import type {
  ProviderSetupCandidate,
  ProviderSetupCandidateStatus,
  ProviderSetupPreview,
} from "@napier/contracts/provider-setup";

import { environmentSetupCopy } from "./environment-setup-copy";

export interface ProviderSetupStatusCopy {
  label: string;
  detail: string;
}

export function providerSetupStatusCopy(
  status: ProviderSetupCandidateStatus,
): ProviderSetupStatusCopy {
  return environmentSetupCopy.provider.statuses[status];
}

export function providerSetupEnableCandidate(
  preview: ProviderSetupPreview,
): ProviderSetupCandidate | undefined {
  const recommended = preview.candidates.find(
    (candidate) => candidate.providerId === preview.recommendedProviderId,
  );
  if (recommended?.status === "available") return recommended;
  return preview.candidates.find(
    (candidate) => candidate.status === "available",
  );
}

export function providerSetupReadyCandidate(
  preview: ProviderSetupPreview,
): ProviderSetupCandidate | undefined {
  return preview.candidates.find((candidate) => candidate.status === "ready");
}
