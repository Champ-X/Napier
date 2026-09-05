import type { RouteFailureClass } from "@napier/contracts/model-route";

import { routeFailureClassFromHttpDiagnostic } from "./model-route-http-status.js";

/**
 * Compatibility-only classifier for provider SDKs which expose no stable
 * status, code, type, or typed failure signal. New integrations must preserve
 * structured evidence instead of adding provider wording here.
 */
export function classifyLegacyRouteFailureText(
  message: string,
): RouteFailureClass {
  const httpFailure = routeFailureClassFromHttpDiagnostic(message);
  if (httpFailure) return httpFailure;
  const value = message.toLowerCase();
  if (/\babort(?:ed|ing)?\b|cancelled|canceled/u.test(value)) {
    return "cancelled";
  }
  if (
    /context_length_exceeded|maximum context|context.{0,24}(?:limit|window).{0,24}(?:exceed|too)|too many (?:input )?tokens|prompt (?:is )?too long/u.test(
      value,
    )
  ) {
    return "context";
  }
  if (/insufficient (?:credit|balance)|billing|payment required/u.test(value)) {
    return "billing";
  }
  if (/unauthori[sz]ed|forbidden|invalid api key|authentication/u.test(value)) {
    return "authentication";
  }
  if (
    /rate.?limit|too many requests|quota.{0,16}(?:rate|minute|second)/u.test(
      value,
    )
  ) {
    return "rate_limited";
  }
  if (
    /bad gateway|service unavailable|gateway timeout|internal server error/u.test(
      value,
    )
  ) {
    return "provider_server";
  }
  if (
    /econnreset|econnrefused|enotfound|etimedout|und_err_socket|socket hang up|network error|fetch failed|connection (?:closed|reset|terminated)|premature close|terminated|dns|request timeout|\btimed? out\b|\btimeout\b/u.test(
      value,
    )
  ) {
    return "network";
  }
  if (
    /tool.{0,24}(?:schema|dialect|choice|call).{0,24}(?:invalid|unsupported)|invalid.{0,24}tool/u.test(
      value,
    )
  ) {
    return "tool_dialect";
  }
  return "unknown";
}
