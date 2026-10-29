import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { emptyUsage, type RunRecord } from "@napier/contracts";
import { canonicalJson, createLocalAgentRuntime, sha256, UnsupportedSandboxAdapter } from "@napier/runtime";
import { afterAll, describe, expect, it } from "vitest";

import { verifyWorkflowBenchmarkArtifacts, workflowBenchmarkLedgerFileName } from "../src/workflow-benchmark-contract.js";
import { createWorkflowBenchmarkLedgerBundle, verifyWorkflowBenchmarkLedgerBundle } from "../src/workflow-benchmark-ledger.js";
import { workflowBenchmarkRunEvidence } from "../src/workflow-benchmark-run-summary.js";
import { runWorkflowBenchmark } from "../src/workflow-benchmark.js";
import type { WorkflowBenchmarkLedgerBundle, WorkflowBenchmarkResult } from "../src/workflow-benchmark-types.js";

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))); });

const parent: RunRecord = {
  id: "run_parent", threadId: "thread_usage", agentId: "agent_usage", source: "workflow", status: "completed",
  startedAt: "2026-10-29T01:00:00.000Z", finishedAt: "2026-10-29T01:00:10.000Z",
  usage: { ...emptyUsage(), inputTokens: 10, outputTokens: 5, costUsd: 0.1 },
};
const child: RunRecord = {
  ...parent, id: "run_child", source: "subagent", parentRunId: parent.id, usageStatus: "complete",
  usage: { ...emptyUsage(), inputTokens: 4, outputTokens: 2, costUsd: 0.04 },
};

let artifactPromise: ReturnType<typeof runWorkflowBenchmark> | undefined;
async function artifacts() {
  if (artifactPromise) return artifactPromise;
  const root = await mkdtemp(path.join(tmpdir(), "napier-workflow-child-usage-"));
  roots.push(root);
  const provider = fauxProvider({ provider: "faux-child-usage" });
  provider.setResponses(Array.from({ length: 3 }, () => (context: { messages: unknown[] }) => {
    const prompt = JSON.stringify(context.messages);
    const document = [{ id: "doc_alpha", length: 5 }, { id: "doc_beta", length: 4 }, { id: "doc_gamma", length: 6 }]
      .find((item) => prompt.includes(item.id));
    if (!document) throw new Error("Unexpected workflow fixture request");
    return fauxAssistantMessage(JSON.stringify(document));
  }));
  artifactPromise = runWorkflowBenchmark({
    caseRoot: path.resolve(import.meta.dirname, "../../../benchmarks/workflow/document-map-reduce-v1"),
    outputDir: root, model: { provider: provider.provider.id, id: "faux-1" }, env: {},
  }, {
    now: () => new Date("2026-10-29T01:00:00.000Z"),
    createRuntime: async (options) => {
      const runtime = await createLocalAgentRuntime({ ...options, sandbox: new UnsupportedSandboxAdapter("child-usage-test") });
      runtime.models.registerProvider(provider.provider);
      return runtime;
    },
  });
  return artifactPromise;
}

