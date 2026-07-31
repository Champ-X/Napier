import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  type LspProtocolSessionRequest,
  RunLspSessionManager,
  type OsSandboxAdapter,
  type SandboxedProcess,
} from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Run-owned persistent LSP Sessions", () => {
  it("performs no workspace I/O until an LSP operation is requested", async () => {
    const sandbox = new ProtocolSandbox();
    const manager = new RunLspSessionManager(
      sandbox,
      path.join(tmpdir(), "napier-lsp-missing-workspace"),
    );
    manager.forRun({
      threadId: "thread_lazy",
      runId: "run_lazy00001",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(sandbox.launchCount).toBe(0);
  });

  it("reuses one server until the workspace changes", async () => {
    const fixture = await createFixture("reuse");
    const sandbox = new ProtocolSandbox();
    const manager = new RunLspSessionManager(sandbox, fixture.workspaceRoot);
    const owner = { threadId: "thread_reuse", runId: "run_reuse0001" };
    const executor = manager.forRun(owner);

    const first = await executor.execute(
      protocolRequest(fixture, "first"),
      echoOperation("first"),
    );
    const second = await executor.execute(
      protocolRequest(fixture, "second"),
      echoOperation("second"),
    );
    expect(first.value).toEqual({ value: "first" });
    expect(second.value).toEqual({ value: "second" });
    expect(sandbox.launchCount).toBe(1);
    expect(first).toEqual(
      expect.objectContaining({
        sessionMode: "run_persistent",
        sessionReused: false,
        sessionOperation: 1,
      }),
    );
    expect(second).toEqual(
      expect.objectContaining({
        sessionMode: "run_persistent",
        sessionReused: true,
        sessionOperation: 2,
        sessionIdSha256: first.sessionIdSha256,
      }),
    );

    await writeFile(fixture.target, "export const value = 2;\n");
    const replacement = await executor.execute(
      protocolRequest(fixture, "replacement", "export const value = 2;\n"),
      echoOperation("replacement"),
    );
    expect(sandbox.launchCount).toBe(2);
    expect(replacement).toEqual(
      expect.objectContaining({
        sessionReused: false,
        sessionOperation: 1,
      }),
    );
    expect(replacement.sessionIdSha256).not.toBe(first.sessionIdSha256);

    await manager.cancelRun(owner);
    expect(sandbox.activeCount).toBe(0);
  });

  it("serializes one Run while isolating concurrent Runs", async () => {
    const fixture = await createFixture("isolation");
    const sandbox = new ProtocolSandbox();
    const manager = new RunLspSessionManager(sandbox, fixture.workspaceRoot);
    const leftOwner = {
      threadId: "thread_left",
      runId: "run_left0001",
    };
    const rightOwner = {
      threadId: "thread_right",
      runId: "run_right001",
    };
    const left = manager.forRun(leftOwner);
    const right = manager.forRun(rightOwner);
    const [leftFirst, leftSecond, rightFirst] = await Promise.all([
      left.execute(
        protocolRequest(fixture, "left-first"),
        echoOperation("left-first"),
      ),
      left.execute(
        protocolRequest(fixture, "left-second"),
        echoOperation("left-second"),
      ),
      right.execute(
        protocolRequest(fixture, "right-first"),
        echoOperation("right-first"),
      ),
    ]);

    expect(sandbox.launchCount).toBe(2);
    expect(leftFirst.sessionOperation).toBe(1);
    expect(leftSecond.sessionOperation).toBe(2);
    expect(leftSecond.sessionIdSha256).toBe(leftFirst.sessionIdSha256);
    expect(rightFirst.sessionIdSha256).not.toBe(leftFirst.sessionIdSha256);

    await Promise.all([
      manager.cancelRun(leftOwner),
      manager.cancelRun(rightOwner),
    ]);
    expect(sandbox.activeCount).toBe(0);
  });

  it("replaces an idle server that exits unexpectedly", async () => {
    const fixture = await createFixture("idle-exit");
    const sandbox = new ProtocolSandbox();
    const manager = new RunLspSessionManager(sandbox, fixture.workspaceRoot);
    const owner = { threadId: "thread_exit", runId: "run_exit00001" };
    const executor = manager.forRun(owner);
    const first = await executor.execute(
      protocolRequest(fixture, "before-exit"),
      echoOperation("before-exit"),
    );
    sandbox.crash();
    await new Promise<void>((resolve) => setImmediate(resolve));

    const replacement = await executor.execute(
      protocolRequest(fixture, "after-exit"),
      echoOperation("after-exit"),
    );
    expect(sandbox.launchCount).toBe(2);
    expect(replacement.sessionReused).toBe(false);
    expect(replacement.sessionIdSha256).not.toBe(first.sessionIdSha256);
    await manager.cancelRun(owner);
    expect(sandbox.activeCount).toBe(0);
  });

  it("cancels a queued operation without breaking Run serialization", async () => {
    const fixture = await createFixture("queued-cancel");
    const sandbox = new ProtocolSandbox();
    const manager = new RunLspSessionManager(sandbox, fixture.workspaceRoot);
    const owner = { threadId: "thread_queue", runId: "run_queue0001" };
    const executor = manager.forRun(owner);
    const active = executor.execute(
      protocolRequest(fixture, "active"),
      waitOperation(),
    );
    await sandbox.waitStarted;
    const controller = new AbortController();
    const queued = executor.execute(
      protocolRequest(fixture, "queued"),
      echoOperation("queued"),
      controller.signal,
    );
    controller.abort();
    await expect(queued).rejects.toThrow("LSP queued was aborted");

    sandbox.releaseWait({ value: "active" });
    await expect(active).resolves.toEqual(
      expect.objectContaining({ value: { value: "active" } }),
    );
    const next = await executor.execute(
      protocolRequest(fixture, "next"),
      echoOperation("next"),
    );
    expect(next.sessionOperation).toBe(2);
    expect(next.sessionReused).toBe(true);
    expect(sandbox.launchCount).toBe(1);
    await manager.cancelRun(owner);
  });

  it("enforces the global active Session bound", async () => {
    const fixture = await createFixture("active-bound");
    const sandbox = new ProtocolSandbox();
    const manager = new RunLspSessionManager(sandbox, fixture.workspaceRoot);
    const owners = Array.from({ length: 5 }, (_, index) => ({
      threadId: `thread_bound_${index}`,
      runId: `run_bound_000${index}`,
    }));
    for (const [index, owner] of owners.slice(0, 4).entries()) {
      await manager
        .forRun(owner)
        .execute(
          protocolRequest(fixture, `bound-${index}`),
          echoOperation(`bound-${index}`),
        );
    }
    await expect(
      manager
        .forRun(owners[4]!)
        .execute(
          protocolRequest(fixture, "bound-rejected"),
          echoOperation("bound-rejected"),
        ),
    ).rejects.toThrow("LSP active Session limit reached");
    expect(sandbox.launchCount).toBe(4);

    await manager.cancelRun(owners[0]!);
    await expect(
      manager
        .forRun(owners[4]!)
        .execute(
          protocolRequest(fixture, "bound-admitted"),
          echoOperation("bound-admitted"),
        ),
    ).resolves.toEqual(expect.objectContaining({ sessionReused: false }));
    expect(sandbox.launchCount).toBe(5);
    await Promise.all(owners.slice(1).map((owner) => manager.cancelRun(owner)));
    expect(sandbox.activeCount).toBe(0);
  });

  it("invalidates an operation when the workspace drifts in flight", async () => {
    const fixture = await createFixture("drift");
    const sandbox = new ProtocolSandbox();
    const manager = new RunLspSessionManager(sandbox, fixture.workspaceRoot);
    const owner = { threadId: "thread_drift", runId: "run_drift0001" };
    const pending = manager
      .forRun(owner)
      .execute(protocolRequest(fixture, "drift"), waitOperation());
    await sandbox.waitStarted;
    await writeFile(fixture.target, "export const value = 3;\n");
    sandbox.releaseWait({ value: "stale" });

    await expect(pending).rejects.toThrow(
      "LSP drift workspace changed during execution",
    );
    await expect(pending).rejects.not.toThrow(fixture.workspaceRoot);
    expect(sandbox.activeCount).toBe(0);
  });

  it("terminates uncertain state on cancellation and timeout", async () => {
    const fixture = await createFixture("termination");
    const cancelledSandbox = new ProtocolSandbox();
    const cancelledManager = new RunLspSessionManager(
      cancelledSandbox,
      fixture.workspaceRoot,
    );
    const cancelledOwner = {
      threadId: "thread_cancel",
      runId: "run_cancel001",
    };
    const controller = new AbortController();
    const cancelled = cancelledManager
      .forRun(cancelledOwner)
      .execute(
        protocolRequest(fixture, "cancelled"),
        waitOperation(),
        controller.signal,
      );
    await cancelledSandbox.waitStarted;
    controller.abort();
    await expect(cancelled).rejects.toThrow("LSP cancelled was aborted");
    expect(cancelledSandbox.activeCount).toBe(0);

    const recovered = await cancelledManager
      .forRun(cancelledOwner)
      .execute(
        protocolRequest(fixture, "recovered"),
        echoOperation("recovered"),
      );
    expect(recovered.sessionReused).toBe(false);
    expect(cancelledSandbox.launchCount).toBe(2);
    await cancelledManager.cancelRun(cancelledOwner);

    const timedOutSandbox = new ProtocolSandbox();
    const timedOutManager = new RunLspSessionManager(
      timedOutSandbox,
      fixture.workspaceRoot,
    );
    const timedOutOwner = {
      threadId: "thread_timeout",
      runId: "run_timeout01",
    };
    const timedOut = timedOutManager
      .forRun(timedOutOwner)
      .execute(
        protocolRequest(fixture, "timeout", undefined, 50),
        waitOperation(),
      );
    await timedOutSandbox.waitStarted;
    await expect(timedOut).rejects.toThrow("LSP timeout timed out");
    expect(timedOutSandbox.activeCount).toBe(0);
  });
});

