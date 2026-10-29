import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { validateSubagentChildRunState } from "../src/subagent-child-run-validation.js";
import { assertSubagentContinuationState } from "../src/subagent-continuation-lineage.js";
import { assertReplaySubagentBindings } from "../src/subagent-replay-validation.js";
import { continuationRunnerFixture, cleanupContinuationRunnerFixtures } from "./subagent-continuation-runner-fixture.js";

afterEach(cleanupContinuationRunnerFixtures);

describe("continuation durable lineage integrity", () => {
  it.each(["usage", "ordinal", "grant_source", "capsule_source"] as const)("rejects a rehashed %s contradiction against the predecessor", async (kind) => {
    const f = await continuationRunnerFixture(), claimed = await f.interruptAndClaim();
    const runs = claimed.store.listRuns(f.thread.id), tasks = claimed.store.listSubagentTasks(f.thread.id);
    const run = runs.find((candidate) => candidate.id === claimed.continuation.execution.run.id)!;
    const receipt = run.subagent!.continuation!;
    if (kind === "usage") receipt.budget.inheritedUsage.inputTokens += 1;
    if (kind === "ordinal") receipt.budget.continuationOrdinal = 42;
    if (kind === "grant_source") {
      receipt.grant.sourceTaskId = "task_unrelated";
      const { contentSha256: _hash, ...grant } = receipt.grant;
      receipt.grant.contentSha256 = sha256(canonicalJson(grant));
    }
    if (kind === "capsule_source") receipt.sourceRunId = "run_unrelated";
    const { contentSha256: _hash, ...content } = receipt;
    receipt.contentSha256 = sha256(canonicalJson(content));
    expect(() => validateSubagentChildRunState(runs, tasks)).toThrow(/continuation.*(budget|grant|source)/i);
  });

  it("rejects a second successor for one predecessor in persisted state", async () => {
    const f = await continuationRunnerFixture(), claimed = await f.interruptAndClaim();
    const runs = claimed.store.listRuns(f.thread.id), tasks = claimed.store.listSubagentTasks(f.thread.id);
    const duplicate = structuredClone(claimed.continuation.execution.run);
    duplicate.id = "run_duplicate_successor";
    expect(() => assertSubagentContinuationState([...runs, duplicate], tasks)).toThrow("multiple successors");
  });

  it.each(["missing", "duplicate", "changed"] as const)("rejects a %s durable continuation event in replay", async (kind) => {
    const f = await continuationRunnerFixture(), claimed = await f.interruptAndClaim();
    const bundle = await exportThreadReplayBundle(claimed.store, f.thread.id);
    const event = bundle.events.find((candidate) => candidate.type === "subagent.child.continuation_started")!;
    if (kind === "missing") bundle.events = bundle.events.filter((candidate) => candidate !== event);
    if (kind === "duplicate") bundle.events.push(structuredClone(event));
    if (kind === "changed") event.payload = { changed: true };
    expect(() => assertReplaySubagentBindings(bundle.runs, bundle.subagents, bundle.events, undefined))
      .toThrow("receipt differs from its durable event");
  });
});
