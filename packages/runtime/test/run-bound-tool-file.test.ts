import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  applyTaskNarrativeEvent,
  createTaskNarrativeEventState,
  taskNarrativeView,
} from "@napier/contracts/task-narrative";
import { LocalStore } from "../src/store.js";
import { RunBoundFileArtifactRegistrar } from "../src/run-bound-file-artifact.js";
import { sha256 } from "../src/ed25519.js";
import {
  KernelProjectionRegistry,
  TaskNarrativeProjectionService,
} from "../src/kernel-projections.js";

const stores: LocalStore[] = [],
  roots: string[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.shutdown();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-tool-file-"));
  roots.push(root);
  const store = new LocalStore({
    workspaceRoot: path.join(root, "workspace"),
    dataRoot: path.join(root, "data"),
  });
  stores.push(store);
  await store.initialize();
  await mkdir(store.workspaceRoot, { recursive: true });
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    agentId: agent.id,
    title: "Verified tool files",
  });
  const run = await store.createRun({ threadId: thread.id, agentId: agent.id });
  return {
    store,
    thread,
    run,
    owner: { threadId: thread.id, runId: run.id },
    registrar: new RunBoundFileArtifactRegistrar(store),
  };
}
function output(
  bytes = "first",
  file = "output.txt",
  operationId = "fixture-first",
) {
  return {
    operationId,
    path: file,
    fileSha256: sha256(bytes),
    fileBytes: Buffer.byteLength(bytes),
    toolName: "browser" as const,
    action: "download" as const,
    materialization: "produced" as const,
    producedEvidence: "Browser wrote bytes.",
    verifiedEvidence: "Browser verified bytes.",
  };
}
async function receipts(f: Awaited<ReturnType<typeof fixture>>) {
  return (await f.store.listEvents(f.thread.id)).filter(
    (event) => event.type === "artifact.tool_file_verified",
  );
}
it("deduplicates concurrent retries and never resurrects an older same-path version", async () => {
  const f = await fixture();
  await writeFile(path.join(f.store.workspaceRoot, "output.txt"), "first");
  expect(
    (
      await Promise.all([
        f.registrar.register(f.owner, output()),
        f.registrar.register(f.owner, output()),
      ])
    ).map((r) => r.status),
  ).toEqual(["registered", "registered"]);
  const original = (await receipts(f))[0]!;
  expect(await receipts(f)).toHaveLength(1);
  await writeFile(path.join(f.store.workspaceRoot, "output.txt"), "second");
  expect(
    (
      await f.registrar.register(
        f.owner,
        output("second", "output.txt", "fixture-second"),
      )
    ).status,
  ).toBe("registered");
  const latest = (await receipts(f))[1]!;
  await writeFile(path.join(f.store.workspaceRoot, "output.txt"), "first");
  expect((await f.registrar.register(f.owner, output())).status).toBe(
    "registered",
  );
  expect(await receipts(f)).toHaveLength(2);
  const entry = (await f.store.getDetail(f.thread.id)).taskNarrative!
    .deliverables![0]!;
  expect(entry.sourceEventId).toBe(latest.id);
  expect(entry.sourceEventId).not.toBe(original.id);
  expect(entry.artifact.sha256).toBe(sha256("second"));
  expect(entry.accessibility).toBe("drifted");
});
it("retains expected identity on changed or missing bytes in full and warm projections, even with a final reference", async () => {
  const f = await fixture(),
    registry = new KernelProjectionRegistry(),
    service = new TaskNarrativeProjectionService(registry, f.store);
  try {
    await writeFile(path.join(f.store.workspaceRoot, "output.txt"), "first");
    await f.registrar.register(f.owner, output());
    await service.project(f.thread.id);
    await f.store.appendEvent({
      ...f.owner,
      type: "message.assistant",
      category: "message",
      payload: { role: "assistant", text: "Open `output.txt`." },
    });
    for (const status of ["drifted", "missing"] as const) {
      if (status === "drifted")
        await writeFile(
          path.join(f.store.workspaceRoot, "output.txt"),
          "replacement",
        );
      else await rm(path.join(f.store.workspaceRoot, "output.txt"));
      const full = (await f.store.getDetail(f.thread.id)).taskNarrative!;
      expect((await service.project(f.thread.id)).view).toEqual(full);
      expect(full.deliverables).toHaveLength(1);
      expect(full.deliverables![0]).toMatchObject({
        source: "tool_file",
        accessibility: status,
        verification: "unverified",
        artifact: { sha256: sha256("first"), sizeBytes: 5 },
      });
    }
  } finally {
    registry.shutdown();
  }
});
it("refuses mismatched bytes, escaping paths, symlinks, directories, and oversized files before any receipt", async () => {
  const f = await fixture();
  await writeFile(path.join(f.store.workspaceRoot, "output.txt"), "changed");
  await symlink("output.txt", path.join(f.store.workspaceRoot, "link.txt"));
  await mkdir(path.join(f.store.workspaceRoot, "directory"));
  await writeFile(
    path.join(f.store.workspaceRoot, "large.txt"),
    Buffer.alloc(8 * 1024 * 1024 + 1),
  );
  for (const file of [
    "output.txt",
    "../outside.txt",
    "/tmp/outside.txt",
    "a/../output.txt",
    "link.txt",
    "directory",
    "large.txt",
  ]) {
    expect(
      (await f.registrar.register(f.owner, output("first", file))).status,
      file,
    ).toBe("failed");
  }
  expect(await receipts(f)).toEqual([]);
});
it.skipIf(process.platform === "win32")(
  "rejects a FIFO without waiting for a writer",
  async () => {
    const f = await fixture();
    await promisify(execFile)("mkfifo", [
      path.join(f.store.workspaceRoot, "fifo.txt"),
    ]);
    expect(
      (await f.registrar.register(f.owner, output("first", "fifo.txt"))).status,
    ).toBe("failed");
  },
  2000,
);
it("rejects foreign, missing, terminal, and terminal-racing owners", async () => {
  const f = await fixture();
  await writeFile(path.join(f.store.workspaceRoot, "output.txt"), "first");
  const other = await f.store.createThread({
    agentId: f.run.agentId,
    title: "Other",
  });
  for (const owner of [
    { ...f.owner, threadId: other.id },
    { ...f.owner, runId: "run_missing" },
  ])
    expect((await f.registrar.register(owner, output())).status).toBe("failed");
  const appendOnce = f.store.appendEventOnce.bind(f.store);
  f.store.appendEventOnce = async (input, key) => {
    await f.store.finishRun(f.run.id, "completed");
    return appendOnce(input, key);
  };
  expect((await f.registrar.register(f.owner, output())).status).toBe("failed");
  expect((await f.registrar.register(f.owner, output())).status).toBe("failed");
  expect(await receipts(f)).toEqual([]);
});
it("keeps formal declarations authoritative and never borrows tool verification for a different identity", async () => {
  const f = await fixture();
  await writeFile(path.join(f.store.workspaceRoot, "output.txt"), "first");
  await f.registrar.register(f.owner, output());
  const plan = await f.store.createPlan(f.thread.id, {
    objective: "A new declaration",
    steps: [
      { id: "one", title: "Work", description: "Work", verification: "Check" },
    ],
    artifacts: [
      {
        id: "different",
        path: "./output.txt",
        kind: "file",
        description: "Later declaration",
      },
    ],
  });
  const entry = (await f.store.getDetail(f.thread.id)).taskNarrative!
    .deliverables!;
  expect(entry).toHaveLength(1);
  expect(entry[0]).toMatchObject({
    source: "plan",
    planId: plan.id,
    artifact: { id: "different", status: "expected" },
    verification: "unverified",
  });
});
it("rejects malformed or relabeled receipt envelopes and excludes foreign/child Runs", async () => {
  const f = await fixture();
  await writeFile(path.join(f.store.workspaceRoot, "output.txt"), "first");
  await f.registrar.register(f.owner, output());
  const event = (await receipts(f))[0]!;
  const detail = await f.store.getDetail(f.thread.id);
  for (const corrupt of [
    { ...event, runId: "run_other" },
    { ...event, threadId: "thread_other" },
    {
      ...event,
      payload: { ...(event.payload as object), materialization: "observed" },
    },
    {
      ...event,
      payload: { ...(event.payload as object), path: "../output.txt" },
    },
    { ...event, schemaVersion: 2 },
  ])
    expect(
      taskNarrativeView(
        detail,
        applyTaskNarrativeEvent(createTaskNarrativeEventState(), corrupt),
      ).deliverables,
    ).toEqual([]);
  await expect(
    f.store.appendEvent({
      ...f.owner,
      type: "artifact.tool_file_verified",
      category: "artifact",
      payload: {} as never,
    }),
  ).rejects.toThrow("invalid");
});

