/**
 * login / logout / whoami.
 *
 * Signing in is optional: everything the engine does works offline. An account only
 * buys the shared library at creative.kudcrafts.com — templates, fonts and designs
 * that follow you between machines.
 */
import { Command } from "commander";
import { login, logout, accessToken } from "../auth.ts";
import { readConfig, apiUrl } from "../config.ts";
import { emit, fail, note, dim, bold, green } from "../output.ts";

export function registerAccountCommands(program: Command): void {
  program
    .command("login")
    .description("sign in through the browser")
    .option("--no-browser", "print the URL instead of opening a browser")
    .option("--api <url>", "server to sign in against")
    .action(async (o) => {
      try {
        if (o.api) process.env.CREATIVE_API_URL = o.api;
        const cfg = await login({ noBrowser: !o.browser });
        const who = cfg.user?.email ?? cfg.user?.name ?? cfg.user?.id ?? "signed in";
        note(`${green("✓")} ${bold(who)} ${dim(`· ${apiUrl(cfg)}`)}`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("logout")
    .description("forget the stored token")
    .action(async () => {
      await logout();
      note(dim("signed out"));
    });

  program
    .command("whoami")
    .description("who the CLI is signed in as")
    .option("--json", "machine-readable output")
    .action(async (o) => {
      const cfg = readConfig();
      const token = await accessToken();
      const state = {
        signedIn: Boolean(token),
        api: apiUrl(cfg),
        user: cfg.user ?? null,
        expiresAt: cfg.expiresAt ? new Date(cfg.expiresAt).toISOString() : null,
      };
      if (o.json) return emit(state);
      if (!state.signedIn) return note(dim(`not signed in · ${state.api}\nrun: creative login`));
      note(`${bold(cfg.user?.email ?? cfg.user?.id ?? "signed in")} ${dim(`· ${state.api}`)}`);
    });
}
