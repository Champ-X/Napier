import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createLocalAgentRuntime,
  exportThreadReplayBundle,
  UnsupportedSandboxAdapter,
  verifyThreadReplayBundle,
} from "@napier/runtime";
import { spawn as spawnTerminal } from "node-pty";
import { afterEach, expect, it, vi } from "vitest";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

const builtTerminalTest = process.platform === "win32" ? it.skip : it;

builtTerminalTest(
  "runs two durable turns and one cancellation through the built TUI PTY",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-tui-pty-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);

    const entrypoint = path.resolve(import.meta.dirname, "../dist/index.js");
    let output = "";
    let exited = false;
    const terminal = spawnTerminal(
      process.execPath,
      [
        entrypoint,
        "tui",
        "--workspace",
        workspaceRoot,
        "--data-root",
        dataRoot,
        "--model",
        "napier/demo",
        "--title",
        "Built TUI PTY thread",
      ],
      {
        name: "xterm-256color",
        cols: 100,
        rows: 30,
        cwd: root,
        env: terminalEnvironment(),
      },
    );
    const dataSubscription = terminal.onData((data) => {
      output += data;
    });
    const exit = new Promise<number>((resolve) => {
      terminal.onExit(({ exitCode }) => {
        exited = true;
        resolve(exitCode);
      });
    });

    try {
      await waitForLastFrame(outputText, "Ready; type a prompt", 5_000);
      terminal.write("First built TUI turn.\r");
      await waitForStatusCount(outputText, "completed", 1);

      terminal.resize(120, 35);
      terminal.write("Second built TUI turn.\r");
      await waitForStatusCount(outputText, "completed", 2);

      terminal.write("Cancel the third built TUI turn.\r");
      await vi.waitFor(
        () => {
          const frame = lastFrame(output);
          expect(frame).toContain("Cancel the third built TUI turn.");
          expect(frame).toContain("napier…:");
        },
        { timeout: 10_000 },
      );
      terminal.write("\u0003");
      await waitForStatusCount(outputText, "cancelled", 1);

      terminal.write("/status\r");
      await waitForLastFrame(outputText, "Last Run:", 5_000);
      terminal.write("/exit\r");
      expect(await exit).toBe(0);
    } finally {
      dataSubscription.dispose();
      if (!exited) terminal.kill();
    }

    expect(output).toContain("\u001b[?1049h");
    expect(output).toContain("\u001b[?2004h");
    expect(output).toContain("\u001b[?2004l");
    expect(output).toContain("\u001b[?1049l");
    expect(output).not.toContain("requires interactive stdin/stdout TTYs");

    const reopened = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      sandbox: new UnsupportedSandboxAdapter("tui-pty-inspect"),
    });
    const thread = reopened.store
      .listThreads()
      .find((candidate) => candidate.title === "Built TUI PTY thread");
    expect(thread).toBeDefined();
    expect(
      reopened.store
        .listRuns(thread!.id)
        .map((run) => run.status)
        .sort(),
    ).toEqual(["cancelled", "completed", "completed"]);
    const replay = await exportThreadReplayBundle(reopened.store, thread!.id);
    expect(verifyThreadReplayBundle(replay).status).toBe("valid");
    await reopened.shutdown();

    function outputText(): string {
      return output;
    }
  },
  30_000,
);

async function waitForLastFrame(
  output: () => string,
  value: string,
  timeout: number,
): Promise<void> {
  await vi.waitFor(() => expect(lastFrame(output())).toContain(value), {
    timeout,
  });
}

async function waitForStatusCount(
  output: () => string,
  status: "completed" | "cancelled",
  expected: number,
): Promise<void> {
  await vi.waitFor(
    () => {
      expect(runIdsWithStatus(output(), status).size).toBe(expected);
    },
    { timeout: 10_000 },
  );
}

function runIdsWithStatus(output: string, status: string): Set<string> {
  return new Set(
    [
      ...output.matchAll(new RegExp(`Run (run_[a-z0-9_-]+) ${status}`, "gu")),
    ].map((match) => match[1]!),
  );
}

function lastFrame(output: string): string {
  return output.split("\u001b[H\u001b[2J").at(-1) ?? "";
}

function terminalEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}
