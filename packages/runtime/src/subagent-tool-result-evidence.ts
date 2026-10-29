import { agentToolResultText } from "./agent-tool-result-text.js";
import { canonicalJson, sha256 } from "./ed25519.js";

/** Exact SDK-visible payload, excluding the SDK's observation timestamp and tool identity. */
export function subagentToolResultEvidence(value: unknown) {
  const result = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const content = result["content"] ?? [];
  const names = result["addedToolNames"];
  const payload = { content, details: result["details"], usage: result["usage"],
    ...(Array.isArray(names) && names.length ? { addedToolNames: names } : {}) };
  return { outputTextSha256: sha256(agentToolResultText({ content })),
    resultContentSha256: sha256(canonicalJson(content)),
    resultDetailsSha256: sha256(canonicalJson({ details: result["details"] })),
    resultPayloadSha256: sha256(canonicalJson(payload)) };
}
