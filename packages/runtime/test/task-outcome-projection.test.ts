import { mkdtemp, rm, writeFile, mkdir, symlink, open } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStore } from "../src/store.js";
import {
  KernelProjectionRegistry,
  TaskNarrativeProjectionService,
} from "../src/kernel-projections.js";
import { createGoal } from "../src/goals.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-task-outcome-"));
  roots.push(root);
  const store = new LocalStore({
    workspaceRoot: path.join(root, "workspace"),
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Task facts",
    agentId: agent.id,
  });
  const run = await store.createRun({ threadId: thread.id, agentId: agent.id });
  return { store, thread, run };
}

describe("Shared task facts", () => {
  it.skipIf(process.platform === "win32")("rejects an explicitly referenced FIFO without blocking task detail or cached projection", async () => {
    const { store, thread, run } = await setup();
    const registry = new KernelProjectionRegistry();
    const service = new TaskNarrativeProjectionService(registry, store);
    const fifo = path.join(store.workspaceRoot, "output.txt");
    try {
      await mkdir(store.workspaceRoot, { recursive: true });
      await promisify(execFile)("mkfifo", [fifo]);
      await store.appendEvent({ threadId: thread.id, runId: run.id, type: "message.assistant",
        category: "message", visibility: "user", payload: { role: "assistant", text: "Open `output.txt`." } });
      await store.finishRun(run.id, "completed");
      for (const inspect of [() => store.getDetail(thread.id), () => service.project(thread.id)]) {
        const result = inspect();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const settled = await Promise.race([result.then(() => true), new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), 2_000);
          })]);
          expect(settled, "A non-file output reference must not wait for a FIFO writer").toBe(true);
        } finally {
          clearTimeout(timer);
          // Release the old blocking implementation too, so a regression does
          // not strand a libuv open or prevent fixture cleanup.
          const release = await open(fifo, constants.O_RDWR | constants.O_NONBLOCK);
          try { await result; } finally { await release.close(); }
        }
      }
      expect((await store.getDetail(thread.id)).taskNarrative?.deliverables).toEqual([]);
      expect((await service.project(thread.id)).view.deliverables).toEqual([]);
    } finally {
      registry.shutdown();
      store.close();
    }
  });

  it("does not accept a completed run with an unfinished plan, on replay or cached projection", async () => {
    const { store, thread, run } = await setup();
    const registry = new KernelProjectionRegistry();
    const service = new TaskNarrativeProjectionService(registry, store);
    try {
      await store.createPlan(thread.id, {
        objective: "Deliver report and tests",
        steps: [
          {
            id: "test",
            title: "Verify report",
            description: "Run the independent check",
            verification: "Report meets requested criteria",
          },
        ],
      });
      expect((await service.project(thread.id)).view.execution).toBe("running");
      await store.finishRun(run.id, "completed");
      const canonical = (await store.getDetail(thread.id)).taskNarrative!;
      const warm = await service.project(thread.id);
      expect(warm.view).toEqual(canonical);
      expect(canonical).toMatchObject({
        phase: "ended",
        execution: "ended",
        phaseLabel: "Work remains",
        currentAction: "This run ended; unfinished work remains",
        objective: { status: "partial" },
        remainingItems: ["Verify report"],
        nextStep: "Verify report",
      });
      // Data changes without new narrative events must still invalidate the
      // derived facts; only the event reducer is cached.
      const resumed = await store.createRun({
        threadId: thread.id,
        agentId: run.agentId,
      });
      const next = await service.project(thread.id);
      expect(next.view).toMatchObject({
        phase: "working",
        execution: "running",
        metricRunId: resumed.id,
      });
      expect(next.view).toEqual(
        (await store.getDetail(thread.id)).taskNarrative,
      );
    } finally {
      registry.shutdown();
      store.close();
    }
  });

  it("keeps no-plan and failed-plan tasks unverified and tool counts out of results", async () => {
    const { store, thread, run } = await setup();
    try {
      await store.appendEvent({
        threadId: thread.id,
        runId: run.id,
        type: "tool.failed",
        category: "tool",
        visibility: "user",
        payload: {
          callId: "plan",
          toolName: "create_plan",
          error: "Plan not found",
        },
      });
      await store.appendEvent({
        threadId: thread.id,
        runId: run.id,
        type: "tool.completed",
        category: "tool",
        visibility: "user",
        payload: { callId: "read", toolName: "read_file" },
      });
      await store.finishRun(run.id, "completed");
      expect((await store.getDetail(thread.id)).taskNarrative).toMatchObject({
        phase: "ended",
        execution: "ended",
        objective: { status: "unverified" },
        completedItems: [],
        processItems: ["Read 1 file"],
        remainingItems: [],
      });
      const goal = {
        ...createGoal("Deliver report"),
        status: "completed" as const,
        blocker: "none" as const,
        lastEvaluatedRunId: run.id,
        evidence: "The model says all checks passed.",
      };
      await store.setGoal(thread.id, goal);
      expect(
        (await store.getDetail(thread.id)).taskNarrative?.objective,
      ).toMatchObject({ status: "unverified", evidence: [] });
    } finally {
      store.close();
    }
  });

  it("a later cancelled or failed run cannot borrow an earlier success", async () => {
    const { store, thread, run } = await setup();
    try {
      await store.finishRun(run.id, "completed");
      for (const status of ["cancelled", "failed"] as const) {
        const next = await store.createRun({
          threadId: thread.id,
          agentId: run.agentId,
        });
        await store.finishRun(next.id, status);
        const facts = (await store.getDetail(thread.id)).taskNarrative!;
        expect(facts.phase).toBe(status === "failed" ? "failed" : "ended");
        expect(facts.metricRunId).toBe(next.id);
        expect(facts.objective?.status).not.toBe("accepted");
      }
    } finally {
      store.close();
    }
  });
  it("checks no-plan output references against the filesystem without promoting or exposing escaped files", async () => {
    const { store, thread, run } = await setup();
    const registry = new KernelProjectionRegistry();
    const service = new TaskNarrativeProjectionService(registry, store);
    try {
      await mkdir(path.join(store.workspaceRoot, "outputs"), {
        recursive: true,
      });
      await writeFile(
        path.join(store.workspaceRoot, "outputs/report.html"),
        "<h1>Candidate</h1>",
      );
      await writeFile(
        path.join(path.dirname(store.workspaceRoot), "outside.txt"),
        "outside",
      );
      await symlink(
        path.join(path.dirname(store.workspaceRoot), "outside.txt"),
        path.join(store.workspaceRoot, "escaped.txt"),
      );
      await service.project(thread.id);
      const reference = await store.appendEvent({
        threadId: thread.id,
        runId: run.id,
        type: "message.assistant",
        category: "message",
        visibility: "user",
        payload: {
          role: "assistant",
          text: "Open [report](outputs/report.html). `outputs/./report.html` `../outside.txt` `escaped.txt` `missing.txt` [external](https://example.test/a.html)",
        },
      });
      await store.finishRun(run.id, "completed");
      const detail = await store.getDetail(thread.id);
      expect(detail.taskNarrative?.deliverables).toHaveLength(1);
      expect(detail.taskNarrative?.deliverables?.[0]).toMatchObject({
        path: "outputs/report.html",
        source: "final_reference",
        sourceEventId: reference.id,
        accessibility: "available",
        verification: "unverified",
        artifact: {
          status: "candidate",
          sourceRunId: run.id,
          sha256: createHash("sha256")
            .update("<h1>Candidate</h1>")
            .digest("hex"),
        },
      });
      expect((await service.project(thread.id)).view).toEqual(
        detail.taskNarrative,
      );
      await writeFile(
        path.join(store.workspaceRoot, "outputs/report.html"),
        "<h1>Changed</h1>",
      );
      const changed = await service.project(thread.id);
      expect(changed.view.deliverables?.[0]?.artifact.sha256).not.toBe(
        detail.taskNarrative?.deliverables?.[0]?.artifact.sha256,
      );
      expect(changed.view.objective?.status).toBe("unverified");
      expect(changed.view).toEqual(
        (await store.getDetail(thread.id)).taskNarrative,
      );
      await rm(path.join(store.workspaceRoot, "outputs/report.html"));
      expect((await service.project(thread.id)).view.deliverables).toEqual([]);
    } finally {
      registry.shutdown();
      store.close();
    }
  });

  it("keeps formal bindings for absolute aliases and ignores unreferenced workspace files", async () => {
    const { store, thread, run } = await setup();
    try {
      await mkdir(store.workspaceRoot, { recursive: true });
      const report = path.join(store.workspaceRoot, "report.md");
      await writeFile(report, "Report");
      await writeFile(
        path.join(store.workspaceRoot, "unreferenced.md"),
        "Not a deliverable",
      );
      const plan = await store.createPlan(thread.id, {
        objective: "Report",
        steps: [
          {
            id: "write",
            title: "Write",
            description: "Write report",
            verification: "Report checked",
          },
        ],
        artifacts: [
          {
            id: "report",
            path: "report.md",
            kind: "file",
            description: "Report",
          },
        ],
      });
      await store.updatePlanArtifact(plan.id, "report", {
        status: "produced",
        sourceRunId: run.id,
        evidence: "File produced",
      });
      await store.appendEvent({
        threadId: thread.id,
        runId: run.id,
        type: "message.assistant",
        category: "message",
        visibility: "user",
        payload: { role: "assistant", text: `[Report](${report})` },
      });
      await store.finishRun(run.id, "completed");
      const targets = (await store.getDetail(thread.id)).taskNarrative
        ?.deliverables;
      expect(targets).toHaveLength(1);
      expect(targets?.[0]).toMatchObject({
        source: "plan",
        planId: plan.id,
        path: "report.md",
      });
      const next = await store.createRun({
        threadId: thread.id,
        agentId: run.agentId,
      });
      await store.appendEvent({
        threadId: thread.id,
        runId: next.id,
        type: "message.assistant",
        category: "message",
        visibility: "user",
        payload: { role: "assistant", text: "No new file was delivered." },
      });
      expect(
        (await store.getDetail(thread.id)).taskNarrative?.deliverables?.every(
          (entry) => entry.source === "plan",
        ),
      ).toBe(true);
    } finally {
      store.close();
    }
  });
});
