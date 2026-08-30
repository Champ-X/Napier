import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";

import type { ExecutionPlan, RunEvent } from "@napier/contracts";
import type { OsSandboxAdapter, SandboxedProcess } from "@napier/runtime/code";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { registerPlanArtifactInspectionHttp } from "../src/plan-artifact-inspection-http.js";
import type { PlanArtifactHttpStore } from "../src/plan-artifact-http-store.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Plan Artifact diff HTTP", () => {
  it("peeks at a produced artifact without appending a Ledger event", async () => {
    const workspaceRoot = await createRepository();
    const events: RunEvent[] = [];
    const plan = executionPlan();
    plan.artifacts[0]!.status = "produced";
    const app = new Hono();
    registerPlanArtifactInspectionHttp(
      app,
      {
        workspaceRoot,
        getPlan: () => plan,
        appendEvent: async (input) => {
          const event = {
            id: "event_unexpected",
            seq: 1,
            createdAt: "2026-08-30T00:00:00.000Z",
            visibility: input.visibility ?? "user",
            ...input,
          } as RunEvent;
          events.push(event);
          return event;
        },
      },
      directSandbox(),
    );

    const response = await app.request(
      `/api/threads/${plan.threadId}/plans/${plan.id}/artifacts/report/peek`,
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Napier-Read-Mode")).toBe("peek");
    expect(body).toEqual(
      expect.objectContaining({
        kind: "napier.plan-artifact-text-peek",
        artifactId: "report",
        text: expect.stringContaining("PRIVATE_HTTP_DIFF_BEFORE"),
      }),
    );
    expect(events).toEqual([]);
  });

  it("returns the diff while persisting only bounded hash and count evidence", async () => {
    const workspaceRoot = await createRepository();
    await writeFile(
      path.join(workspaceRoot, "report.md"),
      "# Report\nPRIVATE_HTTP_DIFF_AFTER\n",
      "utf8",
    );
    const events: RunEvent[] = [];
    const plan = executionPlan();
    const store: PlanArtifactHttpStore = {
      workspaceRoot,
      getPlan: () => plan,
      appendEvent: async (input) => {
        const event: RunEvent = {
          id: `event_${events.length + 1}`,
          seq: events.length + 1,
          createdAt: "2026-08-26T00:00:00.000Z",
          visibility: input.visibility ?? "user",
          ...input,
        };
        events.push(event);
        return event;
      },
    };
    const app = new Hono();
    registerPlanArtifactInspectionHttp(app, store, directSandbox());

    const response = await app.request(
      `/api/threads/${plan.threadId}/plans/${plan.id}/artifacts/report/diff`,
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Napier-Plan-Artifact-Diff-Files")).toBe("1");
    expect(response.headers.get("X-Napier-Plan-Artifact-Diff-Hunks")).toBe("1");
    expect(body).toEqual(
      expect.objectContaining({
        kind: "napier.plan-artifact-diff-preview",
        schemaVersion: 1,
        text: expect.stringContaining("+PRIVATE_HTTP_DIFF_AFTER"),
        fileCount: 1,
        hunkCount: 1,
        addedLineCount: 1,
        deletedLineCount: 1,
        ledgerEventId: "event_1",
        ledgerEventSeq: 1,
      }),
    );
    expect(events).toEqual([
      expect.objectContaining({
        type: "artifact.diff_previewed",
        category: "artifact",
        visibility: "user",
        payload: expect.objectContaining({
          planId: plan.id,
          artifactId: "report",
          scope: "working",
          outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          outputBytes: expect.any(Number),
          fileCount: 1,
          hunkCount: 1,
          addedLineCount: 1,
          deletedLineCount: 1,
          repositoryStateSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("PRIVATE_HTTP_DIFF_AFTER");
    expect(JSON.stringify(events)).not.toContain("PRIVATE_HTTP_DIFF_BEFORE");
    expect(JSON.stringify(events)).not.toContain("diff --git");
  });

  it("rejects an artifact that has not reached produced state", async () => {
    const workspaceRoot = await createRepository();
    const plan = executionPlan();
    plan.artifacts[0]!.status = "candidate";
    const app = new Hono();
    registerPlanArtifactInspectionHttp(
      app,
      {
        workspaceRoot,
        getPlan: () => plan,
        appendEvent: async () => {
          throw new Error("No event should be appended");
        },
      },
      directSandbox(),
    );

    const response = await app.request(
      `/api/threads/${plan.threadId}/plans/${plan.id}/artifacts/report/diff`,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Only produced or verified artifacts can be diffed",
    });
  });
});

function executionPlan(): ExecutionPlan {
  return {
    id: "plan_1",
    threadId: "thread_1",
    objective: "Produce a report",
    status: "active",
    steps: [],
    artifacts: [
      {
        id: "report",
        path: "report.md",
        kind: "file",
        description: "Verified report",
        status: "verified",
        evidence: "Verified by the runtime.",
        createdAt: "2026-08-26T00:00:00.000Z",
        updatedAt: "2026-08-26T00:00:00.000Z",
      },
    ],
    replans: [],
    replanRecommendation: null,
    criticalPathStepIds: [],
    readyStepIds: [],
    blockedStepIds: [],
    phaseWaves: [],
    activePhaseIndex: null,
    parallelReadyStepIds: [],
    phaseProjectionSha256: "a".repeat(64),
    revision: 1,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}

async function createRepository(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-artifact-http-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await git(workspaceRoot, ["init", "--quiet"]);
  await writeFile(
    path.join(workspaceRoot, "report.md"),
    "# Report\nPRIVATE_HTTP_DIFF_BEFORE\n",
    "utf8",
  );
  await git(workspaceRoot, ["add", "report.md"]);
  await git(workspaceRoot, [
    "-c",
    "user.name=Napier Test",
    "-c",
    "user.email=napier@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  return workspaceRoot;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("/usr/bin/git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-artifact-diff-test",
    async launch(request) {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: {
          ...request.env,
          HOME: request.workspaceRoot,
          TMPDIR: request.workspaceRoot,
        },
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return childProcess(child);
    },
  };
}

function childProcess(child: ChildProcess): SandboxedProcess {
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
    child.once("error", () => resolve({ code: null, signal: null }));
  });
  return {
    stdin: child.stdin ?? new PassThrough(),
    stdout: child.stdout ?? new PassThrough(),
    stderr: child.stderr ?? new PassThrough(),
    exit,
    terminate: async () => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }
      await exit;
    },
  };
}
