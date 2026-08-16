import {
  NAPIER_PRODUCT_VERSION,
  NAPIER_RELEASE_IDENTITY_SHA256,
} from "./release-product-identity.js";

export { NAPIER_RELEASE_IDENTITY_SHA256 } from "./release-product-identity.js";

export const RELEASE_PRODUCT_IDENTITY_REQUIRED_FROM_VERSION = "0.1.3";

export function releaseProductVersionRequiresIdentity(
  productVersion: string,
): boolean {
  return (
    compareSemver(
      productVersion,
      RELEASE_PRODUCT_IDENTITY_REQUIRED_FROM_VERSION,
    ) >= 0
  );
}

export function resolveReleaseProductIdentity(
  productVersion: string,
  requested?: string,
): string | undefined {
  if (!releaseProductVersionRequiresIdentity(productVersion)) return undefined;
  const identity =
    requested ??
    (productVersion === NAPIER_PRODUCT_VERSION
      ? NAPIER_RELEASE_IDENTITY_SHA256
      : undefined);
  if (!identity || !/^[a-f0-9]{64}$/.test(identity)) {
    throw new Error(
      `Release Product version ${productVersion} requires a source-bound release identity`,
    );
  }
  if (
    productVersion === NAPIER_PRODUCT_VERSION &&
    identity !== NAPIER_RELEASE_IDENTITY_SHA256
  ) {
    throw new Error(
      `Release Product version ${productVersion} must use the running release identity`,
    );
  }
  return identity;
}

export function validateRunReleaseIdentity(
  identity: unknown,
): string | undefined {
  if (identity === undefined) return undefined;
  if (typeof identity !== "string" || !/^[a-f0-9]{64}$/.test(identity)) {
    throw new Error("Run release identity is invalid");
  }
  return identity;
}

export function normalizeRunReleaseIdentity(run: {
  releaseIdentitySha256?: string;
}): void {
  const identity = validateRunReleaseIdentity(run.releaseIdentitySha256);
  if (identity) run.releaseIdentitySha256 = identity;
  else delete run.releaseIdentitySha256;
}

export function distinctReleaseProductIdentities(
  versions: Array<{
    productVersion: string;
    releaseIdentitySha256?: string;
  }>,
  passingVersions: string[],
): boolean {
  const identities = passingVersions.map((productVersion) => {
    const version = versions.find(
      (candidate) => candidate.productVersion === productVersion,
    );
    return version?.releaseIdentitySha256 ?? `legacy:${productVersion}`;
  });
  return new Set(identities).size === identities.length;
}

export function consecutivePassingProductVersions(
  versions: Array<{ productVersion: string; status: string }>,
): string[] {
  const consecutive: string[] = [];
  for (let index = versions.length - 1; index >= 0; index -= 1) {
    const version = versions[index]!;
    if (version.status !== "passed") break;
    const next = consecutive[0];
    if (next && !isImmediateProductVersion(version.productVersion, next)) break;
    consecutive.unshift(version.productVersion);
  }
  return consecutive;
}

function isImmediateProductVersion(previous: string, next: string): boolean {
  const left = parseSemver(previous);
  const right = parseSemver(next);
  if (!left || !right) return false;
  if (left[0] === right[0] && left[1] === right[1])
    return right[2] === left[2] + 1;
  if (left[0] === right[0]) return right[1] === left[1] + 1 && right[2] === 0;
  return right[0] === left[0] + 1 && right[1] === 0 && right[2] === 0;
}

function compareSemver(left: string, right: string): number {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  if (!leftParts || !rightParts) return left.localeCompare(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

function parseSemver(value: string): [number, number, number] | undefined {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : undefined;
}
