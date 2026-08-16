/**
 * The editor: layer list, preview, inspector, lint.
 *
 * There is no free-drag canvas, and that is a design decision rather than a
 * missing feature. Position comes from anchors and from other layers, so a
 * headline that grows by a line pushes the fine print down instead of colliding
 * with it. Dragging a layer to an absolute pixel would throw that away and break
 * the next hundred renders — so the inspector edits the same anchors the CLI
 * writes, and the preview is the rendered image, not a browser approximation of
 * one.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, AlertTriangle, Info, Type, Image as ImageIcon, Square, Eye, EyeOff, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  renderUrl,
  uploadAsset,
  type CreativeDocument,
  type Design,
  type DocumentLayer,
  type Finding,
  type LayerReport,
  type Project,
} from "@/lib/api.ts";
import { useLiveLibrary } from "@/lib/use-live.ts";
import { Button, Input, Spinner } from "@/components/ui.tsx";
import { cn } from "@/lib/cn.ts";

const ANCHORS = [
  "top-left", "top", "top-right",
  "left", "center", "right",
  "bottom-left", "bottom", "bottom-right",
] as const;

const layerIcon = (type: string) =>
  type === "text" ? Type : type === "image" ? ImageIcon : Square;

const layerId = (layer: DocumentLayer, i: number) => layer.id ?? `${layer.type}${i}`;

export function Editor() {
  const { id = "" } = useParams();
  useLiveLibrary();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const design = useQuery({
    queryKey: ["design", id],
    queryFn: () => api.get<Design>(`/api/designs/${id}`),
  });

  const lint = useQuery({
    queryKey: ["design", id, "lint", design.data?.version],
    queryFn: () => api.get<{ findings: Finding[]; layers: LayerReport[] }>(`/api/designs/${id}/lint`),
    enabled: Boolean(design.data),
  });

  const save = useMutation({
    mutationFn: (document: CreativeDocument) => api.patch<Design>(`/api/designs/${id}`, { document }),
    onSuccess: () => {
      // The write publishes an event, which invalidates these anyway — but doing
      // it here too means the tab that made the edit does not wait on the round
      // trip through Redis to see its own change.
      queryClient.invalidateQueries({ queryKey: ["design", id] });
      queryClient.invalidateQueries({ queryKey: ["designs"] });
    },
  });

  const rename = useMutation({
    mutationFn: (name: string) => api.patch<Design>(`/api/designs/${id}`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["design", id] }),
  });

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<{ items: Project[] }>("/api/projects"),
  });

  const moveToProject = useMutation({
    mutationFn: (projectId: string | null) => api.patch<Design>(`/api/designs/${id}`, { projectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["design", id] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["designs"] });
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
  const current = layers.find((l, i) => layerId(l, i) === selected) ?? null;
  const currentIndex = layers.findIndex((l, i) => layerId(l, i) === selected);
  const findings = lint.data?.findings ?? [];

  /** Replace one layer and write the whole document — the API validates it. */
  const patchLayer = (index: number, patch: Partial<DocumentLayer>) => {
    const next: CreativeDocument = {
      ...doc,
      layers: layers.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    };
    save.mutate(next);
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-3">
        <Button asChild variant="ghost" size="icon">
          <Link to="/" aria-label="Back to the library">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <input
          className="min-w-0 flex-1 rounded px-1 text-sm font-medium outline-none focus:bg-neutral-100"
          defaultValue={design.data.name}
          onBlur={(e) => {
            const value = e.target.value.trim();
            if (value && value !== design.data!.name) rename.mutate(value);
          }}
        />
        <select
          className="h-8 rounded-lg border border-neutral-200 bg-white px-2 text-xs text-neutral-600 outline-none focus:ring-2 focus:ring-neutral-400"
          value={design.data.projectId ?? ""}
          onChange={(e) => moveToProject.mutate(e.target.value || null)}
          aria-label="Project"
        >
          <option value="">No project</option>
          {(projects.data?.items ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-neutral-400">
          {doc.canvas.w}×{doc.canvas.h}
        </span>
        {save.isPending ? <Spinner /> : null}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* layers */}
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-neutral-200 bg-white p-2">
          <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
            Layers
          </p>
          {layers.map((layer, i) => {
            const lid = layerId(layer, i);
            const Icon = layerIcon(layer.type);
            const hasFinding = findings.some((f) => f.layer === lid);
            return (
              <button
                key={lid}
                onClick={() => setSelected(lid)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                  selected === lid ? "bg-neutral-900 text-white" : "hover:bg-neutral-100",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="min-w-0 flex-1 truncate">{lid}</span>
                {hasFinding ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : null}
                {layer.hidden ? <EyeOff className="h-3.5 w-3.5 shrink-0 opacity-40" /> : null}
              </button>
            );
          })}
        </aside>

        {/* preview */}
        <main className="flex min-w-0 flex-1 items-center justify-center overflow-auto bg-neutral-100 p-8">
          <div className="checkerboard max-h-full overflow-hidden rounded-lg border border-neutral-200 shadow-sm">
            <img
              key={design.data.version}
              src={renderUrl(design.data.id, design.data.version, 900)}
              alt={design.data.name}
              className="block max-h-[calc(100vh-8rem)] w-auto"
            />
          </div>
        </main>

        {/* inspector + lint */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-neutral-200 bg-white">
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {current && currentIndex >= 0 ? (
              <Inspector
                layer={current}
                report={lint.data?.layers.find((l) => l.id === selected)}
                onPatch={(patch) => patchLayer(currentIndex, patch)}
              />
            ) : (
              <p className="px-1 py-6 text-sm text-neutral-400">
                Pick a layer to edit it. Position comes from anchors, not from dragging.
              </p>
            )}
          </div>

          <div className="max-h-64 shrink-0 overflow-y-auto border-t border-neutral-200 p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              Lint {findings.length ? `· ${findings.length}` : ""}
            </p>
            {lint.isPending ? (
              <Spinner />
            ) : findings.length === 0 ? (
              <p className="text-xs text-neutral-400">Nothing to fix.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {findings.map((f, i) => (
                  <li
                    key={`${f.rule}-${i}`}
                    className={cn(
                      "rounded-md border p-2 text-xs",
                      f.severity === "error"
                        ? "border-red-200 bg-red-50"
                        : "border-amber-200 bg-amber-50",
                    )}
                  >
                    <div className="flex items-start gap-1.5">
                      {f.severity === "error" ? (
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-red-600" />
                      ) : (
                        <Info className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-neutral-800">{f.message}</p>
                        {f.fix ? <p className="mt-0.5 text-neutral-600">{f.fix}</p> : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
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
}: {
  layer: DocumentLayer;
  report?: LayerReport;
  onPatch: (patch: Partial<DocumentLayer>) => void;
}) {
  const frame = (layer.frame ?? {}) as Record<string, unknown>;
  const patchFrame = (patch: Record<string, unknown>) =>
    onPatch({ frame: { ...frame, ...patch } });

  const inset = Array.isArray(frame.inset)
    ? (frame.inset as [number, number])
    : [Number(frame.inset ?? 0), Number(frame.inset ?? 0)];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{layer.id ?? layer.type}</p>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onPatch({ hidden: !layer.hidden })}
          aria-label={layer.hidden ? "Show layer" : "Hide layer"}
        >
          {layer.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>

      {layer.type === "image" ? (
        <Field label="Image">
          <div className="flex flex-col gap-2">
            {typeof layer.src === "string" && layer.src ? (
              <div className="checkerboard overflow-hidden rounded-lg border border-neutral-200">
                <img src={layer.src} alt="" className="block max-h-32 w-full object-contain" />
              </div>
            ) : null}
            <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white text-sm hover:bg-neutral-100">
              <Upload className="h-4 w-4" />
              Replace
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  // Cleared straight away so choosing the same file twice fires again.
                  e.target.value = "";
                  try {
                    const asset = await uploadAsset(file);
                    onPatch({ src: asset.url });
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Upload failed");
                  }
                }}
              />
            </label>
          </div>
        </Field>
      ) : null}

      {layer.type === "text" && layer.text !== undefined ? (
        <Field label="Copy">
          <textarea
            className="min-h-[72px] w-full resize-y rounded-lg border border-neutral-200 p-2 text-sm outline-none focus:ring-2 focus:ring-neutral-400"
            defaultValue={layer.text}
            onBlur={(e) => {
              if (e.target.value !== layer.text) onPatch({ text: e.target.value });
            }}
          />
        </Field>
      ) : null}

      {layer.type === "text" && layer.runs ? (
        <p className="rounded-md bg-neutral-100 p-2 text-xs text-neutral-500">
          This layer has {layer.runs.length} styled runs. Editing runs is CLI and MCP work
          for now — the copy here would flatten them.
        </p>
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

      <div className="grid grid-cols-2 gap-2">
        <Field label="Inset x">
          <Input
            type="number"
            defaultValue={inset[0]}
            onBlur={(e) => patchFrame({ inset: [Number(e.target.value), inset[1]] })}
          />
        </Field>
        <Field label="Inset y">
          <Input
            type="number"
            defaultValue={inset[1]}
            onBlur={(e) => patchFrame({ inset: [inset[0], Number(e.target.value)] })}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Width">
          <Input
            type="number"
            defaultValue={typeof frame.w === "number" ? frame.w : ""}
            placeholder="auto"
            onBlur={(e) =>
              patchFrame({ w: e.target.value === "" ? undefined : Number(e.target.value) })
            }
          />
        </Field>
        <Field label="Gap">
          <Input
            type="number"
            defaultValue={typeof frame.gap === "number" ? frame.gap : ""}
            placeholder="0"
            onBlur={(e) =>
              patchFrame({ gap: e.target.value === "" ? undefined : Number(e.target.value) })
            }
          />
        </Field>
      </div>

      {layer.type === "text" ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Size">
            <Input
              type="number"
              defaultValue={typeof layer.size === "number" ? layer.size : ""}
              onBlur={(e) =>
                onPatch({ size: e.target.value === "" ? undefined : Number(e.target.value) })
              }
            />
          </Field>
          <Field label="Colour">
            <Input
              defaultValue={typeof layer.color === "string" ? layer.color : ""}
              placeholder="#111111"
              onBlur={(e) => onPatch({ color: e.target.value || undefined })}
            />
          </Field>
        </div>
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
    </div>
  );
}
