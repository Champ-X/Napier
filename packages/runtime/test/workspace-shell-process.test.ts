import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LocalStore,
  WorkspaceProcessManager,
  projectWorkspaceProcessSessions,
} from "../src/index.js";
import { HostDirectSandboxAdapter } from "../src/sandbox-host-direct.js";
import { workspaceProcessToolResult } from "../src/workspace-process-tool-result.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Workspace shell Process Session", () => {
  it("runs a real child command through the production PTY and durable projection", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-shell-process-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "data");
    await mkdir(workspaceRoot);
    const store = new LocalStore({ workspaceRoot, dataRoot });
    await store.initialize();
    const manager = new WorkspaceProcessManager({
      store,
      workspaceRoot,
      dataRoot,
      sandbox: new HostDirectSandboxAdapter(),
    });
    await manager.initialize();
    try {
      const thread = store.listThreads()[0]!;
      const run = store.listRuns(thread.id)[0]!;
      const session = await manager.start({
        threadId: thread.id,
        runId: run.id,
        command: {
          runtime: "shell",
          args: ["node -e 'process.stdout.write(\"shell-session-ok\")'"],
          timeoutMs: 5_000,
        },
        terminal: { columns: 80, rows: 24 },
      });
      expect(session).toEqual(
        expect.objectContaining({
          runtime: "shell",
          status: "running",
          ioMode: "pty",
          stdinMode: "interactive",
        }),
      );
      const settled = await manager.waitForSettlement(thread.id, session.id);
      expect(settled).toEqual(
        expect.objectContaining({ runtime: "shell", status: "succeeded" }),
      );
      const output = await manager.output(thread.id, session.id);
      expect(output.chunks.map((chunk) => chunk.text).join("")).toBe(
        "shell-session-ok",
      );
      const toolResult = workspaceProcessToolResult(
        "poll",
        settled,
        output.chunks,
      );
      expect(toolResult.details).toEqual(
        expect.objectContaining({
          sandbox: "host-direct",
          isolation: "none",
          networkAccess: "denied",
        }),
      );
      expect(toolResult.content[0]?.text).toContain("Sandbox: host-direct");
      expect(toolResult.content[0]?.text).toContain(
        "host-direct does not enforce workspace, network, or resource boundaries",
      );
      expect(
        projectWorkspaceProcessSessions(await store.listEvents(thread.id)),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: session.id, runtime: "shell" }),
        ]),
      );
    } finally {
      await manager.shutdown();
    }
  });
});
