import { readFile } from "node:fs/promises";
import path from "node:path";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

import { inferWorkspaceRoot } from "./workspace-root.js";
import { createWorkspaceRuntimeHost } from "./workspace-runtime-host.js";

const webRoot = path.resolve(import.meta.dirname, "../../web/dist");
const host = await createWorkspaceRuntimeHost({
  workspaceRoot: path.resolve(process.env["NAPIER_WORKSPACE"] ?? inferWorkspaceRoot(process.cwd())),
  ...(process.env["NAPIER_HOME"] ? { dataRoot: path.resolve(process.env["NAPIER_HOME"]) } : {}),
  onWarning: (workspaceId, error) => {
    process.stderr.write(`Napier workspace warning for ${workspaceId}: ${error}\n`);
  },
});

const app = new Hono();
app.all("/api/*", (context) => host.fetch(context.req.raw));
app.use("/*", serveStatic({ root: webRoot }));
app.get("*", async (context) => {
  try { return context.html(await readFile(path.join(webRoot, "index.html"), "utf8")); }
  catch {
    return context.text("Napier API is running. Start the web workspace with `npm run dev -w @napier/web`.", 200);
  }
});

const configuredPort = Number.parseInt(process.env["NAPIER_PORT"] ?? "8787", 10);
const port = Number.isFinite(configuredPort) ? configuredPort : 8787;
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
  process.stdout.write(`Napier is listening on http://${info.address}:${info.port}\n`);
});

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  await host.shutdown();
  await closed;
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