it("retains prior-Run receipts across continuation without adopting a new final-reference digest", async () => {
  const f = await fixture();
  await writeFile(path.join(f.store.workspaceRoot, "output.txt"), "first");
  await f.registrar.register(f.owner, output());
  await f.store.finishRun(f.run.id, "completed");
  const next = await f.store.createRun({
    threadId: f.thread.id,
    agentId: f.run.agentId,
  });
  const before = (await f.store.getDetail(f.thread.id)).taskNarrative!
    .deliverables!;
  expect(before[0]).toMatchObject({
    source: "tool_file",
    artifact: { sourceRunId: f.run.id, sha256: sha256("first") },
  });
  await writeFile(path.join(f.store.workspaceRoot, "output.txt"), "second");
  await f.store.appendEvent({
    threadId: f.thread.id,
    runId: next.id,
    type: "message.assistant",
    category: "message",
    payload: { role: "assistant", text: "Open `output.txt`." },
  });
  expect(
    (await f.store.getDetail(f.thread.id)).taskNarrative!.deliverables![0],
  ).toMatchObject({
    source: "tool_file",
    accessibility: "drifted",
    artifact: { sha256: sha256("first") },
  });
  expect(
    (
      await f.registrar.register(
        { threadId: f.thread.id, runId: next.id },
        output("second", "output.txt", "fixture-second"),
      )
    ).status,
  ).toBe("registered");
  const events = await receipts(f);
  const detail = await f.store.getDetail(f.thread.id);
  const oldLate = {
    ...events[0]!,
    id: "late-old-version",
    seq: events[1]!.seq + 100,
  };
  let state = createTaskNarrativeEventState();
  for (const event of [...events, oldLate])
    state = applyTaskNarrativeEvent(state, event);
  expect(taskNarrativeView(detail, state).deliverables![0]).toMatchObject({
    sourceEventId: events[1]!.id,
    artifact: { sourceRunId: next.id, sha256: sha256("second") },
  });
  const childOnly = {
    ...detail,
    runs: detail.runs.map((run) => ({ ...run, source: "subagent" as const })),
  };
  expect(taskNarrativeView(childOnly, state).deliverables).toEqual([]);
});

