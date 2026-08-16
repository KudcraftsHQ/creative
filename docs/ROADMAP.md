# Roadmap and handoff

State of the repository, and what the next agent picks up. Keep this file current —
it is the handoff between sessions, not a wish list.

## Done (phases 0–4, on `main`)

- `packages/core` — the engine. Document schema (zod), rich-text runs with shared-scale
  auto-fit, per-line rounded highlight boxes, anchors and layer-relative frames, image
  fit/cover/focal/colour grading, encoding to a file-size budget, the linter, the font
  registry with licences, hosted background removal.
- `apps/cli` — `creative`. init, render, inspect, lint, templates, describe, fill, batch,
  edit, font (add/list/set-license/remove/preview), rmbg, finish, color, export,
  login/logout/whoami (OAuth 2.0 + PKCE, loopback callback, `~/.creative/config.json`).
- `apps/mcp` — `creative-mcp`, 13 tools over stdio. Renders come back as image blocks.
- `templates/` — `promo-band` and `spec-poster`, reproducing the two reference creatives.
- `.github/workflows` — CI (test, typecheck, compile) and release (four native targets,
  GitHub release, Homebrew cask pushed to `KudcraftsHQ/homebrew-tap`).
- 16 tests, all passing. `bun test`, `bun run typecheck`.

## Not done

### 1. The template-authoring loop

**This is not something the repository implements.** The loop belongs to whichever agent
is driving the tools: it writes a template JSON, fills it, renders, *looks at* the
returned image against the reference, and patches. That is a judgement the model makes
by looking, and the platform's job is to hand it the pictures and get out of the way.

So do not build scoring, similarity metrics or a `verify_template` checker into core.
`save_template`, `fill_template` and `compare_images` are the whole surface, and they
already exist. If the loop turns out to be missing something, it will be a *capability*
the agent cannot express (a layer type, a frame mode), not a measurement.

What is genuinely open: driving the loop end to end once, to find those missing
capabilities. Regenerating `spec-poster` from `docs/references/` is the exercise.

### 2. Background-removal provider survey

`packages/core/src/bgremove.ts` supports remove.bg, PhotoRoom and Clipdrop behind one
interface, chosen by whichever API key is present. Nobody has compared them. Run all
three over ~10 real product photographs — the black rubber parts on a dark hand are the
hard case — and record quality against price in `docs/bgremove-survey.md`. Then set a
default.

### 3. The web app — `creative.kudcrafts.com` (built, deploying)

`apps/api` and `apps/web` exist and are in tempe-sadari's shape. What is done:

- `apps/api` — Hono 4 + Prisma 5 + better-auth + zod. Routes: `health`, `me`, `designs`
  (CRUD, `/render`, `/lint`), `projects`, `templates`, `fonts`, `events`.
- The OAuth server the CLI talks to — `/oauth/authorize` (server-rendered consent),
  `/oauth/token`, PKCE S256, loopback-only redirects, single-use codes that revoke the
  whole grant on replay, tokens stored as SHA-256 hashes, rotating refresh.
  Verified end to end against the real `creative login`.
- `apps/web` — Vite + React 18 + TanStack Query + Radix + Tailwind + react-router.
  Library (search over the copy in every design, projects as folders, grid) and editor
  (layer list, preview, inspector, lint panel).
- Live preview over SSE: `streamSSE`, a singleton `EventSource` pinned on `window`, and
  `ping` keepalive. **The hub is Redis pub/sub**, per the mark on the plan — web and
  worker are separate containers, so an in-process emitter could not reach across them.
- **No free-drag canvas.** The inspector edits anchors, and writes the same JSON the CLI
  writes.

Not done: the ASCII mockups in the plan at
https://notes.kudcrafts.com/d/headless-canva-plan could not be read back (that page is
client-rendered and `readback pull` returns only marks), so both screens were built from
the description above — worth a look against the mockups. Also open: run designs, an
upload route for image assets, and project rename/delete in the UI.

### 4. Deployment (in progress)

- `Dockerfile` — multi-stage, tempe-sadari's shape: install → builder (prisma generate,
  vite build, bun build) → slim runner. Fonts (Anton, Archivo Black, Inter) are installed
  at build time into `CREATIVE_HOME=/app/.creative` and baked in, so a render is
  reproducible from the image alone. `prisma migrate deploy` runs on start of the web app
  only, so the worker cannot race it.
- Database `creative-db` created on the shared `postgresql` instance (uuid `n4okooo`) and
  migrated. `pgbouncer-shared` is wildcard + `auth_query`, so it needed no new config.
- Prisma through the pooler needs `?pgbouncer=true&connection_limit=1` on `DATABASE_URL`
  and a `DIRECT_URL` that bypasses it for migrations.
- Assets in S3 via `@aws-sdk/client-s3` with presigned URLs. `src/lib/storage.ts` is
  written but **no bucket is configured yet**: previews fall back to on-demand rendering,
  and the worker idles until S3 env is set.

### 5. Smaller things

- `creative font fetch <url>` driving the `playwriter` skill, for a face that only exists
  behind a download button. One at a time, licence recorded. Not a bulk scraper.
- Per-run letter-spacing is implemented but untested against older Skia builds, where the
  `letterSpacing` setter may be absent (the code degrades silently — verify).
- `creative preview --watch`: a local page that re-renders on file change, for working
  without the full web app.
- Group layers, and repeating rows (the three-badge footer in `spec-poster` is currently
  one text layer, not a row of three).

## Rules for this repository

- **The core holds the logic.** The CLI and the MCP server are thin. If a fix has to be
  made twice, it is in the wrong place.
- **Determinism.** Same document + same assets => same bytes. No wall-clock, no
  randomness, nothing that renders differently on a second run.
- **Every lint finding carries a fix.** The consumer is a model deciding what to change.
- **Font licences are required.** `lint` fails commercial work using a `personal-only`
  face. Do not add a way around it.
- Tests cover behaviour that breaks silently — auto-fit ratios, anchors moving together,
  budgets being met — not "does it draw".
