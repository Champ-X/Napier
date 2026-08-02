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
import type {
  OsSandboxAdapter,
  SandboxedProcess,
} from "../src/sandbox.js";
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

describe("Workflow Git inspection Tool node", () => {
  it("returns a typed hash receipt while status paths remain live-only", async () => {
    const fixture = await createFixture();
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_WORKFLOW.txt"),
      "PRIVATE_AFTER\n",
    );
    const manifest = defineExecutionPlanWorkflow({
      name: "Read Git status",
      version: 1,
      description: "Inspect one repository without mutation.",
      blueprint: fixture.blueprint,
      inputSchema: requestSchema(),
      outputSchema: receiptSchema(),
      outputNodeId: "status",
      maxConcurrency: 1,
      nodes: [
        {
          id: "status",
          type: "tool",
          tool: "git_inspect",
          effect: "read",
          inputBindings: {
            action: { source: "literal", value: "status" },
          },
          inputSchema: statusInputSchema(),
          outputSchema: receiptSchema(),
          timeoutMs: 10_000,
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
    const workflows = new ExecutionPlanWorkflowRuntime(
      fixture.store,
      runtime,
    );

    const result = await workflows.run({
      threadId: fixture.threadId,
      request: {
        manifest,
        input: { request: "Inspect status." },
      },
    });

    expect(result).toEqual(
      expect.objectContaining({ status: "completed" }),
    );
    expect(result.output).toEqual(
      expect.objectContaining({
        kind: "napier.git-inspection",
        schemaVersion: 1,
        action: "status",
        statusEntryCount: 1,
        repositoryStateSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const events = await fixture.store.listEvents(fixture.threadId);
    const completed = events.find(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["toolName"] === "git_inspect",
    );
    const durable = JSON.stringify(completed);
    expect(durable).not.toContain("PRIVATE_WORKFLOW");
    expect(durable).not.toContain("PRIVATE_BEFORE");
    expect(durable).not.toContain("PRIVATE_AFTER");
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, fixture.threadId),
      ),
    ).toEqual(expect.objectContaining({ status: "valid" }));
    fixture.store.close();
  }, 30_000);
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-workflow-git-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await git(workspaceRoot, ["init", "--quiet"]);
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
    enabledTools: ["git_inspect"],
  });
  const plan = await store.createPlan(sourceThread.id, {
    objective: "Inspect Git status.",
    steps: [
      {
        id: "status",
        title: "Inspect status",
        description: "Read status through the fixed Git runtime.",
        verification: "Return a hash-only receipt.",
      },
    ],
  });
  const blueprint = await createExecutionPlanBlueprint(
    store,
    sourceThread.id,
    plan.id,
  );
  const thread = await store.createThread({
    title: "Git Workflow target",
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

function statusInputSchema(): WorkflowObjectSchema {
  return {
    type: "object",
    properties: { action: { type: "string", enum: ["status"] } },
    required: ["action"],
    additionalProperties: false,
  };
}

function receiptSchema(): WorkflowObjectSchema {
  const digest = { type: "string", minLength: 64, maxLength: 64 } as const;
  const count = { type: "integer", minimum: 0 } as const;
  return {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["napier.git-inspection"] },
      schemaVersion: { type: "integer", minimum: 1, maximum: 1 },
      action: { type: "string", enum: ["status"] },
      repositoryPathSha256: digest,
      gitDirectorySha256: digest,
      statusEntryCount: count,
      fileCount: count,
      hunkCount: count,
      addedLineCount: count,
      deletedLineCount: count,
      outputSha256: digest,
      outputBytes: count,
      repositoryStateSha256: digest,
      headStateSha256: digest,
      indexSha256: digest,
      indexPresent: { type: "boolean" },
      configSha256: digest,
      sandboxSha256: digest,
      gitExecutableSha256: digest,
      gitArgumentsSha256: digest,
      gitEnvironmentSha256: digest,
      gitResourceLimitsSha256: digest,
      durationMs: count,
      resultSha256: digest,
    },
    required: [
      "kind",
      "schemaVersion",
      "action",
      "repositoryPathSha256",
      "gitDirectorySha256",
      "statusEntryCount",
      "fileCount",
      "hunkCount",
      "addedLineCount",
      "deletedLineCount",
      "outputSha256",
      "outputBytes",
      "repositoryStateSha256",
      "headStateSha256",
      "indexSha256",
      "indexPresent",
      "configSha256",
      "sandboxSha256",
      "gitExecutableSha256",
      "gitArgumentsSha256",
      "gitEnvironmentSha256",
      "gitResourceLimitsSha256",
      "durationMs",
      "resultSha256",
    ],
    additionalProperties: false,
  };
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
    id: "direct-workflow-git-test",
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
