import type {
  ApplySandboxSetupRequest,
  SandboxSetupPreview,
  SandboxSetupResult,
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
