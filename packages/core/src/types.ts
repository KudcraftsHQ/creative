/**
 * The document schema.
 *
 * A design is data, not a drawing session: this file is the contract every other
 * part of the system is written against — the CLI, the MCP tools, the renderer,
 * the linter and (later) the web editor all read and write exactly this shape.
 *
 * Two properties are worth protecting as it grows:
 *   - Deterministic. Same document + same assets => same pixels. No randomness,
 *     no wall-clock, no "auto" that means "whatever the machine feels like".
 *   - Relative by default. Positions come from anchors and from other layers, so
 *     a headline that grows by a line pushes what follows instead of colliding
 *     with it. Absolute pixels are allowed, but they are the escape hatch.
 */
import { z } from "zod";

/** A length: `120` (px), `"50%"` of the parent axis, or `"auto"`. */
export const Length = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?%$/), z.literal("auto")]);
export type Length = z.infer<typeof Length>;

export const Color = z.string().describe("#rgb, #rrggbb, #rrggbbaa or a css colour name");

export const Anchor = z.enum([
  "top-left", "top", "top-right",
  "left", "center", "right",
  "bottom-left", "bottom", "bottom-right",
]);
export type Anchor = z.infer<typeof Anchor>;

/**
 * Where a layer sits. Three ways to say it, in order of preference:
 *   { anchor: "top-right", inset: 40, w: 520 }     — pinned to the canvas
 *   { below: "headline", gap: 12 }                 — pinned to another layer
 *   { x: 100, y: 240, w: 520, h: 300 }             — absolute, the escape hatch
 */
export const Frame = z.object({
  anchor: Anchor.optional(),
  inset: z.union([z.number(), z.tuple([z.number(), z.number()])]).optional()
    .describe("distance from the anchored edges; [x, y] or one value for both"),
  x: Length.optional(),
  y: Length.optional(),
  w: Length.optional(),
  h: Length.optional(),
  below: z.string().optional().describe("id of the layer this one follows"),
  above: z.string().optional(),
  gap: z.number().default(0),
  align: z.enum(["start", "center", "end"]).optional()
    .describe("cross-axis alignment against the layer named in below/above"),
}).strict();
export type Frame = z.infer<typeof Frame>;

/** `"full"` is sugar for the whole canvas. */
export const FrameSpec = z.union([z.literal("full"), Frame]);

/**
 * One styled span inside a text layer. Wrapping happens across run boundaries and
 * auto-fit scales every run by the same factor, so the relative sizes you designed
 * survive at any copy length.
 */
export const Run = z.object({
  text: z.string(),
  font: z.string().default("Anton").describe("registered family name"),
  size: z.number().default(64),
  color: Color.default("#000000"),
  tracking: z.number().default(0).describe("letter-spacing, in px at size 100"),
  transform: z.enum(["none", "upper", "lower"]).default("none"),
  stroke: z.object({ color: Color, width: z.number() }).optional(),
}).strict();
export type Run = z.infer<typeof Run>;

/** The box painted behind the text. `perLine` is what makes it read as Canva. */
export const TextBox = z.object({
  mode: z.enum(["none", "fit", "grow"]).default("none")
    .describe(
      "none: no box painted. " +
      "fit: scale the text to fill the frame — down when the copy is long, up when it is short, " +
      "bounded by autofit.min/max. A frame with no declared height constrains width only. " +
      "grow: keep the authored size and let the box follow the text.",
    ),
  fill: Color.optional(),
  radius: z.number().default(0),
  pad: z.union([z.number(), z.tuple([z.number(), z.number()])]).default(0)
    .describe("[x, y] or one value for both"),
  perLine: z.boolean().default(true)
    .describe("a box per wrapped line, hugging its own width, overlapping by the vertical padding"),
}).strict();
export type TextBox = z.infer<typeof TextBox>;

const LayerBase = {
  id: z.string().optional(),
  frame: FrameSpec.default({}),
  opacity: z.number().min(0).max(1).default(1),
  rotate: z.number().default(0).describe("degrees, clockwise, about the layer centre"),
  hidden: z.boolean().default(false),
};

