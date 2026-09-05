import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LspRenameApplyDiagnosticsDetails } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import type { OsSandboxAdapter } from "../src/sandbox.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { LocalStore } from "../src/store.js";
import type { SubagentWorktreeLifecycleDiagnosticsAdapter } from "../src/subagent-worktree-lifecycle-diagnostics.js";
import { SubagentWorktreeMutationManager } from "../src/subagent-worktree-mutation.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";
import { WorkspaceProcessManager } from "../src/workspace-processes.js";
import { createActiveTestRun } from "./active-run-test-fixture.js";

const temporaryRoots: string[] = [];
const openProcesses: WorkspaceProcessManager[] = [];
const openStores: LocalStore[] = [];

afterEach(async () => {
  await Promise.allSettled(
    openProcesses.splice(0).map((processes) => processes.shutdown()),
  );
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Subagent worktree debugger", () => {
  it("debugs, steps, verifies, and merges unmerged candidate behavior", async () => {
    const fixture = await createFixture(debugSource(20));
    const { manager, worktree } = await createCandidate(fixture);
    const tools = manager.createCoderTools(worktree);
    const patch = tools.find((tool) => tool.name === "apply_patch")!;
    const debuggerTool = tools.find((tool) => tool.name === "node_debugger")!;
    await patch.execute("patch-debug-input", {
      operation: "replace",
      path: "src/debug-target.mjs",
      expectedSha256: sha256(debugSource(20)),
      edits: [{ oldText: "calculate(20)", newText: "calculate(41)" }],
    });

    const launched = await debuggerTool.execute("debug-launch", {
      action: "launch",
      path: "src/debug-target.mjs",
      breakpoints: [{ line: 2 }],
      timeoutMs: 2_000,
      sessionTimeoutMs: 20_000,
    });
    const launchText = toolText(launched);
    const processId = launchText.match(/process_[a-z0-9]{20}/u)?.[0];
    const frameId = launchText.match(/#(\d+) calculate/u)?.[1];
    expect(launchText).toContain("Stop reason: breakpoint");
    expect(processId).toBeDefined();
    expect(frameId).toBeDefined();

    const evaluated = await debuggerTool.execute("debug-evaluate", {
      action: "evaluate",
      processId,
      frameId: Number(frameId),
      expression: "input + 0 /* PRIVATE_DEBUG_EXPRESSION */",
    });
    expect(toolText(evaluated)).toContain("ok: 41 (number)");
    const stepped = await debuggerTool.execute("debug-next", {
      action: "next",
      processId,
    });
    expect(toolText(stepped)).toContain("src/debug-target.mjs:3:");
    const completed = await debuggerTool.execute("debug-continue", {
      action: "continue",
      processId,
    });
    expect(toolText(completed)).toContain("Target exit code: 0");
    await expect(
      readFile(
        path.join(fixture.workspaceRoot, "src/debug-target.mjs"),
        "utf8",
      ),
    ).resolves.toContain("calculate(20)");

    const preview = await manager.storePreview(worktree, "a".repeat(64));
    await expect(manager.apply(preview.id)).resolves.toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          status: "applied",
          postcondition: "verified",
        }),
      }),
    );
    await expect(
      readFile(
        path.join(fixture.workspaceRoot, "src/debug-target.mjs"),
        "utf8",
      ),
    ).resolves.toContain("calculate(41)");
    expect(await activeSessions(fixture)).toEqual([]);
    const durable = JSON.stringify(
      await fixture.store.listEvents(fixture.threadId),
    );
    expect(durable).not.toContain("debug-target.mjs");
    expect(durable).not.toContain("PRIVATE_DEBUG_EXPRESSION");
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(fixture.store, fixture.threadId),
      ).status,
    ).toBe("valid");
  }, 20_000);

  it("settles a paused debugger before issuing a candidate preview", async () => {
    const fixture = await createFixture(debugSource(20));
    const { manager, worktree } = await createCandidate(fixture);
    const tools = manager.createCoderTools(worktree);
    await tools
      .find((tool) => tool.name === "apply_patch")!
      .execute("patch", {
        operation: "replace",
        path: "src/debug-target.mjs",
        expectedSha256: sha256(debugSource(20)),
        edits: [{ oldText: "calculate(20)", newText: "calculate(21)" }],
      });
    const launched = await tools
      .find((tool) => tool.name === "node_debugger")!
      .execute("debug-launch", {
        action: "launch",
        path: "src/debug-target.mjs",
        breakpoints: [{ line: 2 }],
        timeoutMs: 2_000,
        sessionTimeoutMs: 20_000,
      });
    expect(toolText(launched)).toContain("Stop reason: breakpoint");

    await expect(
      manager.storePreview(worktree, "b".repeat(64)),
    ).resolves.toEqual(
      expect.objectContaining({
        changedFileCount: 1,
        modifiedFileCount: 1,
      }),
    );
    expect(await activeSessions(fixture)).toEqual([]);
  }, 20_000);

  it("invalidates settlement when a debug target changes candidate bytes", async () => {
    const fixture = await createFixture(
      [
        'import { writeFileSync } from "node:fs";',
        'writeFileSync(new URL("./marker.txt", import.meta.url), "changed");',
        "function calculate(input) {",
        "  return input + 1;",
        "}",
        "globalThis.RESULT = calculate(20);",
      ].join("\n"),
    );
    const { manager, worktree } = await createCandidate(fixture);
    const tools = manager.createCoderTools(worktree);
    const patch = tools.find((tool) => tool.name === "apply_patch")!;
    const source = await readFile(
      path.join(worktree.root, "src/debug-target.mjs"),
      "utf8",
    );
    await patch.execute("patch-debug-source", {
      operation: "replace",
      path: "src/debug-target.mjs",
      expectedSha256: sha256(source),
      edits: [{ oldText: "calculate(20)", newText: "calculate(22)" }],
    });

    await expect(
      tools
        .find((tool) => tool.name === "node_debugger")!
        .execute("debug", {
          action: "launch",
          path: "src/debug-target.mjs",
          breakpoints: [{ line: 4 }],
          timeoutMs: 2_000,
          sessionTimeoutMs: 20_000,
        }),
    ).rejects.toThrow("changed candidate bytes");
    await expect(
      manager.storePreview(worktree, "c".repeat(64)),
    ).rejects.toThrow("operation integrity is indeterminate");
    expect(await activeSessions(fixture)).toEqual([]);
  }, 20_000);

  it("cancels a paused debugger before rejecting toolchain drift", async () => {
    const fixture = await createFixture(debugSource(20));
    const { manager, worktree } = await createCandidate(fixture);
    const tools = manager.createCoderTools(worktree);
    await tools
      .find((tool) => tool.name === "apply_patch")!
      .execute("patch", {
        operation: "replace",
        path: "src/debug-target.mjs",
        expectedSha256: sha256(debugSource(20)),
        edits: [{ oldText: "calculate(20)", newText: "calculate(23)" }],
      });
    const launched = await tools
      .find((tool) => tool.name === "node_debugger")!
      .execute("debug-launch", {
        action: "launch",
        path: "src/debug-target.mjs",
        breakpoints: [{ line: 2 }],
        timeoutMs: 2_000,
        sessionTimeoutMs: 20_000,
      });
    expect(toolText(launched)).toContain("Stop reason: breakpoint");
    await rm(path.join(fixture.workspaceRoot, "node_modules"), {
      recursive: true,
    });

    await expect(
      manager.storePreview(worktree, "d".repeat(64)),
    ).rejects.toThrow();
    expect(await activeSessions(fixture)).toEqual([]);
    await manager.cleanup(worktree);
  }, 20_000);
});

