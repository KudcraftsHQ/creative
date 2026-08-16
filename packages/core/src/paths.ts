import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

/** Everything the tool owns on disk lives under one directory. */
export function creativeHome(): string {
  return process.env.CREATIVE_HOME ?? join(homedir(), ".creative");
}

export function ensureDir(p: string): string {
  mkdirSync(p, { recursive: true });
  return p;
}

export const paths = {
  home: () => ensureDir(creativeHome()),
  fonts: () => ensureDir(join(creativeHome(), "fonts")),
  fontIndex: () => join(creativeHome(), "fonts.json"),
  config: () => join(creativeHome(), "config.json"),
  cache: () => ensureDir(join(creativeHome(), "cache")),
};
