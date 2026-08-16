/**
 * The font registry.
 *
 * Deliberately a registry rather than a downloader. Every face carries a licence
 * and where it came from, because these images are commercial use and a large part
 * of the free-font internet is not licensed for that. `lint` refuses a document
 * that draws with a `personal-only` face; that rule is the whole reason this file
 * stores more than a path.
 *
 * Google's catalogue needs no API key — it is a git repository of font files — so
 * installing from it is a directory listing and a few GETs, not a dependency.
 */
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { paths } from "./paths.ts";

export type License = "OFL" | "Apache-2.0" | "UFL" | "commercial" | "personal-only" | "unknown";

export interface FontFile {
  path: string;
  weight: number;
  italic: boolean;
}

export interface FontEntry {
  family: string;
  files: FontFile[];
  license: License;
  source: string;
  addedAt: string;
}

type Index = Record<string, FontEntry>;

const GOOGLE_DIRS: Array<[string, License]> = [
  ["ofl", "OFL"],
  ["apache", "Apache-2.0"],
  ["ufl", "UFL"],
];

const WEIGHTS: Array<[RegExp, number]> = [
  [/thin/i, 100], [/extralight|ultralight/i, 200], [/light/i, 300],
  [/regular|book|normal/i, 400], [/medium/i, 500],
  [/semibold|demibold/i, 600], [/extrabold|ultrabold/i, 800], [/black|heavy/i, 900],
  [/bold/i, 700],
];

function weightFromName(name: string): number {
  // Variable fonts carry every weight; 400 is the sane default instance.
  if (/\[.*wght.*\]|variablefont/i.test(name)) return 400;
  for (const [re, w] of WEIGHTS) if (re.test(name)) return w;
  return 400;
}

export function readIndex(): Index {
  const p = paths.fontIndex();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Index;
  } catch {
    return {};
  }
}

function writeIndex(ix: Index): void {
  writeFileSync(paths.fontIndex(), JSON.stringify(ix, null, 2) + "\n");
}

const key = (family: string) => family.toLowerCase().replace(/\s+/g, "");

export function getFont(family: string): FontEntry | undefined {
  return readIndex()[key(family)];
}

export function listFonts(): FontEntry[] {
  return Object.values(readIndex()).sort((a, b) => a.family.localeCompare(b.family));
}

/** Register every known face with Skia. Cheap, idempotent, called before any render. */
let registered = false;
export function registerAll(force = false): number {
  if (registered && !force) return 0;
  let n = 0;
  for (const entry of Object.values(readIndex())) {
    for (const f of entry.files) {
      if (existsSync(f.path) && GlobalFonts.registerFromPath(f.path, entry.family)) n++;
    }
  }
  registered = true;
  return n;
}

/** Families a document asks for that are not installed. */
export function missingFamilies(families: Iterable<string>): string[] {
  const ix = readIndex();
  const out = new Set<string>();
  for (const f of families) if (!ix[key(f)]) out.add(f);
  return [...out];
}

/* ── installing ────────────────────────────────────────────────────────────── */

interface GhEntry { name: string; download_url: string | null; type: string }