it("reconciles an acknowledged-late receipt append without duplicating its event", async () => {
  const f = await fixture();
  await writeFile(path.join(f.store.workspaceRoot, "output.txt"), "first");
  const append = f.store.appendEventOnce.bind(f.store);
  let fail = true;
  f.store.appendEventOnce = async (input, key) => {
    const event = await append(input, key);
    if (fail) {
      fail = false;
      throw new Error("Lost acknowledgement");
    }
    return event;
  };
  expect((await f.registrar.register(f.owner, output())).status).toBe("failed");
  expect((await f.registrar.register(f.owner, output())).status).toBe(
    "registered",
  );
  expect(await receipts(f)).toHaveLength(1);
});

it("selects the third real invocation for A to B to A, while retries keep their original event", async () => {
  const f = await fixture();
  for (const [operationId, bytes] of [
    ["call-a1", "first"],
    ["call-b", "second"],
    ["call-a2", "first"],
  ]) {
    await writeFile(path.join(f.store.workspaceRoot, "output.txt"), bytes!);
    expect(
      (
        await f.registrar.register(f.owner, {
          ...output(bytes!),
          operationId: operationId!,
        } as ReturnType<typeof output>)
      ).status,
    ).toBe("registered");
  }
  const events = await receipts(f);
  expect(events).toHaveLength(3);
  expect(
    (await f.store.getDetail(f.thread.id)).taskNarrative!.deliverables![0],
  ).toMatchObject({
    sourceEventId: events[2]!.id,
    accessibility: "available",
    artifact: { sha256: sha256("first") },
  });
});

it("refuses a different file binding under the same actual operation identity", async () => {
  const f = await fixture();
  await writeFile(path.join(f.store.workspaceRoot, "output.txt"), "first");
  expect((await f.registrar.register(f.owner, output())).status).toBe(
    "registered",
  );
  await writeFile(path.join(f.store.workspaceRoot, "output.txt"), "second");
  expect((await f.registrar.register(f.owner, output("second"))).status).toBe(
    "failed",
  );
  expect(await receipts(f)).toHaveLength(1);
});
