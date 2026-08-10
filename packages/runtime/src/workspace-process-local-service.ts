import type {
  WorkspaceProcessLocalService,
  WorkspaceProcessSession,
} from "@napier/contracts";

import { validateSandboxLocalServiceRequest } from "./sandbox-local-service-policy.js";
import type {
  SandboxLocalServiceBinding,
  SandboxLocalServiceRequest,
} from "./sandbox-types.js";

export type WorkspaceProcessLocalServiceRequest = SandboxLocalServiceRequest;

export function validateWorkspaceProcessLocalServiceRequest(input: {
  localService?: WorkspaceProcessLocalServiceRequest;
  interactive?: boolean;
  terminal?: unknown;
  privateProtocol: boolean;
  writePreview: boolean;
}): void {
  if (!input.localService) return;
  validateSandboxLocalServiceRequest(input.localService);
  if (input.interactive || input.terminal !== undefined) {
    throw new Error(
      "Workspace local services cannot use interactive or PTY input",
    );
  }
  if (input.privateProtocol) {
    throw new Error("Private Process protocols cannot publish local services");
  }
  if (input.writePreview) {
    throw new Error(
      "Workspace local services cannot start in a scoped write transaction",
    );
  }
}

export function workspaceProcessLocalServiceProjection(
  binding: SandboxLocalServiceBinding,
): WorkspaceProcessLocalService {
  return { ...binding, status: "ready" };
}

export function closedWorkspaceProcessLocalService(
  session: WorkspaceProcessSession,
): Pick<WorkspaceProcessSession, "localService"> {
  return session.localService
    ? { localService: { ...session.localService, status: "closed" } }
    : {};
}
