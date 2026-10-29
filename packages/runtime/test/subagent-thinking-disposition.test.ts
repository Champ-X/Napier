import { rm } from "node:fs/promises";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { JsonObject } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStore } from "../src/store.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { normalizeModelPhysicalObservation } from "../src/model-usage-observation.js";
import { issueModelThinkingSuppression, type ModelThinkingSuppressionProof } from "../src/model-thinking-suppression.js";
import type { ModelThinkingLoopEvidence } from "../src/model-thinking-loop-policy.js";
import { claimChildThinkingSuppression } from "../src/subagent-response-disposition.js";
import { prepareSubagentWorkingSet } from "../src/subagent-working-set-capsule.js";
import { createThreadReplayBundle, validateThreadReplayBundle } from "../src/thread-bundles.js";
import { accountingFixture } from "./model-accounting-fixture.js";

const fixtures: Awaited<ReturnType<typeof accountingFixture>>[] = [], stores: LocalStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const f of fixtures.splice(0)) { f.store.close(); f.source.close(); await rm(f.root, { recursive: true, force: true }); }
});
async function fixture() { const f = await accountingFixture(); fixtures.push(f); return f; }
const recovery = { reason: "thinking_only_terminal", attempt: 1, observedBytes: 120,
  observedThinkingChunks: 3, repeatedUnitBytes: 40, repeatedUnitSha256: "a".repeat(64) } satisfies ModelThinkingLoopEvidence;

async function prepared() {
  const f = await fixture(), child = await f.child(), call = await child.prepare();
  const logical: AssistantMessage = { ...f.fixture.message, content: [{ type: "thinking", thinking: "Bounded hidden reasoning" }] };
  const payload: JsonObject = { ...call.reference, stopReason: logical.stopReason, responseSha256: sha256(canonicalJson(logical)),
    toolCalls: [], outputDisposition: "suppressed_thinking_recovery", thinkingRecovery: recovery };
  const proof = issueModelThinkingSuppression({ message: logical, evidence: recovery, attribution: call.attribution });
  const settle = (body: JsonObject = payload, capture = true, capability: ModelThinkingSuppressionProof | null = proof) => f.store.settleSubagentChildInvocation({ ...child.fence,
    expectedExecutionRevision: child.reservation.executionRevision, invocationId: child.reservation.invocationId,
    usageStatus: "unknown", ...(capture ? { capture: child.capture } : {}),
    ...(capability ? { thinkingSuppression: capability } : {}), payload: body });
  let entered = false;
  const enter = async () => {
    if (entered) return;
    await f.store.modelAccountingRepository.enter(call.prepared); f.source.reserve(call.attribution); entered = true;
  };
  const physical = async (message: AssistantMessage = logical) => {
    await enter();
    const observation = normalizeModelPhysicalObservation({ attribution: call.attribution, message, terminal: "response" });
    f.source.record(observation);
    const delivery = f.source.pending({ physicalId: call.attribution.physicalId })[0]!;
    await f.store.modelAccountingRepository.reconcile(delivery); f.source.acknowledge(delivery);
    return observation;
  };
  return { f, child, call, logical, payload, proof, settle, enter, physical };
}

