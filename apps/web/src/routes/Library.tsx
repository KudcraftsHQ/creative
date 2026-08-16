/**
 * The library.
 *
 * A sidebar of projects, templates and fonts; a list of designs down the right.
 * Rows rather than a grid of thumbnails, because what identifies a listing is its
 * copy — "HARGA GROSIR / CUMA 57 RIBUAN!" — and a caption under a tile cannot
 * carry that plus the template, the sizes, the faces and the actions.
 *
 * Search is the point of the screen. A design is JSON, so every word of copy in
 * every design is already a column: searching "grosir" finds the listing whose
 * headline says it, which no folder of PNGs can do.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Plus, Folder, LayoutGrid, X, ChevronRight, ChevronDown, Images } from "lucide-react";
import {
  api,
  renderUrl,
  type DesignSummary,
  type Project,
  type TemplateSummary,
  type FontEntry,
} from "@/lib/api.ts";
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

type Sort = "new" | "old" | "name";

const SORTS: Record<Sort, string> = { new: "newest", old: "oldest", name: "name" };

/** "2h ago", "yesterday" — the resolution the list actually needs. */
function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return "just now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = hours / 24;
  if (days < 2) return "yesterday";
  if (days < 30) return `${Math.round(days)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** The first line of copy, which is what a person recognises a design by. */
function headlineOf(searchText: string): string {
  const line = searchText.split("\n").map((l) => l.trim()).filter(Boolean)[0];
  return line ? (line.length > 64 ? `${line.slice(0, 64)}…` : line) : "";
}

export function Library() {
  useLiveLibrary();
  const queryClient = useQueryClient();

  const [q, setQ] = useState("");
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<Sort>("new");
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<{ items: Project[] }>("/api/projects"),
  });

  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: () => api.get<{ items: TemplateSummary[] }>("/api/templates"),
  });

  const fonts = useQuery({
    queryKey: ["fonts"],
    queryFn: () => api.get<{ items: FontEntry[] }>("/api/fonts"),
  });

  const designs = useQuery({
    queryKey: ["designs", { q, projectId }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (projectId) params.set("projectId", projectId);
      params.set("limit", "60");
      return api.get<{ items: DesignSummary[]; nextCursor: string | null }>(`/api/designs?${params}`);
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

  const duplicate = useMutation({
    mutationFn: (id: string) => api.post<DesignSummary>(`/api/designs/${id}/duplicate`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["designs"] }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not duplicate"),
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

  const items = [...(designs.data?.items ?? [])].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    const d = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    return sort === "old" ? d : -d;
  });

  const projectName = (id: string | null) =>
    projects.data?.items.find((p) => p.id === id)?.name ?? null;

  return (
    <div className="flex h-screen flex-col">
      {/* ┌ creative ─────────── ⌕ search ──────── [ + New design ] ┐ */}
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-neutral-200 bg-white px-4">
        <Link to="/" className="text-sm font-semibold tracking-tight">
          creative
        </Link>
        <div className="relative max-w-xl flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <Input
            className="h-9 pl-9"
            placeholder="Search every word of copy in every design…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button onClick={() => create.mutate()} disabled={create.isPending} size="sm">
          <Plus className="h-4 w-4" />
          New design
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* sidebar: projects, templates, fonts */}
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-neutral-200 bg-white p-3">
          <SideHeading>Projects</SideHeading>
          <SideRow
            active={projectId === undefined}
            onClick={() => setProjectId(undefined)}
            icon={<LayoutGrid className="h-3.5 w-3.5" />}
            label="All designs"
          />
          {(projects.data?.items ?? []).map((p) => (
            <SideRow
              key={p.id}
              active={projectId === p.id}
              onClick={() => setProjectId(p.id)}
              onToggle={() => setOpenProjects((s) => ({ ...s, [p.id]: !s[p.id] }))}
              expanded={openProjects[p.id] ?? false}
              icon={<Folder className="h-3.5 w-3.5" />}
              label={p.name}
              count={p.designs}
              onDelete={() => {
                // The designs inside survive — the API detaches rather than
                // cascades, so deleting a folder cannot lose work.
                if (!confirm(`Delete “${p.name}”? The designs in it stay in the library.`)) return;
                if (projectId === p.id) setProjectId(undefined);
                removeProject.mutate(p.id);
              }}
            />
          ))}
          <NewProjectRow onCreate={(name) => createProject.mutate(name)} />

          <SideHeading className="mt-5">Templates</SideHeading>
          {(templates.data?.items ?? []).map((t) => (
            <SideRow
              key={t.name}
              active={false}
              onClick={() => setQ("")}
              icon={<span className="h-3.5 w-3.5 rounded-sm border border-neutral-300" />}
              label={t.name}
              count={t.slots.length}
              title={`${t.slots.length} slots · ${t.sizes.join(" ")}`}
            />
          ))}

          <SideHeading className="mt-5">Assets</SideHeading>
          <Link
            to="/assets"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
          >
            <Images className="h-3.5 w-3.5 opacity-60" />
            <span className="flex-1 truncate">Image gallery</span>
          </Link>

          <SideHeading className="mt-5">Fonts</SideHeading>
          <div className="px-2 py-1 text-xs text-neutral-500">
            {fonts.data ? `${fonts.data.items.length} installed` : "…"}
          </div>
          {(fonts.data?.items ?? []).map((f) => (
            <div key={f.family} className="flex items-center gap-2 px-2 py-0.5 text-xs text-neutral-500">
              <span className="flex-1 truncate">{f.family}</span>
              <span className={cn("text-[10px]", f.license === "personal-only" && "text-red-600")}>
                {f.license}
              </span>
            </div>
          ))}
        </aside>

        {/* the list */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-2.5 text-xs text-neutral-500">
            <span>
              {designs.isPending
                ? "…"
                : `${items.length} design${items.length === 1 ? "" : "s"}${q ? ` matching “${q}”` : ""}`}
            </span>
            <label className="flex items-center gap-1.5">
              sort:
              <select
                className="rounded border border-neutral-200 bg-white px-1.5 py-0.5 outline-none focus:ring-2 focus:ring-neutral-400"
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
              >
                {Object.entries(SORTS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

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
                  : "Make one here, or write one from the CLI — anything written from a terminal shows up in this list."
              }
            />
          ) : (
            <ul className="divide-y divide-neutral-100">
              {items.map((design) => (
                <li key={design.id} className="group flex gap-4 px-5 py-3 hover:bg-neutral-50">
                  <Link
                    to={`/d/${design.id}`}
                    className="checkerboard block h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-white"
                  >
                    <img
                      src={renderUrl(design.id, design.version, 200)}
                      alt={design.name}
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                  </Link>

                  <div className="min-w-0 flex-1">
                    <Link to={`/d/${design.id}`} className="block truncate text-sm font-medium">
                      {projectName(design.projectId) ? (
                        <span className="text-neutral-400">{projectName(design.projectId)} / </span>
                      ) : null}
                      {design.name}
                    </Link>
                    <p className="truncate text-xs text-neutral-500">
                      {[
                        design.templateName,
                        `${design.width}×${design.height}`,
                        design.fonts?.join(", "),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {headlineOf(design.searchText) ? (
                      <p className="truncate text-xs text-neutral-600">
                        “{headlineOf(design.searchText)}”
                      </p>
                    ) : null}
                    <p className="mt-0.5 text-[11px] text-neutral-400">
                      {ago(design.updatedAt)}
                      {design.updatedVia && design.updatedVia !== "web"
                        ? ` · via ${design.updatedVia.toUpperCase()}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-start gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button asChild variant="secondary" size="sm">
                      <Link to={`/d/${design.id}`}>open</Link>
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => duplicate.mutate(design.id)}
                      disabled={duplicate.isPending}
                    >
                      dup
                    </Button>
                    <Button asChild variant="secondary" size="sm">
                      <a href={`/api/designs/${design.id}/render?format=png`} download={`${design.name}.png`}>
                        ↓ png
                      </a>
                    </Button>
                    <Button asChild variant="secondary" size="sm">
                      <a href={`/api/designs/${design.id}/render?format=jpg`} download={`${design.name}.jpg`}>
                        jpg
                      </a>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>
    </div>
  );
}

