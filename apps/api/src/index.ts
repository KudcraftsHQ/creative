/**
 * The API, and in production the server for the built SPA as well.
 *
 * Two entry points share this file's shape: this one serves traffic, and
 * `src/worker.ts` runs the same code with no domain in front of it. Both talk to
 * the same database and the same Redis, which is what makes a render started by
 * the worker show up in a tab attached to the web container.
 */
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { registerAll } from "@creative/core";
import { auth } from "./lib/auth.ts";
import { healthRoute } from "./routes/health.ts";
import { meRoute } from "./routes/me.ts";
import { designsRoute } from "./routes/designs.ts";
import { projectsRoute } from "./routes/projects.ts";
import { eventsRoute } from "./routes/events.ts";
import { templatesRoute, fontsRoute } from "./routes/templates.ts";
import { assetsRoute, assetPublicRoute } from "./routes/assets.ts";
import { oauthRoute } from "./routes/oauth.ts";

export const app = new Hono();

app.use(logger());

// Same-origin in production — the SPA is served from this container. In dev the
// Vite server proxies /api here, so cookies stay same-origin there too.
app.use("/api/*", cors({ origin: (origin) => origin ?? "*", credentials: true }));

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Reading an asset is public and must be matched before the authed /api/assets
// router below — a document renders from a terminal that holds no session.
app.route("/api/assets", assetPublicRoute);

// Mounted at the root: `creative login` builds /oauth/authorize and /oauth/token
// from the bare API origin, so these cannot live under /api.
app.route("/oauth", oauthRoute);

const apiRoutes = app
  .basePath("/api")
  .route("/health", healthRoute)
  .route("/me", meRoute)
  .route("/designs", designsRoute)
  .route("/projects", projectsRoute)
  .route("/events", eventsRoute)
  .route("/assets", assetsRoute)
  .route("/templates", templatesRoute)
  .route("/fonts", fontsRoute);

export type AppType = typeof apiRoutes;

// The built SPA, and a fallback so a deep link like /d/<id> reaches the router
// instead of a 404. /api is excluded so a missing route stays a missing route.
app.use("/*", serveStatic({ root: "./apps/web/dist" }));
app.get("*", async (c) => {
  if (c.req.path.startsWith("/api") || c.req.path.startsWith("/oauth")) return c.notFound();
  return serveStatic({ path: "./apps/web/dist/index.html" })(c, async () => {});
});

// Fonts are baked into the image at CREATIVE_HOME. Registering at boot rather than
// on the first render means a container with an empty registry fails its health
// check instead of quietly rendering every design in a substituted face.
const registered = registerAll(true);
const port = Number(process.env.PORT ?? 3000);
console.log(
  `[creative-api] listening on :${port}  fonts=${registered}  NODE_ENV=${process.env.NODE_ENV}`,
);

export default {
  port,
  // SSE streams sit idle between pings. Bun's default 10s idle timeout would drop
  // them well before the 25s keepalive; 255 is the maximum it accepts.
  idleTimeout: 255,
  fetch: app.fetch,
};