describe("child suppressed thinking source evidence", () => {
  it("excludes a known hidden thinking terminal from the checkpoint transcript without losing accounting or replay evidence", async () => {
    const p = await prepared(), { f, child } = p;
    await p.physical(); const settled = await p.settle();
    expect((await p.settle()).executionRevision).toBe(settled.executionRevision);
    const fence = { ...child.fence, expectedExecutionRevision: settled.executionRevision };
    const ready = await f.store.prepareSubagentChildCheckpoint(fence);
    const initial = { role: "user", content: child.task.prompt, timestamp: 1 };
    const capsule = await prepareSubagentWorkingSet(f.options.dataRoot, { frontier: ready.frontier, boundary: "before_model",
      systemPrompt: child.child.profile.systemPrompt, tools: [], messages: [initial], mailbox: { consumedThroughSeq: 0, entries: [] } });
    const saved = await f.store.commitSubagentChildCheckpoint({ ...fence, prepared: capsule });
    expect(saved.run).toMatchObject({ usageStatus: "complete", usage: { inputTokens: 100 }, subagent: { checkpoint: { messageCount: 1 } } });
    const events = await f.store.listRunEvents(child.child.run.id);
    expect(events.filter((event) => event.type === "model.response")).toHaveLength(1);
    expect(events.find((event) => event.type === "model.response")!.payload).toMatchObject({ stopReason: "stop",
      responseSha256: sha256(canonicalJson(p.logical)), outputDisposition: "suppressed_thinking_recovery" });
    const reopened = new LocalStore(f.options); stores.push(reopened); await reopened.initializeAccounting();
    expect(reopened.listRuns(f.thread.id).find((run) => run.id === child.child.run.id)?.subagent?.checkpoint).toEqual(saved.run.subagent?.checkpoint);
    const original = createThreadReplayBundle(await f.store.getDetail(f.thread.id));
    expect(JSON.stringify(original)).not.toContain("thinkingSuppression");
    const imported = await f.store.importThreadReplayBundle(original);
    const twice = await f.store.importThreadReplayBundle(createThreadReplayBundle(imported));
    for (const detail of [imported, twice]) {
      validateThreadReplayBundle(createThreadReplayBundle(detail));
      const response = detail.events.find((event) => event.type === "model.response")!;
      expect(response.payload).toMatchObject({ outputDisposition: "suppressed_thinking_recovery", thinkingRecovery: recovery,
        responseSha256: sha256(canonicalJson(p.logical)) });
      expect(detail.runs.find((run) => run.source === "subagent")).toMatchObject({ usageStatus: "complete", usage: { inputTokens: 100 } });
    }
  });

  it("keeps quarantined late raw tool output out of the logical response and checkpoint", async () => {
    const p = await prepared(), { f, child } = p;
    const logical: AssistantMessage = { ...p.logical, content: [], stopReason: "aborted", errorMessage: "Logical thinking attempt stopped" };
    const payload = { ...p.payload, stopReason: "aborted", responseSha256: sha256(canonicalJson(logical)) };
    await p.enter();
    const proof = issueModelThinkingSuppression({ message: logical, evidence: recovery, attribution: p.call.attribution });
    const settled = await p.settle(payload, true, proof);
    const fence = { ...child.fence, expectedExecutionRevision: settled.executionRevision };
    await expect(f.store.prepareSubagentChildCheckpoint(fence)).rejects.toThrow("unresolved model usage");
    const raw: AssistantMessage = { ...p.logical, stopReason: "toolUse",
      content: [{ type: "toolCall", id: "late_unexecuted", name: "read_file", arguments: { path: "never-execute" } }] };
    const observation = await p.physical(raw);
    expect(observation.usageStatus).toBe("known");
    expect(observation.responseSha256).not.toBe(payload.responseSha256);
    const ready = await f.store.prepareSubagentChildCheckpoint(fence);
    const capsule = await prepareSubagentWorkingSet(f.options.dataRoot, { frontier: ready.frontier, boundary: "before_model",
      systemPrompt: child.child.profile.systemPrompt, tools: [], messages: [{ role: "user", content: child.task.prompt, timestamp: 1 }],
      mailbox: { consumedThroughSeq: 0, entries: [] } });
    await f.store.commitSubagentChildCheckpoint({ ...fence, prepared: capsule });
    const events = await f.store.listRunEvents(child.child.run.id);
    expect(events.some((event) => event.type.startsWith("tool."))).toBe(false);
    expect(events.find((event) => event.type === "model.response")!.payload).toMatchObject({ toolCalls: [], responseSha256: payload.responseSha256 });
  });

  it("cannot rewrite a settled suppression when a late terminal callback arrives", async () => {
    const p = await prepared(); await p.physical(); await p.settle();
    const { outputDisposition: _disposition, thinkingRecovery: _recovery, ...delivered } = p.payload;
    await expect(p.settle(delivered, true, null)).rejects.toThrow("settlement conflicts");
    expect((await p.f.store.listRunEvents(p.child.child.run.id)).filter((event) => event.type === "model.response")).toHaveLength(1);
  });

  it.each(["orphan", "unknown_disposition", "bad_reason", "bad_counters", "extra_evidence", "tool_calls", "tool_terminal", "no_capture"] as const)("rejects %s suppression before writing a response", async (kind) => {
    const p = await prepared(), payload = structuredClone(p.payload);
    if (kind === "orphan") delete payload["outputDisposition"];
    if (kind === "unknown_disposition") payload["outputDisposition"] = "hide_anything";
    if (kind === "bad_reason") payload["thinkingRecovery"] = { ...recovery, reason: "not_recovery" };
    if (kind === "bad_counters") payload["thinkingRecovery"] = { ...recovery, observedBytes: 0 };
    if (kind === "extra_evidence") payload["thinkingRecovery"] = { ...recovery, unbound: true };
    if (kind === "tool_calls") payload["toolCalls"] = [{ id: "delivered", name: "read_file" }];
    if (kind === "tool_terminal") payload["stopReason"] = "toolUse";
    await expect(p.settle(payload, kind !== "no_capture")).rejects.toThrow("suppression disposition");
    expect((await p.f.store.listRunEvents(p.child.child.run.id)).some((event) => event.type === "model.response")).toBe(false);
  });

  it.each(["missing", "copied", "forged", "other_response", "other_evidence"] as const)("rejects %s native suppression authority", async (kind) => {
    const p = await prepared();
    const proof = kind === "missing" ? null : kind === "copied" ? { ...p.proof } : kind === "forged" ? {} as ModelThinkingSuppressionProof :
      issueModelThinkingSuppression({ message: kind === "other_response" ? { ...p.logical, timestamp: p.logical.timestamp + 1 } : p.logical,
        evidence: kind === "other_evidence" ? { ...recovery, attempt: 2 } : recovery, attribution: p.call.attribution });
    await expect(p.settle(p.payload, true, proof)).rejects.toThrow(/suppression/iu);
    expect((await p.f.store.listRunEvents(p.child.child.run.id)).some((event) => event.type === "model.response")).toBe(false);
  });

  it("rejects proof reuse for another child invocation even with identical response and detection bytes", async () => {
    const p = await prepared(); await p.physical(); await p.settle();
    const event = (await p.f.store.listRunEvents(p.child.child.run.id)).find((event) => event.type === "model.response")!;
    const payload = { ...event.payload as JsonObject, childInvocationId: "childinv_" + "f".repeat(64) };
    expect(() => claimChildThinkingSuppression(p.proof, payload, { threadId: event.threadId, runId: event.runId })).toThrow("already bound to another attempt");
  });

  it.each(["append", "once", "head"] as const)("blocks generic %s from bypassing native suppression settlement", async (method) => {
    const p = await prepared();
    const input = { threadId: p.f.thread.id, runId: p.child.child.run.id, type: "model.response" as const,
      category: "model" as const, payload: p.payload };
    const append = method === "append" ? () => p.f.store.appendEvent(input) : method === "once" ?
      () => p.f.store.appendEventOnce(input, { namespace: "thinking-test", key: "forged-marker" }) :
      () => p.f.store.appendEventOnceAtRunHead(input, { namespace: "thinking-test", key: "forged-marker", expectedRunHeadSeq: 0 });
    await expect(append()).rejects.toThrow("native guard authority");
    expect((await p.f.store.listRunEvents(p.child.child.run.id)).some((event) => event.type === "model.response")).toBe(false);
  });
});
