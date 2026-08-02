import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { WorkflowObjectSchema } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import type { OsSandboxAdapter, SandboxedProcess } from "../src/sandbox.js";
import { LocalStore } from "../src/store.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";
import { createExecutionPlanBlueprint } from "../src/workflow-blueprints.js";
import { defineExecutionPlanWorkflow } from "../src/workflow-manifests.js";
import { ExecutionPlanWorkflowRuntime } from "../src/workflow-runtime.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Workflow preview-bound Git commit Tool nodes", () => {
  it("passes a Plan-scoped commit preview without durable message or patch", async () => {
    const fixture = await createFixture();
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_WORKFLOW.txt"),
      "PRIVATE_AFTER\n",
    );
    await git(fixture.workspaceRoot, ["add", "PRIVATE_WORKFLOW.txt"]);
    const previewReceipt = receiptSchema("preview");
    const applyReceipt = receiptSchema("apply");
    const manifest = defineExecutionPlanWorkflow({
      name: "Commit reviewed staged index",
      version: 1,
      description: "Preview and atomically commit staged bytes.",
      blueprint: fixture.blueprint,
      inputSchema: requestSchema(),
      outputSchema: applyReceipt,
      outputNodeId: "apply",
      maxConcurrency: 1,
      nodes: [
        {
          id: "preview",
          type: "tool",
          tool: "git_commit_preview",
          effect: "read",
          inputBindings: {
            message: {
              source: "literal",
              value: "feat: PRIVATE_WORKFLOW_COMMIT",
            },
          },
          inputSchema: previewInputSchema(),
          outputSchema: previewReceipt,
          timeoutMs: 15_000,
          maxAttempts: 1,
        },
        {
          id: "apply",
          type: "tool",
          tool: "git_commit_apply",
          effect: "write",
          inputBindings: {
            previewId: {
              source: "node",
              nodeId: "preview",
              path: ["previewId"],
            },
          },
          inputSchema: applyInputSchema(),
          outputSchema: applyReceipt,
          timeoutMs: 15_000,
          maxAttempts: 1,
        },
      ],
    });
    const runtime = new AgentRuntime(
      fixture.store,
      new ModelRegistry(),
      undefined,
      directSandbox(),
    );
    const workflows = new ExecutionPlanWorkflowRuntime(fixture.store, runtime);

    const result = await workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest,
        input: { request: "Commit the reviewed staged index." },
      },
    });

    expect(result).toEqual(expect.objectContaining({ status: "completed" }));
    expect(result.output).toEqual(
      expect.objectContaining({
        kind: "napier.git-commit",
        action: "apply",
        status: "applied",
        postcondition: "verified",
        refUpdateStatus: "succeeded",
        proposedCommitSha1: expect.stringMatching(/^[a-f0-9]{40}$/u),
        sourcePreviewResultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(
      await gitOutput(fixture.workspaceRoot, ["log", "-1", "--format=%s"]),
    ).toBe("feat: PRIVATE_WORKFLOW_COMMIT\n");
    const events = await fixture.store.listEvents(fixture.threadId);
    const completed = events.filter(
      (event) =>
        event.type === "tool.completed" &&
        ["git_commit_preview", "git_commit_apply"].includes(
          String(record(event.payload)?.["toolName"]),
        ),
    );
    expect(completed).toHaveLength(2);
    const durable = JSON.stringify(completed);
    expect(durable).not.toContain("PRIVATE_WORKFLOW.txt");
    expect(durable).not.toContain("PRIVATE_BEFORE");
    expect(durable).not.toContain("PRIVATE_AFTER");
    expect(durable).not.toContain("PRIVATE_WORKFLOW_COMMIT");
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, fixture.threadId),
      ),
    ).toEqual(expect.objectContaining({ status: "valid" }));
    fixture.store.close();
  }, 30_000);
});

