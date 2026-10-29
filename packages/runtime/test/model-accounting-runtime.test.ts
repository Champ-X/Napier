import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import { UnsupportedSandboxAdapter } from "../src/sandbox.js";
import { completeModelInvocation } from "../src/model-complete-invocation.js";
import { ModelUsageReceiptSpool } from "../src/model-usage-source.js";
import { initializeModelAccountingRuntime } from "../src/model-accounting-runtime.js";
import { createLocalModelCallAdmission } from "../src/model-call-local-admission.js";
import { accountingFixture } from "./model-accounting-fixture.js";
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

it.each(["startup", "drain"] as const)("keeps %s source configuration and ACK on the captured native repository", async (phase) => {
  const f = await accountingFixture(), admission = createLocalModelCallAdmission(f.source);
  const configure = vi.spyOn(f.store.modelAccountingRepository, "configureSource").mockImplementation(() => {
    throw new Error("Public source interceptor must not execute");
  });
  const reconcile = vi.spyOn(f.store.modelAccountingRepository, "reconcile").mockImplementation(async () => {
    throw new Error("Public projection replacement must not execute");
  });
  const db = new DatabaseSync(path.join(f.options.dataRoot, "ledger.sqlite"));
  try {
    const runtime = phase === "drain" ? await initializeModelAccountingRuntime(f.store, admission) : undefined;
    await f.physical(await f.main());
    db.exec("CREATE TRIGGER fail_runtime_projection BEFORE INSERT ON model_usage_claims BEGIN SELECT RAISE(ABORT,'runtime projection unavailable'); END");
    const project = () => runtime ? runtime.drain({}) : initializeModelAccountingRuntime(f.store, admission);
    await expect(project()).rejects.toThrow("runtime projection unavailable");
    expect(f.source.pending()).toHaveLength(1);
    expect(db.prepare("SELECT count(*) AS n FROM model_usage_claims").get()?.["n"]).toBe(0);
    db.exec("DROP TRIGGER fail_runtime_projection");
    await project();
    expect(f.source.pending()).toHaveLength(0);
    expect(db.prepare("SELECT count(*) AS n FROM model_usage_claims").get()?.["n"]).toBe(1);
    expect(configure).not.toHaveBeenCalled(); expect(reconcile).not.toHaveBeenCalled();
  } finally {
    db.exec("DROP TRIGGER IF EXISTS fail_runtime_projection"); db.close();
    configure.mockRestore(); reconcile.mockRestore(); f.store.close(); f.source.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
