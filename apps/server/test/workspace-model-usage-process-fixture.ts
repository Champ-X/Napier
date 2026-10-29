import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAssistantMessageEventStream, fauxProvider, type AssistantMessage } from "@earendil-works/pi-ai";
import { emptyUsage } from "@napier/contracts";
import { LocalStore } from "@napier/runtime/store";
import { ModelRegistry } from "@napier/runtime/model";
import { withModelCallAttribution } from "../../../packages/runtime/dist/model-call-attribution.js";
import { createModelCallCaptureBinding } from "../../../packages/runtime/dist/model-call-capture.js";
import { createModelContextEnvelopeReceipt } from "../../../packages/runtime/dist/model-context-envelope.js";
import { WorkspaceModelAdmission } from "../src/workspace-model-admission.js";
import { resolveWorkspaceRuntimeIdentity } from "../src/workspace-runtime-identity.js";
import { reconcileWorkspaceModelUsage } from "../src/workspace-model-usage-recovery.js";

const [mode, root, url] = process.argv.slice(2);
if (!mode || !root) throw new Error("Fixture mode/root required");
const stateHome = path.join(root, "host");
const send = (value: unknown) => new Promise<void>((resolve, reject) => process.send?.(value as object, (error) => error ? reject(error) : resolve()));
if (mode === "replay") {
  const metadata = JSON.parse(await readFile(path.join(root, "metadata.json"), "utf8"));
  const admission = await WorkspaceModelAdmission.open(stateHome);
  try {
    await reconcileWorkspaceModelUsage(metadata.identity, admission);
    const store = new LocalStore({ workspaceRoot: metadata.identity.root, dataRoot: metadata.identity.dataRoot });
    try {
      await store.initializeAccounting();
      await send({ stage: "replayed", run: store.listRuns(metadata.threadId).find((run) => run.id === metadata.runId),
        events: await store.listRunEvents(metadata.runId), budget: admission.snapshot() });
    } finally { store.close(); }
  } finally { admission.close(); }
  process.disconnect?.();
} else {
  if (!url || new URL(url).hostname !== "127.0.0.1" || new URL(url).protocol !== "http:") throw new Error("Only explicit loopback fixture HTTP is permitted");
  const request = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== url) throw new Error("Non-fixture network access forbidden");
    return request(input, init);
  }) as typeof fetch;
  const workspaceRoot = path.join(root, "workspace"), dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const identity = await resolveWorkspaceRuntimeIdentity(workspaceRoot, dataRoot);
  const admission = await WorkspaceModelAdmission.open(stateHome);
  const store = new LocalStore({ workspaceRoot: identity.root, dataRoot: identity.dataRoot });
  await store.initialize();
  const source = admission.usageSource(identity.workspaceId);
  store.modelAccountingRepository.configureSource({ source, hostWorkspaceId: identity.workspaceId });
  const agentId = store.listAgents()[0]!.id, thread = await store.createThread({ agentId, title: "Loopback late usage" });
  const leased = await store.createLeasedRun({ threadId: thread.id, agentId, source: "user" },
    { ownerId: `process:${process.pid}:late-usage-fixture`, ttlMs: 60_000 });
  const provider = fauxProvider({ provider: "usage-loopback", models: [{ id: "delayed", contextWindow: 100, maxTokens: 20,
    cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1.25 } }] });
  const model = provider.getModel();
  let resolveStarted!: () => void;
  const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
  let physicalCalls = 0;
  const dispatch = () => {
    physicalCalls += 1;
    const stream = createAssistantMessageEventStream();
    // Deliberately ignores AbortSignal; only an exact loopback URL can be fetched.
    void fetch(url).then(async (response) => {
      const result = await response.json() as AssistantMessage;
      result.provider = model.provider; result.model = model.id; result.api = model.api;
      if (result.usage.totalTokens !== 14) throw new Error("Nonzero fixture usage changed");
      stream.push({ type: "done", reason: "stop", message: result });
    }).catch((error) => { stream.result = () => Promise.reject(error); });
    resolveStarted();
    return stream;
  };
  const registry = new ModelRegistry(undefined, admission.forWorkspace(identity.workspaceId));
  registry.registerProvider({ ...provider.provider, stream: dispatch, streamSimple: dispatch });
  const context = { messages: [{ role: "user" as const, content: "Local delayed response only", timestamp: 1 }] };
  const controller = new AbortController(), options = { maxTokens: 20, signal: controller.signal };
  const prepared = await store.modelAccountingRepository.prepare({
    owner: store.modelAccountingRepository.runAuthority({ runId: leased.run.id, token: leased.token }),
    method: "completeSimple", phase: "agent_turn", logicalCallId: "loopback-physical-1", model,
    capture: createModelCallCaptureBinding({ model, context, options,
      envelope: createModelContextEnvelopeReceipt({ turnIndex: 0, systemPrompt: "", messages: context.messages, tools: [] }) }),
  });
  const entered = await store.modelAccountingRepository.enter(prepared);
  const result = withModelCallAttribution(entered, registry.models, () => registry.models.completeSimple(model, context, options));
  const settled = result.then(() => ({ status: "resolved" }), (error: unknown) => ({ status: "rejected", error: String(error) }));
  await Promise.race([started, settled.then((outcome) => { throw new Error(`Model settled before loopback dispatch: ${JSON.stringify(outcome)}`); })]);
  controller.abort(new Error("Logical cancellation fixture"));
  const terminal = await store.finishRun(leased.run.id, "cancelled", { leaseToken: leased.token, usage: emptyUsage(),
    terminalEvent: { payload: { status: "cancelled", reason: "fixture logical cancellation" } } });
  const terminalEvents = (await store.listRunEvents(terminal.id)).filter((event) => event.type === "run.cancelled");
  await writeFile(path.join(root, "metadata.json"), JSON.stringify({ identity, threadId: thread.id, runId: terminal.id,
    terminal, terminalEvents, mode, physicalCalls }, null, 2), { flag: "wx" });
  if (mode === "source_committed" || mode === "before_receipt") store.close();
  if (mode === "store_committed") {
    const db = new DatabaseSync(path.join(stateHome, "model-admission.sqlite"));
    db.exec("CREATE TRIGGER fixture_ack_barrier BEFORE UPDATE OF acknowledged_at ON model_usage_receipts BEGIN SELECT RAISE(ABORT, 'fixture before acknowledgement'); END");
    db.close();
  }
  await send({ stage: "logical_terminal", physicalCalls, terminal, budget: admission.snapshot() });
  const outcome = await settled;
  await send({ stage: "physical_settled", physicalCalls, outcome, budget: admission.snapshot() });
  // Keep the owner alive at the requested actual SIGKILL boundary.
  setInterval(() => undefined, 1_000);
}
