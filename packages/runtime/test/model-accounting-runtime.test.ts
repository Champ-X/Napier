import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import { UnsupportedSandboxAdapter } from "../src/sandbox.js";
import { completeModelInvocation } from "../src/model-complete-invocation.js";
import { ModelUsageReceiptSpool } from "../src/model-usage-source.js";
import { modelResultAttribution } from "../src/model-call-attribution.js";

it("standalone shutdown waits for physical observation and closes its durable source after Store projection", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napier-native-runtime-"));
  const workspaceRoot = path.join(root, "workspace"), dataRoot = path.join(root, "state");
  await mkdir(workspaceRoot);
  const services = await createLocalAgentRuntime({ workspaceRoot, dataRoot, sandbox: new UnsupportedSandboxAdapter("native-drain") });
  const faux = fauxProvider({ provider: "native-runtime" }), source = createAssistantMessageEventStream();
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const dispatch = vi.fn(() => { signalStarted(); return source; });
  services.models.registerProvider({ ...faux.provider, stream: dispatch, streamSimple: dispatch });
  const model = services.models.resolve({ provider: faux.provider.id, id: "faux-1" })!;
  const pending = completeModelInvocation({ models: services.models.models, model, context: { messages: [] },
    phase: "standalone_model_call", accounting: services.models.accountingForOperation("standalone_model_call") });
  await started;
  const closeStore = vi.spyOn(services.store, "shutdown");
  const shutdown = services.shutdown();
  expect(services.shutdown()).toBe(shutdown);
  expect(closeStore).not.toHaveBeenCalled();
  source.push({ type: "done", reason: "stop", message: { ...fauxAssistantMessage("physical result"), api: model.api, provider: model.provider, model: model.id,
    usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } } } });
  try {
    const response = await pending;
    await shutdown;
    expect(closeStore).toHaveBeenCalledOnce();
    const spool = await ModelUsageReceiptSpool.open(path.join(dataRoot, "model-usage.sqlite"));
    try {
      const attribution = modelResultAttribution(response)!;
      expect(spool.attribution(attribution.physicalId)).toEqual(attribution);
      expect(spool.pending()).toHaveLength(0);
    } finally { spool.close(); }
    expect(dispatch).toHaveBeenCalledOnce();
  } finally { await shutdown; await rm(root, { recursive: true, force: true }); }
});
