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

describe("Workflow preview-bound Git review Tool nodes", () => {
  it("passes one Plan-scoped promotion without durable branch or patch text", async () => {
    const fixture = await createFixture();
    const sourceCommit = await commit(fixture.workspaceRoot, "HEAD");
    const targetCommit = await commit(
      fixture.workspaceRoot,
      "release/PRIVATE_WORKFLOW_TARGET",
    );
    const previewReceipt = receiptSchema("preview");
    const applyReceipt = receiptSchema("apply");
    const manifest = defineExecutionPlanWorkflow({
      name: "Promote reviewed local commits",
      version: 1,
      description: "Review and fast-forward one local target branch.",
      blueprint: fixture.blueprint,
      inputSchema: requestSchema(),
      outputSchema: applyReceipt,
      outputNodeId: "apply",
      maxConcurrency: 1,
      nodes: [
        {
          id: "preview",
          type: "tool",
          tool: "git_review_preview",
          effect: "read",
          inputBindings: {
            targetBranchName: {
              source: "literal",
              value: "release/PRIVATE_WORKFLOW_TARGET",
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
          tool: "git_review_apply",
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
        input: { request: "Promote the reviewed commit." },
      },
    });

    expect(result).toEqual(expect.objectContaining({ status: "completed" }));
    expect(result.output).toEqual(
      expect.objectContaining({
        kind: "napier.git-review",
        action: "apply",
        status: "applied",
        postcondition: "verified",
        sourceCommitSha1: sourceCommit,
        targetCommitSha1: targetCommit,
        commitCount: 1,
        durable: true,
        sourcePreviewResultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(
      await commit(fixture.workspaceRoot, "release/PRIVATE_WORKFLOW_TARGET"),
    ).toBe(sourceCommit);
    const events = await fixture.store.listEvents(fixture.threadId);
    const completed = events.filter(
      (event) =>
        event.type === "tool.completed" &&
        ["git_review_preview", "git_review_apply"].includes(
          String(record(event.payload)?.["toolName"]),
        ),
    );
    expect(completed).toHaveLength(2);
    expect(completed[1]?.payload).toEqual(
      expect.objectContaining({
        effect: "write",
        action: "apply",
        status: "completed",
        postcondition: "verified",
        workflowOutput: expect.objectContaining({ status: "applied" }),
      }),
    );
    const durable = JSON.stringify(completed);
    expect(durable).not.toContain("PRIVATE_WORKFLOW_SOURCE");
    expect(durable).not.toContain("PRIVATE_WORKFLOW_TARGET");
    expect(durable).not.toContain("PRIVATE_WORKFLOW_CONTENT");
    expect(durable).not.toContain("REVIEWED PATCH");
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
    path.join(tmpdir(), "napier-workflow-git-review-"),
  );
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await git(workspaceRoot, ["init", "--quiet", "--initial-branch=main"]);
  await writeFile(path.join(workspaceRoot, "SOURCE.txt"), "PRIVATE_BEFORE\n");
  await git(workspaceRoot, ["add", "SOURCE.txt"]);
  await commitFixture(workspaceRoot, "baseline");
  await git(workspaceRoot, ["branch", "release/PRIVATE_WORKFLOW_TARGET"]);
  await git(workspaceRoot, [
    "checkout",
    "--quiet",
    "-b",
    "feature/PRIVATE_WORKFLOW_SOURCE",
  ]);
  await writeFile(
    path.join(workspaceRoot, "SOURCE.txt"),
    "PRIVATE_WORKFLOW_CONTENT\n",
  );
  await git(workspaceRoot, ["add", "SOURCE.txt"]);
  await commitFixture(workspaceRoot, "reviewed");
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const sourceThread = store.listThreads()[0]!;
  await store.updateAgent(sourceThread.agentId, {
    toolPolicy: "workspace",
    enabledTools: ["git_review_preview", "git_review_apply"],
  });
  const plan = await store.createPlan(sourceThread.id, {
    objective: "Promote one reviewed local commit.",
    steps: [
      {
        id: "preview",
        title: "Review commit range",
        description: "Bind the complete fast-forward patch.",
        verification: "Return one Plan-scoped capability.",
      },
      {
        id: "apply",
        title: "Promote target",
        description: "CAS fast-forward the reviewed local target.",
        verification: "Return a durable ref/reflog receipt.",
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
    title: "Git review Workflow target",
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
    properties: { targetBranchName: { type: "string" } },
    required: ["targetBranchName"],
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
    kind: { type: "string", enum: ["napier.git-review"] } as const,
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
    sourceBranchRefSha256: digest,
    targetBranchRefSha256: digest,
    sourceBranchNameBytes: count,
    targetBranchNameBytes: count,
    sourceCommitSha1: objectId,
    targetCommitSha1: objectId,
    commitCount: count,
    fileCount: count,
    hunkCount: count,
    addedLineCount: count,
    deletedLineCount: count,
    patchSha256: digest,
    patchBytes: count,
    reviewPlanSha256: digest,
    beforeRepositoryStateSha256: digest,
    afterRepositoryStateSha256: digest,
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
    "sourceBranchRefSha256",
    "targetBranchRefSha256",
    "sourceBranchNameBytes",
    "targetBranchNameBytes",
    "sourceCommitSha1",
    "targetCommitSha1",
    "commitCount",
    "fileCount",
    "hunkCount",
    "addedLineCount",
    "deletedLineCount",
    "patchSha256",
    "patchBytes",
    "reviewPlanSha256",
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
            "afterRepositoryStateSha256",
            "sourcePreviewResultSha256",
            "refUpdateStatus",
          ],
    additionalProperties: false,
  };
}

async function commitFixture(cwd: string, message: string): Promise<void> {
  await git(cwd, [
    "-c",
    "user.name=Napier Test",
    "-c",
    "user.email=napier@example.invalid",
    "commit",
    "--quiet",
    "-m",
    message,
  ]);
}

async function commit(cwd: string, revision: string): Promise<string> {
  return (await gitOutput(cwd, ["rev-parse", `${revision}^{commit}`])).trim();
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
    id: "direct-workflow-git-review-test",
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
