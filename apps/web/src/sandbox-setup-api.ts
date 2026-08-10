import type {
  ApplySandboxSetupRequest,
  ApplySandboxUninstallRequest,
  SandboxSetupPreview,
  SandboxSetupResult,
  SandboxUninstallPreview,
  SandboxUninstallResult,
} from "@napier/contracts/sandbox-setup";

import { requestJson } from "./api-client";

export function getSandboxSetupPreview(): Promise<SandboxSetupPreview> {
  return requestJson("/api/setup/sandbox");
}

export function applySandboxSetup(
  request: ApplySandboxSetupRequest,
): Promise<SandboxSetupResult> {
  return requestJson("/api/setup/sandbox", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function getSandboxUninstallPreview(): Promise<SandboxUninstallPreview> {
  return requestJson("/api/setup/sandbox/uninstall");
}

export function applySandboxUninstall(
  request: ApplySandboxUninstallRequest,
): Promise<SandboxUninstallResult> {
  return requestJson("/api/setup/sandbox/uninstall", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
