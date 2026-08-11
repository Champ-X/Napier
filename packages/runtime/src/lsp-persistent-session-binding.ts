import type { LspProtocolSessionRequest } from "./lsp-protocol-session.js";
import {
  createWorkspacePathSnapshot,
  type WorkspacePathSnapshot,
} from "./workspace-snapshot.js";

export function assertPersistentLspRequest(
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

export function persistentLspWorkspaceSnapshot(
  workspaceRoot: string,
  limits: { maxFiles: number; maxBytes: number },
): Promise<WorkspacePathSnapshot> {
  return createWorkspacePathSnapshot(workspaceRoot, workspaceRoot, limits);
}