interface Fixture {
  workspaceRoot: string;
  dataRoot: string;
  store: LocalStore;
  processes: WorkspaceProcessManager;
  sandbox: OsSandboxAdapter;
  threadId: string;
  runId: string;
}

async function createFixture(source: string): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-coder-debugger-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await Promise.all([
    mkdir(path.join(workspaceRoot, "src"), { recursive: true }),
    mkdir(path.join(workspaceRoot, "node_modules"), { recursive: true }),
  ]);
  await writeFile(path.join(workspaceRoot, "src/debug-target.mjs"), source);
  const store = new LocalStore({ workspaceRoot, dataRoot });
  await store.initialize();
  openStores.push(store);
  const sandbox = directSandbox();
  const processes = new WorkspaceProcessManager({
    store,
    workspaceRoot,
    sandbox,
  });
  await processes.initialize();
  openProcesses.push(processes);
  const { thread, run } = await createActiveTestRun(
    store,
    "Subagent worktree debugger fixture",
  );
  return {
    workspaceRoot,
    dataRoot,
    store,
    processes,
    sandbox,
    threadId: thread.id,
    runId: run.id,
  };
}

async function createCandidate(fixture: Fixture) {
  const manager = new SubagentWorktreeMutationManager({
    workspaceRoot: fixture.workspaceRoot,
    dataRoot: fixture.dataRoot,
    ownerId: "worker_debugger_test",
    sandbox: fixture.sandbox,
    processes: fixture.processes,
    debuggerOwner: {
      threadId: fixture.threadId,
      runId: fixture.runId,
    },
    enableCandidateDebugger: true,
    lifecycleDiagnostics: lifecycleDiagnosticsAdapter(),
  });
  const worktree = await manager.createWorktree("task_debugger1", [
    "src/debug-target.mjs",
  ]);
  return { manager, worktree };
}

