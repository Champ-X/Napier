import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { sha256 } from "../src/ed25519.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";
import { ModelRegistry } from "../src/models.js";
import type { OsSandboxAdapter, SandboxedProcess } from "../src/sandbox.js";
import { LocalStore } from "../src/store.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent Git inspection", () => {
  it("reads real status while Ledger and Replay retain only hashes", async () => {
    const fixture = await createFixture();
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_SOURCE.txt"),
      "PRIVATE_AFTER\n",
    );
    const agent = await fixture.store.updateAgent(
      fixture.store.listAgents()[0]!.id,
      {
        toolPolicy: "workspace",
        enabledTools: ["git_inspect"],
      },
    );
    const thread = await fixture.store.createThread({
      title: "Private Git inspection",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-git-inspect" });
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("git_inspect", { action: "status" }), {
        stopReason: "toolUse",
      }),
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "PRIVATE_SOURCE.txt",
        );
        return fauxAssistantMessage("Git status was inspected.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(
      fixture.store,
      models,
      undefined,
      directSandbox(),
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Inspect the current Git status.",
      model: { provider: "faux-git-inspect", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    const events = await fixture.store.listEvents(thread.id);
    const gitEvents = events.filter(
      (event) => record(event.payload)?.["toolName"] === "git_inspect",
    );
    expect(gitEvents.map((event) => event.type)).toEqual([
      "tool.started",
      "tool.completed",
    ]);
    expect(gitEvents[0]?.payload).toEqual(
      expect.objectContaining({
        effect: "read",
        inputRedacted: true,
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(gitEvents[1]?.payload).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        details: expect.objectContaining({
          kind: "napier.git-inspection",
          action: "status",
          statusEntryCount: 1,
          resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    const durable = JSON.stringify(gitEvents);
    expect(durable).not.toContain("PRIVATE_SOURCE");
    expect(durable).not.toContain("PRIVATE_BEFORE");
    expect(durable).not.toContain("PRIVATE_AFTER");
    expect(durable).not.toContain("GIT STATUS");
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, thread.id),
      ),
    ).toEqual(expect.objectContaining({ status: "valid" }));
    fixture.store.close();
  }, 30_000);

  it("inspects, edits, and atomically stages one text conflict", async () => {
    const fixture = await createFixture();
    await createMergeConflict(fixture.workspaceRoot);
    const conflictText = await readFile(
      path.join(fixture.workspaceRoot, "PRIVATE_SOURCE.txt"),
      "utf8",
    );
    const resolvedText = "PRIVATE_OURS\n";
    const agent = await fixture.store.updateAgent(
      fixture.store.listAgents()[0]!.id,
      {
        toolPolicy: "workspace",
        enabledTools: [
          "git_inspect",
          "read_file",
          "apply_patch",
          "git_stage_preview",
          "git_stage_apply",
        ],
      },
    );
    const thread = await fixture.store.createThread({
      title: "Private Git conflict",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-git-conflict" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("git_inspect", {
          action: "conflict",
          path: "PRIVATE_SOURCE.txt",
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("PRIVATE_BEFORE");
        expect(messages).toContain("PRIVATE_OURS");
        expect(messages).toContain("PRIVATE_THEIRS");
        return fauxAssistantMessage(
          fauxToolCall("read_file", { path: "PRIVATE_SOURCE.txt" }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain("<<<<<<< HEAD");
        return fauxAssistantMessage(
          fauxToolCall("apply_patch", {
            operation: "replace",
            path: "PRIVATE_SOURCE.txt",
            expectedSha256: sha256(conflictText),
            edits: [{ oldText: conflictText, newText: resolvedText }],
          }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage(
        fauxToolCall("git_stage_preview", {
          path: "PRIVATE_SOURCE.txt",
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("GIT INDEX TRANSITION");
        expect(messages).toContain("staged tree matches HEAD");
        const previewId = messages.match(
          /gitstagepreview_[a-z0-9]{8,80}/u,
        )?.[0];
        return fauxAssistantMessage(
          fauxToolCall("git_stage_apply", { previewId }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage("The conflict is resolved and staged."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(
      fixture.store,
      models,
      undefined,
      directSandbox(),
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Inspect and resolve the current text conflict.",
      model: { provider: "faux-git-conflict", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    expect(
      await gitOutput(fixture.workspaceRoot, [
        "ls-files",
        "--unmerged",
        "--",
        "PRIVATE_SOURCE.txt",
      ]),
    ).toBe("");
    expect(
      await readFile(
        path.join(fixture.workspaceRoot, "PRIVATE_SOURCE.txt"),
        "utf8",
      ),
    ).toBe(resolvedText);
    const events = await fixture.store.listEvents(thread.id);
    const durable = JSON.stringify(events);
    for (const privateValue of [
      "PRIVATE_SOURCE.txt",
      "PRIVATE_BEFORE",
      "PRIVATE_OURS",
      "PRIVATE_THEIRS",
      "<<<<<<<",
    ]) {
      expect(durable).not.toContain(privateValue);
    }
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, thread.id),
      ),
    ).toEqual(expect.objectContaining({ status: "valid" }));
    fixture.store.close();
  }, 30_000);
});

async function createMergeConflict(workspaceRoot: string): Promise<void> {
  const sourceBranch = (
    await gitOutput(workspaceRoot, ["symbolic-ref", "--short", "HEAD"])
  ).trim();
  await git(workspaceRoot, ["branch", "feature"]);
  await writeFile(
    path.join(workspaceRoot, "PRIVATE_SOURCE.txt"),
    "PRIVATE_OURS\n",
  );
  await commit(workspaceRoot, "ours");
  await git(workspaceRoot, ["checkout", "--quiet", "feature"]);
  await writeFile(
    path.join(workspaceRoot, "PRIVATE_SOURCE.txt"),
    "PRIVATE_THEIRS\n",
  );
  await commit(workspaceRoot, "theirs");
  await git(workspaceRoot, ["checkout", "--quiet", sourceBranch]);
  await execFileAsync(
    "/usr/bin/git",
    [
      "-c",
      "user.name=Napier Test",
      "-c",
      "user.email=napier@example.invalid",
      "merge",
      "feature",
    ],
    { cwd: workspaceRoot, env: gitEnvironment() },
  ).catch(() => undefined);
}

async function commit(workspaceRoot: string, message: string): Promise<void> {
  await git(workspaceRoot, ["add", "PRIVATE_SOURCE.txt"]);
  await git(workspaceRoot, [
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

async function createFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  store: LocalStore;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-agent-git-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await git(workspaceRoot, ["init", "--quiet"]);
  await writeFile(
    path.join(workspaceRoot, "PRIVATE_SOURCE.txt"),
    "PRIVATE_BEFORE\n",
  );
  await git(workspaceRoot, ["add", "PRIVATE_SOURCE.txt"]);
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
  return { root, workspaceRoot, store };
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("/usr/bin/git", args, {
    cwd,
    env: gitEnvironment(),
  });
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  return (
    await execFileAsync("/usr/bin/git", args, {
      cwd,
      env: gitEnvironment(),
    })
  ).stdout;
}

function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-agent-git-test",
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
