import type { MessageConnection } from "vscode-jsonrpc/node.js";

import { canonicalJson, sha256 } from "./ed25519.js";
import { parseLspRange, type LspRange } from "./lsp-locations.js";

export const MAX_LSP_CODE_ACTION_DIAGNOSTICS = 64;

export interface ProtocolCodeActionResult {
  diagnostics: unknown[];
  actions: unknown;
}

export interface CodeActionDiagnostic {
  raw: Record<string, unknown>;
  range: LspRange;
  receipt: {
    rangeSha256: string;
    severity: number | null;
    codeSha256: string | null;
    sourceSha256: string | null;
    messageSha256: string;
  };
}

export function prepareLspCodeActionOperation(request: {
  line: number;
  character: number;
}): (
  connection: MessageConnection,
  targetUri: string,
) => () => Promise<ProtocolCodeActionResult> {
  return (connection, targetUri) => {
    const diagnosticsReady = waitForCodeActionDiagnostics(
      connection,
      targetUri,
    );
    return async (): Promise<ProtocolCodeActionResult> => {
      const diagnostics = parseCodeActionDiagnostics(await diagnosticsReady);
      const selected = diagnostics.filter((diagnostic) =>
        rangeContainsPosition(diagnostic.range, {
          line: request.line - 1,
          character: request.character - 1,
        }),
      );
      if (selected.length === 0) {
        return { diagnostics: [], actions: [] };
      }
      const actions = await connection.sendRequest("textDocument/codeAction", {
        textDocument: { uri: targetUri },
        range: enclosingRange(selected.map((item) => item.range)),
        context: {
          diagnostics: selected.map((item) => item.raw),
          only: ["quickfix"],
          triggerKind: 1,
        },
      });
      return {
        diagnostics: selected.map((item) => item.raw),
        actions,
      };
    };
  };
}

export function parseCodeActionDiagnostics(
  value: unknown,
): CodeActionDiagnostic[] {
  if (!Array.isArray(value)) {
    throw new Error("LSP code action diagnostics must be an array");
  }
  if (value.length > MAX_LSP_CODE_ACTION_DIAGNOSTICS) {
    throw new Error(
      `LSP code action returned more than ${MAX_LSP_CODE_ACTION_DIAGNOSTICS} diagnostics`,
    );
  }
  return value.map((diagnostic, index) => {
    if (
      !record(diagnostic) ||
      typeof diagnostic["message"] !== "string" ||
      !parseLspRange(diagnostic["range"])
    ) {
      throw new Error(`LSP code action diagnostic ${index + 1} is malformed`);
    }
    const range = parseLspRange(diagnostic["range"])!;
    const severity =
      Number.isSafeInteger(diagnostic["severity"]) &&
      Number(diagnostic["severity"]) >= 1 &&
      Number(diagnostic["severity"]) <= 4
        ? Number(diagnostic["severity"])
        : null;
    const code =
      typeof diagnostic["code"] === "string" ||
      typeof diagnostic["code"] === "number"
        ? String(diagnostic["code"])
        : null;
    const source =
      typeof diagnostic["source"] === "string" ? diagnostic["source"] : null;
    return {
      raw: diagnostic,
      range,
      receipt: {
        rangeSha256: sha256(canonicalJson(range)),
        severity,
        codeSha256: code === null ? null : sha256(code),
        sourceSha256: source === null ? null : sha256(source),
        messageSha256: sha256(diagnostic["message"]),
      },
    };
  });
}

function waitForCodeActionDiagnostics(
  connection: MessageConnection,
  expectedUri: string,
): Promise<unknown[]> {
  return new Promise((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let latest: unknown[] = [];
    connection.onNotification(
      "textDocument/publishDiagnostics",
      (params: unknown) => {
        if (
          !record(params) ||
          params["uri"] !== expectedUri ||
          !Array.isArray(params["diagnostics"])
        ) {
          return;
        }
        latest = params["diagnostics"];
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(() => resolve(latest), 100);
      },
    );
  });
}

function enclosingRange(ranges: LspRange[]): LspRange {
  const sortedStarts = ranges.map((range) => range.start).sort(comparePosition);
  const sortedEnds = ranges.map((range) => range.end).sort(comparePosition);
  return {
    start: sortedStarts[0]!,
    end: sortedEnds.at(-1)!,
  };
}

function rangeContainsPosition(
  range: LspRange,
  position: { line: number; character: number },
): boolean {
  if (comparePosition(range.start, range.end) === 0) {
    return comparePosition(range.start, position) === 0;
  }
  return (
    comparePosition(range.start, position) <= 0 &&
    comparePosition(position, range.end) < 0
  );
}

function comparePosition(
  left: { line: number; character: number },
  right: { line: number; character: number },
): number {
  return left.line - right.line || left.character - right.character;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
