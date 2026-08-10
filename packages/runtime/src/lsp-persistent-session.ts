import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  initializeLspConnection,
  type LspProtocolExecutor,
  type LspProtocolSessionRequest,
  type LspProtocolSessionResult,
  MAX_LSP_PROTOCOL_BYTES,
  MAX_LSP_STDERR_CHARS,
  type PrepareLspProtocolOperation,
  registerLspClientHandlers,
  syncLspDocument,
} from "./lsp-protocol-session.js";
import type { OsSandboxAdapter, SandboxedProcess } from "./sandbox.js";
import { LSP_FIXED_ENVIRONMENT } from "./lsp-source-session.js";
import {
  createWorkspacePathSnapshot,
  type WorkspacePathSnapshot,
} from "./workspace-snapshot.js";

export const MAX_ACTIVE_LSP_SESSIONS = 4;
export const MAX_LSP_SESSION_OPERATIONS = 32;
export const MAX_LSP_SESSION_PROTOCOL_BYTES = 8 * 1024 * 1024;
export const MAX_LSP_SESSION_STDERR_CHARS = 64 * 1024;
export const MAX_LSP_SESSION_WORKSPACE_FILES = 10_000;
export const MAX_LSP_SESSION_WORKSPACE_BYTES = 64 * 1024 * 1024;

const LSP_SESSION_SHUTDOWN_GRACE_MS = 1_000;
const LSP_SESSION_LIMITS_SHA256 = sha256(
  canonicalJson({
    maxActiveSessions: MAX_ACTIVE_LSP_SESSIONS,
    maxOperations: MAX_LSP_SESSION_OPERATIONS,
    maxOperationProtocolBytes: MAX_LSP_PROTOCOL_BYTES,
    maxSessionProtocolBytes: MAX_LSP_SESSION_PROTOCOL_BYTES,
    maxOperationStderrChars: MAX_LSP_STDERR_CHARS,
    maxSessionStderrChars: MAX_LSP_SESSION_STDERR_CHARS,
    maxWorkspaceFiles: MAX_LSP_SESSION_WORKSPACE_FILES,
    maxWorkspaceBytes: MAX_LSP_SESSION_WORKSPACE_BYTES,
    workspaceFreshness: "bounded_before_after_sha256",
    workspaceExcludedSegments: [".git", ".napier", "node_modules"],
    serialized: true,
    processGroupTermination: true,
  }),
);
export interface LspSessionOwner {
  threadId: string;
  runId: string;
}
interface RunSession {
  protocol: PersistentLspProtocolSession;
  runtimeIdentitySha256: string;
  workspaceSha256: string;
}

export class RunLspSessionManager {
  private readonly sessions = new Map<string, RunSession>();
  private readonly tails = new Map<string, Promise<void>>();

  constructor(
    private readonly sandbox: OsSandboxAdapter,
    private readonly workspaceRoot: string,
  ) {}

  forRun(owner: LspSessionOwner): LspProtocolExecutor {
    const key = ownerKey(owner);
    return {
      execute: <T>(
        request: LspProtocolSessionRequest,
        prepareOperation: PrepareLspProtocolOperation<T>,
        signal?: AbortSignal,
      ) =>
        this.serialized(
          key,
          () => this.execute(key, request, prepareOperation, signal),
          signal,
          request.abortedMessage,
        ),
    };
  }

