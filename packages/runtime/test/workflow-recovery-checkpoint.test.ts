import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import type { LocalStore } from "../src/store.js";
import {
  createApprovalFixture,
  openWorkflowFixture,
} from "./fixtures/workflow-approval-recovery-setup.js";

const roots: string[] = [];
const stores: LocalStore[] = [];
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function create() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-workflow-checkpoint-"),
  );
  roots.push(root);
  const fixture = await createApprovalFixture(root);
  stores.push(fixture.store);
  return { ...fixture, root };
}
async function saveAnswer(fixture: Awaited<ReturnType<typeof create>>) {
  return fixture.store.answerOperatorDecision(
    fixture.request.threadId,
    fixture.request.decisionId,
    fixture.request.answer,
  );
}

it.each(["workflow.recovery.claimed", "workflow.completed"])(
  "survives process death at %s without repeating a write",
  async (eventType) => {
    const fixture = await create();
    await saveAnswer(fixture);
    const { threadId, planId } = fixture.request;
    const checkpoint = await fixture.workflows.recoveryCheckpoint(
      threadId,
      planId,
    );
    const options = {
      threadId,
      planId,
      request: { checkpointSha256: checkpoint.checkpointSha256! },
    };
    await writeFile(
      path.join(fixture.root, "checkpoint-request.json"),
      JSON.stringify(options),
    );
    fixture.store.close();
    stores.pop();
    await expect(
      promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(
            new URL("./fixtures/workflow-checkpoint-crash.ts", import.meta.url),
          ),
          fixture.root,
          eventType,
        ],
        { timeout: 15000 },
      ),
    ).rejects.toMatchObject({ signal: "SIGKILL" });
    const reopened = await openWorkflowFixture(fixture.root);
    stores.push(reopened.store);
    const target = path.join(fixture.root, "workspace/approved.txt");
    const before = await stat(target).catch(() => undefined);
    await expect(reopened.workflows.recover(options)).rejects.toThrow(
      /checkpoint has changed/,
    );
    const fresh = await reopened.workflows.recoveryCheckpoint(threadId, planId);
    if (fresh.status === "ready") {
      expect(
        (
          await reopened.workflows.recover({
            threadId,
            planId,
            request: { checkpointSha256: fresh.checkpointSha256! },
          })
        ).status,
      ).toBe("completed");
    } else expect(fresh.status).toBe("completed");
    expect(await readFile(target, "utf8")).toBe(
      fixture.request.answer.customText,
    );
    if (before) {
      const after = await stat(target);
      expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
    }
    expect(
      (await reopened.store.listEvents(threadId)).filter(
        (event) => event.type === "tool.started",
      ),
    ).toHaveLength(1);
  },
  20000,
);

