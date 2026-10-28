import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, expect, it } from "vitest";
import { LocalStore } from "../src/store.js";
import { assessAutomaticRecovery } from "../src/automatic-recovery.js";
import { readWorkspacePatchRecoveryPlan } from "../src/workspace-patch-recovery-plan.js";

const roots: string[] = [],
  stores: LocalStore[] = [];
const observations: unknown[] = [];
afterAll(async () => {
  const output = process.env["NAPIER_VERIFIED_PATCH_OBSERVATIONS"];
  if (output) await writeFile(output, JSON.stringify(observations, null, 2));
});
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it.each(
  ["create", "replace"].flatMap((operation) =>
    ["before-effect", "after-prepared"].map((checkpoint) => ({
      operation,
      checkpoint,
    })),
  ),
)(
  "executes the exact $operation once after $checkpoint, then continues read-only",
  async ({ operation, checkpoint }) => {
    const fixture = await crashed(checkpoint, operation);
    const events = await fixture.store.listRunEvents(fixture.run.id);
    expect(assessAutomaticRecovery({ run: fixture.run, events }).eligible).toBe(
      true,
    );
    const { run, provider } = await resume(fixture);
    expect(run.status, run.error).toBe("completed");
    expect(provider.state.callCount).toBe(1);
    expect(await readFile(fixture.target, "utf8")).toBe("written once\n");
    const recoveredEvents = await fixture.store.listRunEvents(run.id);
    expect(
      recoveredEvents.filter(
        (event) => event.type === "workspace.patch.commit_started",
      ),
    ).toHaveLength(1);
    expect(
      recoveredEvents.filter((event) => event.type === "tool.completed"),
    ).toHaveLength(1);
    expect(
      readWorkspacePatchRecoveryPlan(run, recoveredEvents)?.entries,
    ).toHaveLength(1);
    expect(
      JSON.stringify(
        recoveredEvents.filter((event) => event.category === "tool"),
      ),
    ).not.toContain("written once");
  },
  30000,
);

it("does not enable writes for the existing safe_read_only policy", async () => {
  const fixture = await crashed("after-prepared", "create", "safe_read_only");
  const events = await fixture.store.listRunEvents(fixture.run.id);
  expect(
    assessAutomaticRecovery({ run: fixture.run, events }).blockReasons,
  ).toContain("unsafe_tool_effect");
  await expect(stat(fixture.target)).rejects.toMatchObject({ code: "ENOENT" });
}, 30000);

it.each(["permissions", "target"])(
  "stops when %s change after Run creation",
  async (change) => {
    const fixture = await crashed("before-effect", "create");
    const { run, provider } = await resume(fixture, change);
    expect(run.status).toBe("failed");
    expect(provider.state.callCount).toBe(0);
    expect(
      (await fixture.store.listRunEvents(run.id)).some(
        (event) => event.type === "workspace.patch.commit_started",
      ),
    ).toBe(false);
    if (change === "target")
      expect(await readFile(fixture.target, "utf8")).toBe("external\n");
    else
      await expect(stat(fixture.target)).rejects.toMatchObject({
        code: "ENOENT",
      });
  },
  30000,
);

it.each([
  "after-created",
  "after-prepared",
  "after-file",
  "after-settlement",
  "after-terminal",
])(
  "recovers a second process loss at %s without losing or repeating the patch",
  async (checkpoint) => {
    const fixture = await crashed("before-effect", "create");
    await resumeProcess(fixture, checkpoint, true);
    const before = await stat(fixture.target).catch(() => undefined);
    const { run, provider } = await resume(fixture);
    expect(run.status, run.error).toBe("completed");
    expect(provider.state.callCount).toBe(1);
    expect(await readFile(fixture.target, "utf8")).toBe("written once\n");
    const after = await stat(fixture.target);
    if (before)
      expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
    const events = await fixture.store.listEvents(run.threadId);
    expect(
      events.filter((event) => event.type === "workspace.patch.commit_started"),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) => event.type === "workspace.patch.recovery_planned",
      ),
    ).toHaveLength(2);
  },
  30000,
);

it("does not start another Run when the final response is lost", async () => {
  const fixture = await crashed("before-effect", "create");
  await resumeProcess(fixture, "after-return", true);
  const runs = fixture.store.listRuns(fixture.run.threadId);
  expect(runs).toHaveLength(2);
  expect(runs.at(-1)!.status).toBe("completed");
  const before = await stat(fixture.target);
  const sweep =
    await fixture.store.claimAutomaticRecoveries("response-loss-test");
  expect(sweep.claims).toHaveLength(0);
  const after = await stat(fixture.target);
  expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
}, 30000);

