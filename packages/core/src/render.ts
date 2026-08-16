/**
 * The renderer: resolve every frame, paint, and report what happened.
 *
 * Layout and paint share one pass because a text layer's box is not knowable until
 * its content has been measured, and the layer after it may be anchored to that box.
 * Resolving in document order and remembering each result is enough for the anchor
 * model (`below`/`above` refer backwards), and it keeps the report honest: the boxes
 * an agent reads back are the boxes that were actually painted.
 */
import { createCanvas, loadImage, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { registerAll } from "./fonts.ts";
import { loadSource, applyColor } from "./assets.ts";
import { expandRuns, layoutText, fontString, plainText, type LaidLine } from "./text.ts";
import type { Box, Document, ImageLayer, Layer, LayerReport, RectLayer, RenderReport, TextLayer } from "./types.ts";

export interface RenderOptions {
  /** Where relative image paths resolve from. */
  baseDir?: string;
  /** 2 renders at twice the canvas size for retina exports. */
  scale?: number;
}

export interface RenderResult {
  canvas: Canvas;
  report: RenderReport;
}

const pad2 = (p: number | [number, number]): [number, number] =>
  Array.isArray(p) ? p : [p, p];

function resolveLength(v: unknown, axis: number, fallback: number): number {
  if (v === undefined || v === "auto") return fallback;
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.endsWith("%")) return (parseFloat(v) / 100) * axis;
  return fallback;
}

/** Substitute `@var.name` references from the document's `vars` block. */
export function resolveVars<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === "string") {
    return (value.startsWith("@") ? vars[value.slice(1)] ?? value : value) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => resolveVars(v, vars)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveVars(v, vars);
    return out as T;
  }
  return value;
}

/**
 * What a layer has to work with, and whether the document actually said so.
 *
 * The distinction matters: a `fit` text layer with a declared height shrinks into
 * that height, but one without a declared height should be as tall as its content —
 * not as tall as the rest of the canvas, which would push everything anchored below
 * it off the bottom edge.
 */
interface Available {
  w: number;
  h: number;
  explicitW: boolean;
  explicitH: boolean;
}

function anchorPosition(
  anchor: string | undefined,
  inset: [number, number],
  size: { w: number; h: number },
  canvas: { w: number; h: number },
): { x: number; y: number } {
  const [ix, iy] = inset;
  const a = anchor ?? "top-left";
  const x = a.includes("left") ? ix
    : a.includes("right") ? canvas.w - size.w - ix
    : (canvas.w - size.w) / 2;
  const y = a.startsWith("top") ? iy
    : a.startsWith("bottom") ? canvas.h - size.h - iy
    : a === "left" || a === "right" || a === "center" ? (canvas.h - size.h) / 2
    : iy;
  return { x, y };
}

/** Resolve one layer's box, given the boxes of the layers before it. */
function place(
  layer: Layer,
  canvas: { w: number; h: number },
  placed: Map<string, Box>,
  contentSize: (avail: Available) => { w: number; h: number },
): Box {
  const frame = layer.frame === "full"
    ? { anchor: "top-left" as const, inset: 0, x: 0, y: 0, w: canvas.w, h: canvas.h, gap: 0 }
    : layer.frame;

  const inset = pad2((frame.inset ?? 0) as number | [number, number]);
  const ref = frame.below ?? frame.above;
  const refBox = ref ? placed.get(ref) : undefined;
  if (ref && !refBox) {
    throw new Error(`layer frame references "${ref}", which is not an earlier layer id`);
  }

  // Available space: an explicit w/h wins; otherwise the canvas less its insets,
  // or the referenced layer's width when following one.
  const availW = resolveLength(frame.w, canvas.w, refBox ? refBox.w : canvas.w - inset[0] * 2);
  const availH = resolveLength(frame.h, canvas.h, refBox
    ? canvas.h - (refBox.y + refBox.h) - (frame.gap ?? 0) - inset[1]
    : canvas.h - inset[1] * 2);

  const size = contentSize({
    w: availW,
    h: availH,
    explicitW: frame.w !== undefined && frame.w !== "auto",
    explicitH: frame.h !== undefined && frame.h !== "auto",
  });

  if (refBox) {
    const gap = frame.gap ?? 0;
    const y = frame.above ? refBox.y - gap - size.h : refBox.y + refBox.h + gap;
    const align = frame.align ?? "start";
    const x = align === "center" ? refBox.x + (refBox.w - size.w) / 2
      : align === "end" ? refBox.x + refBox.w - size.w
      : refBox.x;
    return { x, y, w: size.w, h: size.h };
  }

  if (frame.x !== undefined || frame.y !== undefined) {
    return {
      x: resolveLength(frame.x, canvas.w, 0),
      y: resolveLength(frame.y, canvas.h, 0),
      w: size.w,
      h: size.h,
    };
  }

  const pos = anchorPosition(frame.anchor, inset, size, canvas);
  return { x: pos.x, y: pos.y, w: size.w, h: size.h };
}

