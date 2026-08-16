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

### 1. The template-authoring loop (highest value)

The point of `save_template` + `compare_images` is that **an agent authors templates from
a reference image** rather than a human writing JSON: read the reference, propose a
template, fill it, render, compare, patch, repeat until close enough. The tools exist;
the loop has not been driven end to end and no prompt/skill wraps it.

Build it as a skill or an MCP prompt, and prove it by regenerating `spec-poster` from
`docs/references/` without hand-editing JSON. Watch for: the model proposing absolute
pixel frames instead of anchors (it will), and declaring `maxChars` it never checks.

### 2. Background-removal provider survey

`packages/core/src/bgremove.ts` supports remove.bg, PhotoRoom and Clipdrop behind one
interface, chosen by whichever API key is present. Nobody has compared them. Run all
three over ~10 real product photographs — the black rubber parts on a dark hand are the
hard case — and record quality against price in `docs/bgremove-survey.md`. Then set a
default.

### 3. The web app — `creative.kudcrafts.com`

Copy tempe-sadari's shape exactly; it is already what we want.

- `apps/api` — Hono 4 + Prisma 5 + better-auth + zod, `bun --hot` in dev. Must also be
  the OAuth server the CLI's `creative login` talks to: `/oauth/authorize`,
  `/oauth/token`, authorization code + PKCE, client id `creative-cli`, loopback redirect.
  See `apps/cli/src/auth.ts` for exactly what it expects.
- `apps/web` — Vite + React 18 + TanStack Query + Radix/shadcn + Tailwind + react-router.
- Live preview over SSE: `streamSSE` from `hono/streaming`, singleton `EventSource`
  pinned on `window` so HMR does not orphan it, `ping` events as keepalive. A document
  write from any source — terminal, agent, batch — re-renders and pushes to open tabs.
- Screens: a library (search across the copy in every design, projects as folders, a
  top-down scrollable grid) and an editor (layer list, preview, right-hand inspector,
  lint panel). ASCII mockups of both are in the plan at
  https://notes.kudcrafts.com/d/headless-canva-plan — follow them.
- **No free-drag canvas.** Position comes from anchors; dragging to an absolute pixel
  breaks the property that makes the next hundred renders work. The inspector edits the
  same JSON the CLI writes.
- Search is the differentiator and is nearly free: a design is JSON, so every word of
  copy is a Postgres full-text column.

### 4. Deployment

- One multi-stage Dockerfile, tempe-sadari's shape: install → builder (prisma generate,
  vite build, bun build) → slim runner; API serves the built SPA; `prisma migrate deploy`
  on start. Bake the fonts into the runner layer so renders are reproducible.
- Two Coolify applications from that one image, different start commands: the web app,
  and a worker with no domain for renders and background removal.
- Database `creative-db` on the shared Coolify `postgresql` instance (uuid `n4okooo`).
  The `pgbouncer-shared` service is wildcard + `auth_query`, so it needs **no new
  PgBouncer config** — unlike the older per-app poolers, whose stack currently reports
  `degraded:unhealthy`.
- Prisma through the pooler needs `?pgbouncer=true&connection_limit=1` on `DATABASE_URL`
  and a `DIRECT_URL` that bypasses it for migrations.
- Assets in S3 via `@aws-sdk/client-s3` with presigned URLs, as tempe-sadari does.

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
