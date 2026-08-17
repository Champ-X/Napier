import { readFile } from "node:fs/promises";
import path from "node:path";

import type { WorkspaceSummary } from "@napier/contracts";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

import { createApp, createServices, type NapierServices } from "./app.js";
import { WorkspaceRebindBusyError, workspaceRebindBusyReasons } from "./workspace-rebind.js";

const webRoot = path.resolve(import.meta.dirname, "../../web/dist");

function attachStatic(app: Hono): Hono {
  app.use("/*", serveStatic({ root: webRoot }));
  app.get("*", async (context) => {
    try {
      return context.html(
        await readFile(path.join(webRoot, "index.html"), "utf8"),
      );
    } catch {
      return context.text(
        "Napier API is running. Start the web workspace with `npm run dev -w @napier/web`.",
        200,
      );
    }
  });
  return app;
}

async function teardownServices(next: NapierServices): Promise<void> {
  await next.receiptTrustDirectorySubscriptions.stop();
  await next.recovery.stop();
  await next.automation.stop();
  await next.channels.stop();
  await next.shutdownLocalRuntime();
}

let services = await createServices({ startAutomation: true });
let rebinding = false;

// A workspace rebind swaps the entire service graph onto a new folder. It
// refuses while any Run is active, tears down the current runtime with the same
// ordering as process shutdown (minus server.close), then rebuilds services and
// the Hono app so every handler and derived data root points at the new store.
async function rebindWorkspace(absoluteRoot: string): Promise<WorkspaceSummary> {
  if (rebinding) {
    throw new WorkspaceRebindBusyError(["a workspace rebind is already running"]);
  }
  rebinding = true;
  try {
    const busy = workspaceRebindBusyReasons(services.store);
    if (busy.length > 0) throw new WorkspaceRebindBusyError(busy);
    const previous = services;
    await teardownServices(previous);
    // Bind a per-workspace ledger under the new folder rather than reusing the
    // launch-time NAPIER_HOME, so each folder is self-contained and its
    // persisted threads never reference a different workspace root.
    services = await createServices({
      startAutomation: true,
      workspaceRoot: absoluteRoot,
      dataRoot: path.join(absoluteRoot, ".napier"),
    });
    app = attachStatic(createApp(services, { rebindWorkspace }));
    return services.store.getWorkspaceSummary();
  } finally {
    rebinding = false;
  }
}

let app = attachStatic(createApp(services, { rebindWorkspace }));

const configuredPort = Number.parseInt(
  process.env["NAPIER_PORT"] ?? "8787",
  10,
);
const port = Number.isFinite(configuredPort) ? configuredPort : 8787;

const server = serve(
  {
    fetch: ((...args: Parameters<Hono["fetch"]>) => app.fetch(...args)) as Hono["fetch"],
    hostname: "127.0.0.1",
    port,
  },
  (info) => {
    process.stdout.write(
      `Napier is listening on http://${info.address}:${info.port}\n`,
    );
  },
);

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  await teardownServices(services);
  await new Promise<void>((resolve) => server.close(() => resolve()));
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