it("allows only one competing recovery process to execute a pending patch", async () => {
  const fixture = await crashed("before-effect", "create");
  fixture.store.close();
  stores.splice(stores.indexOf(fixture.store), 1);
  const args = [
    "--import",
    "tsx",
    fileURLToPath(
      new URL("./fixtures/verified-patch-recovery-resume.ts", import.meta.url),
    ),
    fixture.root,
  ];
  const results = await Promise.allSettled([
    promisify(execFile)(process.execPath, args, { timeout: 20000 }),
    promisify(execFile)(process.execPath, args, { timeout: 20000 }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  fixture.store = new LocalStore({
    workspaceRoot: path.join(fixture.root, "workspace"),
    dataRoot: path.join(fixture.root, "data"),
  });
  stores.push(fixture.store);
  await fixture.store.initialize(true);
  const runs = fixture.store.listRuns(fixture.run.threadId);
  expect(runs).toHaveLength(2);
  expect(runs.at(-1)!.status).toBe("completed");
  const events = await fixture.store.listEvents(fixture.run.threadId);
  expect(
    events.filter((event) => event.type === "workspace.patch.commit_started"),
  ).toHaveLength(1);
}, 30000);

it("rechecks retained file evidence after recovery itself was interrupted", async () => {
  const fixture = await crashed("before-effect", "create");
  await resumeProcess(fixture, "after-file", true);
  await writeFile(fixture.target, "external after recovered write\n");
  await expect(resume(fixture)).rejects.toThrow();
  expect(await readFile(fixture.target, "utf8")).toBe(
    "external after recovered write\n",
  );
}, 30000);

it.each([false, true])(
  "retains the earlier version in a patch chain across another interruption: %s",
  async (interruptAgain) => {
    const fixture = await crashed(
      "after-prepared",
      "replace",
      "verified_patches",
      "chain",
    );
    expect(await readFile(fixture.target, "utf8")).toBe("middle\n");
    if (interruptAgain) await resumeProcess(fixture, "after-terminal", true);
    const { run } = await resume(fixture);
    expect(run.status, run.error).toBe("completed");
    expect(await readFile(fixture.target, "utf8")).toBe("written once\n");
    const events = await fixture.store.listEvents(fixture.run.threadId);
    expect(
      events.filter((event) => event.type === "workspace.patch.commit_started"),
    ).toHaveLength(2);
    expect(
      readWorkspacePatchRecoveryPlan(
        run,
        await fixture.store.listRunEvents(run.id),
      )?.entries,
    ).toHaveLength(2);
  },
  30000,
);

it("rejects direct recovery mode creation without the internal bounded grant", async () => {
  const fixture = await crashed("before-effect", "create");
  await expect(
    fixture.store.createRun({
      threadId: fixture.run.threadId,
      agentId: fixture.run.agentId,
      parentRunId: fixture.run.id,
      source: "recovery",
      executionMode: "verified_patch_recovery",
    }),
  ).rejects.toThrow("internal operation grant");
  expect(fixture.store.listRuns(fixture.run.threadId)).toHaveLength(1);
}, 30000);

it("stops when the original process-capable environment becomes unavailable", async () => {
  const fixture = await crashed(
    "before-effect",
    "create",
    "verified_patches",
    "process",
  );
  const { run, provider } = await resume(fixture, "sandbox");
  expect(run.status).toBe("failed");
  expect(run.error).toContain("Sandbox is unavailable");
  expect(provider.state.callCount).toBe(0);
  await expect(stat(fixture.target)).rejects.toMatchObject({ code: "ENOENT" });
}, 30000);

async function crashed(
  checkpoint: string,
  operation: string,
  mode = "verified_patches",
  sequence = "single",
) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-verified-patch-"));
  roots.push(root);
  await expect(
    promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(
          new URL("./fixtures/patch-recovery-crash.ts", import.meta.url),
        ),
        root,
        checkpoint,
        operation,
        mode,
        sequence,
      ],
      { timeout: 20000 },
    ),
  ).rejects.toMatchObject({ code: 73 });
  const store = new LocalStore({
    workspaceRoot: path.join(root, "workspace"),
    dataRoot: path.join(root, "data"),
  });
  stores.push(store);
  await store.initialize(true);
  const thread = store
    .listThreads()
    .find((value) => value.title === "Retain settled patch")!;
  return {
    root,
    store,
    run: store.listRuns(thread.id)[0]!,
    target: path.join(root, "workspace/retained.txt"),
  };
}

async function resume(
  fixture: Awaited<ReturnType<typeof crashed>>,
  checkpoint = "complete",
) {
  await resumeProcess(fixture, checkpoint);
  const result = JSON.parse(
    await readFile(path.join(fixture.root, "recovery-result.json"), "utf8"),
  );
  if (result.run.status === "completed") {
    expect(result.toolNames).toEqual(["read_file"]);
    expect(result.promptHasEvidence).toBe(true);
  }
  return {
    run: result.run,
    provider: { state: { callCount: result.modelCalls } },
  };
}
async function resumeProcess(
  fixture: Awaited<ReturnType<typeof crashed>>,
  checkpoint: string,
  crashes = false,
) {
  fixture.store.close();
  stores.splice(stores.indexOf(fixture.store), 1);
  const child = promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(
        new URL(
          "./fixtures/verified-patch-recovery-resume.ts",
          import.meta.url,
        ),
      ),
      fixture.root,
      checkpoint,
    ],
    { timeout: 20000 },
  );
  if (crashes) await expect(child).rejects.toMatchObject({ code: 73 });
  else await child;
  fixture.store = new LocalStore({
    workspaceRoot: path.join(fixture.root, "workspace"),
    dataRoot: path.join(fixture.root, "data"),
  });
  stores.push(fixture.store);
  await fixture.store.initialize(true);
  const events = await fixture.store.listEvents(fixture.run.threadId);
  const current = fixture.store.listRuns(fixture.run.threadId).at(-1)!;
  observations.push({
    scenario: expect.getState().currentTestName,
    checkpoint,
    ...JSON.parse(
      await readFile(
        path.join(fixture.root, "recovery-process-observation.json"),
        "utf8",
      ),
    ),
    status: current.status,
    commitMarkers: events.filter(
      (event) => event.type === "workspace.patch.commit_started",
    ).length,
    recoveryPlans: events.filter(
      (event) => event.type === "workspace.patch.recovery_planned",
    ).length,
    externalModelRequests: 0,
  });
}