class ProtocolSandbox implements OsSandboxAdapter {
  readonly id = "persistent-lsp-test";
  launchCount = 0;
  activeCount = 0;
  readonly waitStarted: Promise<void>;

  private startWait!: () => void;
  private settleWait: ((value: unknown) => void) | undefined;
  private crashCurrent: (() => void) | undefined;

  constructor() {
    this.waitStarted = new Promise<void>((resolve) => {
      this.startWait = resolve;
    });
  }

  releaseWait(value: unknown): void {
    this.settleWait?.(value);
  }

  crash(): void {
    this.crashCurrent?.();
  }

  async launch(): Promise<SandboxedProcess> {
    this.launchCount += 1;
    this.activeCount += 1;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let settled = false;
    let settleExit!: (value: {
      code: number | null;
      signal: NodeJS.Signals | null;
    }) => void;
    const exit = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      settleExit = resolve;
    });
    const settle = (
      code: number | null,
      signal: NodeJS.Signals | null = null,
    ): void => {
      if (settled) return;
      settled = true;
      this.activeCount -= 1;
      stdout.end();
      stderr.end();
      settleExit({ code, signal });
    };
    const connection = createMessageConnection(
      new StreamMessageReader(stdin),
      new StreamMessageWriter(stdout),
    );
    connection.onRequest("initialize", () => ({ capabilities: {} }));
    connection.onNotification("textDocument/didOpen", (params: unknown) => {
      const document =
        record(params) && record(params["textDocument"])
          ? params["textDocument"]
          : {};
      void connection.sendNotification("textDocument/publishDiagnostics", {
        uri: typeof document["uri"] === "string" ? document["uri"] : "",
        diagnostics: [],
      });
    });
    connection.onRequest("test/echo", (params: unknown) => params);
    connection.onRequest("test/wait", () => {
      this.startWait();
      return new Promise<unknown>((resolve) => {
        this.settleWait = resolve;
      });
    });
    connection.onRequest("shutdown", () => null);
    connection.onNotification("exit", () => {
      connection.dispose();
      settle(0);
    });
    connection.listen();
    this.crashCurrent = () => {
      connection.dispose();
      settle(1);
    };
    return {
      stdin,
      stdout,
      stderr,
      exit,
      terminate: async () => {
        connection.dispose();
        settle(null, "SIGTERM");
      },
    };
  }
}

