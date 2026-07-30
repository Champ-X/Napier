import path from "node:path";
import { pathToFileURL } from "node:url";

import type { LspDiagnosticLanguage } from "@napier/contracts";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node.js";

import type { SandboxedProcess } from "./sandbox.js";

export const MAX_LSP_DIAGNOSTICS = 64;
export const MAX_LSP_DIAGNOSTIC_MESSAGE_CHARS = 1_000;
export const MAX_LSP_PROTOCOL_BYTES = 2 * 1024 * 1024;
export const MAX_LSP_STDERR_CHARS = 16_000;

const DIAGNOSTICS_QUIET_MS = 100;
const SHUTDOWN_GRACE_MS = 1_000;

export interface LspDiagnostic {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  severity: 1 | 2 | 3 | 4;
  code?: string;
  source?: string;
  message: string;
}

export interface LspProtocolSessionRequest {
  label: string;
  abortedMessage: string;
  workspaceRoot: string;
  target: string;
  language: LspDiagnosticLanguage;
  source: string;
  timeoutMs: number;
  typescriptServerPath: string;
}

export interface LspProtocolSessionResult<T> {
  value: T;
  protocolBytes: number;
  stderr: string;
  stderrTruncated: boolean;
}

export type PrepareLspProtocolOperation<T> = (
  connection: MessageConnection,
  targetUri: string,
) => () => Promise<T>;

export async function runLspProtocolSession<T>(
  child: SandboxedProcess,
  request: LspProtocolSessionRequest,
  prepareOperation: PrepareLspProtocolOperation<T>,
  signal?: AbortSignal,
): Promise<LspProtocolSessionResult<T>> {
  let protocolBytes = 0;
  let stderr = "";
  let stderrTruncated = false;
  let completed = false;
  let shuttingDown = false;
  let failSession: ((error: Error) => void) | undefined;
  const failure = new Promise<never>((_, reject) => {
    failSession = reject;
  });
  const fail = (message: string): void => {
    if (completed) return;
    completed = true;
    failSession?.(new Error(message));
    void child.terminate().catch(() => undefined);
  };
  const onStdoutData = (chunk: Buffer | string): void => {
    protocolBytes += Buffer.byteLength(chunk);
    if (protocolBytes > MAX_LSP_PROTOCOL_BYTES) {
      fail(`${request.label} exceeded its protocol output limit`);
    }
  };
  const onStderrData = (chunk: Buffer | string): void => {
    if (stderrTruncated) return;
    const text = chunk.toString();
    const remaining = MAX_LSP_STDERR_CHARS - stderr.length;
    stderr += text.slice(0, Math.max(0, remaining));
    if (text.length > remaining) {
      stderrTruncated = true;
      fail(`${request.label} exceeded its stderr limit`);
    }
  };
  child.stdout.on("data", onStdoutData);
  child.stderr.on("data", onStderrData);
  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  );
  connection.onError(() => fail(`${request.label} protocol failed`));
  connection.onClose(() => {
    if (!shuttingDown) fail(`${request.label} server closed unexpectedly`);
  });
  registerClientHandlers(connection, request.workspaceRoot);
  const collect = prepareOperation(
    connection,
    pathToFileURL(request.target).href,
  );
  connection.listen();
  const abort = (): void => fail(request.abortedMessage);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(
    () => fail(`${request.label} timed out`),
    request.timeoutMs,
  );
  void child.exit.then((exit) => {
    if (!shuttingDown) {
      fail(
        exit.code === 0
          ? `${request.label} server exited before completing the request`
          : `${request.label} server failed`,
      );
    }
  });
  try {
    await raceFailure(
      connection.sendRequest("initialize", {
        processId: null,
        clientInfo: { name: "napier", version: "0.1.0" },
        rootUri: pathToFileURL(request.workspaceRoot).href,
        capabilities: {
          workspace: { configuration: false, workspaceFolders: true },
          textDocument: {
            definition: { linkSupport: true },
            references: {},
            rename: { prepareSupport: true },
            publishDiagnostics: {
              relatedInformation: false,
              tagSupport: { valueSet: [1, 2] },
              versionSupport: true,
            },
          },
        },
        initializationOptions: {
          disableAutomaticTypingAcquisition: true,
          tsserver: { path: request.typescriptServerPath },
        },
        workspaceFolders: [
          {
            uri: pathToFileURL(request.workspaceRoot).href,
            name: path.basename(request.workspaceRoot),
          },
        ],
        trace: "off",
      }),
      failure,
    );
    await connection.sendNotification("initialized", {});
    await connection.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: pathToFileURL(request.target).href,
        languageId: request.language,
        version: 1,
        text: request.source,
      },
    });
    const value = await raceFailure(collect(), failure);
    shuttingDown = true;
    await raceFailure(connection.sendRequest("shutdown"), failure);
    await connection.sendNotification("exit");
    const exit = await Promise.race([
      child.exit,
      new Promise<undefined>((resolve) =>
        setTimeout(() => resolve(undefined), SHUTDOWN_GRACE_MS),
      ),
    ]);
    if (!exit) {
      await child.terminate();
    } else if (exit.code !== 0) {
      throw new Error(`${request.label} server failed during shutdown`);
    }
    completed = true;
    return {
      value,
      protocolBytes,
      stderr,
      stderrTruncated,
    };
  } finally {
    completed = true;
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    connection.dispose();
    child.stdout.off("data", onStdoutData);
    child.stderr.off("data", onStderrData);
    await child.terminate().catch(() => undefined);
  }
}

