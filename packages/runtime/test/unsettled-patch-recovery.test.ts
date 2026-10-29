import { once } from "node:events";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterAll, afterEach, expect, it } from "vitest";
import { reconcileInterruptedWorkspacePatches } from "../src/workspace-patch-interruption-reconciliation.js";
import { liveToolEffectAuthoritiesFromEvents } from "../src/sqlite-tool-effect-authority.js";
import { AgentRuntime } from "../src/agent-runtime.js";
import { assessAutomaticRecovery } from "../src/automatic-recovery.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { reconciledPatchRecoveryEvidence } from "../src/workspace-patch-reconciled-evidence.js";
import { baselinePatchAssessment } from "./fixtures/patch-recovery-baseline.js";

const roots: string[] = [];
const stores: LocalStore[] = [];
const observations: Record<string, unknown>[] = [];
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
afterAll(async () => {
  if (process.env["NAPIER_UNSETTLED_PATCH_OBSERVATIONS"])
    await writeFile(
      process.env["NAPIER_UNSETTLED_PATCH_OBSERVATIONS"]!,
      JSON.stringify(observations, null, 2),
    );
});

it.each(["create", "replace"])(
  "reconciles %s immediately after file commit, before any returned result",
  async (operation) => {
    const root = await crashed("after-file", operation);
    const file = path.join(root, "workspace/retained.txt");
    const before = await stat(file);
    const restartedAt = performance.now();
    const store = await restart(root);
    const restartMs = performance.now() - restartedAt;
    const run = store.listRuns(store.listThreads()[0]!.id)[0]!;
    const events = await store.listRunEvents(run.id);
    expect(run.status).toBe("interrupted");
    expect(
      events.filter((e) =>
        [
          "tool.operation.settled",
          "tool.completed",
          "context.tool_result",
        ].includes(e.type),
      ),
    ).toEqual([]);
    expect(reconciledPatchRecoveryEvidence(events)).toHaveLength(1);
    for (const type of [
      "workspace.patch.prepared",
      "workspace.patch.reconciled",
      "tool.operation.effect_indeterminate",
      "tool.started",
      "run.interrupted",
    ]) {
      expect(
        reconciledPatchRecoveryEvidence(
          events.filter((event) => event.type !== type),
        ),
      ).toEqual([]);
    }
    const invalidProof = structuredClone(events);
    invalidProof.find(
      (event) => event.type === "workspace.patch.reconciled",
    )!.payload["preparedSha256"] = "0".repeat(64);
    expect(reconciledPatchRecoveryEvidence(invalidProof)).toEqual([]);

    expect(assessAutomaticRecovery({ run, events }).eligible).toBe(true);
    expect((await baselinePatchAssessment(root, run, events)).eligible).toBe(
      false,
    );
    const marker = events.find(
      (e) => e.type === "tool.operation.effect_indeterminate",
    )!;
    for (const type of [
      "tool.completed",
      "context.tool_result",
      "workspace.patch.reconciled",
    ]) {
      await expect(
        store.appendEvent({
          threadId: run.threadId,
          runId: run.id,
          type,
          category: "tool",
          visibility: "debug",
          payload: { callId: marker.payload["parentCallId"] },
        }),
      ).rejects.toThrow();
    }
    // The same durable history is loaded on a second startup, without new proofs.
    store.close();
    const replayed = await restart(root);
    expect(
      (await replayed.listRunEvents(run.id)).filter(
        (e) => e.type === "workspace.patch.reconciled",
      ),
    ).toHaveLength(1);
    const claim = await recoveryClaim(replayed);
    const provider = fauxProvider({ provider: "faux-patch-recovery" });
    provider.setResponses([
      (context) => {
        expect(context.tools?.map((t) => t.name)).toEqual(["read_file"]);
        expect(JSON.stringify(context.messages)).toContain(
          "independently reconciled",
        );
        return fauxAssistantMessage(
          "The retained file is available for inspection.",
        );
      },
    ]);
    const registry = new ModelRegistry();
    registry.registerProvider(provider.provider);
    const continuedAt = performance.now();
    const recovered = await new AgentRuntime(
      replayed,
      registry,
    ).resumeInterruptedRunAutomatically(claim);
    expect(recovered.status, recovered.error).toBe("completed");
    const after = await stat(file);
    expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
    expect(await readFile(file, "utf8")).toBe("written once\n");
    expect(provider.state.callCount).toBe(1);
    expect(
      (await replayed.listRunEvents(recovered.id)).filter(
        (e) => e.type === "tool.started",
      ),
    ).toHaveLength(0);
    observations.push({
      checkpoint: "after-file",
      operation,
      restartMs,
      continuationMs: performance.now() - continuedAt,
      recovered: true,
      originalResultFabricated: false,
      fileIdentityAndMtimePreserved: true,
      repeatedWrites: 0,
      recoveryModelFixtureCalls: 1,
      externalModelRequests: 0,
      manualInterventions: 0,
    });
  },
  30000,
);