function echoOperation(value: string) {
  return (connection: {
      sendRequest(method: string, params: unknown): Promise<unknown>;
    }) =>
    () =>
      connection.sendRequest("test/echo", { value });
}

function waitOperation() {
  return (connection: {
      sendRequest(method: string, params?: unknown): Promise<unknown>;
    }) =>
    () =>
      connection.sendRequest("test/wait");
}

function protocolRequest(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  label: string,
  source = "export const value = 1;\n",
  timeoutMs = 1_000,
): LspProtocolSessionRequest {
  return {
    label: `LSP ${label}`,
    abortedMessage: `LSP ${label} was aborted`,
    workspaceRoot: fixture.workspaceRoot,
    target: fixture.target,
    language: "typescript",
    source,
    timeoutMs,
    typescriptServerPath: "/runtime/typescript/tsserver.js",
    nodeExecutable: "/runtime/node",
    languageServerPath: "/runtime/lsp/cli.mjs",
    languageServerRoot: "/runtime/lsp",
    typescriptRoot: "/runtime/typescript",
    runtimeIdentitySha256: "a".repeat(64),
  };
}

async function createFixture(label: string) {
  const root = await mkdtemp(path.join(tmpdir(), `napier-lsp-${label}-`));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const target = path.join(workspaceRoot, "source.ts");
  await mkdir(workspaceRoot);
  await writeFile(target, "export const value = 1;\n");
  return {
    workspaceRoot: await realpath(workspaceRoot),
    target: await realpath(target),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
