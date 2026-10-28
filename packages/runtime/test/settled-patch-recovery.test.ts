import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { AgentRuntime } from "../src/agent-runtime.js";
import { assessAutomaticRecovery } from "../src/automatic-recovery.js";
import { ModelRegistry } from "../src/models.js";
import { settledPatchRecoveryCandidates } from "../src/run-patch-recovery-evidence.js";
import { loadSettledPatchRecoveryEvidence } from "../src/workspace-patch-result-recovery.js";
import { LocalStore } from "../src/store.js";
import {
  baselinePatchAssessment,
  PATCH_RECOVERY_BASELINE,
} from "./fixtures/patch-recovery-baseline.js";

const roots: string[] = [];
const stores: LocalStore[] = [];
const observations: Record<string, unknown>[] = [];
afterAll(async () => {
  const output = process.env["NAPIER_PATCH_RECOVERY_OBSERVATIONS"];
  if (output)
    await writeFile(
      output,
      JSON.stringify(
        { baselineCommit: PATCH_RECOVERY_BASELINE, observations },
        null,
        2,
      ),
    );
});
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("settled patch automatic recovery across process death", () => {
  it.each(["after-terminal", "after-settlement"])(
    "retains a committed file at %s and continues without rewriting it",
    async (checkpoint) => {
      const fixture = await crashed(checkpoint);
      const before = await stat(fixture.file);
      const events = await fixture.store.listRunEvents(fixture.run.id);
      const baseline = await baselinePatchAssessment(
        fixture.root,
        fixture.run,
        events,
      );
      expect(baseline.eligible).toBe(false);
      expect(baseline.blockReasons).toContain("unsafe_tool_effect");
      const { patches, retainedResults } =
        await loadSettledPatchRecoveryEvidence(fixture.store.dataRoot, events);
      expect(retainedResults).toHaveLength(
        checkpoint === "after-settlement" ? 1 : 0,
      );
      expect(patches).toHaveLength(1);
      expect(
        settledPatchRecoveryCandidates(
          events.filter((event) => event.type !== "tool.operation.settled"),
        ),
      ).toEqual([]);
      if (checkpoint === "after-terminal") {
        const completed = events.find(
          (event) => event.type === "tool.completed",
        )!;
        expect(
          settledPatchRecoveryCandidates([
            ...events,
            { ...completed, seq: completed.seq + 1 },
          ]),
        ).toEqual([]);
        const forged = structuredClone(events);
        const result = forged.find((event) => event.type === "tool.completed")!;
        (result.payload["details"] as Record<string, unknown>)["afterSha256"] =
          "0".repeat(64);
        expect(settledPatchRecoveryCandidates(forged)).toEqual([]);
      }
      expect(JSON.stringify(events)).not.toContain("written once");
      expect(JSON.stringify(patches)).not.toContain("retained.txt");
      expect(
        assessAutomaticRecovery({ run: fixture.run, events }),
      ).toMatchObject({ eligible: true, toolCalls: { unsafe: 1 } });
      const claim = await claimRecovery(fixture);
      const provider = fauxProvider({ provider: "faux-patch-recovery" });
      provider.setResponses([
        (context) => {
          expect(context.tools?.map((tool) => tool.name)).toEqual([
            "read_file",
          ]);
          expect(JSON.stringify(context.messages)).toContain(
            "settled patch operation(s) were retained",
          );
          if (checkpoint === "after-settlement")
            expect(JSON.stringify(context.messages)).toContain(
              "settled_result_capsule",
            );
          return fauxAssistantMessage(
            "The retained file can now be inspected.",
          );
        },
      ]);
      const registry = new ModelRegistry();
      registry.registerProvider(provider.provider);
      const recoveryStarted = performance.now();
      const recovered = await new AgentRuntime(
        fixture.store,
        registry,
      ).resumeInterruptedRunAutomatically({
        ...claim,
        onRunCreated: (run) =>
          fixture.store
            .bindAutomaticRecoveryRun(claim.attempt.id, claim.token, run.id)
            .then(() => undefined),
      });
      expect(recovered.status, recovered.error).toBe("completed");
      expect(recovered.parentRunId).toBe(fixture.run.id);
      expect(provider.state.callCount).toBe(1);
      expect(await readFile(fixture.file, "utf8")).toBe("written once\n");
      const after = await stat(fixture.file);
      expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
      expect(
        (await fixture.store.listRunEvents(recovered.id)).filter(
          (event) => event.type === "tool.started",
        ),
      ).toHaveLength(0);
      if (checkpoint === "after-settlement") {
        expect(
          (await fixture.store.listRunEvents(fixture.run.id)).filter(
            (event) => event.type === "tool.completed",
          ),
        ).toHaveLength(0);
      }
      observations.push({
        checkpoint,
        retainedExactResults: retainedResults.length,
        baselineEligible: baseline.eligible,
        baselineBlockReasons: baseline.blockReasons,
        runStatus: recovered.status,
        restartMs: fixture.restartMs,
        continuationMs: performance.now() - recoveryStarted,
        recoveryModelFixtureCalls: provider.state.callCount,
        externalModelRequests: 0,
        fileContentPreserved: true,
        fileIdentityAndMtimePreserved: true,
        repeatedWriteCalls: 0,
        manualInterventions: 0,
        retainedOperations: patches.length,
      });
    },
    30000,
  );

  it.each([
    "changed",
    "missing",
    "symlink",
    "missing-capsule",
    "missing-result",
    "tampered-result",
  ] as const)(
    "rechecks %s after the claim and stops before any model request",
    async (change) => {
      const fixture = await crashed(
        change.endsWith("result") ? "after-settlement" : "after-terminal",
      );
      const claim = await claimRecovery(fixture);
      if (change === "changed")
        await writeFile(fixture.file, "operator edit\n");
      if (change === "missing") await unlink(fixture.file);
      if (change === "symlink") {
        await unlink(fixture.file);
        const external = path.join(fixture.root, "outside.txt");
        await writeFile(external, "written once\n");
        await symlink(external, fixture.file);
      }
      if (change === "missing-capsule")
        await rm(path.join(fixture.root, "data/workspace-patch-recovery"), {
          recursive: true,
        });
      if (change === "missing-result")
        await rm(path.join(fixture.root, "data/workspace-patch-results"), {
          recursive: true,
        });
      if (change === "tampered-result") {
        const directory = path.join(
          fixture.root,
          "data/workspace-patch-results",
        );
        const [name] = await readdir(directory);
        const filename = path.join(directory, name!);
        const capsule = JSON.parse(await readFile(filename, "utf8"));
        capsule.result.content[0].text = "Forged result";
        await writeFile(filename, JSON.stringify(capsule));
      }
      const provider = fauxProvider({ provider: "faux-patch-recovery" });
      const registry = new ModelRegistry();
      registry.registerProvider(provider.provider);
      const recoveryStarted = performance.now();
      await expect(
        new AgentRuntime(
          fixture.store,
          registry,
        ).resumeInterruptedRunAutomatically(claim),
      ).rejects.toThrow(/Patch recovery/);
      expect(provider.state.callCount).toBe(0);
      expect(fixture.store.listRuns(fixture.run.threadId)).toHaveLength(1);
      observations.push({
        checkpoint: `after-claim:${change}`,
        stoppedBeforeContinuation: true,
        restartMs: fixture.restartMs,
        reconciliationMs: performance.now() - recoveryStarted,
        recoveryModelFixtureCalls: 0,
        externalModelRequests: 0,
        repeatedWriteCalls: 0,
        requiresManualReview: true,
      });
    },
    30000,
  );

  it.each(["before-effect", "after-effect"])(
    "does not infer success or replay at %s without complete evidence",
    async (checkpoint) => {
      const fixture = await crashed(checkpoint);
      const events = await fixture.store.listRunEvents(fixture.run.id);
      expect(settledPatchRecoveryCandidates(events)).toEqual([]);
      expect(
        assessAutomaticRecovery({ run: fixture.run, events }).eligible,
      ).toBe(false);
      expect(
        (
          await fixture.store.claimAutomaticRecoveries("worker_patch_test", {
            now: new Date(Date.now() + 5000),
          })
        ).claims,
      ).toEqual([]);
      if (checkpoint === "before-effect")
        await expect(stat(fixture.file)).rejects.toMatchObject({
          code: "ENOENT",
        });
      else expect(await readFile(fixture.file, "utf8")).toBe("written once\n");
      if (checkpoint === "after-effect")
        expect(fixture.run.outcome).toBe("blocked_safety");
      observations.push({
        checkpoint,
        runStatus: fixture.run.status,
        outcome: fixture.run.outcome,
        restartMs: fixture.restartMs,
        automaticallyContinued: false,
        fileState:
          checkpoint === "before-effect"
            ? "absent"
            : "committed_content_retained",
        repeatedWriteCalls: 0,
        externalModelRequests: 0,
        requiresManualReview: true,
      });
    },
    30000,
  );
});

async function crashed(checkpoint: string) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-settled-patch-"));
  roots.push(root);
  const child = fileURLToPath(
    new URL("./fixtures/patch-recovery-crash.ts", import.meta.url),
  );
  await expect(
    promisify(execFile)(
      process.execPath,
      ["--import", "tsx", child, root, checkpoint],
      { timeout: 20000 },
    ),
  ).rejects.toMatchObject({ code: 73 });
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  });
  stores.push(store);
  const restartStarted = performance.now();
  await store.initialize(true);
  const restartMs = performance.now() - restartStarted;
  const thread = store.listThreads()[0]!;
  const run = store.listRuns(thread.id)[0]!;
  return {
    root,
    store,
    run,
    restartMs,
    file: path.join(root, "workspace/retained.txt"),
  };
}

async function claimRecovery(fixture: Awaited<ReturnType<typeof crashed>>) {
  await new Promise((resolve) => setTimeout(resolve, 1050));
  const result =
    await fixture.store.claimAutomaticRecoveries("worker_patch_test");
  expect(result.claims).toHaveLength(1);
  return result.claims[0]!;
}
