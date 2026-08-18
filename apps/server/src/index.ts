import { readFile } from "node:fs/promises";
import path from "node:path";

import type { WorkspaceSummary } from "@napier/contracts";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

import { createApp, createServices, type NapierServices } from "./app.js";
import {
  readRecentWorkspaces,
  recordRecentWorkspace,
} from "./recent-workspaces.js";
import {
  WorkspaceRebindBusyError,
  resolveRebindWorkspaceRoot,
  workspaceRebindBusyReasons,
} from "./workspace-rebind.js";
import { WorkspaceServiceGraphCache } from "./workspace-service-swap.js";

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

async function pauseServices(next: NapierServices): Promise<void> {
  await next.receiptTrustDirectorySubscriptions.stop();
  await next.recovery.stop();
  await next.automation.stop();
  await next.channels.stop();
}

function resumeServices(next: NapierServices): void {
  next.automation.start();
  next.channels.start();
  next.recovery.start();
  next.receiptTrustDirectorySubscriptions.start();
}

async function disposeServices(next: NapierServices): Promise<void> {
  await pauseServices(next);
  await next.shutdownLocalRuntime();
}

let services = await createServices({ startAutomation: true });
let rebinding = false;
const serviceGraphs = new WorkspaceServiceGraphCache({
  initialRoot: services.store.getWorkspaceSummary().root,
  initialGraph: services,
  maxEntries: 3,
  prepare: (workspaceRoot) =>
    createServices({
      startAutomation: false,
      workspaceRoot,
      dataRoot: path.join(workspaceRoot, ".napier"),
    }),
  pause: pauseServices,
  resume: resumeServices,
  activate: (candidate) => {
    services = candidate;
    app = attachStatic(
      createApp(candidate, { rebindWorkspace, listWorkspaceThreads }),
    );
  },
  dispose: disposeServices,
  onDisposeError: (root, error) => {
    process.stderr.write(
      `Napier workspace cleanup warning for ${root}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  },
});

// A workspace rebind swaps the active service graph while keeping a bounded
// set of recent graphs warm. Only the active graph runs background workers.
async function rebindWorkspace(
  absoluteRoot: string,
): Promise<WorkspaceSummary> {
  if (rebinding) {
    throw new WorkspaceRebindBusyError([
      "a workspace rebind is already running",
    ]);
  }
  rebinding = true;
  try {
    const busy = workspaceRebindBusyReasons(services.store);
    if (busy.length > 0) throw new WorkspaceRebindBusyError(busy);
    await serviceGraphs.switchTo(absoluteRoot);
    const summary = services.store.getWorkspaceSummary();
    await recordRecentWorkspace(summary.root);
    return summary;
  } finally {
    rebinding = false;
  }
}

async function listWorkspaceThreads(root: string) {
  const canonicalRoot = await resolveRebindWorkspaceRoot(root);
  const graph = await serviceGraphs.prewarm(canonicalRoot);
  return graph.store.listVisibleThreads();
}

let app = attachStatic(
  createApp(services, { rebindWorkspace, listWorkspaceThreads }),
);

// Record the launch workspace so it appears in the recent list before any
// switch. Best-effort and outside createServices, so it survives rebuilds.
void recordRecentWorkspace(services.store.getWorkspaceSummary().root).then(
  async () => {
    const recent = await readRecentWorkspaces();
    for (const workspace of recent.slice(0, 3)) {
      if (!serviceGraphs.has(workspace.root)) {
        await serviceGraphs.prewarm(workspace.root).catch(() => undefined);
      }
    }
  },
);

const configuredPort = Number.parseInt(
  process.env["NAPIER_PORT"] ?? "8787",
  10,
);
const port = Number.isFinite(configuredPort) ? configuredPort : 8787;

const server = serve(
  {
    fetch: ((...args: Parameters<Hono["fetch"]>) =>
      app.fetch(...args)) as Hono["fetch"],
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
  await serviceGraphs.shutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
