import type { JsonObject } from "@napier/contracts";
import type {
  ToolFailureClassV1,
  ToolFailureDefinitionV1,
  ToolFailureReceiptV1,
} from "@napier/contracts/tool-protocol";

import { canonicalJson, sha256 } from "./ed25519.js";
import { toolFailureDiagnosticText } from "./tool-failure-receipt-support.js";

/** Compatibility boundary for undeclared v1 tools. */
export function legacyToolFailureDefinition(): ToolFailureDefinitionV1 {
  return Object.freeze({
    kind: "napier.tool-failure-definition" as const,
    schemaVersion: 1 as const,
    availability: "unavailable" as const,
    coverage: "legacy_fallback" as const,
    modes: [],
  });
}

export function legacyToolFailureReceipt(
  failure: unknown,
): ToolFailureReceiptV1 {
  const normalized = toolFailureDiagnosticText(failure).slice(0, 16_000);
  const failureClass = legacyClassifyText(normalized);
  const definition = legacyToolFailureDefinition();
  return Object.freeze({
    kind: "napier.tool-failure-semantics" as const,
    schemaVersion: 1 as const,
    coverage: "legacy_fallback" as const,
    class: failureClass,
    ...legacyFailurePolicy(failureClass),
    failureDefinitionSha256: sha256(
      canonicalJson(definition as unknown as JsonObject),
    ),
    diagnosticSha256: sha256(normalized),
  });
}

export function legacyToolFailureLedgerProjection(
  output: string,
  details: unknown,
): { toolFailure: JsonObject } {
  return {
    toolFailure: legacyToolFailureReceipt({
      output,
      details,
    }) as unknown as JsonObject,
  };
}

/** Text inference exists solely to replay and execute undeclared v1 tools. */
function legacyClassifyText(value: string): ToolFailureClassV1 {
  if (/\b(?:abort(?:ed)?|cancel(?:led)?)\b/iu.test(value)) return "cancelled";
  if (/\b(?:timeout|timed\s*out|etimedout|deadline\s+exceeded)\b/iu.test(value))
    return "timeout";
  if (
    /\b(?:session\s+(?:is\s+)?not\s+active|session\s+closed|target\s+closed)\b/iu.test(
      value,
    )
  )
    return "session_state";
  if (/\b(?:unsupported|does\s+not\s+(?:support|provide))\b/iu.test(value))
    return "unsupported";
  if (
    /\b(?:not\s+configured|unavailable|missing\s+credentials?|no\s+credentials?)\b/iu.test(
      value,
    )
  )
    return "unavailable";
  if (
    /\b(?:401|unauthori[sz]ed|authentication\s+(?:failed|required))\b/iu.test(
      value,
    )
  )
    return "unauthorized";
  if (/\b(?:403|forbidden|permission\s+denied|eacces|eperm)\b/iu.test(value))
    return "forbidden";
  if (/\b(?:404|not\s+found|enoent)\b/iu.test(value)) return "not_found";
  if (/\b(?:429|rate[ -]?limit(?:ed)?)\b/iu.test(value)) return "rate_limited";
  if (
    /\b(?:econn|enotfound|eai_again|socket|network|dns|fetch\s+failed)\b/iu.test(
      value,
    )
  )
    return "network";
  if (
    /\b(?:invalid\s+(?:input|argument|parameter)|schema|validation)\b/iu.test(
      value,
    )
  )
    return "invalid_input";
  if (/\b(?:too\s+large|size\s+limit|resource\s+limit|quota)\b/iu.test(value))
    return "resource_limit";
  if (/\b(?:blocked|policy|denied\s+by)\b/iu.test(value)) return "policy";
  return "unknown";
}

function legacyFailurePolicy(
  failureClass: ToolFailureClassV1,
): Pick<ToolFailureReceiptV1, "scope" | "disposition" | "fatalToSession"> {
  switch (failureClass) {
    case "invalid_input":
      return {
        scope: "invocation",
        disposition: "correct_input",
        fatalToSession: false,
      };
    case "unavailable":
    case "unsupported":
      return {
        scope: "capability",
        disposition: "terminal",
        fatalToSession: false,
      };
    case "unauthorized":
    case "forbidden":
      return {
        scope: "route",
        disposition: "alternate_route",
        fatalToSession: false,
      };
    case "not_found":
      return {
        scope: "target",
        disposition: "terminal",
        fatalToSession: false,
      };
    case "rate_limited":
      return {
        scope: "route",
        disposition: "retry_after",
        fatalToSession: false,
      };
    case "timeout":
    case "network":
      return {
        scope: "origin",
        disposition: "alternate_route",
        fatalToSession: false,
      };
    case "session_state":
      return {
        scope: "session",
        disposition: "recover_state",
        fatalToSession: true,
      };
    case "cancelled":
    case "policy":
    case "resource_limit":
      return {
        scope: "invocation",
        disposition: "terminal",
        fatalToSession: false,
      };
    case "unknown":
      return {
        scope: "invocation",
        disposition: "alternate_route",
        fatalToSession: false,
      };
  }
}
