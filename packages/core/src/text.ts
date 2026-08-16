/**
 * Rich text layout.
 *
 * A text layer is a list of styled runs, not a string. Wrapping happens across run
 * boundaries; the tallest run on a line sets that line's height; auto-fit finds one
 * scale factor applied to every run, so the relative sizes the template designed
 * hold at any copy length. That last property is the whole point — shrinking only
 * the headline and leaving the price at 130px would break the composition it was
 * shrunk to protect.
 */
import type { SKRSContext2D } from "@napi-rs/canvas";
import type { Run, TextLayer } from "./types.ts";

export interface Token extends Run {
  br?: boolean;
}

export interface LaidLine {
  tokens: Token[];
  width: number;
  /** Tallest run on the line, before line-height is applied. */
  height: number;
}

export interface TextLayout {
  scale: number;
  lines: LaidLine[];
  width: number;
  height: number;
  /** Largest rendered size, so callers can report "auto-fit chose 87px". */
  fontSize: number;
  atMinimum: boolean;
  overflow: boolean;
}

const DEFAULTS: Omit<Run, "text"> = {
  font: "Anton",
  size: 64,
  color: "#000000",
  tracking: 0,
  transform: "none",
};

/** Normalise a layer's shorthand (`text` + top-level style) into explicit runs. */
export function expandRuns(layer: TextLayer): Run[] {
  const base: Omit<Run, "text"> = {
    ...DEFAULTS,
    ...(layer.font !== undefined ? { font: layer.font } : {}),
    ...(layer.size !== undefined ? { size: layer.size } : {}),
    ...(layer.color !== undefined ? { color: layer.color } : {}),
    ...(layer.tracking !== undefined ? { tracking: layer.tracking } : {}),
    ...(layer.transform !== undefined ? { transform: layer.transform } : {}),
  };
  const source = layer.runs?.length
    ? layer.runs
    : [{ text: layer.text ?? "" }];
  return source.map((r) => ({ ...base, ...r } as Run));
}

function applyTransform(text: string, t: Run["transform"]): string {
  return t === "upper" ? text.toUpperCase() : t === "lower" ? text.toLowerCase() : text;
}

export function fontString(run: Run, scale: number): string {
  return `${Math.max(1, run.size * scale)}px "${run.font}"`;
}

/** Split runs into words, preserving each word's style and explicit breaks. */
function tokenize(runs: Run[]): Token[] {
  const out: Token[] = [];
  for (const run of runs) {
    const text = applyTransform(run.text, run.transform);
    const parts = text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) out.push({ ...run, text: "", br: true });
      for (const word of part.split(/\s+/)) {
        if (word !== "") out.push({ ...run, text: word });
      }
    });
  }
  return out;
}

function setFont(ctx: SKRSContext2D, run: Run, scale: number): void {
  ctx.font = fontString(run, scale);
  // Tracking is expressed at size 100 so it scales with the type, the way a
  // designer means it when they say "tighten this by 2".
  const ls = (run.tracking / 100) * run.size * scale;
  try {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${ls}px`;
  } catch {
    /* older Skia builds ignore tracking rather than failing the render */
  }
}

export function measureToken(ctx: SKRSContext2D, token: Token, scale: number): number {
  setFont(ctx, token, scale);
  return ctx.measureText(token.text).width;
}

function spaceWidth(ctx: SKRSContext2D, run: Run, scale: number): number {
  setFont(ctx, run, scale);
  return ctx.measureText(" ").width;
}

/** Wrap at a given scale. `maxW = Infinity` gives one line per explicit break. */
export function wrap(ctx: SKRSContext2D, runs: Run[], maxW: number, scale: number): LaidLine[] {
  const tokens = tokenize(runs);
  const lines: LaidLine[] = [{ tokens: [], width: 0, height: 0 }];

  for (const token of tokens) {
    const line = lines[lines.length - 1]!;
    if (token.br) {
      lines.push({ tokens: [], width: 0, height: 0 });
      continue;
    }
    const w = measureToken(ctx, token, scale);
    const sp = line.tokens.length ? spaceWidth(ctx, token, scale) : 0;
    if (line.tokens.length && line.width + sp + w > maxW) {
      lines.push({ tokens: [token], width: w, height: token.size * scale });
    } else {
      line.tokens.push(token);
      line.width += sp + w;
      line.height = Math.max(line.height, token.size * scale);
    }
  }

  // An empty trailing line from a final "\n" is a real blank line; an empty
  // document is not. Keep the former, drop the latter.
  return lines.filter((l, i) => l.tokens.length > 0 || (i > 0 && i < lines.length - 1) || lines.length === 1);
}

export interface LayoutOptions {
  maxW: number;
  maxH: number;
  lineHeight: number;
  autofit?: { min: number; max: number };
  /** `fit` shrinks to the box; `grow`/`none` keep the authored size and wrap only. */
  mode: "none" | "fit" | "grow";
}

export function layoutText(ctx: SKRSContext2D, runs: Run[], o: LayoutOptions): TextLayout {
  const authoredMax = Math.max(...runs.map((r) => r.size), 1);
  const measure = (scale: number) => {
    const lines = wrap(ctx, runs, o.maxW, scale);
    const height = lines.reduce((a, l) => a + l.height * o.lineHeight, 0);
    const width = Math.max(0, ...lines.map((l) => l.width));
    return { lines, width, height };
  };

  if (o.mode !== "fit") {
    const m = measure(1);
    return {
      scale: 1,
      ...m,
      fontSize: authoredMax,
      atMinimum: false,
      overflow: m.height > o.maxH + 0.5 || m.width > o.maxW + 0.5,
    };
  }

  // Binary search on one shared scale. 24 iterations lands well inside a pixel and
  // costs nothing next to the paint; the alternative (stepping font sizes) both
  // quantises badly and loses the run-to-run ratios.
  const min = (o.autofit?.min ?? 12) / authoredMax;
  const max = (o.autofit?.max ?? 400) / authoredMax;
  let lo = min, hi = Math.max(min, max), best = min;
  let bestM = measure(min);

  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const m = measure(mid);
    if (m.width <= o.maxW + 0.5 && m.height <= o.maxH + 0.5) {
      best = mid;
      bestM = m;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return {
    scale: best,
    ...bestM,
    fontSize: Math.round(authoredMax * best),
    atMinimum: best <= min + 1e-6,
    overflow: bestM.width > o.maxW + 0.5 || bestM.height > o.maxH + 0.5,
  };
}

export function plainText(runs: Run[]): string {
  return runs.map((r) => applyTransform(r.text, r.transform)).join("").replace(/\s+/g, " ").trim();
}
