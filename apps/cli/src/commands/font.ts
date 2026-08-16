/**
 * `creative font …`
 *
 * A registry, not a downloader. Google's catalogue installs with one command because
 * it is a git repository of font files and every face in it is OFL/Apache/UFL. Anything
 * else — purchased, or downloaded by hand from somewhere like DaFont, where the default
 * licence is personal-use-only — comes in through `font add <file>` with its licence
 * recorded, and `lint` refuses to render commercial work with a personal-only face.
 */
import { Command } from "commander";
import { writeFileSync } from "node:fs";
import {
  installFromGoogle, installLocal, listFonts, getFont, removeFont,
  setLicense, renderSpecimen, type License,
} from "@creative/core";
import { emit, fail, note, dim, bold, yellow } from "../output.ts";

const LICENSES: License[] = ["OFL", "Apache-2.0", "UFL", "commercial", "personal-only", "unknown"];

function checkLicense(v: string): License {
  if (!LICENSES.includes(v as License)) {
    throw new Error(`--license must be one of: ${LICENSES.join(", ")}`);
  }
  return v as License;
}

export function registerFontCommands(program: Command): void {
  const font = program.command("font").description("manage the font registry");

  font
    .command("add <familyOrFile>")
    .description("install from Google Fonts by family name, or register a local .ttf/.otf")
    .option("--family <name>", "family name to register a local file under")
    .option("--license <id>", `one of ${LICENSES.join(", ")}`, checkLicense)
    .option("--source <text>", "where it came from — an invoice, a URL, a licence reference")
    .action(async (arg: string, o) => {
      try {
        const isFile = /\.(ttf|otf|ttc)$/i.test(arg);
        const entry = isFile
          ? installLocal(arg, { family: o.family, license: o.license, source: o.source })
          : await installFromGoogle(arg);

        note(`${bold(entry.family)}  ${dim(`${entry.files.length} file(s) · ${entry.license} · ${entry.source}`)}`);
        if (entry.license === "unknown") {
          note(yellow("  no licence recorded") + dim(" — lint will warn. Re-run with --license and --source."));
        }
        if (entry.license === "personal-only") {
          note(yellow("  personal-use only") + dim(" — lint will refuse to render commercial work with it."));
        }
      } catch (err) {
        fail(err);
      }
    });

  font
    .command("list")
    .description("installed families")
    .option("--json", "machine-readable output")
    .action((o) => {
      const fonts = listFonts();
      if (o.json) return emit(fonts);
      if (!fonts.length) {
        return note(dim("no fonts installed. Start with:  creative font add Anton"));
      }
      for (const f of fonts) {
        const weights = [...new Set(f.files.map((x) => x.weight))].sort((a, b) => a - b).join(", ");
        const lic = f.license === "personal-only" ? yellow(f.license) : f.license;
        note(`${bold(f.family)}  ${dim(`${weights} · ${lic} · ${f.source}`)}`);
      }
    });

  font
    .command("set-license <family>")
    .description("record the licence you hold for a family")
    .requiredOption("--license <id>", `one of ${LICENSES.join(", ")}`, checkLicense)
    .option("--source <text>", "where it came from")
    .action((family: string, o) => {
      try {
        const entry = setLicense(family, o.license, o.source);
        note(`${bold(entry.family)} ${dim(`· ${entry.license} · ${entry.source}`)}`);
      } catch (err) {
        fail(err);
      }
    });

  font
    .command("remove <family>")
    .description("forget a family (the files stay on disk)")
    .action((family: string) => {
      if (removeFont(family)) note(`removed ${bold(family)}`);
      else fail(`"${family}" is not installed`);
    });

  font
    .command("preview <family>")
    .description("render a specimen sheet, so an agent can see the face before choosing it")
    .option("-o, --out <file>", "output path", "specimen.png")
    .option("--text <text>", "sample text", "HARGA GROSIR 57 RIBUAN")
    .action((family: string, o) => {
      try {
        writeFileSync(o.out, renderSpecimen(family, o.text));
        note(`${o.out}  ${dim(`specimen for ${family}`)}`);
      } catch (err) {
        fail(err);
      }
    });
}