it.each(["create", "replace"])(
  "does not infer a %s commit from a write-ahead intent alone",
  async (operation) => {
    const root = await crashed("after-prepared", operation);
    const store = await restart(root);
    const run = store.listRuns(store.listThreads()[0]!.id)[0]!;
    expect(run.status).toBe("interrupted");
    const events = await store.listRunEvents(run.id);
    expect(events.filter((e) => e.type === "workspace.patch.not_committed")).toHaveLength(1);
    expect(
      events.filter((e) => e.type === "workspace.patch.prepared"),
    ).toHaveLength(1);
    expect(reconciledPatchRecoveryEvidence(events)).toEqual([]);
    if (operation === "create")
      await expect(
        stat(path.join(root, "workspace/retained.txt")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    else
      expect(
        await readFile(path.join(root, "workspace/retained.txt"), "utf8"),
      ).toBe("before\n");
    observations.push({
      checkpoint: "after-prepared",
      operation,
      recovered: false,
      originalFilePreserved: true,
      repeatedWrites: 0,
      externalModelRequests: 0,
      requiresManualReview: true,
    });
  },
  30000,
);

it.each([
  "changed",
  "missing",
  "same-content-new-inode",
  "symlink",
  "missing-intent",
  "corrupt-intent",
  "invalid-prepared",
  "live-lock",
])(
  "stops %s before creating a continuation",
  async (change) => {
    const root = await crashed("after-file");
    const file = path.join(root, "workspace/retained.txt");
    if (change === "changed") await writeFile(file, "external change\n");
    if (change === "missing") await unlink(file);
    if (change === "same-content-new-inode") await replaceIdentically(file);
    if (change === "symlink") {
      await unlink(file);
      await writeFile(path.join(root, "external.txt"), "written once\n");
      await symlink(path.join(root, "external.txt"), file);
    }
    if (change === "missing-intent")
      await rm(path.join(root, "data/workspace-patch-intents"), {
        recursive: true,
      });
    if (change === "corrupt-intent") {
      const dir = path.join(root, "data/workspace-patch-intents");
      await writeFile(path.join(dir, (await readdir(dir))[0]!), "{}");
    }
    if (change === "invalid-prepared") {
      const db = new DatabaseSync(path.join(root, "data/ledger.sqlite"));
      db.exec(
        "UPDATE ledger_events SET event_json = json_set(event_json, '$.payload', json('{}')) WHERE event_type = 'workspace.patch.prepared'",
      );
      db.close();
    }
    if (change === "live-lock") {
      const dir = path.join(root, "data/file-edit-locks");
      await writeFile(
        path.join(dir, (await readdir(dir))[0]!),
        JSON.stringify({ pid: process.pid }),
      );
    }
    const startedAt = performance.now();
    const store = await restart(root);
    const run = store.listRuns(store.listThreads()[0]!.id)[0]!;
    const events = await store.listRunEvents(run.id);
    if (change === "live-lock") {
      expect(run.status).toBe("running");
      expect(events.filter((event) => ["run.failed", "run.interrupted", "tool.operation.effect_indeterminate"].includes(event.type))).toEqual([]);
      expect(reconciledPatchRecoveryEvidence(events)).toEqual([]);
      expect(assessAutomaticRecovery({ run, events }).eligible).toBe(false);
      return;
    }
    expect(run.outcome).toBe("blocked_safety");
    expect(reconciledPatchRecoveryEvidence(events)).toEqual([]);
    expect(assessAutomaticRecovery({ run, events }).eligible).toBe(false);
    expect(
      (
        await store.claimAutomaticRecoveries("test_reconciled", {
          now: new Date(Date.now() + 5000),
        })
      ).claims,
    ).toEqual([]);
    const reason = events.find((e) => e.type === "run.failed")!.payload[
      "reconciliationReason"
    ];
    expect(reason).toMatch(/^patch_/);
    observations.push({
      checkpoint: `after-file:${change}`,
      reason,
      restartMs: performance.now() - startedAt,
      recovered: false,
      repeatedWrites: 0,
      externalModelRequests: 0,
      requiresManualReview: true,
    });
  },
  30000,
);

it("rechecks file identity after claiming recovery, before any model call", async () => {
  const root = await crashed("after-file");
  const store = await restart(root);
  const claim = await recoveryClaim(store);
  await replaceIdentically(path.join(root, "workspace/retained.txt"));
  const provider = fauxProvider({ provider: "faux-patch-recovery" });
  const registry = new ModelRegistry();
  registry.registerProvider(provider.provider);
  await expect(
    new AgentRuntime(store, registry).resumeInterruptedRunAutomatically(claim),
  ).rejects.toThrow(/Patch recovery postcondition/);
  expect(provider.state.callCount).toBe(0);
  expect(store.listRuns(store.listThreads()[0]!.id)).toHaveLength(1);
  observations.push({
    checkpoint: "after-claim:same-content-new-inode",
    recovered: false,
    repeatedWrites: 0,
    externalModelRequests: 0,
    recoveryModelFixtureCalls: 0,
    requiresManualReview: true,
  });
}, 30000);

it("rolls back the authority fence, proof and Run transition together if snapshot persistence fails", async () => {
  const root = await crashed("after-file");
  const db = new DatabaseSync(path.join(root, "data/ledger.sqlite"));
  db.exec(
    "CREATE TRIGGER stop_patch_recovery BEFORE UPDATE ON workspace_state BEGIN SELECT RAISE(ABORT, 'forced patch rollback'); END;",
  );
  await expect(restart(root)).rejects.toThrow("forced patch rollback");
  expect(
    db
      .prepare(
        "SELECT event_type FROM ledger_events WHERE event_type IN ('tool.operation.effect_indeterminate','workspace.patch.reconciled','run.interrupted')",
      )
      .all(),
  ).toEqual([]);
  db.exec("DROP TRIGGER stop_patch_recovery");
  db.close();
  const store = await restart(root);
  expect(store.listRuns(store.listThreads()[0]!.id)[0]!.status).toBe(
    "interrupted",
  );
  observations.push({
    checkpoint: "reconciliation-transaction-rollback",
    atomicRollbackVerified: true,
    retryReconciled: true,
    repeatedWrites: 0,
    externalModelRequests: 0,
  });
}, 30000);

it("does not commit the target when write-ahead private storage fails", async () => {
  const root = await crashed("preparation-storage-failure");
  await expect(
    stat(path.join(root, "workspace/retained.txt")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  const store = await restart(root);
  const run = store.listRuns(store.listThreads()[0]!.id)[0]!;
  const events = await store.listRunEvents(run.id);
  expect(
    events.filter((event) => event.type === "workspace.patch.prepared"),
  ).toHaveLength(0);
  expect(reconciledPatchRecoveryEvidence(events)).toEqual([]);
  expect(assessAutomaticRecovery({ run, events }).eligible).toBe(false);
  observations.push({
    checkpoint: "preparation-storage-failure",
    targetUnchanged: true,
    recovered: false,
    repeatedWrites: 0,
    externalModelRequests: 0,
    requiresManualReview: true,
  });
}, 30000);

it("refuses to reconcile a live writer even after it released the file lock", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napier-live-patch-"));
  roots.push(root);
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(
        new URL("./fixtures/patch-recovery-crash.ts", import.meta.url),
      ),
      root,
      "live-after-effect",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const exited = once(child, "exit");
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("live patch fixture timed out")),
        20000,
      );
      child.stdout.on("data", (data: Buffer) => {
        if (data.toString().includes("patch-ready")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error("live patch fixture exited early"));
      });
    });
    const store = await restart(root);
    const run = store.listRuns(store.listThreads()[0]!.id)[0]!;
    expect(run.status).toBe("running");
    const events = await store.listRunEvents(run.id);
    const reconciliation = await reconcileInterruptedWorkspacePatches({
      workspaceRoot: store.workspaceRoot,
      dataRoot: store.dataRoot,
      events,
      boundaries: liveToolEffectAuthoritiesFromEvents(events).map(
        (value) => value.boundaryEvent!,
      ),
    });
    expect(reconciliation.inputs).toEqual([]);
    expect(reconciliation.reason).toBe("patch_writer_still_available");
    expect(await readdir(path.join(root, "data/file-edit-locks"))).toHaveLength(
      0,
    );
    store.close();
  } finally {
    child.kill("SIGKILL");
    await exited;
  }
  const recovered = await restart(root);
  expect(recovered.listRuns(recovered.listThreads()[0]!.id)[0]!.status).toBe(
    "interrupted",
  );
  observations.push({
    checkpoint: "live-writer-after-file-lock-release",
    refusedWhileWriterAlive: true,
    reconciledAfterProcessDeath: true,
    repeatedWrites: 0,
    externalModelRequests: 0,
  });
}, 30000);

async function crashed(checkpoint: string, operation = "create") {
  const root = await mkdtemp(path.join(tmpdir(), "napier-unsettled-patch-"));
  roots.push(root);
  const child = fileURLToPath(
    new URL("./fixtures/patch-recovery-crash.ts", import.meta.url),
  );
  await expect(
    promisify(execFile)(
      process.execPath,
      ["--import", "tsx", child, root, checkpoint, operation],
      { timeout: 20000 },
    ),
  ).rejects.toMatchObject({ code: 73 });
  return root;
}
async function restart(root: string) {
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  });
  stores.push(store);
  await store.initialize(true);
  return store;
}
async function recoveryClaim(store: LocalStore) {
  await new Promise((resolve) => setTimeout(resolve, 1050));
  const claims = (await store.claimAutomaticRecoveries("patch_recovery_test"))
    .claims;
  expect(claims).toHaveLength(1);
  return claims[0]!;
}
async function replaceIdentically(file: string) {
  await writeFile(file + ".replacement", "written once\n");
  await rename(file + ".replacement", file);
}