export async function runLspDiagnosticsSession(
  child: SandboxedProcess,
  request: LspProtocolSessionRequest,
  signal?: AbortSignal,
): Promise<{
  diagnostics: LspDiagnostic[];
  truncated: boolean;
  protocolBytes: number;
  stderr: string;
  stderrTruncated: boolean;
}> {
  const result = await runLspProtocolSession(
    child,
    request,
    (connection, targetUri) => {
      const diagnostics = diagnosticsNotification(connection, targetUri);
      return () => diagnostics;
    },
    signal,
  );
  return {
    ...result.value,
    protocolBytes: result.protocolBytes,
    stderr: result.stderr,
    stderrTruncated: result.stderrTruncated,
  };
}

function registerClientHandlers(
  connection: MessageConnection,
  workspaceRoot: string,
): void {
  connection.onRequest("workspace/configuration", (params: unknown) => {
    const items =
      record(params) && Array.isArray(params["items"]) ? params["items"] : [];
    return items.map(() => ({
      insertSpaces: true,
      tabSize: 2,
    }));
  });
  connection.onRequest("workspace/workspaceFolders", () => [
    {
      uri: pathToFileURL(workspaceRoot).href,
      name: path.basename(workspaceRoot),
    },
  ]);
  connection.onRequest("client/registerCapability", () => null);
  connection.onRequest("client/unregisterCapability", () => null);
  connection.onRequest("window/workDoneProgress/create", () => null);
  connection.onRequest("window/showMessageRequest", () => null);
  connection.onRequest("workspace/applyEdit", () => ({ applied: false }));
}

function diagnosticsNotification(
  connection: MessageConnection,
  expectedUri: string,
): Promise<{ diagnostics: LspDiagnostic[]; truncated: boolean }> {
  return new Promise((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let latest: { diagnostics: LspDiagnostic[]; truncated: boolean } = {
      diagnostics: [],
      truncated: false,
    };
    connection.onNotification(
      "textDocument/publishDiagnostics",
      (params: unknown) => {
        const published = parsePublishedDiagnostics(params, expectedUri);
        if (!published) return;
        latest = published;
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(() => resolve(latest), DIAGNOSTICS_QUIET_MS);
      },
    );
  });
}

function parsePublishedDiagnostics(
  value: unknown,
  expectedUri: string,
): { diagnostics: LspDiagnostic[]; truncated: boolean } | undefined {
  if (!record(value) || value["uri"] !== expectedUri) return undefined;
  if (!Array.isArray(value["diagnostics"])) return undefined;
  const values = value["diagnostics"];
  const diagnostics = values
    .slice(0, MAX_LSP_DIAGNOSTICS)
    .map(parseDiagnostic)
    .filter((diagnostic): diagnostic is LspDiagnostic => Boolean(diagnostic));
  return {
    diagnostics,
    truncated:
      values.length > MAX_LSP_DIAGNOSTICS ||
      diagnostics.length !== Math.min(values.length, MAX_LSP_DIAGNOSTICS),
  };
}

function parseDiagnostic(value: unknown): LspDiagnostic | undefined {
  if (!record(value) || !record(value["range"])) return undefined;
  const start = record(value["range"]["start"])
    ? value["range"]["start"]
    : undefined;
  const end = record(value["range"]["end"]) ? value["range"]["end"] : undefined;
  if (
    !start ||
    !end ||
    !nonNegativeInteger(start["line"]) ||
    !nonNegativeInteger(start["character"]) ||
    !nonNegativeInteger(end["line"]) ||
    !nonNegativeInteger(end["character"]) ||
    typeof value["message"] !== "string"
  ) {
    return undefined;
  }
  const severity =
    value["severity"] === 1 ||
    value["severity"] === 2 ||
    value["severity"] === 3 ||
    value["severity"] === 4
      ? value["severity"]
      : 1;
  const code =
    typeof value["code"] === "string" || typeof value["code"] === "number"
      ? String(value["code"]).slice(0, 100)
      : undefined;
  const source =
    typeof value["source"] === "string"
      ? value["source"].slice(0, 80)
      : undefined;
  return {
    startLine: Number(start["line"]) + 1,
    startCharacter: Number(start["character"]) + 1,
    endLine: Number(end["line"]) + 1,
    endCharacter: Number(end["character"]) + 1,
    severity,
    ...(code ? { code } : {}),
    ...(source ? { source } : {}),
    message: value["message"].slice(0, MAX_LSP_DIAGNOSTIC_MESSAGE_CHARS),
  };
}

async function raceFailure<T>(
  operation: Promise<T>,
  failure: Promise<never>,
): Promise<T> {
  return Promise.race([operation, failure]);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