function roundRect(ctx: SKRSContext2D, b: Box, r: number): void {
  ctx.beginPath();
  if (r > 0) ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(r, b.w / 2, b.h / 2));
  else ctx.rect(b.x, b.y, b.w, b.h);
}

/**
 * The axis-aligned area a rotated box occupies.
 *
 * Reported alongside the box because the box is where the layer was *placed* and
 * this is where it ended up: rotate a headline and its corners leave the canvas
 * long before its frame does. The linter reads this one, so its off-canvas verdict
 * is about the pixels rather than the intent.
 */
export function rotatedBounds(box: Box, degrees: number): Box {
  const r = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(r)), sin = Math.abs(Math.sin(r));
  const w = box.w * cos + box.h * sin;
  const h = box.w * sin + box.h * cos;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/**
 * Rotation and mirroring both happen about the layer's centre, so neither moves it:
 * a flipped photograph stays in its frame, and the layers anchored to it do not
 * shift because a mirror was turned on.
 */
function withTransform(ctx: SKRSContext2D, layer: Layer, box: Box, draw: () => void): void {
  ctx.save();
  ctx.globalAlpha = layer.opacity ?? 1;
  if (layer.rotate || layer.flipX || layer.flipY) {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    ctx.translate(cx, cy);
    if (layer.rotate) ctx.rotate((layer.rotate * Math.PI) / 180);
    if (layer.flipX || layer.flipY) ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
    ctx.translate(-cx, -cy);
  }
  draw();
  ctx.restore();
}

function setShadow(ctx: SKRSContext2D, shadow?: { color: string; blur: number; x: number; y: number }): void {
  if (!shadow) return;
  ctx.shadowColor = shadow.color;
  ctx.shadowBlur = shadow.blur;
  ctx.shadowOffsetX = shadow.x;
  ctx.shadowOffsetY = shadow.y;
}

