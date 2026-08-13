import type {
  ProviderSetupCandidate,
  ProviderSetupCandidateStatus,
  ProviderSetupPreview,
} from "@napier/contracts/provider-setup";

export interface ProviderSetupStatusCopy {
  label: string;
  detail: string;
}

const STATUS_COPY: Record<
  ProviderSetupCandidateStatus,
  ProviderSetupStatusCopy
> = {
  ready: {
    label: "Ready",
    detail: "This locator is enabled and the model is available.",
  },
  available: {
    label: "Found",
    detail: "The environment locator exists. Enable it explicitly for Napier.",
  },
  missing: {
    label: "Not found",
    detail: "Set this environment variable before enabling the provider.",
  },
  conflict: {
    label: "Review",
    detail: "Another active locator already controls this provider.",
  },
  unavailable: {
    label: "Unavailable",
    detail: "This provider or model is not available in this build.",
  },
};

export function providerSetupStatusCopy(
  status: ProviderSetupCandidateStatus,
): ProviderSetupStatusCopy {
  return STATUS_COPY[status];
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
