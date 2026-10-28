import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, afterEach, expect, it } from "vitest";
import { withBaselineApprovalService } from "./fixtures/workflow-approval-baseline.js";
import type { AnswerAndResumeEmbeddedWorkflowOptions } from "../src/embedded-workflow-approvals.js";
import type { LocalStore } from "../src/store.js";
import { openWorkflowFixture } from "./fixtures/workflow-approval-recovery-setup.js";

const observations: unknown[] = [];
afterAll(async () => {
  const output = process.env["NAPIER_WORKFLOW_APPROVAL_OBSERVATIONS"];
  if (output)
    await writeFile(output, JSON.stringify(observations, null, 2) + "\n");
});
const roots: string[] = [];
const runChild = promisify(execFile);
const children: ReturnType<typeof runChild>[] = [];
const stores: LocalStore[] = [];
const child = fileURLToPath(
  new URL("./fixtures/workflow-approval-recovery-crash.ts", import.meta.url),
);
afterEach(async () => {
  for (const operation of children) operation.child.kill("SIGKILL");
  await Promise.allSettled(children.splice(0));
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const checkpoints = [
  "after-answer",
  "before-continuation-commit",
  "after-continuation-commit",
  "before-approval-complete",
  "after-approval-plan-commit",
  "after-approval-event",
  "after-workflow-completed",
];
it.each(
  checkpoints.flatMap((checkpoint) =>
    [false, true].map((reject) => ({ checkpoint, reject })),
  ),
)(
  "retries the same request after $checkpoint (reject=$reject) without losing its answer or repeating the write",
  async ({ checkpoint, reject }) => {
    const { root, request } = await crashed(checkpoint, reject);
    const restartStarted = performance.now();
    const fixture = await openWorkflowFixture(root);
    const restartMs = performance.now() - restartStarted;
    stores.push(fixture.store);
    const file = path.join(root, "workspace/approved.txt");
    const before = await stat(file).catch(() => undefined);
    const resumeStarted = performance.now();
    const result = await fixture.embedded.answerAndResume(request);
    const resumeMs = performance.now() - resumeStarted;
    expect(result.result.status).toBe(reject ? "blocked" : "completed");
    expect(result.decision.customText).toBe(request.answer.customText);
    if (reject) {
      expect(result.result.nodeResults[0]?.errorCode).toBe("approval_rejected");
      await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    } else expect(await readFile(file, "utf8")).toBe(request.answer.customText);
    await assertOnce(fixture.store, request, reject);
    const events = await fixture.store.listEvents(request.threadId);
    const second = await fixture.embedded.answerAndResume(request);
    expect(second.result.output).toEqual(result.result.output);
    expect(second.result.status).toBe(result.result.status);
    expect((await fixture.store.listEvents(request.threadId)).length).toBe(
      events.length,
    );
    if (before) {
      const after = await stat(file);
      expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
    }
    observations.push({
      checkpoint,
      reject,
      status: result.result.status,
      restartMs,
      resumeMs,
      answerSha256: result.decision.answerSha256,
      continuationRunId: result.decision.continuationRunId,
      runCount: fixture.store.listRuns(request.threadId).length,
      answeredEvents: 1,
      continuedEvents: 1,
      writeStarts: reject ? 0 : 1,
      repeatedRequestAddedEvents: 0,
      existingFileIdentityPreserved: before ? true : null,
      externalModelRequests: 0,
    });
  },
  30000,
);

it("concurrent retries from independent processes share one continuation and one downstream write", async () => {
  const { root, request } = await crashed("after-answer");
  const pending = [0, 1].map(() => retry(root, "barrier"));
  await expect
    .poll(
      async () =>
        (await readdir(root)).filter((file) => file.endsWith(".ready")).length,
      { timeout: 10000 },
    )
    .toBe(2);
  await writeFile(path.join(root, "start-gate"), "go");
  const replies = await Promise.all(pending);
  expect(replies.map((reply) => reply.result?.status ?? reply.error)).toEqual([
    "completed",
    "completed",
  ]);
  const fixture = await openWorkflowFixture(root);
  stores.push(fixture.store);
  await assertOnce(fixture.store, request, false);
  observations.push({
    checkpoint: "concurrent-independent-processes",
    statuses: replies.map((reply) => reply.result.status),
    runCount: 3,
    answeredEvents: 1,
    continuedEvents: 1,
    writeStarts: 1,
  });
}, 30000);

it("waits for a paused live owner, then reclaims after SIGKILL without orphaning its continuation", async () => {
  const { root, request } = await crashed("after-answer");
  const owner = promisify(execFile)(
    process.execPath,
    ["--import", "tsx", child, root, "hold-continuation"],
    { timeout: 20000, killSignal: "SIGKILL" },
  );
  const exited = owner.catch((error: { signal: string }) => error);
  try {
    await expect
      .poll(
        () => readFile(path.join(root, "owner-held"), "utf8").catch(() => ""),
        { timeout: 10000 },
      )
      .not.toBe("");
    let returned = false;
    const pending = retry(root, "barrier").then((reply) => {
      returned = true;
      return reply;
    });
    await expect
      .poll(
        async () =>
          (await readdir(root)).some((file) => file.endsWith(".ready")),
        { timeout: 10000 },
      )
      .toBe(true);
    await writeFile(path.join(root, "start-gate"), "go");
    await delay(200);
    expect(returned).toBe(false);
    owner.child.kill("SIGKILL");
    expect(await exited).toMatchObject({ signal: "SIGKILL" });
    expect((await pending).result.status).toBe("completed");
    const fixture = await openWorkflowFixture(root);
    stores.push(fixture.store);
    await assertOnce(fixture.store, request, false);
    const decision = (
      await fixture.store.listOperatorDecisions(request.threadId)
    )[0]!;
    expect(
      fixture.store
        .listRuns(request.threadId)
        .find((run) => run.id === decision.continuationRunId)?.status,
    ).toBe("interrupted");
    observations.push({
      checkpoint: "paused-live-owner-then-SIGKILL",
      waitedForLiveOwner: true,
      status: "completed",
      continuationStatus: "interrupted",
      runCount: 3,
      continuedEvents: 1,
      writeStarts: 1,
    });
  } finally {
    owner.child.kill("SIGKILL");
    await exited;
  }
}, 30000);

async function crashed(checkpoint: string, reject = false) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-workflow-approval-"));
  roots.push(root);
  await expect(
    promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        child,
        root,
        checkpoint,
        reject ? "reject" : "approve",
      ],
      { timeout: 20000 },
    ),
  ).rejects.toMatchObject({ code: 73 });
  return {
    root,
    request: JSON.parse(
      await readFile(path.join(root, "request.json"), "utf8"),
    ) as AnswerAndResumeEmbeddedWorkflowOptions,
  };
}
function retry(root: string, selection = "approve") {
  const operation = runChild(
    process.execPath,
    ["--import", "tsx", child, root, "retry", selection],
    { timeout: 20000 },
  );
  children.push(operation);
  const result = operation.then((reply) => JSON.parse(reply.stdout.trim()));
  void result.catch(() => undefined);
  return result;
}
async function assertOnce(
  store: LocalStore,
  request: AnswerAndResumeEmbeddedWorkflowOptions,
  reject: boolean,
) {
  const events = await store.listEvents(request.threadId);
  expect(
    events.filter((event) => event.type === "operator.decision.answered"),
  ).toHaveLength(1);
  expect(
    events.filter((event) => event.type === "operator.decision.continued"),
  ).toHaveLength(1);
  expect(events.filter((event) => event.type === "tool.started")).toHaveLength(
    reject ? 0 : 1,
  );
  expect(store.listRuns(request.threadId)).toHaveLength(reject ? 2 : 3);
  expect(
    store
      .listRuns(request.threadId)
      .filter((run) => ["queued", "running"].includes(run.status)),
  ).toHaveLength(0);
}

it("reproduces the old pending-only API failure against the same saved answer", async () => {
  const { root, request } = await crashed("after-answer");
  const fixture = await openWorkflowFixture(root);
  stores.push(fixture.store);
  const before = await fixture.store.listEvents(request.threadId);
  await withBaselineApprovalService(async (modulePath) => {
    const module = await import(modulePath);
    const baseline = new module.EmbeddedWorkflowApprovalService(
      fixture.store,
      fixture.workflows,
    );
    await expect(baseline.answerAndResume(request)).rejects.toThrow(
      "Workflow has no single pending Approval decision",
    );
  });
  expect(await fixture.store.listEvents(request.threadId)).toEqual(before);
  expect((await fixture.embedded.answerAndResume(request)).result.status).toBe(
    "completed",
  );
  await assertOnce(fixture.store, request, false);
  observations.push({
    checkpoint: "fixed-baseline-same-saved-answer",
    baseline: "state_conflict",
    current: "completed",
    baselineAddedEvents: 0,
    writeStarts: 1,
  });
}, 30000);
