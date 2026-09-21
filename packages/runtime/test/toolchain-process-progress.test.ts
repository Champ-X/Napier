import { afterEach, expect, it } from "vitest";
import { createWorkspaceProcessTool } from "../src/workspace-process-tool.js";
import { workspaceProcessToolResult } from "../src/workspace-process-tool-result.js";
import { withToolchainProcessProvider } from "../src/toolchain-process-provider.js";
import { resolveToolProgress } from "../src/tool-progress-semantics.js";
import { RunProgressTracker } from "../src/run-progress-vector.js";
import { projectValidatedVectorChain } from "../src/run-progress-payload-codec.js";
import { hasRunNoProgressPressure } from "../src/run-convergence-policy.js";
import {
  cleanupProgressFixtures,
  createFixture,
  createRun,
  toolEvent,
  event,
} from "./run-progress-vector-test-support.js";

afterEach(cleanupProgressFixtures);
const original = createWorkspaceProcessTool(undefined as never, {
  threadId: "thread_progress",
  runId: "run_progress",
});
const candidate = withToolchainProcessProvider(original);
const processId = "process_evidence";
const input = { action: "poll", processId };
function result(parts: string[], cursor = 1) {
  return workspaceProcessToolResult(
    "poll",
    {
      id: processId,
      status: "running",
      sandbox: "host-direct",
      nextCursor: cursor,
      outputAvailable: true,
      workspaceAccess: "read_only",
      networkAccess: "denied",
      contentSha256: "a".repeat(64),
    } as never,
    parts.map((text, index) => ({
      stream: "stdout",
      text,
      cursor: cursor + index,
    })),
  );
}

it("credits observed output only in the opt-in provider, independently of cursor or chunking", () => {
  const first = result(["RE", "ADY\n"]);
  const same = result(["READY\n"], 20);
  const a = resolveToolProgress(candidate, input, first);
  const b = resolveToolProgress(candidate, input, same);
  expect(resolveToolProgress(original, input, first).contribution).toBe(
    "neutral",
  );
  expect(a.contribution).toBe("supporting");
  expect(a.coverage).toBe("trusted_declared");
  expect(a.stateSha256).toBe(b.stateSha256);
  expect(a.resourceKeySha256).toBe(b.resourceKeySha256);
  expect(resolveToolProgress(candidate, input, result([])).contribution).toBe(
    "neutral",
  );
  for (const action of ["start", "input", "cancel", "resize", "start_write"])
    expect(
      resolveToolProgress(candidate, { ...input, action }, first).contribution,
    ).toBe("neutral");
  expect(
    resolveToolProgress(candidate, { ...input, processId: "foreign" }, first)
      .contribution,
  ).toBe("neutral");
});

it("deduplicates A-B-A process evidence across durable hydration without certifying a product", async () => {
  const f = await createFixture("process-evidence");
  try {
    const run = await createRun(f);
    let tracker = await RunProgressTracker.create(f.store, run);
    for (const [index, text] of ["A", "B", "A"].entries()) {
      const progress = resolveToolProgress(
        candidate,
        input,
        result([text], index + 1),
      );
      await toolEvent(f.store, run, "tool.completed", {
        callId: `poll-${index}`,
        toolName: "workspace_process",
        progress: progress as never,
      });
      await event(f.store, run, "turn.completed", {});
      await tracker.recordTurn();
      if (index === 1) tracker = await RunProgressTracker.create(f.store, run);
    }
    const vector = projectValidatedVectorChain(
      await f.store.listRunEvents(run.id),
      run.id,
    ).at(-1)!;
    expect(vector.supportCount).toBe(2);
    expect(vector.supportProgressed).toBe(false);
    expect(vector.productCount).toBe(0);
    expect(vector.acceptanceCount).toBe(0);
    expect(vector.progressed).toBe(false);
  } finally {
    await f.store.close();
  }
});

it("keeps useful process inspection alive but retains the absolute stall window", async () => {
  const f = await createFixture("process-activity-window");
  try {
    const run = await createRun(f);
    const tracker = await RunProgressTracker.create(f.store, run);
    for (let index = 0; index < 8; index++) {
      const progress = resolveToolProgress(
        candidate,
        input,
        result([`reply-${index}`]),
      );
      await toolEvent(f.store, run, "tool.completed", {
        callId: `poll-${index}`,
        toolName: "workspace_process",
        progress: progress as never,
      });
      await event(f.store, run, "turn.completed", {});
      await tracker.recordTurn();
    }
    const vector = projectValidatedVectorChain(
      await f.store.listRunEvents(run.id),
      run.id,
    ).at(-1)!;
    const phase = { attempts: 0, advances: 0, failureDomains: 0 };
    expect(vector.activity?.progressed).toBe(true);
    expect(vector.progressed).toBe(false);
    expect(hasRunNoProgressPressure(vector, phase)).toBe(false);
    expect(
      hasRunNoProgressPressure({ ...vector, stagnantTurnCount: 18 }, phase),
    ).toBe(true);
    expect(
      hasRunNoProgressPressure({ ...vector, stagnantElapsedMs: 180000 }, phase),
    ).toBe(true);
  } finally {
    await f.store.close();
  }
});
