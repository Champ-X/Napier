import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ModelRegistry } from "../packages/runtime/src/models.js";
import { createThreadBranch } from "../packages/runtime/src/thread-branches.js";
import {
  cleanupProgressFixtures,
  createFixture,
} from "../packages/runtime/test/run-progress-vector-test-support.js";
import { processReadyAgentRuntime } from "../packages/runtime/test/process-run-readiness-test-fixture.js";
import {
  parseBranchHistoryFixture,
  seedBranchHistory,
  auditBranchHistory,
} from "./harness-branch-history-fixture.mjs";

afterEach(cleanupProgressFixtures);

it("grades inherited boundaries and rejects original, leaked, exclusive and invalid-input implementations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "branch-shipping-oracle-"));
  try {
    const caseRoot = new URL(
      "../benchmarks/harness-components/branch-shipping-history-v1/",
      import.meta.url,
    );
    const original = await readFile(
      new URL("fixture/src/shipping.js", caseRoot),
      "utf8",
    );
    const correct = original.replace(
      "subtotalCents > 6_000",
      "subtotalCents >= 7_000",
    );
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "grader.mjs"),
      await readFile(new URL("outcome.mjs", caseRoot)),
    );
    for (const [source, passes] of [
      [correct, true],
      [original, false],
      [correct.replace(">= 7_000", ">= 6_000"), false],
      [correct.replace(">= 7_000", ">= 9_000"), false],
      [correct.replace(">= 7_000", "> 7_000"), false],
      [correct.replace("!Number.isInteger(subtotalCents) || ", ""), false],
    ]) {
      await writeFile(path.join(root, "src/shipping.js"), source);
      const grade = spawnSync(
        process.execPath,
        [path.join(root, "grader.mjs")],
        { encoding: "utf8", timeout: 10000 },
      );
      expect(grade.status === 0, grade.stderr).toBe(passes);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
const fixture = {
  schemaVersion: 1,
  initialText: "Review shipping arithmetic.",
  mode: "steering",
  amendmentText: "Use a 7000-cent inclusive threshold in this branch.",
  sourceLaterText: "Use 9000 cents in the original thread.",
};

it.each([
  { ...fixture, mode: "assistant" },
  { ...fixture, initialText: "" },
  { ...fixture, toolResults: [] },
  { ...fixture, schemaVersion: 2 },
])("rejects unsupported fixture input %# before setup", (input) => {
  expect(() => parseBranchHistoryFixture(JSON.stringify(input))).toThrow(
    "Invalid branch history fixture",
  );
});

it.each(["steering", "follow_up"])(
  "seeds and audits real branch APIs for %s without network",
  async (mode) => {
    const f = await createFixture(`branch-probe-${mode}`);
    await f.store.updateAgent(f.agentId, {
      enabledTools: ["read_file"],
      enabledSkills: [],
      enabledSubagents: [],
    });
    const seeded = await seedBranchHistory({
      store: f.store,
      thread: f.store.getThread(f.threadId),
      fixture: parseBranchHistoryFixture(JSON.stringify({ ...fixture, mode })),
      createThreadBranch,
    });
    const provider = fauxProvider({ provider: `branch-probe-${mode}` });
    provider.setResponses([
      fauxAssistantMessage("Reviewed the branch."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const run = await processReadyAgentRuntime(f.store, models).runPrompt({
      threadId: seeded.thread.id,
      text: "Continue using the inherited rules.",
      model: { provider: provider.provider.id, id: "faux-1" },
      harnessPolicyPreset: "coding-node.v1",
    });
    expect(run.status, run.error).toBe("completed");
    const events = await f.store.listRunEvents(run.id);
    expect(
      await auditBranchHistory(f.store, seeded.receipt, events),
    ).toMatchObject({ passed: true, queryReceipts: 1 });
    const contaminated = structuredClone(events);
    const memory = contaminated.find(
      (event) =>
        event.type === "context.memory" &&
        event.payload.phase === "model_invocation",
    );
    memory.payload.query.sourceEventIds.push(
      seeded.receipt.sourceUserEventIds.at(-1),
    );
    expect(
      (await auditBranchHistory(f.store, seeded.receipt, contaminated)).passed,
    ).toBe(false);
    expect((await auditBranchHistory(f.store, seeded.receipt, [])).passed).toBe(
      false,
    );
    await f.store.appendEvent({
      threadId: f.threadId,
      runId: seeded.receipt.sourceRunIds.at(-1),
      type: "message.user",
      category: "message",
      visibility: "user",
      payload: { role: "user", text: "Changed ledger" },
    });
    expect(
      (await auditBranchHistory(f.store, seeded.receipt, events))
        .sourceUnchanged,
    ).toBe(false);
  },
);