  async cancelRun(owner: LspSessionOwner): Promise<void> {
    const key = ownerKey(owner);
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);
    session.protocol.cancel("LSP session was cancelled with its Run");
    await session.protocol.close();
  }

  private async execute<T>(
    key: string,
    request: LspProtocolSessionRequest,
    prepareOperation: PrepareLspProtocolOperation<T>,
    signal?: AbortSignal,
  ): Promise<LspProtocolSessionResult<T>> {
    assertPersistentRequest(request, await realpath(this.workspaceRoot));
    if (signal?.aborted) throw new Error(request.abortedMessage);
    const before = await workspaceSnapshot(request.workspaceRoot);
    let managed = this.sessions.get(key);
    let reused = false;
    if (
      managed &&
      (!managed.protocol.reusable ||
        before.truncated ||
        managed.workspaceSha256 !== before.sha256 ||
        managed.runtimeIdentitySha256 !== request.runtimeIdentitySha256 ||
        managed.protocol.operationCount >= MAX_LSP_SESSION_OPERATIONS)
    ) {
      this.sessions.delete(key);
      await managed.protocol.close();
      managed = undefined;
    }
    if (!managed) {
      await this.pruneUnavailableSessions();
      if (this.sessions.size >= MAX_ACTIVE_LSP_SESSIONS) {
        throw new Error("LSP active Session limit reached");
      }
      const protocol = await PersistentLspProtocolSession.start(
        this.sandbox,
        request,
      );
      managed = {
        protocol,
        runtimeIdentitySha256: request.runtimeIdentitySha256!,
        workspaceSha256: before.sha256,
      };
      this.sessions.set(key, managed);
    } else {
      reused = true;
    }

    try {
      const result = await managed.protocol.execute(
        request,
        prepareOperation,
        signal,
      );
      const after = await workspaceSnapshot(request.workspaceRoot);
      const workspaceStable =
        !before.truncated && !after.truncated && before.sha256 === after.sha256;
      if (!workspaceStable) {
        this.sessions.delete(key);
        await managed.protocol.close();
        if (
          !before.truncated &&
          !after.truncated &&
          before.sha256 !== after.sha256
        ) {
          throw new Error(
            `${request.label} workspace changed during execution`,
          );
        }
      }
      return {
        ...result,
        sessionMode: "run_persistent",
        sessionReused: reused,
        sessionOperation: managed.protocol.operationCount,
        sessionIdSha256: managed.protocol.idSha256,
        sessionWorkspaceSha256: before.sha256,
        sessionLimitsSha256: LSP_SESSION_LIMITS_SHA256,
      };
    } catch (error) {
      if (this.sessions.get(key)?.protocol === managed.protocol) {
        this.sessions.delete(key);
      }
      await managed.protocol.close();
      throw error;
    }
  }

  private async serialized<T>(
    key: string,
    operation: () => Promise<T>,
    signal: AbortSignal | undefined,
    abortedMessage: string,
  ): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.tails.set(key, tail);
    void tail.finally(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    try {
      await waitForTurn(previous, signal, abortedMessage);
      return await operation();
    } finally {
      release();
    }
  }

  private async pruneUnavailableSessions(): Promise<void> {
    const unavailable = [...this.sessions.entries()].filter(
      ([, session]) => !session.protocol.healthy,
    );
    for (const [key] of unavailable) this.sessions.delete(key);
    await Promise.allSettled(
      unavailable.map(([, session]) => session.protocol.close()),
    );
  }
}

class PersistentLspProtocolSession {
  readonly idSha256 = sha256(`lsp-session:${crypto.randomUUID()}`);
  operationCount = 0;

  private readonly connection: MessageConnection;
  private readonly documentVersions = new Map<string, number>();
  private readonly failure: Promise<never>;
  private failSession: ((error: Error) => void) | undefined;
  private protocolBytes = 0;
  private stderr = "";
  private initialized = false;
  private active = false;
  private closing = false;
  private closed = false;
  private failed = false;
  private currentLabel = "LSP session";
  private operationProtocolStart = 0;
  private operationStderrStart = 0;
  private closingPromise: Promise<void> | undefined;

  get reusable(): boolean {
    return this.healthy && !this.active;
  }

  get healthy(): boolean {
    return !this.failed && !this.closed && !this.closing;
  }

  private constructor(private readonly child: SandboxedProcess) {
    this.failure = new Promise<never>((_, reject) => {
      this.failSession = reject;
    });
    void this.failure.catch(() => undefined);
    this.connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    this.connection.onError(() =>
      this.fail(`${this.currentLabel} protocol failed`),
    );
    this.connection.onClose(() => {
      if (!this.closing) {
        this.fail(`${this.currentLabel} server closed unexpectedly`);
      }
    });
    child.stdout.on("data", this.onStdoutData);
    child.stderr.on("data", this.onStderrData);
    void child.exit.then((exit) => {
      if (this.closing) return;
      this.fail(
        exit.code === 0
          ? `${this.currentLabel} server exited unexpectedly`
          : `${this.currentLabel} server failed`,
      );
    });
  }

  static async start(
    sandbox: OsSandboxAdapter,
    request: LspProtocolSessionRequest,
  ): Promise<PersistentLspProtocolSession> {
    const child = await sandbox.launch({
      command: request.nodeExecutable!,
      args: [request.languageServerPath!, "--stdio", "--log-level", "1"],
      cwd: request.workspaceRoot,
      env: { ...LSP_FIXED_ENVIRONMENT },
      workspaceRoot: request.workspaceRoot,
      approvedCapabilities: ["process.spawn", "workspace.read"],
      stdinMode: "open",
      ...(request.runtimeLocation === "provider"
        ? {}
        : {
            runtimeReadPaths: [
              request.languageServerRoot!,
              request.typescriptRoot!,
            ],
          }),
    });
    const session = new PersistentLspProtocolSession(child);
    registerLspClientHandlers(session.connection, request.workspaceRoot);
    session.connection.listen();
    return session;
  }

