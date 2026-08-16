/**
 * The editor: layers and lint on the left, the document in the middle, the selected
 * layer on the right.
 *
 * The middle is the document in one of two forms — the render, or the JSON. They are
 * the same thing, and the toggle between them is the point: the inspector will always
 * cover less of the schema than the schema has, because fields land in core first, so
 * the literal document is always one click away and always editable.
 *
 * There is no free-drag canvas, and that is a decision rather than a gap. Position
 * comes from anchors and from other layers, so a headline that grows by a line pushes
 * the fine print down instead of colliding with it. Dragging to an absolute pixel
 * throws that away and breaks the next hundred renders — so the inspector edits the
 * same anchors the CLI writes, and the preview is the rendered image rather than a
 * browser's approximation of one. What *is* draggable is what has nothing to be
 * relative to: the crop window on a photograph.
 *
 * The right panel is a runs table because a text layer is a list of styled spans,
 * not a string: the 3× ratio between the price and the words around it is the
 * design, and it has to be editable as such.
 */
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, AlertTriangle, Info, Type, Image as ImageIcon, Square,
  Eye, EyeOff, Upload, Plus, Trash2, Images, Copy, Download, ArrowUp, ArrowDown,
  FlipHorizontal, FlipVertical, Italic, Braces,
} from "lucide-react";
import {
  api,
  ApiError,
  renderUrl,
  uploadAsset,
  type Asset,
  type CreativeDocument,
  type Design,
  type DocumentLayer,
  type Finding,
  type LayerReport,
  type Project,
} from "@/lib/api.ts";
import { useLiveLibrary } from "@/lib/use-live.ts";
import { Button, Spinner } from "@/components/ui.tsx";
import { JsonPane } from "@/components/json-pane.tsx";
import {
  Choice, ColorField, Field, Grid3, NumberField, Section, SelectField,
  SliderField, TextField, Toggle,
} from "@/components/fields.tsx";
import {
  IconButton, TooltipProvider,
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from "@/components/menu.tsx";
import { cn } from "@/lib/cn.ts";

const ANCHORS = [
  "top-left", "top", "top-right",
  "left", "center", "right",
  "bottom-left", "bottom", "bottom-right",
] as const;

/** The ratios worth offering. A design is authored at one and exported at several. */
const SIZES: Array<{ label: string; w: number; h: number }> = [
  { label: "1:1", w: 1080, h: 1080 },
  { label: "4:5", w: 1080, h: 1350 },
  { label: "9:16", w: 1080, h: 1920 },
];

type Run = {
  text: string;
  font?: string;
  size?: number;
  color?: string;
  tracking?: number;
  transform?: "none" | "upper" | "lower";
  italic?: boolean;
  stroke?: { color: string; width: number };
};

type Shadow = { color: string; blur: number; x: number; y: number };
type Crop = [number, number, number, number];

/** `DocumentLayer` is deliberately loose — core owns the schema — so read it as such. */
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const bool = (v: unknown): boolean => v === true;

const layerIcon = (type: string) =>
  type === "text" ? Type : type === "image" ? ImageIcon : Square;

const layerId = (layer: DocumentLayer, i: number) => layer.id ?? `${layer.type}${i}`;

export function Editor() {
  const { id = "" } = useParams();
  useLiveLibrary();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"preview" | "json">("preview");
  const [renderedAt, setRenderedAt] = useState<number>(() => Date.now());

  const design = useQuery({
    queryKey: ["design", id],
    queryFn: () => api.get<Design>(`/api/designs/${id}`),
  });

  const lint = useQuery({
    queryKey: ["design", id, "lint", design.data?.version],
    queryFn: () => api.get<{ findings: Finding[]; layers: LayerReport[] }>(`/api/designs/${id}/lint`),
    enabled: Boolean(design.data),
  });

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<{ items: Project[] }>("/api/projects"),
  });

  const save = useMutation({
    mutationFn: (document: CreativeDocument) => api.patch<Design>(`/api/designs/${id}`, { document }),
    onSuccess: () => {
      // The write publishes an event that invalidates these anyway — doing it here
      // too means the tab that made the edit does not wait on a round trip through
      // Redis to see its own change.
      setRenderedAt(Date.now());
      queryClient.invalidateQueries({ queryKey: ["design", id] });
      queryClient.invalidateQueries({ queryKey: ["designs"] });
    },
    onError: (err) => {
      // In the JSON view the refusal is shown under the pane, against the text that
      // caused it. A toast there would be the same message twice, and the shorter
      // of the two.
      if (view === "json") return;
      toast.error(err instanceof Error ? err.message : "That document was refused");
    },
  });

  const patchDesign = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch<Design>(`/api/designs/${id}`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["design", id] });
      queryClient.invalidateQueries({ queryKey: ["designs"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  if (design.isPending) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (design.isError || !design.data) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-sm text-neutral-600">That design is not here.</p>
        <Button asChild variant="secondary" size="sm">
          <Link to="/">Back to the library</Link>
        </Button>
      </div>
    );
  }

  const doc = design.data.document;
  const layers = doc.layers ?? [];
  const currentIndex = layers.findIndex((l, i) => layerId(l, i) === selected);
  const current = currentIndex >= 0 ? layers[currentIndex]! : null;
  const findings = lint.data?.findings ?? [];
  const projectName = projects.data?.items.find((p) => p.id === design.data!.projectId)?.name;

  const write = (next: CreativeDocument) => save.mutate(next);

  const patchLayer = (index: number, patch: Partial<DocumentLayer>) =>
    write({ ...doc, layers: layers.map((l, i) => (i === index ? { ...l, ...patch } : l)) });

  const setCanvas = (w: number, h: number) => write({ ...doc, canvas: { ...doc.canvas, w, h } });

  /**
   * Reordering is reordering the array, which is also paint order — and layers
   * anchored with `below` refer *backwards*, so moving one above the layer it
   * follows would leave the document unrenderable. Refused rather than saved.
   */
  const moveLayer = (index: number, by: number) => {
    const to = index + by;
    if (to < 0 || to >= layers.length) return;
    const next = [...layers];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved!);

    const ids = next.map((l, j) => layerId(l, j));
    for (const [j, l] of next.entries()) {
      const ref = typeof l.frame === "object" && l.frame
        ? ((l.frame as Record<string, unknown>).below ?? (l.frame as Record<string, unknown>).above)
        : undefined;
      if (typeof ref === "string" && ids.indexOf(ref) >= j) {
        toast.error(`“${ids[j]}” is anchored to “${ref}”, which would end up after it`);
        return;
      }
    }
    write({ ...doc, layers: next });
  };

  const duplicateLayer = (index: number) => {
    const source = layers[index]!;
    const base = layerId(source, index);
    const taken = new Set(layers.map((l, j) => layerId(l, j)));
    let id = `${base}-copy`;
    for (let n = 2; taken.has(id); n++) id = `${base}-copy-${n}`;

    const next = [...layers];
    next.splice(index + 1, 0, { ...source, id });
    write({ ...doc, layers: next });
  };

  const removeLayer = (index: number) => {
    const gone = layerId(layers[index]!, index);
    // A layer anchored to the deleted one would throw at render time, so those
    // are cut loose to the canvas rather than left pointing at nothing.
    const next = layers
      .filter((_, j) => j !== index)
      .map((l) => {
        if (typeof l.frame !== "object" || !l.frame) return l;
        const frame = l.frame as Record<string, unknown>;
        if (frame.below !== gone && frame.above !== gone) return l;
        toast.message(`“${l.id}” was anchored to “${gone}” — it is now anchored to the canvas`);
        return { ...l, frame: { ...frame, below: undefined, above: undefined, anchor: frame.anchor ?? "top-left" } };
      });
    if (selected === gone) setSelected(null);
    write({ ...doc, layers: next });
  };

  return (
    <TooltipProvider>
    <div className="flex h-screen flex-col">
      {/* ┌ creative / project / name ───────────── ● live ┐ */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-neutral-200 bg-white px-3">
        <Button asChild variant="ghost" size="icon">
          <Link to="/" aria-label="Back to the library">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <span className="text-sm text-neutral-400">
          creative /{projectName ? ` ${projectName} /` : ""}
        </span>
        <input
          className="min-w-0 flex-1 rounded px-1 text-sm font-medium outline-none focus:bg-neutral-100"
          defaultValue={design.data.name}
          onBlur={(e) => {
            const value = e.target.value.trim();
            if (value && value !== design.data!.name) patchDesign.mutate({ name: value });
          }}
        />

        {/* the same document, drawn or spelled out */}
        <div className="flex shrink-0 items-center rounded-lg border border-neutral-200 p-0.5">
          {([
            { key: "preview", label: "preview", Icon: ImageIcon },
            { key: "json", label: "JSON", Icon: Braces },
          ] as const).map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={cn(
                "flex h-6 items-center gap-1.5 rounded px-2 text-xs transition-colors",
                view === key ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100",
              )}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>

        <select
          className="h-7 rounded-lg border border-neutral-200 bg-white px-2 text-xs text-neutral-600 outline-none focus:ring-2 focus:ring-neutral-400"
          value={design.data.projectId ?? ""}
          onChange={(e) => patchDesign.mutate({ projectId: e.target.value || null })}
          aria-label="Project"
        >
          <option value="">No project</option>
          {(projects.data?.items ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {/* Live, in the sense that matters: a write from a terminal lands here. */}
        <span className="flex items-center gap-1.5 text-xs text-neutral-500" title="Edits from the CLI, an agent or another tab arrive here without a refresh">
          <span className={cn("h-1.5 w-1.5 rounded-full", save.isPending ? "bg-amber-500" : "bg-green-500")} />
          live
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* LAYERS · sizes · lint */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-white">
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <Heading>Layers</Heading>
            {layers.map((layer, i) => {
              const lid = layerId(layer, i);
              const Icon = layerIcon(layer.type);
              const hasFinding = findings.some((f) => f.layer === lid);
              return (
                <ContextMenu key={lid}>
                <ContextMenuTrigger asChild>
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                    selected === lid ? "bg-neutral-900 text-white" : "hover:bg-neutral-100",
                  )}
                >
                  <button
                    onClick={() => patchLayer(i, { hidden: !layer.hidden })}
                    aria-label={layer.hidden ? "Show" : "Hide"}
                    className="opacity-60 hover:opacity-100"
                  >
                    {layer.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                  <button onClick={() => setSelected(lid)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate">{lid}</span>
                    <span className={cn("text-[10px]", selected === lid ? "text-white/50" : "text-neutral-400")}>
                      {layer.type}
                    </span>
                  </button>
                  {hasFinding ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : null}
                </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    icon={layer.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    onSelect={() => patchLayer(i, { hidden: !layer.hidden })}
                  >
                    {layer.hidden ? "Show" : "Hide"}
                  </ContextMenuItem>
                  <ContextMenuItem
                    icon={<Copy className="h-3.5 w-3.5" />}
                    onSelect={() => duplicateLayer(i)}
                  >
                    Duplicate
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    icon={<FlipHorizontal className="h-3.5 w-3.5" />}
                    onSelect={() => patchLayer(i, { flipX: !bool(layer.flipX) })}
                  >
                    Flip horizontally
                  </ContextMenuItem>
                  <ContextMenuItem
                    icon={<FlipVertical className="h-3.5 w-3.5" />}
                    onSelect={() => patchLayer(i, { flipY: !bool(layer.flipY) })}
                  >
                    Flip vertically
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    disabled={i === 0}
                    icon={<ArrowUp className="h-3.5 w-3.5" />}
                    onSelect={() => moveLayer(i, -1)}
                  >
                    Move earlier
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={i === layers.length - 1}
                    icon={<ArrowDown className="h-3.5 w-3.5" />}
                    onSelect={() => moveLayer(i, 1)}
                  >
                    Move later
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    danger
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onSelect={() => {
                      if (!confirm(`Delete the layer “${lid}”?`)) return;
                      removeLayer(i);
                    }}
                  >
                    Delete layer
                  </ContextMenuItem>
                </ContextMenuContent>
                </ContextMenu>
              );
            })}

            <Heading className="mt-4">Sizes</Heading>
            <div className="flex flex-wrap gap-1 px-1">
              {SIZES.map((s) => {
                const active = doc.canvas.w === s.w && doc.canvas.h === s.h;
                return (
                  <button
                    key={s.label}
                    onClick={() => setCanvas(s.w, s.h)}
                    className={cn(
                      "rounded border px-2 py-1 text-xs",
                      active
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-neutral-200 hover:bg-neutral-100",
                    )}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ⚠ LINT — under the layers, because a finding names a layer */}
          <div className="max-h-72 shrink-0 overflow-y-auto border-t border-neutral-200 p-2">
            <Heading>
              {findings.length ? `⚠ Lint · ${findings.length}` : "Lint"}
            </Heading>
            {lint.isPending ? (
              <div className="px-2 py-1"><Spinner /></div>
            ) : findings.length === 0 ? (
              <p className="px-2 text-xs text-neutral-400">Nothing to fix.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {findings.map((f, i) => (
                  <li
                    key={`${f.rule}-${i}`}
                    className={cn(
                      "cursor-pointer rounded-md border p-2 text-xs",
                      f.severity === "error"
                        ? "border-red-200 bg-red-50 hover:bg-red-100"
                        : "border-amber-200 bg-amber-50 hover:bg-amber-100",
                    )}
                    onClick={() => f.layer && setSelected(f.layer)}
                  >
                    <div className="flex items-start gap-1.5">
                      {f.severity === "error" ? (
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-red-600" />
                      ) : (
                        <Info className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-neutral-800">
                          {f.layer ? <span className="text-neutral-500">{f.layer}: </span> : null}
                          {f.message}
                        </p>
                        {f.fix ? <p className="mt-0.5 text-neutral-600">{f.fix}</p> : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* the document — drawn, or spelled out */}
        <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 overflow-auto bg-neutral-100 p-6">
          {view === "preview" ? (
            <div className="checkerboard max-h-full overflow-hidden rounded-lg border border-neutral-200 shadow-sm">
              <img
                key={design.data.version}
                src={renderUrl(design.data.id, design.data.version, 900)}
                alt={design.data.name}
                className="block max-h-[calc(100vh-10rem)] w-auto"
              />
            </div>
          ) : (
            // Keyed on the version so a write from a terminal replaces the text
            // rather than leaving an edit in progress against a document that has
            // already moved on.
            <JsonPane
              key={design.data.version}
              doc={doc}
              onApply={write}
              saving={save.isPending}
              rejected={save.error instanceof ApiError ? save.error.message : undefined}
            />
          )}
          <p className="shrink-0 text-xs text-neutral-500">
            {doc.canvas.w}×{doc.canvas.h}
            {" · "}
            {new Date(renderedAt).toLocaleTimeString()}
            {design.data.updatedVia ? ` · via ${design.data.updatedVia.toUpperCase()}` : ""}
            {" · v"}
            {design.data.version}
          </p>
        </main>

        {/* the selected layer */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-neutral-200 bg-white p-3">
          {current ? (
            <Inspector
              // Fields hold their own value until they are left, so switching
              // layers has to give them new ones to hold.
              key={selected}
              layer={current}
              report={lint.data?.layers.find((l) => l.id === selected)}
              onPatch={(patch) => patchLayer(currentIndex, patch)}
              designId={design.data.id}
              designName={design.data.name}
              document={doc}
            />
          ) : (
            <p className="px-1 py-6 text-sm text-neutral-400">
              Pick a layer to edit it. Position comes from anchors, not from dragging — a headline that
              grows by a line pushes what follows down instead of colliding with it.
            </p>
          )}
        </aside>
      </div>
    </div>
    </TooltipProvider>
  );
}

function Heading({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400", className)}>
      {children}
    </p>
  );
}

/**
 * The inspector edits the same JSON the CLI writes — no intermediate model, so
 * what is saved here is exactly what `creative render` reads back.
 */
function Inspector({
  layer,
  report,
  onPatch,
  designId,
  designName,
  document: doc,
}: {
  layer: DocumentLayer;
  report?: LayerReport;
  onPatch: (patch: Partial<DocumentLayer>) => void;
  designId: string;
  designName: string;
  document: CreativeDocument;
}) {
  const frame = (layer.frame === "full" ? {} : (layer.frame ?? {})) as Record<string, unknown>;
  const patchFrame = (patch: Record<string, unknown>) => onPatch({ frame: { ...frame, ...patch } });
  const box = (layer.box ?? {}) as Record<string, unknown>;
  const patchBox = (patch: Record<string, unknown>) => onPatch({ box: { ...box, ...patch } });
  const autofit = (layer.autofit ?? {}) as { min?: number; max?: number };

  const inset = Array.isArray(frame.inset)
    ? (frame.inset as [number, number])
    : [Number(frame.inset ?? 0), Number(frame.inset ?? 0)];
  const pad = Array.isArray(box.pad)
    ? (box.pad as [number, number])
    : [Number(box.pad ?? 0), Number(box.pad ?? 0)];

  const runs: Run[] = (layer.runs as Run[] | undefined) ?? (layer.text !== undefined
    ? [{
        text: layer.text,
        font: str(layer.font),
        size: num(layer.size),
        color: str(layer.color),
        tracking: num(layer.tracking),
        transform: str(layer.transform) as Run["transform"],
        italic: layer.italic === true ? true : undefined,
      }]
    : []);

  /** Editing runs converts a shorthand text layer into a runs layer, once. */
  const setRuns = (next: Run[]) =>
    onPatch({
      runs: next,
      text: undefined, font: undefined, size: undefined, color: undefined,
      tracking: undefined, transform: undefined, italic: undefined,
    });
  const patchRun = (i: number, patch: Partial<Run>) =>
    setRuns(runs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between border-b border-neutral-200 pb-2">
        <p className="text-sm font-medium">{layer.id ?? layer.type}</p>
        <span className="text-xs text-neutral-400">{layer.type}</span>
      </div>

      {layer.type === "image" ? <ImageControls layer={layer} onPatch={onPatch} /> : null}

      {layer.type === "text" ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Runs</span>
            <IconButton
              label="Add a run"
              className="h-6 w-6"
              onClick={() => setRuns([...runs, { text: "TEXT", font: runs[0]?.font ?? "Anton", size: runs[0]?.size ?? 64, color: runs[0]?.color ?? "#111111" }])}
            >
              <Plus className="h-3.5 w-3.5" />
            </IconButton>
          </div>

          {runs.map((run, i) => (
            <RunRow
              key={i}
              run={run}
              onPatch={(patch) => patchRun(i, patch)}
              onRemove={runs.length > 1 ? () => setRuns(runs.filter((_, j) => j !== i)) : undefined}
            />
          ))}
        </div>
      ) : null}

      <Field label="Anchor">
        <div className="grid grid-cols-3 gap-1">
          {ANCHORS.map((a) => (
            <button
              key={a}
              onClick={() => patchFrame({ anchor: a, below: undefined })}
              className={cn(
                "h-7 rounded border text-[10px]",
                frame.anchor === a
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 hover:bg-neutral-100",
              )}
              title={a}
            >
              {a.replace("-", " ")}
            </button>
          ))}
        </div>
      </Field>

      {typeof frame.below === "string" ? (
        <p className="rounded-md bg-neutral-100 p-2 text-xs text-neutral-500">
          Anchored below <strong>{frame.below}</strong> — it moves when that layer changes size.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Field label="Inset x">
          <NumberField value={inset[0]} onCommit={(v) => patchFrame({ inset: [v ?? 0, inset[1]] })} />
        </Field>
        <Field label="Inset y">
          <NumberField value={inset[1]} onCommit={(v) => patchFrame({ inset: [inset[0], v ?? 0] })} />
        </Field>
        <Field label="Width">
          <NumberField value={num(frame.w)} placeholder="auto" onCommit={(w) => patchFrame({ w })} />
        </Field>
        <Field label="Height">
          <NumberField value={num(frame.h)} placeholder="auto" onCommit={(h) => patchFrame({ h })} />
        </Field>
        <Field label="Gap" hint="Distance from the layer this one follows">
          <NumberField value={num(frame.gap)} placeholder="0" onCommit={(gap) => patchFrame({ gap })} />
        </Field>
      </div>

      {layer.type === "text" ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Box">
              <SelectField
                value={(str(box.mode) ?? "none") as "none" | "fit" | "grow"}
                onCommit={(mode) => patchBox({ mode })}
                options={[
                  { value: "none", label: "none" },
                  { value: "fit", label: "fit — shrink into the frame" },
                  { value: "grow", label: "grow — box follows the text" },
                ]}
              />
            </Field>
            <Field label="Fill">
              <ColorField value={str(box.fill)} onCommit={(fill) => patchBox({ fill })} fallback="#F5C518" />
            </Field>
            <Field label="Pad x">
              <NumberField value={pad[0]} onCommit={(v) => patchBox({ pad: [v ?? 0, pad[1]] })} />
            </Field>
            <Field label="Pad y">
              <NumberField value={pad[1]} onCommit={(v) => patchBox({ pad: [pad[0], v ?? 0] })} />
            </Field>
            <Field label="Radius">
              <NumberField value={num(box.radius) ?? 0} onCommit={(radius) => patchBox({ radius: radius ?? 0 })} />
            </Field>
            <Field label="Per line">
              <SelectField
                value={box.perLine === false ? "no" : "yes"}
                onCommit={(v) => patchBox({ perLine: v === "yes" })}
                options={[
                  { value: "yes", label: "a box per line" },
                  { value: "no", label: "one box" },
                ]}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Line height">
              <NumberField
                value={num(layer.lineHeight)}
                placeholder="1.14"
                step={0.01}
                onCommit={(lineHeight) => onPatch({ lineHeight })}
              />
            </Field>
            <Field label="Align">
              <SelectField
                value={(str(layer.align) ?? "left") as "left" | "center" | "right"}
                onCommit={(align) => onPatch({ align })}
                options={[
                  { value: "left", label: "left" },
                  { value: "center", label: "center" },
                  { value: "right", label: "right" },
                ]}
              />
            </Field>
            <Field label="Autofit min">
              <NumberField
                value={autofit.min}
                placeholder="12"
                onCommit={(min) => onPatch({ autofit: { ...autofit, min } })}
              />
            </Field>
            <Field label="Autofit max">
              <NumberField
                value={autofit.max}
                placeholder="400"
                onCommit={(max) => onPatch({ autofit: { ...autofit, max } })}
              />
            </Field>
          </div>
        </>
      ) : null}

      {layer.type === "rect" ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Fill">
            <ColorField value={str(layer.fill)} onCommit={(fill) => onPatch({ fill })} />
          </Field>
          <Field label="Radius">
            <NumberField value={num(layer.radius) ?? 0} onCommit={(radius) => onPatch({ radius: radius ?? 0 })} />
          </Field>
        </div>
      ) : null}

      {layer.type !== "rect" ? (
        <ShadowControls
          shadow={layer.shadow as Shadow | undefined}
          onCommit={(shadow) => onPatch({ shadow })}
        />
      ) : null}

      <TransformControls layer={layer} onPatch={onPatch} />

      {report ? (
        <div className="rounded-md bg-neutral-100 p-2 text-xs text-neutral-500">
          <p className="font-medium text-neutral-600">As rendered</p>
          <p>
            {Math.round(report.box.x)}, {Math.round(report.box.y)} · {Math.round(report.box.w)}×
            {Math.round(report.box.h)}
          </p>
          {report.bounds ? (
            <p>
              once rotated: {Math.round(report.bounds.x)}, {Math.round(report.bounds.y)} ·{" "}
              {Math.round(report.bounds.w)}×{Math.round(report.bounds.h)}
            </p>
          ) : null}
          {report.fontSize ? (
            <p>
              {report.fontSize}px over {report.lines} line{report.lines === 1 ? "" : "s"}
              {report.atMinimum ? " · at the auto-fit floor" : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-1 border-t border-neutral-200 pt-3">
        <Button asChild variant="secondary" size="sm" className="flex-1">
          <a href={`/api/designs/${designId}/render?format=png`} download={`${designName}.png`}>
            <Download className="h-3.5 w-3.5" />
            export png
          </a>
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="flex-1"
          onClick={() => {
            navigator.clipboard.writeText(JSON.stringify(doc, null, 2));
            toast.success("Document JSON copied — it is exactly what the CLI reads");
          }}
        >
          <Copy className="h-3.5 w-3.5" />
          copy JSON
        </Button>
      </div>
    </div>
  );
}

/** One styled span. Its second row is what makes the ratios editable. */
function RunRow({
  run,
  onPatch,
  onRemove,
}: {
  run: Run;
  onPatch: (patch: Partial<Run>) => void;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-neutral-200 p-2">
      <div className="flex gap-1">
        <TextField
          value={run.text}
          onCommit={(text) => onPatch({ text: text ?? "" })}
          className="text-sm"
        />
        {onRemove ? (
          <IconButton label="Remove run" danger className="h-8 w-8 shrink-0 border-0" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        ) : null}
      </div>

      <div className="flex gap-1">
        <TextField
          value={run.font}
          placeholder="Anton"
          onCommit={(font) => onPatch({ font })}
          className="text-xs"
        />
        <div className="w-16 shrink-0">
          <NumberField value={run.size} placeholder="64" onCommit={(size) => onPatch({ size })} />
        </div>
        <div className="w-[7.5rem] shrink-0">
          <ColorField value={run.color} onCommit={(color) => onPatch({ color })} placeholder="#111111" />
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Toggle
          pressed={run.italic === true}
          onPressedChange={(italic) => onPatch({ italic: italic || undefined })}
          label="Italic — synthesised when the family has no italic face"
          className="w-8 px-0"
        >
          <Italic className="h-3.5 w-3.5" />
        </Toggle>
        <div className="min-w-0 flex-1">
          <SelectField
            value={run.transform ?? "none"}
            onCommit={(transform) => onPatch({ transform: transform === "none" ? undefined : transform })}
            options={[
              { value: "none", label: "as typed" },
              { value: "upper", label: "UPPERCASE" },
              { value: "lower", label: "lowercase" },
            ]}
          />
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="h-8 shrink-0 rounded-lg border border-neutral-200 px-2 text-[11px] text-neutral-500 hover:bg-neutral-100"
        >
          {open ? "less" : "more"}
        </button>
      </div>

      {open ? (
        <div className="grid grid-cols-2 gap-2 border-t border-neutral-100 pt-2">
          <Field label="Tracking" hint="Letter-spacing, in px at size 100">
            <NumberField value={run.tracking} placeholder="0" onCommit={(tracking) => onPatch({ tracking })} />
          </Field>
          <Field label="Stroke width">
            <NumberField
              value={run.stroke?.width}
              placeholder="0"
              onCommit={(width) =>
                onPatch({ stroke: width ? { color: run.stroke?.color ?? "#000000", width } : undefined })
              }
            />
          </Field>
          {run.stroke ? (
            <div className="col-span-2">
              <Field label="Stroke colour">
                <ColorField
                  value={run.stroke.color}
                  onCommit={(color) => onPatch({ stroke: { ...run.stroke!, color: color ?? "#000000" } })}
                />
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Rotation, mirroring and opacity — the three that apply to every layer type.
 *
 * All three turn about the layer's centre, so none of them moves it: flipping a
 * photograph does not shift the caption anchored underneath it.
 */
function TransformControls({
  layer,
  onPatch,
}: {
  layer: DocumentLayer;
  onPatch: (patch: Partial<DocumentLayer>) => void;
}) {
  const rotate = num(layer.rotate) ?? 0;
  const opacity = num(layer.opacity) ?? 1;

  return (
    <Section
      title="Transform"
      right={
        rotate || bool(layer.flipX) || bool(layer.flipY) || opacity !== 1 ? (
          <button
            onClick={() => onPatch({ rotate: 0, flipX: false, flipY: false, opacity: 1 })}
            className="text-[11px] text-neutral-400 underline hover:text-neutral-900"
          >
            reset
          </button>
        ) : null
      }
    >
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label="Rotate">
            <SliderField
              value={rotate}
              min={-180}
              max={180}
              onCommit={(v) => onPatch({ rotate: v })}
              format={(v) => `${v}°`}
            />
          </Field>
        </div>
        <div className="w-16 shrink-0">
          <NumberField value={rotate} onCommit={(v) => onPatch({ rotate: v ?? 0 })} />
        </div>
      </div>

      <div className="flex gap-1">
        <Toggle
          pressed={bool(layer.flipX)}
          onPressedChange={(flipX) => onPatch({ flipX })}
          label="Mirror horizontally"
          className="flex-1"
        >
          <FlipHorizontal className="h-3.5 w-3.5" />
          flip x
        </Toggle>
        <Toggle
          pressed={bool(layer.flipY)}
          onPressedChange={(flipY) => onPatch({ flipY })}
          label="Mirror vertically"
          className="flex-1"
        >
          <FlipVertical className="h-3.5 w-3.5" />
          flip y
        </Toggle>
      </div>

      <Field label="Opacity">
        <SliderField
          value={opacity}
          min={0}
          max={1}
          step={0.05}
          onCommit={(v) => onPatch({ opacity: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </Field>
    </Section>
  );
}

/** A shadow is all four fields or none of them, so the toggle writes all four. */
function ShadowControls({
  shadow,
  onCommit,
}: {
  shadow?: Shadow;
  onCommit: (shadow: Shadow | undefined) => void;
}) {
  return (
    <Section
      title="Shadow"
      right={
        <Toggle
          pressed={Boolean(shadow)}
          onPressedChange={(on) => onCommit(on ? { color: "#00000040", blur: 24, x: 0, y: 8 } : undefined)}
          label={shadow ? "Remove the shadow" : "Add a shadow"}
          className="h-6 px-2 text-[11px]"
        >
          {shadow ? "on" : "off"}
        </Toggle>
      }
    >
      {shadow ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Field label="Colour">
              <ColorField
                value={shadow.color}
                onCommit={(color) => onCommit({ ...shadow, color: color ?? "#00000040" })}
                fallback="#000000"
              />
            </Field>
          </div>
          <Field label="Blur">
            <NumberField value={shadow.blur} onCommit={(blur) => onCommit({ ...shadow, blur: blur ?? 0 })} />
          </Field>
          <Field label="Offset x">
            <NumberField value={shadow.x} onCommit={(x) => onCommit({ ...shadow, x: x ?? 0 })} />
          </Field>
          <Field label="Offset y">
            <NumberField value={shadow.y} onCommit={(y) => onCommit({ ...shadow, y: y ?? 0 })} />
          </Field>
        </div>
      ) : null}
    </Section>
  );
}

/**
 * Drag on the picture to crop it; drag inside the crop to move it.
 *
 * A crop is a property of the layer, not an edit to the file: the asset stays the
 * one thing every design references, the crop is reversible, and the document
 * still renders to the same bytes from the same inputs.
 *
 * Dragging is fine here, unlike dragging a layer around the canvas. Position has
 * to stay anchored so a headline that grows pushes what follows; a crop is a
 * window on a photograph and there is nothing for it to be relative to.
 */
function CropBox({
  src,
  crop,
  onChange,
}: {
  src: string;
  crop?: Crop;
  onChange: (crop: Crop | undefined) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<
    | { mode: "draw"; x0: number; y0: number; x1: number; y1: number }
    | { mode: "pan"; rect: Crop; grabX: number; grabY: number }
    | null
  >(null);

  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
      y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1),
    };
  };

  const clamp01 = (v: number, size: number) => Math.min(Math.max(v, 0), 1 - size);
  const round = (c: Crop): Crop => c.map((v) => Number(v.toFixed(4))) as Crop;

  const rect: Crop | null = drag
    ? drag.mode === "pan"
      ? drag.rect
      : [
          Math.min(drag.x0, drag.x1),
          Math.min(drag.y0, drag.y1),
          Math.abs(drag.x1 - drag.x0),
          Math.abs(drag.y1 - drag.y0),
        ]
    : crop ?? null;

  const live = rect
    ? {
        left: `${rect[0] * 100}%`,
        top: `${rect[1] * 100}%`,
        width: `${rect[2] * 100}%`,
        height: `${rect[3] * 100}%`,
      }
    : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={ref}
        className={cn(
          "checkerboard relative select-none overflow-hidden rounded-lg border border-neutral-200",
          drag?.mode === "pan" ? "cursor-grabbing" : "cursor-crosshair",
        )}
        onPointerDown={(e) => {
          const p = at(e);
          e.currentTarget.setPointerCapture(e.pointerId);
          // Inside the existing window, the gesture is "move this"; outside it, it
          // is "draw a new one". Which one you meant is where you put the pointer.
          if (crop && p.x >= crop[0] && p.x <= crop[0] + crop[2] && p.y >= crop[1] && p.y <= crop[1] + crop[3]) {
            setDrag({ mode: "pan", rect: crop, grabX: p.x - crop[0], grabY: p.y - crop[1] });
            return;
          }
          setDrag({ mode: "draw", x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const p = at(e);
          if (drag.mode === "pan") {
            const [, , w, h] = drag.rect;
            setDrag({ ...drag, rect: [clamp01(p.x - drag.grabX, w), clamp01(p.y - drag.grabY, h), w, h] });
            return;
          }
          setDrag({ ...drag, x1: p.x, y1: p.y });
        }}
        onPointerUp={() => {
          if (!drag) return;
          if (drag.mode === "pan") {
            onChange(round(drag.rect));
            setDrag(null);
            return;
          }
          const w = Math.abs(drag.x1 - drag.x0);
          const h = Math.abs(drag.y1 - drag.y0);
          setDrag(null);
          // A click rather than a drag: too small to be a crop anyone meant.
          if (w < 0.02 || h < 0.02) return;
          onChange(round([Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), w, h]));
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <img src={src} alt="" draggable={false} className="block max-h-40 w-full object-contain" />
        {live ? (
          <>
            {/* Four panels around the selection rather than one over it, so the
                kept region is the actual image and not a copy of it. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-neutral-900/50" style={{ height: live.top }} />
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 bg-neutral-900/50"
              style={{ top: `calc(${live.top} + ${live.height})` }}
            />
            <div
              className="pointer-events-none absolute left-0 bg-neutral-900/50"
              style={{ top: live.top, height: live.height, width: live.left }}
            />
            <div
              className="pointer-events-none absolute right-0 bg-neutral-900/50"
              style={{ top: live.top, height: live.height, left: `calc(${live.left} + ${live.width})` }}
            />
            <div className="pointer-events-none absolute border-2 border-white" style={live} />
          </>
        ) : null}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-neutral-400">
        <span className="flex-1">
          {crop
            ? `crop ${Math.round(crop[2] * 100)}% × ${Math.round(crop[3] * 100)}% — drag inside to move it`
            : "drag on the picture to crop"}
        </span>
        {crop ? (
          <button onClick={() => onChange(undefined)} className="text-neutral-500 underline hover:text-neutral-900">
            reset
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Upload a new photograph, or take one already in the gallery. */
function ImageControls({
  layer,
  onPatch,
}: {
  layer: DocumentLayer;
  onPatch: (patch: Partial<DocumentLayer>) => void;
}) {
  const [picking, setPicking] = useState(false);
  const gallery = useQuery({
    queryKey: ["assets"],
    queryFn: () => api.get<{ items: Asset[] }>("/api/assets"),
    enabled: picking,
  });

  const crop = layer.crop as Crop | undefined;
  const fit = (str(layer.fit) ?? "cover") as "cover" | "contain" | "stretch";
  const focal = (Array.isArray(layer.focal) ? layer.focal : [0.5, 0.5]) as [number, number];
  const color = (layer.color ?? {}) as {
    brightness?: number; saturation?: number; hue?: number;
    tint?: string; tintAmount?: number; grayscale?: boolean;
  };
  const patchColor = (patch: Record<string, unknown>) => {
    const next = { ...color, ...patch };
    // An empty grading block would render identically and read as a setting that
    // is on, so it is removed rather than left behind as `{}`.
    const meaningful = Object.entries(next).filter(([k, v]) => v !== undefined && !(k === "tintAmount" && !next.tint));
    onPatch({ color: meaningful.length ? Object.fromEntries(meaningful) : undefined });
  };

  /**
   * Zoom is the crop, read the other way round: a window half as wide is twice the
   * magnification. Scaling about the window's centre means zooming does not also
   * pan, so the two gestures stay separable.
   */
  const zoom = crop && crop[2] > 0 ? 1 / crop[2] : 1;
  const setZoom = (z: number) => {
    if (z <= 1.001) return onPatch({ crop: undefined });
    const [x, y, w, h] = crop ?? [0, 0, 1, 1];
    const nw = Math.min(1, 1 / z);
    const nh = Math.min(1, w > 0 ? h * (nw / w) : nw);
    const cx = x + w / 2, cy = y + h / 2;
    onPatch({
      crop: [
        Number(Math.min(Math.max(cx - nw / 2, 0), 1 - nw).toFixed(4)),
        Number(Math.min(Math.max(cy - nh / 2, 0), 1 - nh).toFixed(4)),
        Number(nw.toFixed(4)),
        Number(nh.toFixed(4)),
      ],
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Field label="Image">
        <div className="flex flex-col gap-2">
          {typeof layer.src === "string" && layer.src ? (
            <>
              <CropBox src={layer.src} crop={crop} onChange={(c) => onPatch({ crop: c })} />
              <Field label="Zoom">
                <SliderField
                  value={zoom}
                  min={1}
                  max={8}
                  step={0.1}
                  onCommit={setZoom}
                  format={(v) => `${v.toFixed(1)}×`}
                />
              </Field>
            </>
          ) : null}

          <div className="flex gap-1">
            <label className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-white text-xs hover:bg-neutral-100">
              <Upload className="h-3.5 w-3.5" />
              upload
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  // Cleared first so choosing the same file twice fires again.
                  e.target.value = "";
                  try {
                    onPatch({ src: (await uploadAsset(file)).url });
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Upload failed");
                  }
                }}
              />
            </label>
            <button
              onClick={() => setPicking((v) => !v)}
              className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-white text-xs hover:bg-neutral-100"
            >
              <Images className="h-3.5 w-3.5" />
              gallery
            </button>
          </div>

          {picking ? (
            gallery.isPending ? (
              <Spinner />
            ) : (gallery.data?.items.length ?? 0) === 0 ? (
              <p className="text-xs text-neutral-400">
                Nothing uploaded yet — <Link to="/assets" className="underline">the gallery</Link> takes a drop.
              </p>
            ) : (
              <div className="grid max-h-48 grid-cols-3 gap-1 overflow-y-auto">
                {gallery.data!.items.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      onPatch({ src: a.url });
                      setPicking(false);
                    }}
                    title={a.name}
                    className="checkerboard overflow-hidden rounded border border-neutral-200 hover:ring-2 hover:ring-neutral-400"
                  >
                    <img src={a.url} alt={a.name} loading="lazy" className="aspect-square w-full object-cover" />
                  </button>
                ))}
              </div>
            )
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <Field label="Fit">
              <SelectField
                value={fit}
                onCommit={(v) => onPatch({ fit: v })}
                options={[
                  { value: "cover", label: "cover" },
                  { value: "contain", label: "contain" },
                  { value: "stretch", label: "stretch" },
                ]}
              />
            </Field>
            <Field label="Radius">
              <NumberField value={num(layer.radius) ?? 0} onCommit={(radius) => onPatch({ radius: radius ?? 0 })} />
            </Field>
          </div>

          {/* Only `cover` crops, and the focal point is what it keeps. */}
          {fit === "cover" ? (
            <Field label="Focal" hint="The part kept in frame when cover crops">
              <Grid3
                value={focal}
                onCommit={(v) => onPatch({ focal: v })}
                labels={(x, y) => `keep the ${y === 0 ? "top" : y === 1 ? "bottom" : "middle"} ${x === 0 ? "left" : x === 1 ? "right" : "centre"}`}
              />
            </Field>
          ) : null}
        </div>
      </Field>

      <Section
        title="Colour"
        right={
          Object.keys(color).length ? (
            <button
              onClick={() => onPatch({ color: undefined })}
              className="text-[11px] text-neutral-400 underline hover:text-neutral-900"
            >
              reset
            </button>
          ) : null
        }
      >
        <Field label="Brightness">
          <SliderField
            value={color.brightness ?? 1}
            min={0}
            max={2}
            step={0.05}
            onCommit={(v) => patchColor({ brightness: v === 1 ? undefined : v })}
            format={(v) => v.toFixed(2)}
          />
        </Field>
        <Field label="Saturation">
          <SliderField
            value={color.saturation ?? 1}
            min={0}
            max={2}
            step={0.05}
            onCommit={(v) => patchColor({ saturation: v === 1 ? undefined : v })}
            format={(v) => v.toFixed(2)}
          />
        </Field>
        <Field label="Hue">
          <SliderField
            value={color.hue ?? 0}
            min={-180}
            max={180}
            onCommit={(v) => patchColor({ hue: v === 0 ? undefined : v })}
            format={(v) => `${v}°`}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Tint">
            <ColorField
              value={color.tint}
              onCommit={(tint) => patchColor({ tint, tintAmount: tint ? color.tintAmount ?? 0.5 : undefined })}
            />
          </Field>
          <Field label="Greyscale">
            <Choice
              value={color.grayscale ? "on" : "off"}
              onCommit={(v) => patchColor({ grayscale: v === "on" ? true : undefined })}
              options={[
                { value: "off", label: "colour" },
                { value: "on", label: "grey" },
              ]}
            />
          </Field>
        </div>
        {color.tint ? (
          <Field label="Tint amount">
            <SliderField
              value={color.tintAmount ?? 0.5}
              min={0}
              max={1}
              step={0.05}
              onCommit={(v) => patchColor({ tintAmount: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </Field>
        ) : null}
      </Section>
    </div>
  );
}
