/**
 * The editor: layers and lint on the left, the render in the middle, the selected
 * layer on the right.
 *
 * There is no free-drag canvas, and that is a decision rather than a gap. Position
 * comes from anchors and from other layers, so a headline that grows by a line
 * pushes the fine print down instead of colliding with it. Dragging to an absolute
 * pixel throws that away and breaks the next hundred renders — so the inspector
 * edits the same anchors the CLI writes, and the preview is the rendered image
 * rather than a browser's approximation of one.
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
} from "lucide-react";
import {
  api,
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
import { Button, Input, Spinner } from "@/components/ui.tsx";
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

type Run = { text: string; font?: string; size?: number; color?: string };

const layerIcon = (type: string) =>
  type === "text" ? Type : type === "image" ? ImageIcon : Square;

const layerId = (layer: DocumentLayer, i: number) => layer.id ?? `${layer.type}${i}`;

export function Editor() {
  const { id = "" } = useParams();
  useLiveLibrary();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
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
    onError: (err) => toast.error(err instanceof Error ? err.message : "That document was refused"),
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

        {/* preview */}
        <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 overflow-auto bg-neutral-100 p-6">
          <div className="checkerboard max-h-full overflow-hidden rounded-lg border border-neutral-200 shadow-sm">
            <img
              key={design.data.version}
              src={renderUrl(design.data.id, design.data.version, 900)}
              alt={design.data.name}
              className="block max-h-[calc(100vh-10rem)] w-auto"
            />
          </div>
          <p className="text-xs text-neutral-500">
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{label}</span>
      {children}
    </label>
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

  const runs: Run[] = layer.runs ?? (layer.text !== undefined
    ? [{ text: layer.text, font: layer.font as string | undefined, size: layer.size as number | undefined, color: layer.color as string | undefined }]
    : []);

  /** Editing runs converts a shorthand text layer into a runs layer, once. */
  const setRuns = (next: Run[]) =>
    onPatch({ runs: next, text: undefined, font: undefined, size: undefined, color: undefined });

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
            <div key={i} className="flex flex-col gap-1 rounded-lg border border-neutral-200 p-2">
              <div className="flex gap-1">
                <input
                  className="min-w-0 flex-1 rounded border border-neutral-200 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-neutral-400"
                  defaultValue={run.text}
                  onBlur={(e) => {
                    if (e.target.value === run.text) return;
                    setRuns(runs.map((r, j) => (j === i ? { ...r, text: e.target.value } : r)));
                  }}
                />
                {runs.length > 1 ? (
                  <IconButton
                    label="Remove run"
                    danger
                    className="h-7 w-7 shrink-0 border-0"
                    onClick={() => setRuns(runs.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                ) : null}
              </div>
              <div className="flex gap-1">
                <input
                  className="min-w-0 flex-1 rounded border border-neutral-200 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-neutral-400"
                  defaultValue={run.font ?? ""}
                  placeholder="Anton"
                  onBlur={(e) => setRuns(runs.map((r, j) => (j === i ? { ...r, font: e.target.value || undefined } : r)))}
                />
                <input
                  type="number"
                  className="w-14 shrink-0 rounded border border-neutral-200 px-1.5 py-1 text-xs outline-none focus:ring-2 focus:ring-neutral-400"
                  defaultValue={run.size ?? ""}
                  placeholder="64"
                  onBlur={(e) =>
                    setRuns(runs.map((r, j) => (j === i ? { ...r, size: e.target.value ? Number(e.target.value) : undefined } : r)))
                  }
                />
                {/* Text beside the swatch, because a run's colour is often a
                    variable — "@ink" — and a colour input can neither show nor
                    keep one. Typing wins; the swatch is a shortcut. */}
                <input
                  className="w-20 shrink-0 rounded border border-neutral-200 px-1.5 py-1 text-xs outline-none focus:ring-2 focus:ring-neutral-400"
                  defaultValue={run.color ?? ""}
                  placeholder="#111111"
                  onBlur={(e) =>
                    setRuns(runs.map((r, j) => (j === i ? { ...r, color: e.target.value || undefined } : r)))
                  }
                />
                <input
                  type="color"
                  aria-label="Pick a colour"
                  className="h-7 w-7 shrink-0 cursor-pointer rounded border border-neutral-200"
                  value={/^#[0-9a-f]{6}$/i.test(run.color ?? "") ? run.color! : "#111111"}
                  onChange={(e) => setRuns(runs.map((r, j) => (j === i ? { ...r, color: e.target.value } : r)))}
                />
              </div>
            </div>
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
          <Input type="number" defaultValue={inset[0]} onBlur={(e) => patchFrame({ inset: [Number(e.target.value), inset[1]] })} />
        </Field>
        <Field label="Inset y">
          <Input type="number" defaultValue={inset[1]} onBlur={(e) => patchFrame({ inset: [inset[0], Number(e.target.value)] })} />
        </Field>
        <Field label="Width">
          <Input
            type="number"
            defaultValue={typeof frame.w === "number" ? frame.w : ""}
            placeholder="auto"
            onBlur={(e) => patchFrame({ w: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </Field>
        <Field label="Gap">
          <Input
            type="number"
            defaultValue={typeof frame.gap === "number" ? frame.gap : ""}
            placeholder="0"
            onBlur={(e) => patchFrame({ gap: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </Field>
      </div>

      {layer.type === "text" ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Box">
              <select
                className="h-9 rounded-lg border border-neutral-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-neutral-400"
                value={(box.mode as string) ?? "none"}
                onChange={(e) => patchBox({ mode: e.target.value })}
              >
                <option value="none">none</option>
                <option value="fit">fit — shrink into the frame</option>
                <option value="grow">grow — box follows the text</option>
              </select>
            </Field>
            <Field label="Fill">
              <div className="flex gap-1">
                <Input
                  defaultValue={(box.fill as string) ?? ""}
                  placeholder="none"
                  onBlur={(e) => patchBox({ fill: e.target.value || undefined })}
                />
                <input
                  type="color"
                  className="h-9 w-9 shrink-0 cursor-pointer rounded border border-neutral-200"
                  value={/^#[0-9a-f]{6}$/i.test((box.fill as string) ?? "") ? (box.fill as string) : "#F5C518"}
                  onChange={(e) => patchBox({ fill: e.target.value })}
                />
              </div>
            </Field>
            <Field label="Pad x">
              <Input type="number" defaultValue={pad[0]} onBlur={(e) => patchBox({ pad: [Number(e.target.value), pad[1]] })} />
            </Field>
            <Field label="Pad y">
              <Input type="number" defaultValue={pad[1]} onBlur={(e) => patchBox({ pad: [pad[0], Number(e.target.value)] })} />
            </Field>
            <Field label="Radius">
              <Input type="number" defaultValue={Number(box.radius ?? 0)} onBlur={(e) => patchBox({ radius: Number(e.target.value) })} />
            </Field>
            <Field label="Per line">
              <select
                className="h-9 rounded-lg border border-neutral-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-neutral-400"
                value={box.perLine === false ? "no" : "yes"}
                onChange={(e) => patchBox({ perLine: e.target.value === "yes" })}
              >
                <option value="yes">a box per line</option>
                <option value="no">one box</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Autofit min">
              <Input
                type="number"
                defaultValue={autofit.min ?? ""}
                placeholder="12"
                onBlur={(e) => onPatch({ autofit: { ...autofit, min: Number(e.target.value) } })}
              />
            </Field>
            <Field label="Autofit max">
              <Input
                type="number"
                defaultValue={autofit.max ?? ""}
                placeholder="400"
                onBlur={(e) => onPatch({ autofit: { ...autofit, max: Number(e.target.value) } })}
              />
            </Field>
          </div>

          <Field label="Align">
            <div className="flex gap-1">
              {(["left", "center", "right"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => onPatch({ align: a })}
                  className={cn(
                    "h-8 flex-1 rounded border text-xs",
                    (layer.align ?? "left") === a
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-200 hover:bg-neutral-100",
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
          </Field>
        </>
      ) : null}

      {report ? (
        <div className="rounded-md bg-neutral-100 p-2 text-xs text-neutral-500">
          <p className="font-medium text-neutral-600">As rendered</p>
          <p>
            {Math.round(report.box.x)}, {Math.round(report.box.y)} · {Math.round(report.box.w)}×
            {Math.round(report.box.h)}
          </p>
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

/**
 * Drag on the picture to crop it.
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
  crop?: [number, number, number, number];
  onChange: (crop: [number, number, number, number] | undefined) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const at = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
      y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1),
    };
  };

  const live = drag
    ? {
        left: `${Math.min(drag.x0, drag.x1) * 100}%`,
        top: `${Math.min(drag.y0, drag.y1) * 100}%`,
        width: `${Math.abs(drag.x1 - drag.x0) * 100}%`,
        height: `${Math.abs(drag.y1 - drag.y0) * 100}%`,
      }
    : crop
      ? {
          left: `${crop[0] * 100}%`,
          top: `${crop[1] * 100}%`,
          width: `${crop[2] * 100}%`,
          height: `${crop[3] * 100}%`,
        }
      : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={ref}
        className="checkerboard relative cursor-crosshair select-none overflow-hidden rounded-lg border border-neutral-200"
        onMouseDown={(e) => {
          const p = at(e);
          setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }}
        onMouseMove={(e) => {
          if (!drag) return;
          const p = at(e);
          setDrag({ ...drag, x1: p.x, y1: p.y });
        }}
        onMouseUp={() => {
          if (!drag) return;
          const w = Math.abs(drag.x1 - drag.x0);
          const h = Math.abs(drag.y1 - drag.y0);
          setDrag(null);
          // A click rather than a drag: too small to be a crop anyone meant.
          if (w < 0.02 || h < 0.02) return;
          onChange([
            Number(Math.min(drag.x0, drag.x1).toFixed(4)),
            Number(Math.min(drag.y0, drag.y1).toFixed(4)),
            Number(w.toFixed(4)),
            Number(h.toFixed(4)),
          ]);
        }}
        onMouseLeave={() => setDrag(null)}
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
            <div
              className="pointer-events-none absolute border-2 border-white"
              style={live}
            />
          </>
        ) : null}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-neutral-400">
        <span className="flex-1">
          {crop
            ? `crop ${Math.round(crop[2] * 100)}% × ${Math.round(crop[3] * 100)}%`
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

  return (
    <Field label="Image">
      <div className="flex flex-col gap-2">
        {typeof layer.src === "string" && layer.src ? (
          <CropBox
            src={layer.src}
            crop={layer.crop as [number, number, number, number] | undefined}
            onChange={(crop) => onPatch({ crop })}
          />
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
            <select
              className="h-9 rounded-lg border border-neutral-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-neutral-400"
              value={(layer.fit as string) ?? "cover"}
              onChange={(e) => onPatch({ fit: e.target.value })}
            >
              <option value="cover">cover</option>
              <option value="contain">contain</option>
              <option value="stretch">stretch</option>
            </select>
          </Field>
          <Field label="Radius">
            <Input
              type="number"
              defaultValue={Number(layer.radius ?? 0)}
              onBlur={(e) => onPatch({ radius: Number(e.target.value) })}
            />
          </Field>
        </div>
      </div>
    </Field>
  );
}
