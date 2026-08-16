/**
 * Output helpers.
 *
 * Two audiences: a person reading a terminal and a model reading stdout. Human text
 * goes to stderr and structured results go to stdout, so `--json` is always safe to
 * pipe and a progress line never corrupts a parse.
 */
import type { Finding } from "@creative/core";

export const isTTY = process.stderr.isTTY === true;

const c = (code: string) => (s: string) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
export const dim = c("2");
export const bold = c("1");
export const red = c("31");
export const yellow = c("33");
export const green = c("32");

export function note(msg: string): void {
  process.stderr.write(msg + "\n");
}

export function emit(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

export function fail(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(red("error: ") + msg + "\n");
  process.exit(1);
}

export function printFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    note(green("clean") + dim(" — no findings"));
    return;
  }
  for (const f of findings) {
    const tag = f.severity === "error" ? red("error") : yellow("warn ");
    note(`${tag} ${bold(f.rule)}${f.layer ? dim(` [${f.layer}]`) : ""}  ${f.message}`);
    if (f.fix) note(`      ${dim("fix:")} ${f.fix}`);
  }
}

export function humanBytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} kB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** `--set key=value` repeated. */
export function collectSet(value: string, previous: Record<string, string> = {}): Record<string, string> {
  const eq = value.indexOf("=");
  if (eq < 1) throw new Error(`--set expects key=value, got "${value}"`);
  return { ...previous, [value.slice(0, eq)]: value.slice(eq + 1) };
}
