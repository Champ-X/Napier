import type { MessageConnection } from "vscode-jsonrpc/node.js";

import {
  MAX_LSP_CODE_ACTIONS,
  parseLspCodeActionResponseEntries,
  parseResolvedLspCodeActionResponse,
  type LspCodeActionCandidate,
  type ParsedLspCodeActions,
} from "./lsp-code-action-parser.js";
import { lspConnectionSupportsCodeActionResolve } from "./lsp-protocol-session.js";

export const MAX_LSP_CODE_ACTION_RESOLVE_REQUESTS = 16;

export interface ResolvedLspCodeActions extends ParsedLspCodeActions {
  resolveSupported: boolean;
  resolveRequestCount: number;
  resolvedActionCount: number;
  resolveOmittedCount: number;
}

export async function resolveLspCodeActionResponse(
  connection: MessageConnection,
  value: unknown,
  signal?: AbortSignal,
): Promise<ResolvedLspCodeActions> {
  const parsed = parseLspCodeActionResponseEntries(value);
  const resolveSupported = lspConnectionSupportsCodeActionResolve(connection);
  const exposed: Array<{
    responseIndex: number;
    candidate: LspCodeActionCandidate;
  }> = [];
  let omittedActionCount = parsed.omittedActionCount;
  let resolveRequestCount = 0;
  let resolvedActionCount = 0;
  let resolveOmittedCount = 0;
  let truncated = false;

  for (const entry of parsed.entries) {
    assertNotAborted(signal);
    if ("candidate" in entry) {
      if (exposed.length < MAX_LSP_CODE_ACTIONS) {
        exposed.push(entry);
      } else {
        omittedActionCount += 1;
        truncated = true;
      }
      continue;
    }
    if (
      !resolveSupported ||
      resolveRequestCount >= MAX_LSP_CODE_ACTION_RESOLVE_REQUESTS ||
      exposed.length >= MAX_LSP_CODE_ACTIONS
    ) {
      omittedActionCount += 1;
      resolveOmittedCount += 1;
      truncated ||= resolveSupported;
      continue;
    }
    resolveRequestCount += 1;
    let value: unknown;
    try {
      value = await connection.sendRequest(
        "codeAction/resolve",
        entry.resolve.action,
      );
    } catch {
      throw new Error("LSP code action resolve request failed");
    }
    assertNotAborted(signal);
    const candidate = parseResolvedLspCodeActionResponse(
      value,
      entry.resolve,
      entry.responseIndex,
    );
    if (!candidate) {
      omittedActionCount += 1;
      resolveOmittedCount += 1;
      continue;
    }
    resolvedActionCount += 1;
    exposed.push({ responseIndex: entry.responseIndex, candidate });
  }

  return {
    actions: exposed
      .sort((left, right) => left.responseIndex - right.responseIndex)
      .map((entry) => entry.candidate),
    omittedActionCount,
    truncated,
    resolveSupported,
    resolveRequestCount,
    resolvedActionCount,
    resolveOmittedCount,
  };
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("LSP code action was aborted");
  }
}
