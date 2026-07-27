import type {
  DiscoverReceiptTrustAnchorDirectoryRequest,
  ReceiptTrustAnchorDirectoryVerificationPolicy,
} from "@napier/contracts";

export const DISCOVERED_DIRECTORY_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export type QualifiedReceiptTrustAnchorDirectoryDiscoveryRequest =
  DiscoverReceiptTrustAnchorDirectoryRequest & {
    policy: ReceiptTrustAnchorDirectoryVerificationPolicy;
  };

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