it("does not let an old request release a later breakpoint", async () => {
  const fixture = await create();
  const { manifest } = fixture.request;
  const paused = await fixture.embedded.run({
    manifest,
    input: {},
    breakBeforeNodeIds: ["approve", "write"],
  });
  const { threadId } = paused;
  const planId = paused.result.planId;
  const first = await fixture.workflows.recoveryCheckpoint(threadId, planId);
  expect(first.action).toBe("continue_breakpoint");
  const options = {
    threadId,
    planId,
    request: { checkpointSha256: first.checkpointSha256! },
  };
  expect((await fixture.workflows.recover(options)).status).toBe("waiting");
  const decision = (await fixture.store.listOperatorDecisions(threadId))[0]!;
  await fixture.store.answerOperatorDecision(
    threadId,
    decision.id,
    fixture.request.answer,
  );
  const answered = await fixture.workflows.recoveryCheckpoint(threadId, planId);
  expect(
    (
      await fixture.workflows.recover({
        threadId,
        planId,
        request: { checkpointSha256: answered.checkpointSha256! },
      })
    ).status,
  ).toBe("paused");
  await expect(fixture.workflows.recover(options)).rejects.toThrow(
    /checkpoint has changed/,
  );
  const second = await fixture.workflows.recoveryCheckpoint(threadId, planId);
  expect(second.action).toBe("continue_breakpoint");
  await expect(
    stat(path.join(fixture.root, "workspace/approved.txt")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    (
      await fixture.workflows.recover({
        threadId,
        planId,
        request: { checkpointSha256: second.checkpointSha256! },
      })
    ).status,
  ).toBe("completed");
});

it("stops rather than overwriting a target created after the checkpoint", async () => {
  const fixture = await create();
  await saveAnswer(fixture);
  const { threadId, planId } = fixture.request;
  const checkpoint = await fixture.workflows.recoveryCheckpoint(
    threadId,
    planId,
  );
  const file = path.join(fixture.root, "workspace/approved.txt");
  await writeFile(file, "New user content");
  const before = await stat(file);
  const result = await fixture.workflows.recover({
    threadId,
    planId,
    request: { checkpointSha256: checkpoint.checkpointSha256! },
  });
  expect(result.status).toBe("blocked");
  expect(await readFile(file, "utf8")).toBe("New user content");
  const after = await stat(file);
  expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
});

it("refuses ambiguous original definitions and cross-thread Plan bindings", async () => {
  const fixture = await create();
  await saveAnswer(fixture);
  const { threadId, planId } = fixture.request;
  const other = fixture.store
    .listThreads()
    .find((thread) => thread.id !== threadId)!;
  expect(
    await fixture.workflows.recoveryCheckpoint(other.id, planId),
  ).toMatchObject({ status: "unavailable", reason: "binding_mismatch" });
  const start = (await fixture.store.listEvents(threadId)).find(
    (event) => event.type === "workflow.started",
  )!;
  await fixture.store.appendEvent({
    threadId,
    runId: start.runId,
    type: start.type,
    category: start.category,
    visibility: start.visibility,
    payload: start.payload,
  });
  expect(
    await fixture.workflows.recoveryCheckpoint(threadId, planId),
  ).toMatchObject({ status: "unavailable", reason: "binding_mismatch" });
});

it("rejects a checkpoint copied into a different workspace and data directory", async () => {
  const fixture = await create();
  await saveAnswer(fixture);
  const { threadId, planId } = fixture.request;
  const checkpoint = await fixture.workflows.recoveryCheckpoint(
    threadId,
    planId,
  );
  fixture.store.close();
  stores.pop();
  const otherRoot = await mkdtemp(
    path.join(tmpdir(), "napier-workflow-relocated-"),
  );
  roots.push(otherRoot);
  await cp(path.join(fixture.root, "data"), path.join(otherRoot, "data"), {
    recursive: true,
  });
  const other = await openWorkflowFixture(otherRoot);
  stores.push(other.store);
  const fresh = await other.workflows.recoveryCheckpoint(threadId, planId);
  expect(fresh.status).toBe("ready");
  expect(fresh.checkpointSha256).not.toBe(checkpoint.checkpointSha256);
  await expect(
    other.workflows.recover({
      threadId,
      planId,
      request: { checkpointSha256: checkpoint.checkpointSha256! },
    }),
  ).rejects.toThrow(/checkpoint has changed/);
  await expect(
    stat(path.join(otherRoot, "workspace/approved.txt")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("captures a private original manifest before nodes and resumes a saved approval after reopening", async () => {
  const fixture = await create();
  const { threadId, planId, manifest } = fixture.request;
  const file = path.join(
    fixture.root,
    "data/workflow-manifests",
    `${manifest.contentSha256}.json`,
  );
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(manifest);
  expect(
    await fixture.workflows.recoveryCheckpoint(threadId, planId),
  ).toMatchObject({
    status: "waiting_answer",
    decisionId: fixture.request.decisionId,
  });
  await saveAnswer(fixture);
  const checkpoint = await fixture.workflows.recoveryCheckpoint(
    threadId,
    planId,
  );
  expect(checkpoint).toMatchObject({ status: "ready", action: "resume" });
  fixture.store.close();
  stores.pop();
  const reopened = await openWorkflowFixture(fixture.root);
  stores.push(reopened.store);
  const request = { checkpointSha256: checkpoint.checkpointSha256! };
  const result = await reopened.workflows.recover({
    threadId,
    planId,
    request,
  });
  expect(result.status).toBe("completed");
  expect(
    await readFile(path.join(fixture.root, "workspace/approved.txt"), "utf8"),
  ).toBe(fixture.request.answer.customText);
  const events = await reopened.store.listEvents(threadId);
  await expect(
    reopened.workflows.recover({ threadId, planId, request }),
  ).rejects.toThrow(/checkpoint has changed/);
  expect(await reopened.store.listEvents(threadId)).toEqual(events);
  expect(events.filter((event) => event.type === "tool.started")).toHaveLength(
    1,
  );
});

it.each(["missing", "tampered"])(
  "does not offer recovery when the private manifest is %s",
  async (mode) => {
    const fixture = await create();
    await saveAnswer(fixture);
    const { threadId, planId, manifest } = fixture.request;
    const checkpoint = await fixture.workflows.recoveryCheckpoint(
      threadId,
      planId,
    );
    const file = path.join(
      fixture.root,
      "data/workflow-manifests",
      `${manifest.contentSha256}.json`,
    );
    if (mode === "missing") await rm(file);
    else
      await writeFile(file, JSON.stringify({ ...manifest, name: "changed" }));
    expect(
      await fixture.workflows.recoveryCheckpoint(threadId, planId),
    ).toMatchObject({ status: "unavailable" });
    await expect(
      fixture.workflows.recover({
        threadId,
        planId,
        request: { checkpointSha256: checkpoint.checkpointSha256! },
      }),
    ).rejects.toThrow(/checkpoint has changed/);
    await expect(
      stat(path.join(fixture.root, "workspace/approved.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("allows only one competing checkpoint continuation", async () => {
  const fixture = await create();
  await saveAnswer(fixture);
  const { threadId, planId } = fixture.request;
  const checkpoint = await fixture.workflows.recoveryCheckpoint(
    threadId,
    planId,
  );
  const second = await openWorkflowFixture(fixture.root);
  stores.push(second.store);
  const requests = await Promise.allSettled(
    [fixture.workflows, second.workflows].map((workflows) =>
      workflows.recover({
        threadId,
        planId,
        request: { checkpointSha256: checkpoint.checkpointSha256! },
      }),
    ),
  );
  expect(
    requests.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    (await fixture.store.listEvents(threadId)).filter(
      (event) => event.type === "tool.started",
    ),
  ).toHaveLength(1);
});

it("isolates observer failure and rejects the consumed request", async () => {
  const fixture = await create();
  await saveAnswer(fixture);
  const { threadId, planId } = fixture.request;
  const checkpoint = await fixture.workflows.recoveryCheckpoint(
    threadId,
    planId,
  );
  const options = {
    threadId,
    planId,
    request: { checkpointSha256: checkpoint.checkpointSha256! },
  };
  await expect(
    fixture.workflows.recover({
      ...options,
      onEvent(event) {
        if (event.type === "workflow.recovery.claimed")
          throw new Error("response lost");
      },
    }),
  ).resolves.toMatchObject({ status: "completed" });
  await expect(fixture.workflows.recover(options)).rejects.toThrow(
    /checkpoint has changed/,
  );
  expect(
    (await fixture.workflows.recoveryCheckpoint(threadId, planId)).status,
  ).toBe("completed");
});