export const TextLayer = z.object({
  ...LayerBase,
  type: z.literal("text"),
  /** Shorthand: `text` + the run fields at the top level. Expanded into one run. */
  text: z.string().optional(),
  runs: z.array(Run.partial().extend({ text: z.string() })).optional(),
  font: z.string().optional(),
  size: z.number().optional(),
  color: Color.optional(),
  tracking: z.number().optional(),
  transform: z.enum(["none", "upper", "lower"]).optional(),
  align: z.enum(["left", "center", "right"]).default("left"),
  lineHeight: z.number().default(1.14),
  box: TextBox.default({}),
  autofit: z.object({ min: z.number().default(12), max: z.number().default(400) }).default({}),
  shadow: z.object({ color: Color, blur: z.number(), x: z.number(), y: z.number() }).optional(),
}).strict();
export type TextLayer = z.infer<typeof TextLayer>;

export const ImageLayer = z.object({
  ...LayerBase,
  type: z.literal("image"),
  src: z.string().describe("path, http(s) url, or data: uri"),
  fit: z.enum(["cover", "contain", "stretch"]).default("cover"),
  focal: z.tuple([z.number(), z.number()]).default([0.5, 0.5])
    .describe("the point kept in view when cover crops, in 0..1 of the source"),
  radius: z.number().default(0),
  color: z.object({
    brightness: z.number().optional(),
    saturation: z.number().optional(),
    hue: z.number().optional(),
    tint: Color.optional(),
    tintAmount: z.number().min(0).max(1).default(0.5),
    grayscale: z.boolean().optional(),
  }).optional(),
  shadow: z.object({ color: Color, blur: z.number(), x: z.number(), y: z.number() }).optional(),
}).strict();
export type ImageLayer = z.infer<typeof ImageLayer>;

export const RectLayer = z.object({
  ...LayerBase,
  type: z.literal("rect"),
  fill: Color.optional(),
  stroke: z.object({ color: Color, width: z.number() }).optional(),
  radius: z.number().default(0),
}).strict();
export type RectLayer = z.infer<typeof RectLayer>;

export const Layer = z.discriminatedUnion("type", [TextLayer, ImageLayer, RectLayer]);
export type Layer = z.infer<typeof Layer>;

export const Canvas = z.object({
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  bg: Color.default("#ffffff"),
}).strict();

export const Document = z.object({
  $schema: z.string().optional(),
  name: z.string().optional(),
  canvas: Canvas,
  /** Colours and other values referenced as `"@brand.yellow"` from any field. */
  vars: z.record(z.string()).default({}),
  layers: z.array(Layer).default([]),
  /** Safe area kept clear of text, in px, for marketplace overlays. */
  safeArea: z.number().default(0),
}).strict();
export type Document = z.infer<typeof Document>;

/* ── templates ─────────────────────────────────────────────────────────────── */

export const Slot = z.object({
  id: z.string(),
  type: z.enum(["text", "image", "color"]),
  label: z.string().optional(),
  required: z.boolean().default(false),
  default: z.string().optional(),
  /** Advisory, and reported by `describe`: how long copy can be before it shrinks. */
  maxChars: z.number().optional(),
  aspect: z.string().optional().describe("e.g. \"1:1\" — images are cropped to it"),
  options: z.array(z.string()).optional(),
}).strict();
export type Slot = z.infer<typeof Slot>;

export const Template = z.object({
  $schema: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  slots: z.array(Slot).default([]),
  document: Document,
  /** Extra canvas sizes, each a shallow patch over the base document. */
  sizes: z.record(z.object({
    canvas: Canvas.partial(),
    patch: z.record(z.any()).default({}),
  })).default({}),
}).strict();
export type Template = z.infer<typeof Template>;

/* ── reports ───────────────────────────────────────────────────────────────── */

export interface Box { x: number; y: number; w: number; h: number }

export interface LayerReport {
  id: string;
  type: Layer["type"];
  box: Box;
  /** text only */
  fontSize?: number;
  lines?: number;
  autofitScale?: number;
  atMinimum?: boolean;
  overflow?: boolean;
  text?: string;
}

export interface RenderReport {
  canvas: { w: number; h: number };
  ms: number;
  layers: LayerReport[];
}

export type Finding = {
  rule: string;
  severity: "error" | "warning";
  layer?: string;
  message: string;
  fix?: string;
};