function SideHeading({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400", className)}>
      {children}
    </p>
  );
}

function SideRow({
  active,
  onClick,
  icon,
  label,
  count,
  onDelete,
  onToggle,
  expanded,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onDelete?: () => void;
  onToggle?: () => void;
  expanded?: boolean;
  title?: string;
}) {
  return (
    <div
      className={cn(
        "group/row flex items-center gap-1 rounded-md pr-1 text-sm",
        active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100",
      )}
      title={title}
    >
      {onToggle ? (
        <button onClick={onToggle} className="p-1 opacity-50 hover:opacity-100" aria-label="Expand">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
      ) : (
        <span className="w-1.5" />
      )}
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
        <span className="opacity-60">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined ? (
          <span className={cn("text-xs", active ? "text-white/60" : "text-neutral-400")}>{count}</span>
        ) : null}
      </button>
      {onDelete ? (
        <button
          onClick={onDelete}
          aria-label={`Delete ${label}`}
          className={cn(
            "rounded p-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 focus:opacity-100",
            active ? "hover:bg-white/20" : "hover:bg-neutral-200",
          )}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

/** A row that becomes a field. A dialog for one text input is a dialog too many. */
function NewProjectRow({ onCreate }: { onCreate: (name: string) => void }) {
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
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
      >
        <Plus className="h-3.5 w-3.5" />
        new
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
      className="mx-1 h-7 w-[calc(100%-0.5rem)] rounded border border-neutral-300 px-2 text-sm outline-none focus:ring-2 focus:ring-neutral-400"
    />
  );
}
