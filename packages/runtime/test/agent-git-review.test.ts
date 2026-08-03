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

describe("Agent preview-bound Git review promotion", () => {
  it("reviews and promotes a fast-forward without durable names or patch text", async () => {
    const fixture = await createFixture();
    const sourceCommit = await commit(fixture.workspaceRoot, "HEAD");
    const targetCommit = await commit(
      fixture.workspaceRoot,
      "release/PRIVATE_TARGET",
    );
    const agent = await fixture.store.updateAgent(
      fixture.store.listAgents()[0]!.id,
      {
        toolPolicy: "workspace",
        enabledTools: ["git_review_preview", "git_review_apply"],
      },
    );
    const thread = await fixture.store.createThread({
      title: "Private Git review",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-git-review" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("git_review_preview", {
          targetBranchName: "release/PRIVATE_TARGET",
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("feature/PRIVATE_SOURCE");
        expect(messages).toContain("release/PRIVATE_TARGET");
        expect(messages).toContain("PRIVATE_REVIEWED_CONTENT");
        expect(messages).toContain(sourceCommit);
        expect(messages).toContain(targetCommit);
        const previewId = messages.match(
          /gitreviewpreview_[a-z0-9]{8,80}/u,
        )?.[0];
        expect(previewId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("git_review_apply", { previewId }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "target branch was durably fast-forwarded",
        );
        return fauxAssistantMessage("The reviewed commit was promoted.");
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
      text: "Review current HEAD and fast-forward the release target.",
      model: { provider: "faux-git-review", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    expect(await commit(fixture.workspaceRoot, "release/PRIVATE_TARGET")).toBe(
      sourceCommit,
    );
    expect(
      (
        await gitOutput(fixture.workspaceRoot, [
          "symbolic-ref",
          "--short",
          "HEAD",
        ])
      ).trim(),
    ).toBe("feature/PRIVATE_SOURCE");
    const events = await fixture.store.listEvents(thread.id);
    const gitEvents = events.filter((event) =>
      ["git_review_preview", "git_review_apply"].includes(
        String(record(event.payload)?.["toolName"]),
      ),
    );
    expect(gitEvents.map((event) => event.type)).toEqual([
      "tool.started",
      "tool.completed",
      "tool.started",
      "tool.completed",
    ]);
    expect(gitEvents[0]?.payload).toEqual(
      expect.objectContaining({ effect: "read", inputRedacted: true }),
    );
    expect(gitEvents[2]?.payload).toEqual(
      expect.objectContaining({ effect: "write", inputRedacted: true }),
    );
    expect(gitEvents[3]?.payload).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        details: expect.objectContaining({
          kind: "napier.git-review",
          action: "apply",
          status: "applied",
          postcondition: "verified",
          sourceCommitSha1: sourceCommit,
          targetCommitSha1: targetCommit,
          resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    const durable = JSON.stringify(gitEvents);
    expect(durable).not.toContain("PRIVATE_SOURCE");
    expect(durable).not.toContain("PRIVATE_TARGET");
    expect(durable).not.toContain("PRIVATE_REVIEWED_CONTENT");
    expect(durable).not.toContain("REVIEWED PATCH");
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
  const root = await mkdtemp(path.join(tmpdir(), "napier-agent-git-review-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await git(workspaceRoot, ["init", "--quiet", "--initial-branch=main"]);
  await writeFile(path.join(workspaceRoot, "SOURCE.txt"), "PRIVATE_BEFORE\n");
  await git(workspaceRoot, ["add", "SOURCE.txt"]);
  await commitFixture(workspaceRoot, "baseline");
  await git(workspaceRoot, ["branch", "release/PRIVATE_TARGET"]);
  await git(workspaceRoot, [
    "checkout",
    "--quiet",
    "-b",
    "feature/PRIVATE_SOURCE",
  ]);
  await writeFile(
    path.join(workspaceRoot, "SOURCE.txt"),
    "PRIVATE_REVIEWED_CONTENT\n",
  );
  await git(workspaceRoot, ["add", "SOURCE.txt"]);
  await commitFixture(workspaceRoot, "reviewed");
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  return { root, workspaceRoot, store };
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
    id: "direct-agent-git-review-test",
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
