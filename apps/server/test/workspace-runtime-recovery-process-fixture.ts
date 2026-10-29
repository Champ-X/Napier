import path from "node:path";
import { serve } from "@hono/node-server";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";

import { createServices } from "../src/app.js";
import { createWorkspaceRuntimeHost } from "../src/workspace-runtime-host.js";
import { processReadySandbox } from "./process-run-readiness-test-fixture.js";

const [stateHome, workspaceRoot, mode] = process.argv.slice(2);
if (!stateHome || !workspaceRoot || (mode !== "hold" && mode !== "recover")) throw new Error("Invalid recovery fixture arguments");
const host = await createWorkspaceRuntimeHost({ workspaceRoot, stateHome }, async (options) => {
  if (!options?.workspaceRoot) throw new Error("Missing fixture workspace identity");
  // Install a deterministic local provider before starting the actual workers.
  const services = await createServices({
    ...options, env: {}, startAutomation: false, sandbox: processReadySandbox("workspace-process-recovery"),
  });
  const label = path.basename(options.workspaceRoot);
  const provider = fauxProvider({ provider: "faux-workspace-recovery" });
  provider.setResponses([
    fauxAssistantMessage(`Recovered only in workspace ${label}.`),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  services.models.registerProvider(provider.provider);
  const runPrompt = services.kernel.runPrompt.bind(services.kernel);
  services.kernel.runPrompt = (input) => runPrompt({ ...input, onEvent: async (event) => {
    await input.onEvent?.(event);
    if (mode === "hold" && event.type === "run.started") {
      process.send?.({ type: "held", root: options.workspaceRoot, runId: event.runId });
      await new Promise<never>(() => undefined);
    }
  } });
  services.automation.start(); services.channels.start(); services.recovery.start();
  services.receiptTrustDirectorySubscriptions.start();
  return services;
});
const server = serve({ fetch: host.fetch, hostname: "127.0.0.1", port: 0 });
if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Missing fixture address");
process.send?.({ type: "ready", origin: `http://127.0.0.1:${address.port}` });
process.once("message", async (message) => {
  if (message !== "shutdown") throw new Error("Unexpected fixture control");
  await host.shutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  process.disconnect?.();
});
