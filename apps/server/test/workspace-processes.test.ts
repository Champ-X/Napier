import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import type {
  ThreadDetail,
  WorkspaceProcessDelta,
  WorkspaceProcessInputReceipt,
  WorkspaceProcessOutput,
  WorkspaceProcessSession,
} from "@napier/contracts";
import type { OsSandboxAdapter, SandboxedProcess } from "@napier/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp, createServices } from "../src/app.js";

const temporaryRoots: string[] = [];
const openServices: Awaited<ReturnType<typeof createServices>>[] = [];

afterEach(async () => {
  for (const services of openServices.splice(0)) {
    await services.workspaceProcesses.shutdown();
    await services.recovery.stop();
    await services.automation.stop();
    await services.channels.stop();
    await services.extensions.shutdown();
    services.store.close();
  }
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Workspace Process HTTP API", () => {
  it("lists, streams, scopes, and cancels a Process Session", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-process-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const controlled = createControlledSandbox();
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot,
      sandbox: controlled.sandbox,
    });
    openServices.push(services);
    const app = createApp(services);
    const agent = services.store.listAgents()[0]!;
    const thread = await services.store.createThread({
      title: "Process API",
      agentId: agent.id,
    });
    const run = await services.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const session = await services.workspaceProcesses.start({
      threadId: thread.id,
      runId: run.id,
      command: {
        runtime: "node",
        args: ["-e", "process.stdout.write('HTTP_SECRET_OUTPUT')"],
      },
      interactive: true,
    });
    const stdin: string[] = [];
    controlled.stdin.setEncoding("utf8");
    controlled.stdin.on("data", (chunk: string) => stdin.push(chunk));
    controlled.stdout.write("HTTP_SECRET_OUTPUT");
    await vi.waitFor(async () => {
      const current = await services.workspaceProcesses.output(
        thread.id,
        session.id,
      );
      expect(current.chunks).toHaveLength(1);
    });

    const listResponse = await app.request(
      `/api/threads/${thread.id}/processes`,
    );
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()) as WorkspaceProcessSession[]).toEqual([
      expect.objectContaining({
        id: session.id,
        status: "running",
        outputAvailable: true,
      }),
    ]);

    const outputResponse = await app.request(
      `/api/threads/${thread.id}/processes/${session.id}/output?after=0`,
    );
    expect(outputResponse.status).toBe(200);
    const output = (await outputResponse.json()) as WorkspaceProcessOutput;
    expect(output.chunks).toEqual([
      {
        cursor: 1,
        stream: "stdout",
        text: "HTTP_SECRET_OUTPUT",
      },
    ]);

    const inputResponse = await app.request(
      `/api/threads/${thread.id}/processes/${session.id}/input`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "HTTP_SECRET_INPUT",
          appendNewline: true,
        }),
      },
    );
    expect(inputResponse.status).toBe(200);
    expect(
      (await inputResponse.json()) as WorkspaceProcessInputReceipt,
    ).toEqual(
      expect.objectContaining({
        processId: session.id,
        initiatedBy: "operator",
        sequence: 1,
        stdinClosed: false,
      }),
    );
    expect(stdin.join("")).toBe("HTTP_SECRET_INPUT\n");
    const invalidInputResponse = await app.request(
      `/api/threads/${thread.id}/processes/${session.id}/input`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "", unknown: true }),
      },
    );
    expect(invalidInputResponse.status).toBe(400);
    const newlineInputResponse = await app.request(
      `/api/threads/${thread.id}/processes/${session.id}/input`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "", appendNewline: true }),
      },
    );
    expect(newlineInputResponse.status).toBe(200);
    expect(stdin.join("")).toBe("HTTP_SECRET_INPUT\n\n");

    const invalidResponse = await app.request(
      `/api/threads/${thread.id}/processes/${session.id}/output?after=-1`,
    );
    expect(invalidResponse.status).toBe(400);

    const otherThread = await services.store.createThread({
      title: "Other",
      agentId: agent.id,
    });
    const deniedResponse = await app.request(
      `/api/threads/${otherThread.id}/processes/${session.id}/output`,
    );
    expect(deniedResponse.status).toBe(404);
    const deniedDeltaResponse = await app.request(
      `/api/threads/${otherThread.id}/processes/${session.id}/delta`,
    );
    expect(deniedDeltaResponse.status).toBe(404);
    const deniedInputResponse = await app.request(
      `/api/threads/${otherThread.id}/processes/${session.id}/input`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "foreign" }),
      },
    );
    expect(deniedInputResponse.status).toBe(404);

    await writeFile(path.join(workspaceRoot, "http-drift.txt"), "drift");
    const cancelResponse = await app.request(
      `/api/threads/${thread.id}/processes/${session.id}/cancel`,
      { method: "POST" },
    );
    expect(cancelResponse.status).toBe(200);
    expect((await cancelResponse.json()) as WorkspaceProcessSession).toEqual(
      expect.objectContaining({
        id: session.id,
        status: "cancelled",
      }),
    );
    expect(controlled.terminate).toHaveBeenCalledOnce();

    const deltaResponse = await app.request(
      `/api/threads/${thread.id}/processes/${session.id}/delta`,
    );
    expect(deltaResponse.status).toBe(200);
    expect((await deltaResponse.json()) as WorkspaceProcessDelta).toEqual(
      expect.objectContaining({
        processId: session.id,
        status: "changed",
        available: true,
        entriesTruncated: false,
        entries: [
          expect.objectContaining({
            kind: "added",
            path: "http-drift.txt",
          }),
        ],
      }),
    );

    const detailResponse = await app.request(`/api/threads/${thread.id}`);
    const detail = (await detailResponse.json()) as ThreadDetail;
    expect(JSON.stringify(detail.events)).not.toContain("HTTP_SECRET_OUTPUT");
    expect(JSON.stringify(detail.events)).not.toContain("HTTP_SECRET_INPUT");
    expect(JSON.stringify(detail.events)).not.toContain("http-drift.txt");
  });
});

function createControlledSandbox() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let settled = false;
  let resolveExit:
    | ((value: { code: number | null; signal: NodeJS.Signals | null }) => void)
    | undefined;
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    resolveExit = resolve;
  });
  const settle = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (settled) return;
    settled = true;
    stdout.end();
    stderr.end();
    resolveExit?.({ code, signal });
  };
  const terminate = vi.fn(async () => settle(null, "SIGTERM"));
  const sandbox: OsSandboxAdapter = {
    id: "server-process-sandbox",
    async launch() {
      return {
        stdin,
        stdout,
        stderr,
        exit,
        terminate,
      } satisfies SandboxedProcess;
    },
  };
  return { sandbox, stdin, stdout, terminate };
}
