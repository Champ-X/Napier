import { canonicalJson, sha256 } from "./ed25519.js";

export function toolOperationDescriptorSha256(descriptor: object): string {
  return sha256(canonicalJson(descriptor));
}

export function toolOperationId(
  parentCallId: string,
  descriptor: object,
): string {
  return `operation_${sha256(
    canonicalJson({ parentCallId, ...descriptor }),
  ).slice(0, 32)}`;
}
