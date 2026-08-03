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

describe("Workflow preview-bound Git stage Tool nodes", () => {
  it("passes a scoped preview to apply without durable source or patch text", async () => {
    const fixture = await createFixture();
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_WORKFLOW.txt"),
      selectedHunkContent("PRIVATE_FIRST_AFTER", "PRIVATE_SECOND_AFTER"),
    );
    const previewReceipt = receiptSchema("preview");
    const applyReceipt = receiptSchema("apply");
    const manifest = defineExecutionPlanWorkflow({
      name: "Stage reviewed Git path",
      version: 1,
      description: "Preview and stage one exact repository path.",
      blueprint: fixture.blueprint,
      inputSchema: requestSchema(),
      outputSchema: applyReceipt,
      outputNodeId: "apply",
      maxConcurrency: 1,
      nodes: [
        {
          id: "preview",
          type: "tool",
          tool: "git_stage_preview",
          effect: "read",
          inputBindings: {
            path: { source: "literal", value: "PRIVATE_WORKFLOW.txt" },
            contextLines: { source: "literal", value: 1 },
            hunkIndexes: { source: "literal", value: [2] },
          },
          inputSchema: previewInputSchema(),
          outputSchema: previewReceipt,
          timeoutMs: 15_000,
          maxAttempts: 1,
        },
        {
          id: "apply",
          type: "tool",
          tool: "git_stage_apply",
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
        input: { request: "Stage the reviewed path." },
      },
    });

    expect(result).toEqual(expect.objectContaining({ status: "completed" }));
    expect(result.output).toEqual(
      expect.objectContaining({
        kind: "napier.git-stage",
        action: "apply",
        status: "applied",
        postcondition: "verified",
        durable: true,
        sourcePreviewResultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const staged = await gitOutput(fixture.workspaceRoot, [
      "diff",
      "--cached",
      "--",
      "PRIVATE_WORKFLOW.txt",
    ]);
    const working = await gitOutput(fixture.workspaceRoot, [
      "diff",
      "--",
      "PRIVATE_WORKFLOW.txt",
    ]);
    expect(staged).toContain("+PRIVATE_SECOND_AFTER");
    expect(staged).not.toContain("+PRIVATE_FIRST_AFTER");
    expect(working).toContain("+PRIVATE_FIRST_AFTER");
    expect(working).not.toContain("+PRIVATE_SECOND_AFTER");
    const events = await fixture.store.listEvents(fixture.threadId);
    const completed = events.filter(
      (event) =>
        event.type === "tool.completed" &&
        ["git_stage_preview", "git_stage_apply"].includes(
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
    expect(durable).not.toContain("PRIVATE_WORKFLOW");
    expect(durable).not.toContain("PRIVATE_FIRST_BEFORE");
    expect(durable).not.toContain("PRIVATE_FIRST_AFTER");
    expect(durable).not.toContain("PRIVATE_SECOND_AFTER");
    expect(durable).not.toContain("STAGED PATCH");
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, fixture.threadId),
      ),
    ).toEqual(expect.objectContaining({ status: "valid" }));
    fixture.store.close();
  }, 30_000);
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-workflow-git-stage-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await git(workspaceRoot, ["init", "--quiet"]);
  await writeFile(
    path.join(workspaceRoot, "PRIVATE_WORKFLOW.txt"),
    selectedHunkContent("PRIVATE_FIRST_BEFORE", "PRIVATE_SECOND_BEFORE"),
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
    enabledTools: ["git_stage_preview", "git_stage_apply"],
  });
  const plan = await store.createPlan(sourceThread.id, {
    objective: "Stage one reviewed Git path.",
    steps: [
      {
        id: "preview",
        title: "Preview path",
        description: "Construct the exact private-index patch.",
        verification: "Return a one-use hash-bound preview.",
      },
      {
        id: "apply",
        title: "Apply stage",
        description: "Atomically update the Git index.",
        verification: "Return a hash-only apply receipt.",
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
    title: "Git stage Workflow target",
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
    properties: {
      path: { type: "string" },
      contextLines: { type: "integer", minimum: 0, maximum: 10 },
      hunkIndexes: {
        type: "array",
        items: { type: "integer", minimum: 1, maximum: 32 },
        minItems: 1,
        maxItems: 32,
      },
    },
    required: ["path", "contextLines", "hunkIndexes"],
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
  const count = { type: "integer", minimum: 0 } as const;
  const properties = {
    kind: { type: "string", enum: ["napier.git-stage"] } as const,
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
    pathSha256: digest,
    pathStateSha256: digest,
    attributesStateSha256: digest,
    contextLines: count,
    fileCount: count,
    hunkCount: count,
    addedLineCount: count,
    deletedLineCount: count,
    patchSha256: digest,
    patchBytes: count,
    beforeRepositoryStateSha256: digest,
    beforeNonIndexStateSha256: digest,
    beforeIndexSha256: digest,
    proposedIndexSha256: digest,
    afterIndexSha256: digest,
    sourcePreviewResultSha256: digest,
    sandboxSha256: digest,
    gitExecutableSha256: digest,
    gitArgumentsSha256: digest,
    gitEnvironmentSha256: digest,
    gitResourceLimitsSha256: digest,
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
    "pathSha256",
    "pathStateSha256",
    "attributesStateSha256",
    "contextLines",
    "fileCount",
    "hunkCount",
    "addedLineCount",
    "deletedLineCount",
    "patchSha256",
    "patchBytes",
    "beforeRepositoryStateSha256",
    "beforeNonIndexStateSha256",
    "beforeIndexSha256",
    "proposedIndexSha256",
    "sandboxSha256",
    "gitExecutableSha256",
    "gitArgumentsSha256",
    "gitEnvironmentSha256",
    "gitResourceLimitsSha256",
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
        : [...common, "afterIndexSha256", "sourcePreviewResultSha256"],
    additionalProperties: false,
  };
}

function selectedHunkContent(first: string, second: string): string {
  const lines = Array.from({ length: 20 }, (_, index) => `line-${index + 1}`);
  lines[1] = first;
  lines[17] = second;
  return `${lines.join("\n")}\n`;
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
    id: "direct-workflow-git-stage-test",
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
