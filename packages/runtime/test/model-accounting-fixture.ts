import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { JsonObject } from "@napier/contracts";
import { LocalStore } from "../src/store.js";
import { ModelUsageReceiptSpool } from "../src/model-usage-source.js";
import { readPreparedModelCall } from "../src/model-call-attribution.js";
import { normalizeModelPhysicalObservation } from "../src/model-usage-observation.js";
import { authorizeSubagentChildRun } from "../src/subagent-child-authorization.js";
import { createModelContextEnvelopeReceipt } from "../src/model-context-envelope.js";
import { modelUsageFixture } from "./model-usage-fixture.js";

export async function accountingFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-accounting-"));
  const options = { dataRoot: path.join(root, "data"), workspaceRoot: path.join(root, "workspace") };
  await mkdir(options.workspaceRoot);
  const store = new LocalStore(options); await store.initialize();
  const sourcePath = path.join(root, "usage.sqlite"), source = await ModelUsageReceiptSpool.open(sourcePath);
  store.modelAccountingRepository.configureSource({ source });
  const profile = await store.updateAgent(store.listAgents()[0]!.id, { enabledSubagents: ["researcher"],
    subagentLimits: { maxConcurrent: 2, maxTotal: 4, maxTurns: 4, timeoutMs: 30_000 }, enabledTools: ["read_file"] });
  const thread = await store.createThread({ agentId: profile.id, title: "Accounting fixture" });
  const lease = { ownerId: `process:${process.pid}:accounting`, ttlMs: 60_000 };
  const parent = await store.createLeasedRun({ threadId: thread.id, agentId: profile.id, source: "user" }, lease);
  const fixture = modelUsageFixture();
  async function main() {
    const prepared = await store.modelAccountingRepository.prepare({
      owner: store.modelAccountingRepository.runAuthority({ runId: parent.run.id, token: parent.token }),
      phase: "agent_turn", method: "completeSimple", logicalCallId: "main", model: fixture.model, capture: fixture.attribution.capture });
    const attribution = readPreparedModelCall(prepared).attribution;
    return { prepared, attribution, reference: { physicalId: attribution.physicalId,
      attributionSha256: attribution.contentSha256, accountingMode: "physical_receipt_v1" } };
  }
  async function child() {
    const task = await store.createSubagentTask({ threadId: thread.id, runId: parent.run.id, role: "researcher",
      description: "Account child", prompt: "Read only", model: profile.model, providerId: "in_process", executionId: "subexec_accounting" });
    const authorization = authorizeSubagentChildRun({ parentRun: parent.run, parentProfile: profile, taskId: task.id,
      executionId: task.executionId!, limits: profile.subagentLimits! });
    const child = await store.startSubagentChildRun({ taskId: task.id, executionId: task.executionId!, authorization, lease });
    const fence = { runId: child.run.id, taskId: task.id, executionId: task.executionId!, token: child.token };
    const reservation = await store.reserveSubagentChildInvocation({ ...fence, expectedExecutionRevision: child.executionRevision,
      phase: "subagent_turn", requestId: "accounting-child" });
    const authority = store.modelAccountingRepository.childAuthority({ ...fence, kind: "child", threadId: thread.id,
      parentRunId: parent.run.id, childInvocationId: reservation.invocationId, invocationIndex: reservation.invocationIndex,
      expectedExecutionRevision: reservation.executionRevision });
    const capture = { ...fixture.attribution.capture, envelope: createModelContextEnvelopeReceipt({ turnIndex: reservation.invocationIndex - 1,
      systemPrompt: fixture.context.systemPrompt!, messages: fixture.context.messages, tools: [] }) };
    async function prepare() {
      const prepared = await store.modelAccountingRepository.prepare({ owner: authority, phase: "subagent_turn", method: "streamSimple",
        logicalCallId: "child", model: fixture.model, capture });
      const attribution = readPreparedModelCall(prepared).attribution;
      return { prepared, attribution, reference: { physicalId: attribution.physicalId,
        attributionSha256: attribution.contentSha256, accountingMode: "physical_receipt_v1" } };
    }
    return { child, task, fence, reservation, authority, prepare,
      capture: { ...capture, adapter: JSON.parse(JSON.stringify(capture.adapter)) as JsonObject } };
  }
  async function physical(call: Awaited<ReturnType<typeof main>>, enter = true) {
    if (enter) await store.modelAccountingRepository.enter(call.prepared);
    source.reserve(call.attribution);
    const observation = normalizeModelPhysicalObservation({ attribution: call.attribution, message: fixture.message, terminal: "response" });
    source.record(observation);
    return { observation, delivery: source.pending({ physicalId: call.attribution.physicalId })[0]! };
  }
  return { root, options, store, sourcePath, source, profile, thread, parent, fixture, main, child, physical };
}