async function activeSessions(fixture: Fixture) {
  return (await fixture.processes.list(fixture.threadId)).filter(
    (session) => session.status === "running",
  );
}

function debugSource(input: number): string {
  return [
    "function calculate(input) {",
    "  const doubled = input * 2;",
    "  const adjusted = doubled + 1;",
    "  return adjusted;",
    "}",
    `globalThis.RESULT = calculate(${String(input)});`,
  ].join("\n");
}

function toolText(value: unknown): string {
  const result = value as {
    content?: Array<{ type: string; text?: string }>;
  };
  return result.content?.find((item) => item.type === "text")?.text ?? "";
}

function lifecycleDiagnosticsAdapter(): SubagentWorktreeLifecycleDiagnosticsAdapter {
  return {
    async observeBefore(changes) {
      return {
        entries: changes.map((change) => ({ change })),
        omittedFileCount: 0,
      };
    },
    async observeAfter() {
      return { details: diagnosticsDetails(), summary: "Diagnostics: clean" };
    },
    unavailable() {
      return {
        details: { ...diagnosticsDetails(), status: "unavailable" },
        summary: "Diagnostics: unavailable",
      };
    },
  };
}

function diagnosticsDetails(): LspRenameApplyDiagnosticsDetails {
  const base = {
    kind: "napier.lsp-rename-apply-diagnostics" as const,
    schemaVersion: 1 as const,
    status: "clean" as const,
    beforeErrorCount: 0,
    beforeWarningCount: 0,
    beforeDiagnosticsSetSha256: sha256("before"),
    afterErrorCount: 0,
    afterWarningCount: 0,
    afterDiagnosticsSetSha256: sha256("after"),
    addedErrorCount: 0,
    resolvedErrorCount: 0,
    fileCount: 1,
    omittedFileCount: 0,
    truncated: false,
  };
  return { ...base, resultSha256: sha256(JSON.stringify(base)) };
}

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-coder-debugger-test",
    async launch(request) {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: { ...request.env },
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exit,
        async terminate() {
          if (
            child.exitCode === null &&
            child.signalCode === null &&
            child.pid !== undefined
          ) {
            try {
              process.kill(-child.pid, "SIGTERM");
            } catch {
              child.kill("SIGTERM");
            }
          }
          const stopped = await Promise.race([
            exit.then(() => true),
            new Promise<false>((resolve) =>
              setTimeout(() => resolve(false), 500),
            ),
          ]);
          if (!stopped && child.pid !== undefined) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
          }
          await exit;
        },
      };
    },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
