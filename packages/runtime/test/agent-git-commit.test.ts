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
import { ModelRegistry } from "../src/models.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import type { OsSandboxAdapter, SandboxedProcess } from "../src/sandbox.js";
import { LocalStore } from "../src/store.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent preview-bound Git commit", () => {
  it("reviews and commits staged bytes without durable message or patch text", async () => {
    const fixture = await createFixture();
    await writeFile(
      path.join(fixture.workspaceRoot, "PRIVATE_SOURCE.txt"),
      "PRIVATE_AFTER\n",
    );
    await git(fixture.workspaceRoot, ["add", "PRIVATE_SOURCE.txt"]);
    const parent = (
      await gitOutput(fixture.workspaceRoot, ["rev-parse", "HEAD"])
    ).trim();
    const agent = await fixture.store.updateAgent(
      fixture.store.listAgents()[0]!.id,
      {
        toolPolicy: "workspace",
        enabledTools: ["git_commit_preview", "git_commit_apply"],
      },
    );
    const thread = await fixture.store.createThread({
      title: "Private Git commit",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-git-commit" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("git_commit_preview", {
          message: "feat: PRIVATE_COMMIT_MESSAGE",
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("PRIVATE_AFTER");
        expect(messages).toContain("PRIVATE_COMMIT_MESSAGE");
        const previewId = messages.match(
          /gitcommitpreview_[a-z0-9]{8,80}/u,
        )?.[0];
        expect(previewId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("git_commit_apply", { previewId }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "The reviewed staged index was committed",
        );
        return fauxAssistantMessage("The reviewed commit is applied.");
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
      text: "Preview and atomically commit the staged source.",
      model: { provider: "faux-git-commit", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    const head = (
      await gitOutput(fixture.workspaceRoot, ["rev-parse", "HEAD"])
    ).trim();
    expect(head).not.toBe(parent);
    expect(
      await gitOutput(fixture.workspaceRoot, ["log", "-1", "--format=%s"]),
    ).toBe("feat: PRIVATE_COMMIT_MESSAGE\n");
    expect(
      await gitOutput(fixture.workspaceRoot, ["diff", "--cached", "HEAD"]),
    ).toBe("");
    const events = await fixture.store.listEvents(thread.id);
    const gitEvents = events.filter((event) =>
      ["git_commit_preview", "git_commit_apply"].includes(
        String(record(event.payload)?.["toolName"]),
      ),
    );
    expect(gitEvents.map((event) => event.type)).toEqual([
      "tool.admitted",
      "tool.started",
      "tool.completed",
      "tool.admitted",
      "tool.started",
      "tool.completed",
    ]);
    expect(gitEvents[1]?.payload).toEqual(
      expect.objectContaining({ effect: "read", inputRedacted: true }),
    );
    expect(gitEvents[4]?.payload).toEqual(
      expect.objectContaining({ effect: "write", inputRedacted: true }),
    );
    expect(gitEvents[5]?.payload).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        details: expect.objectContaining({
          kind: "napier.git-commit",
          action: "apply",
          status: "applied",
          proposedCommitSha1: head,
        }),
      }),
    );
    const durable = JSON.stringify(gitEvents);
    expect(durable).not.toContain("PRIVATE_SOURCE");
    expect(durable).not.toContain("PRIVATE_BEFORE");
    expect(durable).not.toContain("PRIVATE_AFTER");
    expect(durable).not.toContain("PRIVATE_COMMIT_MESSAGE");
    expect(durable).not.toContain("COMMITTED PATCH");
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, thread.id),
      ),
    ).toEqual(expect.objectContaining({ status: "valid" }));
    fixture.store.close();
  }, 30_000);

  it("reviews and completes a resolved merge without durable private text", async () => {
    const fixture = await createFixture();
    const { firstParent, mergeParent } = await createResolvedMerge(
      fixture.workspaceRoot,
    );
    const agent = await fixture.store.updateAgent(
      fixture.store.listAgents()[0]!.id,
      {
        toolPolicy: "workspace",
        enabledTools: ["git_commit_preview", "git_commit_apply"],
      },
    );
    const thread = await fixture.store.createThread({
      title: "Private Git merge commit",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-git-merge-commit" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("git_commit_preview", {
          message: "merge: PRIVATE_MERGE_MESSAGE",
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("GIT MERGE TREE TRANSITION");
        expect(messages).toContain("no staged tree delta");
        expect(messages).toContain(mergeParent);
        const previewId = messages.match(
          /gitcommitpreview_[a-z0-9]{8,80}/u,
        )?.[0];
        return fauxAssistantMessage(
          fauxToolCall("git_commit_apply", { previewId }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage("The reviewed merge commit is applied."),
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
      text: "Complete the reviewed merge.",
      model: { provider: "faux-git-merge-commit", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    const parents = (
      await gitOutput(fixture.workspaceRoot, [
        "rev-list",
        "--parents",
        "-n",
        "1",
        "HEAD",
      ])
    )
      .trim()
      .split(" ");
    expect(parents.slice(1)).toEqual([firstParent, mergeParent]);
    await expect(
      readFile(path.join(fixture.workspaceRoot, ".git/MERGE_HEAD")),
    ).rejects.toThrow();
    const events = await fixture.store.listEvents(thread.id);
    const durable = JSON.stringify(events);
    for (const privateValue of [
      "PRIVATE_SOURCE",
      "PRIVATE_OURS",
      "PRIVATE_THEIRS",
      "PRIVATE_MERGE_MESSAGE",
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

async function createResolvedMerge(workspaceRoot: string): Promise<{
  firstParent: string;
  mergeParent: string;
}> {
  await git(workspaceRoot, ["branch", "feature"]);
  await writeFile(
    path.join(workspaceRoot, "PRIVATE_SOURCE.txt"),
    "PRIVATE_OURS\n",
  );
  await git(workspaceRoot, ["add", "PRIVATE_SOURCE.txt"]);
  await fixtureCommit(workspaceRoot, "ours");
  await git(workspaceRoot, ["checkout", "--quiet", "feature"]);
  await writeFile(
    path.join(workspaceRoot, "PRIVATE_SOURCE.txt"),
    "PRIVATE_THEIRS\n",
  );
  await git(workspaceRoot, ["add", "PRIVATE_SOURCE.txt"]);
  await fixtureCommit(workspaceRoot, "theirs");
  const mergeParent = (
    await gitOutput(workspaceRoot, ["rev-parse", "HEAD"])
  ).trim();
  await git(workspaceRoot, ["checkout", "--quiet", "main"]);
  const firstParent = (
    await gitOutput(workspaceRoot, ["rev-parse", "HEAD"])
  ).trim();
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
  await writeFile(
    path.join(workspaceRoot, "PRIVATE_SOURCE.txt"),
    "PRIVATE_OURS\n",
  );
  await git(workspaceRoot, ["add", "PRIVATE_SOURCE.txt"]);
  return { firstParent, mergeParent };
}

async function fixtureCommit(cwd: string, message: string): Promise<void> {
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

async function createFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  store: LocalStore;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-agent-git-commit-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await git(workspaceRoot, ["init", "--quiet", "--initial-branch=main"]);
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
    id: "direct-agent-git-commit-test",
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
