/**
 * The render, with handles on it.
 *
 * The old note here said there was no free-drag canvas, because dragging a layer to
 * an absolute pixel throws away the anchor model and breaks the next hundred renders.
 * That was the right worry and the wrong conclusion: the problem is not the gesture,
 * it is what the gesture writes.
 *
 * So dragging writes anchors. Moving a layer recomputes its `inset` against the
 * anchor it already has — the same thing `creative edit --move` does — resizing
 * writes `frame.w`/`frame.h`, and the rotate handle writes `rotate`. Nothing here
 * can produce a document the CLI could not have written, and a headline that grows
 * by a line still pushes the fine print down afterwards.
 *
 * Two things follow from the preview being a real render rather than a DOM
 * approximation. The outline moves under the hand and the picture catches up when
 * the hand lets go, because the pixels come from Skia and not from CSS. And one
 * gesture is one save: the document changes when the drag ends, not sixty times
 * on the way.
 */
import { useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import type { DocumentLayer, LayerReport } from "@/lib/api.ts";
import { cn } from "@/lib/cn.ts";

interface Box { x: number; y: number; w: number; h: number }

/** The eight resize handles, named for the compass so the maths reads directly. */
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type Handle = (typeof HANDLES)[number];

const CURSOR: Record<Handle, string> = {
  nw: "nwse-resize", n: "ns-resize", ne: "nesw-resize", e: "ew-resize",
  se: "nwse-resize", s: "ns-resize", sw: "nesw-resize", w: "ew-resize",
};

type Gesture =
  | { kind: "move"; id: string; from: Box; box: Box }
  | { kind: "resize"; id: string; from: Box; handle: Handle; box: Box }
  | { kind: "rotate"; id: string; from: number; angle: number };

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Rotate a delta into the layer's own frame, so a tilted box resizes along itself. */
function unrotate(dx: number, dy: number, degrees: number): [number, number] {
  if (!degrees) return [dx, dy];
  const r = (-degrees * Math.PI) / 180;
  return [dx * Math.cos(r) - dy * Math.sin(r), dx * Math.sin(r) + dy * Math.cos(r)];
}

/**
 * The frame that puts a layer where it was dropped.
 *
 * Anchors are kept wherever they can be. An axis the anchor centres has no inset to
 * write — `top` centres horizontally whatever you set — so dragging along that axis
 * moves the anchor to the nearer edge instead of silently doing nothing. The anchor
 * grid in the inspector lights up on the new one, which is the feedback that says so.
 */
function frameFor(
  frame: Record<string, unknown>,
  box: Box,
  canvas: { w: number; h: number },
  moved: { x: boolean; y: boolean },
): Record<string, unknown> {
  // The absolute escape hatch stays absolute: a document that said x/y meant it.
  if (frame.x !== undefined || frame.y !== undefined) {
    return { ...frame, x: Math.round(box.x), y: Math.round(box.y) };
  }

  const anchor = str(frame.anchor) ?? "top-left";
  let h: "left" | "right" | "" = anchor.includes("left") ? "left" : anchor.includes("right") ? "right" : "";
  let v: "top" | "bottom" | "" = anchor.startsWith("top") ? "top" : anchor.startsWith("bottom") ? "bottom" : "";

  if (!h && moved.x) h = box.x + box.w / 2 < canvas.w / 2 ? "left" : "right";
  if (!v && moved.y) v = box.y + box.h / 2 < canvas.h / 2 ? "top" : "bottom";

  const inset = Array.isArray(frame.inset)
    ? [...(frame.inset as number[])] as [number, number]
    : [Number(frame.inset ?? 0), Number(frame.inset ?? 0)] as [number, number];

  if (h) inset[0] = Math.round(h === "left" ? box.x : canvas.w - box.x - box.w);
  if (v) inset[1] = Math.round(v === "top" ? box.y : canvas.h - box.y - box.h);

  const name = v && h ? `${v}-${h}` : v || h || "center";
  return { ...frame, anchor: name, inset };
}

export function Stage({
  src,
  alt,
  canvas,
  reports,
  selected,
  onSelect,
  onPatch,
  layerIdAt,
}: {
  src: string;
  alt: string;
  canvas: { w: number; h: number };
  reports: LayerReport[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onPatch: (id: string, patch: Partial<DocumentLayer>) => void;
  /** The document layer behind a reported id — the report carries geometry, not fields. */
  layerIdAt: (id: string) => DocumentLayer | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);

  /**
   * Where the last gesture left the layer, held until the server's own geometry
   * catches up. Without it the outline snaps back to the old box for the length of
   * a save and a re-render, which reads as the drag having been rejected.
   *
   * `from` is the reports array it was measured against; a new array means new
   * geometry has arrived and this is no longer the newer answer.
   */
  const [pending, setPending] = useState<
    { id: string; from: LayerReport[]; box?: Box; rotate?: number } | null
  >(null);
  const fresh = pending && pending.from === reports ? pending : null;

  /** Screen pixels to canvas units. The preview is drawn at whatever size it fits. */
  const unit = () => {
    const rect = ref.current!.getBoundingClientRect();
    return canvas.w / rect.width;
  };

  const pct = (b: Box) => ({
    left: `${(b.x / canvas.w) * 100}%`,
    top: `${(b.y / canvas.h) * 100}%`,
    width: `${(b.w / canvas.w) * 100}%`,
    height: `${(b.h / canvas.h) * 100}%`,
  });

  const report = reports.find((r) => r.id === selected);
  const layer = selected ? layerIdAt(selected) : undefined;
  const rotate = num(layer?.rotate) ?? 0;

  // While a gesture is running the outline is wherever the hand has taken it; the
  // rendered picture is still one save behind, and catches up on release.
  const live: Box | undefined =
    gesture && gesture.id === selected && gesture.kind !== "rotate" ? gesture.box
    : fresh?.id === selected && fresh.box ? fresh.box
    : report?.box;

  const liveRotate =
    gesture?.kind === "rotate" && gesture.id === selected ? gesture.angle
    : fresh?.id === selected && fresh.rotate !== undefined ? fresh.rotate
    : rotate;

  const start = (e: React.PointerEvent, g: Gesture) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setGesture(g);
  };

  const origin = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const onMove = (e: React.PointerEvent) => {
    if (!gesture || !report) return;
    const u = unit();
    const dx = (e.clientX - origin.current.x) * u;
    const dy = (e.clientY - origin.current.y) * u;

    if (gesture.kind === "move") {
      setGesture({ ...gesture, box: { ...gesture.from, x: gesture.from.x + dx, y: gesture.from.y + dy } });
      return;
    }

    if (gesture.kind === "resize") {
      const [rx, ry] = unrotate(dx, dy, rotate);
      const b = { ...gesture.from };
      if (gesture.handle.includes("w")) { b.x = gesture.from.x + rx; b.w = gesture.from.w - rx; }
      if (gesture.handle.includes("e")) { b.w = gesture.from.w + rx; }
      if (gesture.handle.includes("n")) { b.y = gesture.from.y + ry; b.h = gesture.from.h - ry; }
      if (gesture.handle.includes("s")) { b.h = gesture.from.h + ry; }
      // A frame narrower than this is a mis-grab, not an intention.
      b.w = Math.max(8, b.w);
      b.h = Math.max(8, b.h);
      setGesture({ ...gesture, box: b });
      return;
    }

    const rect = ref.current!.getBoundingClientRect();
    const cx = rect.left + ((report.box.x + report.box.w / 2) / canvas.w) * rect.width;
    const cy = rect.top + ((report.box.y + report.box.h / 2) / canvas.h) * rect.height;
    const raw = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
    // Shift snaps to 15°, and everything snaps to straight when it is nearly straight —
    // a headline meant to sit level should not end up at 0.4°.
    const snapped = e.shiftKey ? Math.round(raw / 15) * 15 : Math.abs(raw) < 3 ? 0 : Math.round(raw);
    setGesture({ ...gesture, angle: ((snapped + 180) % 360) - 180 });
  };

  const end = () => {
    if (!gesture || !layer) return setGesture(null);
    const wasFull = layer.frame === "full";
    const frame = (wasFull ? {} : (layer.frame ?? {})) as Record<string, unknown>;

    if (gesture.kind === "rotate") {
      if (gesture.angle !== gesture.from) {
        setPending({ id: gesture.id, from: reports, rotate: gesture.angle });
        onPatch(gesture.id, { rotate: gesture.angle });
      }
      return setGesture(null);
    }

    const b = gesture.box;
    const moved = { x: Math.abs(b.x - gesture.from.x) > 0.5, y: Math.abs(b.y - gesture.from.y) > 0.5 };
    const resized = gesture.kind === "resize";
    if (!moved.x && !moved.y && !resized) return setGesture(null);

    const commit = (next: Record<string, unknown>) => {
      setPending({ id: gesture.id, from: reports, box: b });
      onPatch(gesture.id, { frame: next });
      setGesture(null);
    };

    // A layer anchored to another one follows it; dragging must not quietly cut that
    // link, so the vertical distance becomes the gap it already had.
    if (typeof frame.below === "string" || typeof frame.above === "string") {
      const dy = b.y - gesture.from.y;
      const gap = Math.round(Number(frame.gap ?? 0) + (frame.above ? -dy : dy));
      const patch: Record<string, unknown> = { ...frame, gap };
      if (resized) patch.w = Math.round(b.w);
      return commit(patch);
    }

    const next = frameFor(frame, b, canvas, moved);
    if (resized) {
      next.w = Math.round(b.w);
      // Height is only written when a vertical edge was actually dragged: a text
      // layer's height comes from its copy, and pinning it changes what `fit` means.
      if (gesture.handle.includes("n") || gesture.handle.includes("s")) next.h = Math.round(b.h);
    }
    // `"full"` is sugar for the whole canvas, and a layer that has been moved off it
    // is no longer that. Its size is written down so nudging a full-bleed photograph
    // does not also resize it to whatever is left inside the new insets.
    if (wasFull) {
      next.w = Math.round(b.w);
      next.h = Math.round(b.h);
    }
    commit(next);
  };

  return (
    // Not clipped: the rotate handle stands above the top edge, and a layer anchored
    // to the top of the canvas would otherwise have its handle cut off by the frame.
    <div
      ref={ref}
      className="checkerboard relative max-h-full select-none rounded-lg border border-neutral-200 shadow-sm"
      onPointerDown={() => onSelect(null)}
      onPointerMove={onMove}
      onPointerUp={end}
      onPointerCancel={() => setGesture(null)}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="block max-h-[calc(100vh-10rem)] w-auto rounded-[7px]"
      />

      {/* One hit region per layer, in paint order, so the one on top is the one you
          get — the same rule the renderer follows. */}
      {reports.map((r) => {
        const l = layerIdAt(r.id);
        return (
          <button
            key={r.id}
            aria-label={`Select ${r.id}`}
            onPointerDown={(e) => {
              if (r.id !== selected) onSelect(r.id);
              origin.current = { x: e.clientX, y: e.clientY };
              start(e, { kind: "move", id: r.id, from: r.box, box: r.box });
            }}
            className={cn(
              "absolute cursor-move",
              selected === r.id ? "" : "hover:ring-2 hover:ring-white/70",
            )}
            style={{ ...pct(r.box), transform: `rotate(${num(l?.rotate) ?? 0}deg)` }}
          />
        );
      })}

      {/* the selected layer's chrome */}
      {live && selected ? (
        <div
          className="pointer-events-none absolute outline outline-2 outline-offset-0 outline-sky-500"
          style={{ ...pct(live), transform: `rotate(${liveRotate}deg)` }}
        >
          {HANDLES.map((h) => (
            <button
              key={h}
              aria-label={`Resize ${h}`}
              onPointerDown={(e) => {
                origin.current = { x: e.clientX, y: e.clientY };
                start(e, { kind: "resize", id: selected, handle: h, from: live, box: live });
              }}
              className="pointer-events-auto absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-sky-600 bg-white"
              style={{
                left: h.includes("w") ? "0%" : h.includes("e") ? "100%" : "50%",
                top: h.includes("n") ? "0%" : h.includes("s") ? "100%" : "50%",
                cursor: CURSOR[h],
              }}
            />
          ))}

          <button
            aria-label="Rotate"
            onPointerDown={(e) => {
              origin.current = { x: e.clientX, y: e.clientY };
              start(e, { kind: "rotate", id: selected, from: rotate, angle: rotate });
            }}
            className="pointer-events-auto absolute left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border border-sky-600 bg-white text-sky-600 shadow-sm"
            style={{ top: -34, cursor: "grab" }}
            title="Drag to rotate · shift snaps to 15°"
          >
            <RotateCw className="h-3 w-3" />
          </button>
          <div className="absolute left-1/2 top-0 h-[14px] w-px -translate-x-1/2 -translate-y-full bg-sky-500" />

          {gesture ? (
            <span className="absolute -top-7 left-0 rounded bg-sky-600 px-1.5 py-0.5 text-[10px] tabular-nums text-white">
              {gesture.kind === "rotate"
                ? `${gesture.angle}°`
                : `${Math.round(live.x)}, ${Math.round(live.y)} · ${Math.round(live.w)}×${Math.round(live.h)}`}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