  async execute<T>(
    request: LspProtocolSessionRequest,
    prepareOperation: PrepareLspProtocolOperation<T>,
    signal?: AbortSignal,
  ): Promise<LspProtocolSessionResult<T>> {
    if (this.closed || this.failed) {
      throw new Error(`${request.label} Session is unavailable`);
    }
    if (this.active) {
      throw new Error(`${request.label} Session is already executing`);
    }
    this.active = true;
    this.operationCount += 1;
    this.currentLabel = request.label;
    this.operationProtocolStart = this.protocolBytes;
    this.operationStderrStart = this.stderr.length;
    const abort = (): void => this.fail(request.abortedMessage);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(
      () => this.fail(`${request.label} timed out`),
      request.timeoutMs,
    );
    try {
      if (!this.initialized) {
        await raceFailure(
          initializeLspConnection(this.connection, request),
          this.failure,
        );
        this.initialized = true;
      }
      const targetUri = pathToFileURL(request.target).href;
      const collect = prepareOperation(this.connection, targetUri);
      const previousVersion = this.documentVersions.get(targetUri);
      const version = await raceFailure(
        syncLspDocument(this.connection, request, previousVersion),
        this.failure,
      );
      this.documentVersions.set(targetUri, version);
      const value = await raceFailure(collect(), this.failure);
      return {
        value,
        protocolBytes: this.protocolBytes - this.operationProtocolStart,
        stderr: this.stderr.slice(this.operationStderrStart),
        stderrTruncated: false,
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      this.active = false;
      this.currentLabel = "LSP session";
    }
  }

  cancel(message: string): void {
    this.fail(message);
  }

  close(): Promise<void> {
    if (!this.closingPromise) this.closingPromise = this.closeSession();
    return this.closingPromise;
  }

  private readonly onStdoutData = (chunk: Buffer | string): void => {
    this.protocolBytes += Buffer.byteLength(chunk);
    if (
      this.protocolBytes > MAX_LSP_SESSION_PROTOCOL_BYTES ||
      (this.active &&
        this.protocolBytes - this.operationProtocolStart >
          MAX_LSP_PROTOCOL_BYTES)
    ) {
      this.fail(`${this.currentLabel} exceeded its protocol output limit`);
    }
  };

  private readonly onStderrData = (chunk: Buffer | string): void => {
    const text = chunk.toString();
    const remaining = MAX_LSP_SESSION_STDERR_CHARS - this.stderr.length;
    this.stderr += text.slice(0, Math.max(0, remaining));
    if (
      text.length > remaining ||
      (this.active &&
        this.stderr.length - this.operationStderrStart > MAX_LSP_STDERR_CHARS)
    ) {
      this.fail(`${this.currentLabel} exceeded its stderr limit`);
    }
  };

  private fail(message: string): void {
    if (this.failed || this.closed) return;
    this.failed = true;
    this.failSession?.(new Error(message));
    void this.child.terminate().catch(() => undefined);
  }

  private async closeSession(): Promise<void> {
    if (this.closed) return;
    this.closing = true;
    try {
      if (this.initialized && !this.failed) {
        await Promise.race([
          this.connection.sendRequest("shutdown"),
          wait(LSP_SESSION_SHUTDOWN_GRACE_MS),
        ]);
        await this.connection.sendNotification("exit");
        await Promise.race([
          this.child.exit,
          wait(LSP_SESSION_SHUTDOWN_GRACE_MS),
        ]);
      }
    } catch {
      // Termination below is authoritative.
    } finally {
      this.closed = true;
      this.connection.dispose();
      this.child.stdout.off("data", this.onStdoutData);
      this.child.stderr.off("data", this.onStderrData);
      await this.child.terminate().catch(() => undefined);
    }
  }
}

function assertPersistentRequest(
  request: LspProtocolSessionRequest,
  workspaceRoot: string,
): void {
  if (request.workspaceRoot !== workspaceRoot) {
    throw new Error(
      `${request.label} persistent Session workspace binding is invalid`,
    );
  }
  if (!request.nodeExecutable || !request.languageServerPath) {
    throw new Error(
      `${request.label} persistent Session executable binding is invalid`,
    );
  }
  if (!request.languageServerRoot || !request.typescriptRoot) {
    throw new Error(
      `${request.label} persistent Session runtime scope is invalid`,
    );
  }
  if (!request.runtimeIdentitySha256) {
    throw new Error(
      `${request.label} persistent Session runtime identity is invalid`,
    );
  }
  if (
    request.runtimeLocation !== undefined &&
    request.runtimeLocation !== "host" &&
    request.runtimeLocation !== "provider"
  ) {
    throw new Error(
      `${request.label} persistent Session runtime location is invalid`,
    );
  }
}

function workspaceSnapshot(
  workspaceRoot: string,
): Promise<WorkspacePathSnapshot> {
  return createWorkspacePathSnapshot(workspaceRoot, workspaceRoot, {
    maxFiles: MAX_LSP_SESSION_WORKSPACE_FILES,
    maxBytes: MAX_LSP_SESSION_WORKSPACE_BYTES,
  });
}

function ownerKey(owner: LspSessionOwner): string {
  return `${owner.threadId}\u0000${owner.runId}`;
}

function raceFailure<T>(
  operation: Promise<T>,
  failure: Promise<never>,
): Promise<T> {
  return Promise.race([operation, failure]);
}

function wait(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

async function waitForTurn(
  previous: Promise<void>,
  signal: AbortSignal | undefined,
  abortedMessage: string,
): Promise<void> {
  if (!signal) {
    await previous.catch(() => undefined);
    return;
  }
  if (signal.aborted) throw new Error(abortedMessage);
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new Error(abortedMessage));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    await Promise.race([previous.catch(() => undefined), cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
