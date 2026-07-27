import type {
  CreateReceiptTrustAnchorDirectorySubscriptionRequest,
  DiscoverReceiptTrustAnchorDirectoryRequest,
  ReceiptTrustAnchorDirectoryVerificationPolicy,
} from "@napier/contracts";

export const DISCOVERED_DIRECTORY_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const DIRECTORY_SUBSCRIPTION_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export type QualifiedReceiptTrustAnchorDirectoryDiscoveryRequest =
  DiscoverReceiptTrustAnchorDirectoryRequest & {
    policy: ReceiptTrustAnchorDirectoryVerificationPolicy;
  };

export type QualifiedReceiptTrustAnchorDirectorySubscriptionRequest =
  CreateReceiptTrustAnchorDirectorySubscriptionRequest;

export function qualifyReceiptTrustAnchorDirectoryDiscoveryRequest(
  sourceUrl: string,
  expectedAnchorSetSha256: string,
): QualifiedReceiptTrustAnchorDirectoryDiscoveryRequest | undefined {
  const normalizedSourceUrl = normalizeDirectorySourceUrl(sourceUrl);
  const normalizedAnchorSetSha256 = expectedAnchorSetSha256
    .trim()
    .toLowerCase();
  if (
    !normalizedSourceUrl ||
    (normalizedAnchorSetSha256 &&
      !/^[a-f0-9]{64}$/.test(normalizedAnchorSetSha256))
  ) {
    return undefined;
  }
  return {
    sourceUrl: normalizedSourceUrl,
    policy: {
      maxAgeMs: DISCOVERED_DIRECTORY_MAX_AGE_MS,
      minimumTrustedCount: 1,
      ...(normalizedAnchorSetSha256
        ? { expectedAnchorSetSha256: normalizedAnchorSetSha256 }
        : {}),
    },
  };
}

export function qualifyReceiptTrustAnchorDirectorySubscriptionRequest(
  threadId: string,
  label: string,
  sourceUrl: string,
  expectedAnchorSetSha256: string,
): QualifiedReceiptTrustAnchorDirectorySubscriptionRequest | undefined {
  const discovery = qualifyReceiptTrustAnchorDirectoryDiscoveryRequest(
    sourceUrl,
    expectedAnchorSetSha256,
  );
  const normalizedLabel = label.trim();
  if (
    !discovery ||
    !/^thread_[a-z0-9]{8,80}$/.test(threadId) ||
    normalizedLabel.length < 1 ||
    normalizedLabel.length > 100
  ) {
    return undefined;
  }
  return {
    threadId,
    label: normalizedLabel,
    sourceUrl: discovery.sourceUrl,
    refreshIntervalMs: DIRECTORY_SUBSCRIPTION_REFRESH_INTERVAL_MS,
    policy: discovery.policy,
  };
}

function normalizeDirectorySourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
