/**
 * The image gallery.
 *
 * Photographs are the one thing in this system that is not text, so they are the
 * one thing that cannot be written from a terminal as easily as it is dropped from
 * a phone. That makes this the screen the browser is genuinely better at.
 *
 * A grid, unlike the design library: what identifies a photograph is what it looks
 * like, and there is no copy to read.
 */
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Upload, Trash2, Copy, Check, Download, ExternalLink } from "lucide-react";
import { api, uploadAsset, type Asset } from "@/lib/api.ts";
import { Button, Spinner, Empty } from "@/components/ui.tsx";
import {
  IconButton, TooltipProvider,
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from "@/components/menu.tsx";
import { cn } from "@/lib/cn.ts";

const kb = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} kB`;

export function Assets() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const assets = useQuery({
    queryKey: ["assets"],
    queryFn: () => api.get<{ items: Asset[] }>("/api/assets"),
  });

  const upload = useMutation({
    // Sequential rather than Promise.all: a dropped folder of twenty photographs
    // should not open twenty concurrent uploads at the server.
    mutationFn: async (files: File[]) => {
      const done: Asset[] = [];
      for (const file of files) done.push(await uploadAsset(file));
      return done;
    },
    onSuccess: (done) => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      toast.success(`${done.length} image${done.length === 1 ? "" : "s"} uploaded`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Upload failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/assets/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not delete"),
  });

  const take = (list: FileList | null) => {
    const files = [...(list ?? [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) upload.mutate(files);
  };

  const copyUrl = (asset: Asset) => {
    navigator.clipboard.writeText(asset.url);
    setCopied(asset.id);
    setTimeout(() => setCopied(null), 1500);
  };

  const confirmDelete = (asset: Asset) => {
    if (!confirm(`Delete ${asset.name}? Designs using it will lose the image.`)) return;
    remove.mutate(asset.id);
  };

  const items = assets.data?.items ?? [];

  return (
    <TooltipProvider>
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-4">
        <Button asChild variant="ghost" size="icon">
          <Link to="/" aria-label="Back to the library">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="flex-1 text-sm font-semibold tracking-tight">Images</h1>
        <span className="text-xs text-neutral-400">
          {items.length} image{items.length === 1 ? "" : "s"}
        </span>
        <Button size="sm" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? <Spinner className="border-white/40 border-t-white" /> : <Upload className="h-4 w-4" />}
          Upload
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/avif"
          className="hidden"
          onChange={(e) => {
            take(e.target.files);
            e.target.value = "";
          }}
        />
      </header>

      <main
        className={cn(
          "min-h-0 flex-1 overflow-y-auto p-5 transition-colors",
          dragging && "bg-neutral-100 outline-dashed outline-2 -outline-offset-8 outline-neutral-300",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          take(e.dataTransfer.files);
        }}
      >
        {assets.isPending ? (
          <div className="flex justify-center py-24">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <Empty
            title="No images yet"
            hint="Drop photographs here, or use Upload. They are served from a CDN, so a design that references one renders anywhere — including from the CLI."
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {items.map((asset) => (
              <ContextMenu key={asset.id}>
              <ContextMenuTrigger asChild>
              <figure className="group flex flex-col gap-1.5">
                <div className="checkerboard relative overflow-hidden rounded-xl border border-neutral-200 bg-white">
                  <img
                    src={asset.url}
                    alt={asset.name}
                    loading="lazy"
                    className="block aspect-square w-full object-contain"
                  />
                  <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <IconButton
                      label={copied === asset.id ? "Copied" : "Copy the URL"}
                      className="h-7 w-7 bg-white/90 shadow-sm"
                      onClick={() => copyUrl(asset)}
                    >
                      {copied === asset.id ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </IconButton>
                    <IconButton
                      label="Delete"
                      danger
                      className="h-7 w-7 bg-white/90 shadow-sm"
                      onClick={() => confirmDelete(asset)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </div>
                <figcaption className="min-w-0">
                  <p className="truncate text-xs font-medium">{asset.name}</p>
                  <p className="text-[11px] text-neutral-400">
                    {kb(asset.bytes)} · {asset.mimeType.replace("image/", "")}
                  </p>
                </figcaption>
              </figure>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem icon={<Copy className="h-3.5 w-3.5" />} onSelect={() => copyUrl(asset)}>
                  Copy the URL
                </ContextMenuItem>
                <ContextMenuItem
                  icon={<ExternalLink className="h-3.5 w-3.5" />}
                  onSelect={() => window.open(asset.url, "_blank", "noopener")}
                >
                  Open in a new tab
                </ContextMenuItem>
                <ContextMenuItem
                  icon={<Download className="h-3.5 w-3.5" />}
                  onSelect={() => {
                    const a = document.createElement("a");
                    a.href = asset.url;
                    a.download = asset.name;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                  }}
                >
                  Download
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onSelect={() => confirmDelete(asset)}>
                  Delete
                </ContextMenuItem>
              </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        )}
      </main>
    </div>
    </TooltipProvider>
  );
}