async function createFixture() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-workflow-git-commit-"),
  );
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await git(workspaceRoot, ["init", "--quiet", "--initial-branch=main"]);
  await writeFile(
    path.join(workspaceRoot, "PRIVATE_WORKFLOW.txt"),
    "PRIVATE_BEFORE\n",
  );
  await git(workspaceRoot, ["add", "PRIVATE_WORKFLOW.txt"]);
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
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const sourceThread = store.listThreads()[0]!;
  await store.updateAgent(sourceThread.agentId, {
    toolPolicy: "workspace",
    enabledTools: ["git_commit_preview", "git_commit_apply"],
  });
  const plan = await store.createPlan(sourceThread.id, {
    objective: "Commit reviewed staged bytes.",
    steps: [
      {
        id: "preview",
        title: "Preview commit",
        description: "Construct exact tree and commit privately.",
        verification: "Return one Plan-scoped capability.",
      },
      {
        id: "apply",
        title: "Apply commit",
        description: "CAS-update the attached branch.",
        verification: "Return a verified ref receipt.",
        dependsOn: ["preview"],
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    store,
    sourceThread.id,
    plan.id,
  );
  const thread = await store.createThread({
    title: "Git commit Workflow target",
    agentId: sourceThread.agentId,
  });
  return { workspaceRoot, store, blueprint, threadId: thread.id };
}

function requestSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: { request: { type: "string" } },
    required: ["request"],
    additionalProperties: false,
  };
}

function previewInputSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
    additionalProperties: false,
  };
}

function applyInputSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: { previewId: { type: "string" } },
    required: ["previewId"],
    additionalProperties: false,
  };
}

function receiptSchema(action: "preview" | "apply"): WorkflowObjectSchema {
  const digest = { type: "string", minLength: 64, maxLength: 64 } as const;
  const objectId = { type: "string", minLength: 40, maxLength: 40 } as const;
  const count = { type: "integer", minimum: 0 } as const;
  const properties = {
    kind: { type: "string", enum: ["napier.git-commit"] } as const,
    schemaVersion: { type: "integer", minimum: 1, maximum: 1 } as const,
    action: { type: "string", enum: [action] } as const,
    status: {
      type: "string",
      enum: action === "preview" ? ["ready"] : ["applied", "indeterminate"],
    } as const,
    postcondition: {
      type: "string",
      enum:
        action === "preview" ? ["not_applied"] : ["verified", "indeterminate"],
    } as const,
    previewId: { type: "string" } as const,
    expiresAt: { type: "string" } as const,
    messageSha256: digest,
    messageBytes: count,
    branchRefSha256: digest,
    parentCommitSha1: objectId,
    treeSha1: objectId,
    proposedCommitSha1: objectId,
    commitTimestampSeconds: count,
    identitySha256: digest,
    contextLines: count,
    fileCount: count,
    hunkCount: count,
    addedLineCount: count,
    deletedLineCount: count,
    stagedPatchSha256: digest,
    stagedPatchBytes: count,
    beforeRepositoryStateSha256: digest,
    afterHeadStateSha256: digest,
    sourcePreviewResultSha256: digest,
    refUpdateStatus: {
      type: "string",
      enum: ["succeeded", "failed", "timed_out", "output_capped", "unknown"],
    } as const,
    errorSha256: digest,
    runtimeEvidenceSha256: digest,
    durationMs: count,
    durable: { type: "boolean" } as const,
    cancellationObserved: { type: "boolean" } as const,
    resultSha256: digest,
  };
  const common = [
    "kind",
    "schemaVersion",
    "action",
    "status",
    "postcondition",
    "messageSha256",
    "messageBytes",
    "branchRefSha256",
    "parentCommitSha1",
    "treeSha1",
    "proposedCommitSha1",
    "commitTimestampSeconds",
    "identitySha256",
    "contextLines",
    "fileCount",
    "hunkCount",
    "addedLineCount",
    "deletedLineCount",
    "stagedPatchSha256",
    "stagedPatchBytes",
    "beforeRepositoryStateSha256",
    "runtimeEvidenceSha256",
    "durationMs",
    "durable",
    "cancellationObserved",
    "resultSha256",
  ];
  return {
    type: "object",
    properties,
    required:
      action === "preview"
        ? [...common, "previewId", "expiresAt"]
        : [
            ...common,
            "afterHeadStateSha256",
            "sourcePreviewResultSha256",
            "refUpdateStatus",
          ],
    additionalProperties: false,
  };
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("/usr/bin/git", args, {
    cwd,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  return (
    await execFileAsync("/usr/bin/git", args, {
      cwd,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    })
  ).stdout;
}

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-workflow-git-commit-test",
    async launch(request) {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: {
          ...request.env,
          HOME: path.join(request.workspaceRoot, ".napier-test-home"),
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
    stdin: child.stdin!,
    stdout: child.stdout!,
    stderr: child.stderr!,
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

function record(value: unknown): Record<string, unknown> | undefined {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
