import { readFile } from "node:fs/promises";
import path from "node:path";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

import { createApp, createServices } from "./app.js";

const services = await createServices({ startAutomation: true });
const app = createApp(services);
const webRoot = path.resolve(import.meta.dirname, "../../web/dist");

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

const configuredPort = Number.parseInt(
  process.env["NAPIER_PORT"] ?? "8787",
  10,
);
const port = Number.isFinite(configuredPort) ? configuredPort : 8787;

const server = serve(
  {
    fetch: app.fetch,
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
  await services.receiptTrustDirectorySubscriptions.stop();
  await services.recovery.stop();
  await services.automation.stop();
  await services.channels.stop();
  await services.workspaceProcesses.shutdown();
  await services.extensions.shutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  services.store.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