function bind(result: WorkflowBenchmarkResult, bundle: WorkflowBenchmarkLedgerBundle) {
  const { contentSha256: _oldBundleHash, ...content } = bundle;
  bundle.contentSha256 = sha256(canonicalJson(content as never));
  result.ledger.bundleSha256 = bundle.contentSha256;
  result.ledger.bundleFileName = workflowBenchmarkLedgerFileName(result.caseId, bundle.contentSha256);
  result.ledger.bundleBytes = Buffer.byteLength(`${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  const { contentSha256: _oldResultHash, ...resultContent } = result;
  result.contentSha256 = sha256(canonicalJson(resultContent as never));
  return { result, bundle };
}

async function withChild() {
  const original = await artifacts();
  const result = structuredClone(original.result), bundle = structuredClone(original.bundle);
  const owner = bundle.runs.find((run) => run.usage.inputTokens > 0)!;
  // A child Run is an additional view of usage already rolled into its owner.
  // Keep Workflow map children primary even though they also have parentRunId.
  bundle.runs.push({
    id: "run_usage_child", source: "subagent", parentRunId: owner.id,
    status: "completed", durationMs: 1, usageStatus: "complete", usage: structuredClone(owner.usage),
  });
  bundle.runs.sort((left, right) => left.id.localeCompare(right.id));
  return bind(result, bundle);
}

describe("Workflow primary Run usage", () => {
  it("does not add child usage twice while preserving Workflow parented Runs", () => {
    const workflowChild: RunRecord = { ...parent, id: "run_workflow_item", parentRunId: parent.id };
    const result = workflowBenchmarkRunEvidence({ threadId: parent.threadId, planId: "plan_usage", status: "completed" }, [parent, child, workflowChild]);
    expect.soft(result.usage.inputTokens).toBe(20);
    expect.soft(result.usage.outputTokens).toBe(10);
    expect.soft(result.usage.costUsd).toBeCloseTo(0.2);
    expect.soft(result.runCount).toBe(2);
    expect.soft(result.completedRunCount).toBe(2);
  });

  it("refuses unqualified totals when a child has unknown physical usage", () => {
    expect(() => workflowBenchmarkRunEvidence({ threadId: parent.threadId, planId: "plan_usage", status: "completed" }, [parent, { ...child, usageStatus: "incomplete" }])).toThrow(/usage.*incomplete/iu);
  });

  it("retains child source and completeness in a generated ledger", async () => {
    const a = await artifacts();
    const bundle = createWorkflowBenchmarkLedgerBundle({
      generatedAt: a.bundle.generatedAt, caseId: a.result.caseId, caseSha256: a.result.caseSha256,
      threadId: parent.threadId, result: a.result.workflow, status: "completed", planId: a.result.run.planId,
      mapRunIds: a.bundle.workflow.mapRunIds, reduceRunId: a.bundle.workflow.reduceRunId!,
      runs: [parent, child], evaluationEvent: a.bundle.evaluationEvent, terminalEvent: a.bundle.terminalEvent,
      events: [a.bundle.terminalEvent, a.bundle.evaluationEvent], sourceEventStreamSha256: a.bundle.sourceEventStreamSha256, sourceReplaySha256: a.bundle.sourceReplaySha256,
    });
    expect(bundle.runs.find((run) => run.id === child.id)).toMatchObject({ source: "subagent", parentRunId: parent.id, usageStatus: "complete" });
  });

  it("offline verification accepts a retained child without duplicating the primary total", async () => {
    const a = await withChild();
    expect(verifyWorkflowBenchmarkLedgerBundle(a.bundle).valid).toBe(true);
    expect(verifyWorkflowBenchmarkArtifacts(a.result, a.bundle)).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("retains incomplete evidence for inspection but refuses a complete score binding", async () => {
    const a = await withChild();
    a.bundle.runs.find((run) => run.source === "subagent")!.usageStatus = "incomplete";
    bind(a.result, a.bundle);
    expect(verifyWorkflowBenchmarkLedgerBundle(a.bundle).valid).toBe(true);
    expect(verifyWorkflowBenchmarkArtifacts(a.result, a.bundle)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining(["ledger_binding_mismatch"]) });
  });

  it("rejects invalid child ownership and unknown source or usage markers", async () => {
    for (const change of [{ parentRunId: "run_missing" }, { source: "unrecognized" }, { usageStatus: "estimated" }]) {
      const a = await withChild();
      Object.assign(a.bundle.runs.find((run) => run.source === "subagent")!, change);
      bind(a.result, a.bundle);
      expect(verifyWorkflowBenchmarkLedgerBundle(a.bundle).valid).toBe(false);
    }
  });

  it("keeps legacy source-absent receipts valid", async () => {
    const original = await artifacts();
    const result = structuredClone(original.result), bundle = structuredClone(original.bundle);
    for (const run of bundle.runs) { delete run.source; delete run.usageStatus; }
    bind(result, bundle);
    expect(verifyWorkflowBenchmarkArtifacts(result, bundle)).toMatchObject({ valid: true, diagnostics: [] });
  });
});
