#!/usr/bin/env bun
/**
 * creative — a headless Canva.
 *
 * Everything here is a thin wrapper over @creative/core. The CLI and the MCP server
 * are two faces on one engine, and neither is allowed to hold logic of its own: a fix
 * for the agent has to be a fix at the terminal too.
 */
import { Command } from "commander";
import { registerRenderCommands } from "./commands/render.ts";
import { registerTemplateCommands } from "./commands/template.ts";
import { registerFontCommands } from "./commands/font.ts";
import { registerImageCommands } from "./commands/image.ts";
import { registerEditCommands } from "./commands/edit.ts";
import { registerAccountCommands } from "./commands/account.ts";
import { registerInitCommands } from "./commands/init.ts";

export const VERSION = "0.1.0";

const program = new Command();

program
  .name("creative")
  .description("A headless design tool: JSON documents, Skia rendering, auto-fitting rich text.")
  .version(VERSION)
  .showHelpAfterError();

registerInitCommands(program);
registerRenderCommands(program);
registerTemplateCommands(program);
registerEditCommands(program);
registerFontCommands(program);
registerImageCommands(program);
registerAccountCommands(program);

program.addHelpText("after", `
Getting started
  creative font add Anton                     install a face (Google Fonts, no key needed)
  creative init design.json                   a document that already renders
  creative render design.json -o out.png      draw it
  creative inspect design.json                every layer's box, as JSON — for an agent
  creative lint design.json                   overflow, contrast, fonts, safe area

Doing the job
  creative fill promo --set headline="HARGA GROSIR" --set photo=./a.jpg -o out.jpg
  creative batch promo rows.csv --out ./dist --max-kb 300
`);

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
