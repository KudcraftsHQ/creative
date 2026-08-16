/**
 * The library.
 *
 * Search is the point of this screen. A design is JSON, so every word of copy in
 * every design is already a column — searching "grosir" finds the listing whose
 * headline says it, which is not something a folder of PNGs can do. The matched
 * copy is shown under each thumbnail so it is obvious *why* something matched.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Plus, Folder, LayoutGrid, X } from "lucide-react";
import { api, renderUrl, type DesignSummary, type Project } from "@/lib/api.ts";
import { useLiveLibrary } from "@/lib/use-live.ts";
import { Button, Input, Spinner, Empty } from "@/components/ui.tsx";
import { cn } from "@/lib/cn.ts";

const BLANK = {
  canvas: { w: 1080, h: 1080, bg: "#ffffff" },
  layers: [
    {
      type: "text",
      id: "headline",
      frame: { anchor: "center", w: 900 },
      text: "NEW DESIGN",
      font: "Anton",
      size: 120,
      color: "#111111",
      align: "center",
    },
  ],
};

/** The copy that matched, trimmed to the words around the hit. */
function matchExcerpt(text: string, q: string): string | null {
  if (!q) return null;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at === -1) return null;
  const start = Math.max(0, at - 24);
  return (start > 0 ? "…" : "") + text.slice(start, at + q.length + 40).replace(/\n/g, " ").trim() + "…";
}

export function Library() {
  useLiveLibrary();
  const queryClient = useQueryClient();

  const [q, setQ] = useState("");
  const [projectId, setProjectId] = useState<string | undefined>(undefined);

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<{ items: Project[] }>("/api/projects"),
  });

  const designs = useQuery({
    queryKey: ["designs", { q, projectId }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (projectId) params.set("projectId", projectId);
      return api.get<{ items: DesignSummary[]; nextCursor: string | null }>(
        `/api/designs?${params}`,
      );
    },
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<DesignSummary>("/api/designs", {
        name: "Untitled",
        document: BLANK,
        projectId: projectId ?? null,
      }),
    onSuccess: (design) => {
      queryClient.invalidateQueries({ queryKey: ["designs"] });
      window.location.href = `/d/${design.id}`;
    },
  });

  const createProject = useMutation({
    mutationFn: (name: string) => api.post<Project>("/api/projects", { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not create that project"),
  });

  const removeProject = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/projects/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["designs"] });
    },
  });

  const items = designs.data?.items ?? [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold tracking-tight">creative</h1>
        <Button onClick={() => create.mutate()} disabled={create.isPending} size="sm">
          <Plus className="h-4 w-4" />
          New design
        </Button>
      </header>

      <div className="relative mt-6">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <Input
          className="h-10 pl-9"
          placeholder="Search every word of copy in every design…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <nav className="mt-4 flex flex-wrap items-center gap-1.5">
        <FolderChip
          active={projectId === undefined}
          onClick={() => setProjectId(undefined)}
          icon={<LayoutGrid className="h-3.5 w-3.5" />}
          label="All"
        />
        {(projects.data?.items ?? []).map((p) => (
          <FolderChip
            key={p.id}
            active={projectId === p.id}
            onClick={() => setProjectId(p.id)}
            icon={<Folder className="h-3.5 w-3.5" />}
            label={p.name}
            count={p.designs}
            onDelete={() => {
              // The designs inside survive — the API detaches rather than cascades,
              // so deleting a folder cannot lose work.
              if (!confirm(`Delete the project “${p.name}”? The designs in it stay in the library.`)) return;
              if (projectId === p.id) setProjectId(undefined);
              removeProject.mutate(p.id);
            }}
          />
        ))}
        <NewProjectChip onCreate={(name) => createProject.mutate(name)} />
      </nav>

      <main className="mt-6">
        {designs.isPending ? (
          <div className="flex justify-center py-24">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <Empty
            title={q ? `Nothing says “${q}”` : "No designs yet"}
            hint={
              q
                ? "Search runs over the copy inside every design, not just their names."
                : "Make one here, or run `creative render` in a terminal — anything written from the CLI shows up in this grid."
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((design) => {
              const excerpt = matchExcerpt(design.searchText, q);
              return (
                <Link
                  key={design.id}
                  to={`/d/${design.id}`}
                  className="group flex flex-col gap-2"
                >
                  <div className="checkerboard overflow-hidden rounded-xl border border-neutral-200 bg-white transition-shadow group-hover:shadow-md">
                    <img
                      src={renderUrl(design.id, design.version, 480)}
                      alt={design.name}
                      loading="lazy"
                      className="block h-auto w-full"
                      style={{ aspectRatio: `${design.width} / ${design.height}` }}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{design.name}</p>
                    <p className="text-xs text-neutral-400">
                      {design.width}×{design.height}
                    </p>
                    {excerpt ? (
                      <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{excerpt}</p>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function FolderChip({
  active,
  onClick,
  icon,
  label,
  count,
  onDelete,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onDelete?: () => void;
}) {
  return (
    <span
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-full border py-1 pl-3 text-xs transition-colors",
        onDelete ? "pr-1" : "pr-3",
        active
          ? "border-neutral-900 bg-neutral-900 text-white"
          : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-100",
      )}
    >
      <button onClick={onClick} className="inline-flex items-center gap-1.5">
        {icon}
        {label}
        {count !== undefined ? (
          <span className={active ? "text-white/60" : "text-neutral-400"}>{count}</span>
        ) : null}
      </button>
      {onDelete ? (
        <button
          onClick={onDelete}
          aria-label={`Delete ${label}`}
          className={cn(
            "rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100",
            active ? "hover:bg-white/20" : "hover:bg-neutral-200",
          )}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}

/** A chip that becomes a field. A dialog for one text input is a dialog too many. */
function NewProjectChip({ onCreate }: { onCreate: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const commit = () => {
    const value = name.trim();
    if (value) onCreate(value);
    setName("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-neutral-300 px-3 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
      >
        <Plus className="h-3 w-3" />
        Project
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={name}
      placeholder="Project name"
      onChange={(e) => setName(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setName("");
          setOpen(false);
        }
      }}
      className="h-[26px] w-36 rounded-full border border-neutral-300 px-3 text-xs outline-none focus:ring-2 focus:ring-neutral-400"
    />
  );
}