async function ghList(dir: string): Promise<GhEntry[] | null> {
  const res = await fetch(`https://api.github.com/repos/google/fonts/contents/${dir}`, {
    headers: { "User-Agent": "creative-cli", Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return null;
  return (await res.json()) as GhEntry[];
}

/**
 * Install a family from the Google Fonts repository. Returns the entry, or throws
 * with the families it could not find — the caller turns that into advice.
 */
export async function installFromGoogle(family: string): Promise<FontEntry> {
  const dir = key(family);
  for (const [root, license] of GOOGLE_DIRS) {
    const listing = await ghList(`${root}/${dir}`);
    if (!listing) continue;

    const ttfs = listing.filter((e) => e.type === "file" && /\.(ttf|otf)$/i.test(e.name) && e.download_url);
    if (ttfs.length === 0) continue;

    // Static families ship one file per weight; variable families ship one file
    // holding all of them, and mixing the two would register duplicates.
    const variable = ttfs.filter((e) => /\[.*\]/.test(e.name));
    const chosen = variable.length ? variable : ttfs;

    const files: FontFile[] = [];
    for (const e of chosen) {
      const target = join(paths.fonts(), e.name);
      const res = await fetch(e.download_url!, { headers: { "User-Agent": "creative-cli" } });
      if (!res.ok) throw new Error(`downloading ${e.name}: ${res.status}`);
      writeFileSync(target, Buffer.from(await res.arrayBuffer()));
      files.push({ path: target, weight: weightFromName(e.name), italic: /italic/i.test(e.name) });
    }

    const entry: FontEntry = {
      family,
      files,
      license,
      source: `google-fonts:${root}/${dir}`,
      addedAt: new Date().toISOString(),
    };
    const ix = readIndex();
    ix[dir] = entry;
    writeIndex(ix);
    registerAll(true);
    return entry;
  }
  throw new Error(
    `"${family}" is not in the Google Fonts catalogue. If you have the file, ` +
    `install it directly:\n  creative font add ./${family.replace(/\s+/g, "")}.ttf ` +
    `--family "${family}" --license commercial --source "where it came from"`,
  );
}

/** Install a local file. The escape hatch for purchased and hand-downloaded faces. */
export function installLocal(
  file: string,
  opts: { family?: string; license?: License; source?: string } = {},
): FontEntry {
  const src = resolve(file);
  if (!existsSync(src)) throw new Error(`no such file: ${file}`);
  if (!/\.(ttf|otf|ttc)$/i.test(src)) throw new Error(`not a font file: ${file}`);

  const name = basename(src, extname(src));
  const family = opts.family ?? name.replace(/[-_](regular|bold|italic|black|light|medium).*$/i, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  const target = join(paths.fonts(), basename(src));
  if (target !== src) copyFileSync(src, target);

  const ix = readIndex();
  const k = key(family);
  const entry: FontEntry = ix[k] ?? {
    family,
    files: [],
    license: opts.license ?? "unknown",
    source: opts.source ?? `local:${src}`,
    addedAt: new Date().toISOString(),
  };
  if (opts.license) entry.license = opts.license;
  if (opts.source) entry.source = opts.source;
  if (!entry.files.some((f) => f.path === target)) {
    entry.files.push({ path: target, weight: weightFromName(name), italic: /italic/i.test(name) });
  }
  ix[k] = entry;
  writeIndex(ix);
  registerAll(true);
  return entry;
}

/** Record the licence held for an installed family. */
export function setLicense(family: string, license: License, source?: string): FontEntry {
  const ix = readIndex();
  const k = key(family);
  const entry = ix[k];
  if (!entry) throw new Error(`"${family}" is not installed`);
  const next: FontEntry = { ...entry, license, source: source ?? entry.source };
  ix[k] = next;
  writeIndex(ix);
  return next;
}

export function removeFont(family: string): boolean {
  const ix = readIndex();
  const k = key(family);
  if (!ix[k]) return false;
  delete ix[k];
  writeIndex(ix);
  return true;
}

/**
 * A specimen sheet. Exists so an agent can *look* at a face before choosing it —
 * "Anton" means nothing to a model that has never seen it rendered.
 */
export function renderSpecimen(family: string, text = "HARGA GROSIR 57 RIBUAN"): Buffer {
  const entry = getFont(family);
  if (!entry) throw new Error(`"${family}" is not installed — try: creative font add "${family}"`);
  registerAll(true);

  const sizes = [96, 64, 44, 28, 18];
  const pad = 48;
  const height = pad * 2 + sizes.reduce((a, s) => a + s * 1.5, 0) + 24;
  const canvas = createCanvas(1200, Math.round(height));
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "top";

  ctx.fillStyle = "#999999";
  ctx.font = "16px sans-serif";
  ctx.fillText(`${entry.family} · ${entry.license} · ${entry.source}`, pad, 16);

  ctx.fillStyle = "#111111";
  let y = pad + 24;
  for (const size of sizes) {
    ctx.font = `${size}px "${entry.family}"`;
    ctx.fillText(text, pad, y);
    y += size * 1.5;
  }

  return canvas.toBuffer("image/png");
}
