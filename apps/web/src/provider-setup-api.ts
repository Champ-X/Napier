import type {
  ApplyProviderSetupRequest,
  ProviderSetupPreview,
  ProviderSetupResult,
} from "@napier/contracts/provider-setup";

import { requestJson } from "./api-client";

export function getProviderSetupPreview(): Promise<ProviderSetupPreview> {
  return requestJson("/api/setup/providers");
}

export function applyProviderSetup(
  request: ApplyProviderSetupRequest,
): Promise<ProviderSetupResult> {
  return requestJson("/api/setup/providers", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
