/**
 * The config file: `~/.creative/config.json`.
 *
 * Written 0600 because it holds tokens. Kept deliberately small — the CLI works
 * fully offline and unauthenticated, and signing in only adds the shared library
 * at creative.kudcrafts.com.
 */
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { paths } from "@creative/core";

export interface Config {
  apiUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  /** Unix ms. */
  expiresAt?: number;
  user?: { id: string; email?: string; name?: string };
}

export const DEFAULT_API_URL = "https://creative.kudcrafts.com";

export function apiUrl(cfg: Config = readConfig()): string {
  return process.env.CREATIVE_API_URL ?? cfg.apiUrl ?? DEFAULT_API_URL;
}

export function readConfig(): Config {
  const p = paths.config();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Config;
  } catch {
    return {};
  }
}

export function writeConfig(cfg: Config): void {
  const p = paths.config();
  writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
  chmodSync(p, 0o600);
}

export function updateConfig(patch: Partial<Config>): Config {
  const next = { ...readConfig(), ...patch };
  writeConfig(next);
  return next;
}
