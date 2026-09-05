import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

describe("Agent preview-bound Git branch creation", () => {
  it("reviews and creates one branch without durable branch names", async () => {
    const fixture = await createFixture();
    const parent = (
      await gitOutput(fixture.workspaceRoot, ["rev-parse", "HEAD"])
    ).trim();
    const agent = await fixture.store.updateAgent(
      fixture.store.listAgents()[0]!.id,
      {
        toolPolicy: "workspace",
        enabledTools: ["git_branch_create_preview", "git_branch_create_apply"],
      },
    );
    const thread = await fixture.store.createThread({
      title: "Private Git branch",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-git-branch" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("git_branch_create_preview", {
          branchName: "feature/PRIVATE_BRANCH",
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("feature/PRIVATE_BRANCH");
        expect(messages).toContain(parent);
        const previewId = messages.match(
          /gitbranchpreview_[a-z0-9]{8,80}/u,
        )?.[0];
        expect(previewId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("git_branch_create_apply", { previewId }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "The new local branch ref is durable",
        );
        return fauxAssistantMessage("The reviewed branch was created.");
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
      text: "Preview and create one local branch at current HEAD.",
      model: { provider: "faux-git-branch", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    expect(
      (
        await gitOutput(fixture.workspaceRoot, [
          "rev-parse",
          "refs/heads/feature/PRIVATE_BRANCH",
        ])
      ).trim(),
    ).toBe(parent);
    expect(
      (
        await gitOutput(fixture.workspaceRoot, [
          "symbolic-ref",
          "--short",
          "HEAD",
        ])
      ).trim(),
    ).toBe("main");
    const events = await fixture.store.listEvents(thread.id);
    const gitEvents = events.filter((event) =>
      ["git_branch_create_preview", "git_branch_create_apply"].includes(
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
          kind: "napier.git-branch",
          action: "apply",
          status: "applied",
          targetCommitSha1: parent,
        }),
      }),
    );
    const durable = JSON.stringify(gitEvents);
    expect(durable).not.toContain("PRIVATE_BRANCH");
    expect(durable).not.toContain("feature/");
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, thread.id),
      ),
    ).toEqual(expect.objectContaining({ status: "valid" }));
    fixture.store.close();
  }, 30_000);
});

async function createFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  store: LocalStore;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-agent-git-branch-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await git(workspaceRoot, ["init", "--quiet", "--initial-branch=main"]);
  await writeFile(path.join(workspaceRoot, "TRACKED.txt"), "before\n");
  await git(workspaceRoot, ["add", "TRACKED.txt"]);
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
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  return (
    await execFileAsync("/usr/bin/git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    })
  ).stdout;
}

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-agent-git-branch-test",
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