function clearShadow(ctx: SKRSContext2D): void {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function paintTextLayer(
  ctx: SKRSContext2D,
  layer: TextLayer,
  box: Box,
  layout: ReturnType<typeof layoutText>,
): void {
  const [padX, padY] = pad2(layer.box.pad);
  const perLine = layer.box.perLine && layer.box.mode !== "none";
  const drawBox = layer.box.mode !== "none" && layer.box.fill !== undefined;

  // In `grow` the box hugs the text; in `fit` the frame is fixed and the text sits
  // inside it. Either way the first line starts one padding down from the top.
  let cy = box.y;

  if (drawBox && !perLine) {
    setShadow(ctx, layer.shadow);
    ctx.fillStyle = layer.box.fill!;
    roundRect(ctx, box, layer.box.radius);
    ctx.fill();
    clearShadow(ctx);
  }

  for (const line of layout.lines) {
    const lineH = line.height * layer.lineHeight;
    const boxW = line.width + padX * 2;
    const boxH = lineH + padY * 2;

    const alignOffset = layer.align === "center" ? (box.w - boxW) / 2
      : layer.align === "right" ? box.w - boxW
      : 0;
    const bx = box.x + alignOffset;

    if (drawBox && perLine) {
      setShadow(ctx, layer.shadow);
      ctx.fillStyle = layer.box.fill!;
      roundRect(ctx, { x: bx, y: cy, w: boxW, h: boxH }, layer.box.radius);
      ctx.fill();
      clearShadow(ctx);
    }

    // Baseline: middle of the line box, nudged down because uppercase display
    // faces sit optically high inside their em box.
    const baseline = cy + boxH / 2 + line.height * 0.06;
    let tx = bx + padX;
    ctx.textBaseline = "middle";

    for (const [i, token] of line.tokens.entries()) {
      ctx.font = fontString(token, layout.scale);
      const ls = (token.tracking / 100) * token.size * layout.scale;
      try {
        (ctx as unknown as { letterSpacing: string }).letterSpacing = `${ls}px`;
      } catch { /* ignore */ }
      if (i > 0) tx += ctx.measureText(" ").width;
      if (token.stroke) {
        ctx.strokeStyle = token.stroke.color;
        ctx.lineWidth = token.stroke.width;
        ctx.lineJoin = "round";
        ctx.strokeText(token.text, tx, baseline);
      }
      ctx.fillStyle = token.color;
      if (!drawBox) setShadow(ctx, layer.shadow);
      ctx.fillText(token.text, tx, baseline);
      clearShadow(ctx);
      tx += ctx.measureText(token.text).width;
    }

    // Per-line boxes overlap by their vertical padding so a wrapped headline reads
    // as one shape rather than a stack of separate bars.
    cy += perLine && drawBox ? boxH - padY : lineH;
  }
}

/**
 * Decoding is async and `ctx.save()/restore()` is not: the image has to be in hand
 * before the transform is pushed, or the restore happens while the paint is still
 * pending and every later layer inherits the wrong matrix.
 */
async function prepareImage(layer: ImageLayer, baseDir: string) {
  const graded = await applyColor(await loadSource(layer.src, baseDir), layer.color);
  return loadImage(graded);
}

/**
 * The rectangle of the source a layer draws from, in source pixels.
 *
 * Clamped rather than rejected: a crop that runs off the edge is a slider dragged
 * too far, not a malformed document, and refusing to render is a worse answer
 * than drawing the part that exists. A degenerate crop falls back to the whole
 * image, because a zero-width window would draw nothing at all and look like the
 * image failing to load.
 */
function sourceRect(
  crop: [number, number, number, number] | undefined,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  if (!crop) return { x: 0, y: 0, w: width, h: height };

  const [cx, cy, cw, ch] = crop;
  const x = Math.min(Math.max(cx, 0), 1) * width;
  const y = Math.min(Math.max(cy, 0), 1) * height;
  const w = Math.min(Math.max(cw, 0) * width, width - x);
  const h = Math.min(Math.max(ch, 0) * height, height - y);

  if (w < 1 || h < 1) return { x: 0, y: 0, w: width, h: height };
  return { x, y, w, h };
}

/**
 * Draw the image into its frame, and no further.
 *
 * `cover` scales by the larger of the two ratios, so it is *always* bigger than the
 * frame it fills — that is what cover means. Without a clip the excess paints over
 * whatever sits beside it, silently and invisibly to the linter, which checks the
 * frame and finds it perfectly in bounds. The frame is the promise the document
 * makes to every layer anchored to this one, so the paint is held to it whether or
 * not the corners happen to be rounded.
 */
function drawImageInto(
  ctx: SKRSContext2D,
  layer: ImageLayer,
  box: Box,
  img: Awaited<ReturnType<typeof loadImage>>,
): void {
  ctx.save();
  roundRect(ctx, box, layer.radius);
  ctx.clip();

  // The crop is a window on the source, in its own pixels. Everything below works
  // against that window rather than the whole image, so `fit` and `focal` mean
  // what they always meant — just applied to the part that was kept.
  const src = sourceRect(layer.crop, img.width, img.height);

  if (layer.fit === "stretch") {
    ctx.drawImage(img, src.x, src.y, src.w, src.h, box.x, box.y, box.w, box.h);
  } else {
    const s = layer.fit === "cover"
      ? Math.max(box.w / src.w, box.h / src.h)
      : Math.min(box.w / src.w, box.h / src.h);
    const w = src.w * s, h = src.h * s;
    // The focal point is the part of the source kept in frame when cover crops.
    const [fx, fy] = layer.focal;
    const x = layer.fit === "cover" ? box.x + (box.w - w) * fx : box.x + (box.w - w) / 2;
    const y = layer.fit === "cover" ? box.y + (box.h - h) * fy : box.y + (box.h - h) / 2;
    ctx.drawImage(img, src.x, src.y, src.w, src.h, x, y, w, h);
  }
  ctx.restore();
}

function paintImageLayer(
  ctx: SKRSContext2D,
  layer: ImageLayer,
  box: Box,
  img: Awaited<ReturnType<typeof loadImage>>,
  scale: number,
): void {
  if (!layer.shadow) {
    drawImageInto(ctx, layer, box, img);
    return;
  }

  // A shadow has to be cast by what is actually painted. Setting one on the context
  // and clipping would throw the clip away as well — a canvas shadow is drawn with
  // the same clip as its shape — while not clipping would cast from the pixels
  // outside the frame, which nobody can see. So the paint happens on its own
  // surface, and that surface is what casts: a cut-out keeps its silhouette, a
  // cover fill casts from its rounded frame, and neither leaks past the box.
  const off = createCanvas(
    Math.max(1, Math.round(box.w * scale)),
    Math.max(1, Math.round(box.h * scale)),
  );
  const octx = off.getContext("2d");
  octx.scale(scale, scale);
  drawImageInto(octx, layer, { x: 0, y: 0, w: box.w, h: box.h }, img);

  setShadow(ctx, layer.shadow);
  ctx.drawImage(off, box.x, box.y, box.w, box.h);
  clearShadow(ctx);
}

function paintRectLayer(ctx: SKRSContext2D, layer: RectLayer, box: Box): void {
  roundRect(ctx, box, layer.radius);
  if (layer.fill) {
    ctx.fillStyle = layer.fill;
    ctx.fill();
  }
  if (layer.stroke) {
    ctx.strokeStyle = layer.stroke.color;
    ctx.lineWidth = layer.stroke.width;
    ctx.stroke();
  }
}

/** Reported only when there is something to report — see `LayerReport.bounds`. */
const bounds = (layer: Layer, box: Box): { bounds?: Box } =>
  layer.rotate ? { bounds: rotatedBounds(box, layer.rotate) } : {};

export async function render(doc: Document, opts: RenderOptions = {}): Promise<RenderResult> {
  const started = performance.now();
  registerAll();

  const scale = opts.scale ?? 1;
  const baseDir = opts.baseDir ?? process.cwd();
  const canvasSize = { w: doc.canvas.w, h: doc.canvas.h };

  const canvas = createCanvas(Math.round(canvasSize.w * scale), Math.round(canvasSize.h * scale));
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  if (doc.canvas.bg !== "transparent") {
    ctx.fillStyle = doc.canvas.bg;
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);
  }

  const placed = new Map<string, Box>();
  const layers: LayerReport[] = [];

  for (const [i, raw] of doc.layers.entries()) {
    const layer = resolveVars(raw, doc.vars) as Layer;
    const id = layer.id ?? `${layer.type}${i}`;
    if (layer.hidden) continue;

    if (layer.type === "text") {
      const runs = expandRuns(layer);
      const [padX, padY] = pad2(layer.box.pad);
      let layout!: ReturnType<typeof layoutText>;

      const box = place(layer, canvasSize, placed, (avail) => {
        layout = layoutText(ctx, runs, {
          maxW: Math.max(1, avail.w - padX * 2),
          // Only a declared height constrains auto-fit. Without one, "fit" means
          // "fit the width" and the layer is as tall as the text turns out to be.
          maxH: layer.box.mode === "fit" && avail.explicitH
            ? Math.max(1, avail.h - padY * 2)
            : Infinity,
          lineHeight: layer.lineHeight,
          autofit: layer.autofit,
          mode: layer.box.mode,
        });
        const contentH = layout.lines.reduce((a: number, l: LaidLine) => a + l.height * layer.lineHeight, 0);
        // A declared width is a promise to the layers anchored to this one, so it is
        // kept even when the text is narrower; `grow` is the mode that says otherwise.
        const w = layer.box.mode === "grow" || !avail.explicitW
          ? Math.min(layout.width + padX * 2, avail.w)
          : avail.w;
        const h = avail.explicitH ? avail.h : contentH + padY * 2;
        return { w, h };
      });

      withTransform(ctx, layer, box, () => paintTextLayer(ctx, layer, box, layout));
      placed.set(id, box);
      layers.push({
        id,
        type: "text",
        box,
        ...bounds(layer, box),
        fontSize: layout.fontSize,
        lines: layout.lines.length,
        autofitScale: Number(layout.scale.toFixed(4)),
        atMinimum: layout.atMinimum,
        overflow: layout.overflow,
        text: plainText(runs),
      });
      continue;
    }

    if (layer.type === "image") {
      // Decoded before placing so a layer that declares only a width can take its
      // height from the source's aspect ratio instead of the rest of the canvas.
      const img = await prepareImage(layer, baseDir);
      // The aspect of what will actually be drawn — a layer that declares only a
      // width takes its height from the crop, not from the uncropped original.
      const src = sourceRect(layer.crop, img.width, img.height);
      const aspect = src.h / src.w;
      const box = place(layer, canvasSize, placed, (avail) => ({
        w: avail.explicitW || !avail.explicitH ? avail.w : avail.h / aspect,
        h: avail.explicitH || !avail.explicitW ? avail.h : avail.w * aspect,
      }));
      withTransform(ctx, layer, box, () => paintImageLayer(ctx, layer, box, img, scale));
      placed.set(id, box);
      layers.push({ id, type: "image", box, ...bounds(layer, box) });
      continue;
    }

    const box = place(layer, canvasSize, placed, (avail) => ({ w: avail.w, h: avail.h }));
    withTransform(ctx, layer, box, () => paintRectLayer(ctx, layer, box));
    placed.set(id, box);
    layers.push({ id, type: "rect", box, ...bounds(layer, box) });
  }

  return {
    canvas,
    report: {
      canvas: { w: canvas.width, h: canvas.height },
      ms: Math.round(performance.now() - started),
      layers,
    },
  };
}
