import type { SignedExtensionPackageEnvelope } from "@napier/contracts";

export function signedExtensionPackageFilename(
  normalizedName: string,
  envelope: Pick<SignedExtensionPackageEnvelope, "contentSha256">,
): string {
  const safeName = safeFilenameSegment(normalizedName, "extension");
  return `${safeName}-${envelope.contentSha256.slice(0, 12)}.napier-extension.json`;
}

function safeFilenameSegment(value: string, fallback: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized.length > 0 ? normalized : fallback;
}
