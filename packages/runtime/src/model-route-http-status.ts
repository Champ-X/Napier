import type { RouteFailureClass } from "@napier/contracts/model-route";

const HTTP_STATUS_EVIDENCE =
  /(?:^|[^A-Za-z0-9])HTTP(?:\/(?:1(?:\.[01])?|2|3))?(?:\s+STATUS(?:\s+CODE)?)?\s*(?::|=)?\s*(401|402|403|408|429|499|5\d{2})(?=$|[^0-9])/iu;

/** Maps protocol-level HTTP status evidence without relying on provider prose. */
export function routeFailureClassFromHttpStatus(
  status: number | undefined,
): RouteFailureClass | undefined {
  if (status === 499) return "cancelled";
  if (status === 401 || status === 403) return "authentication";
  if (status === 402) return "billing";
  if (status === 408) return "network";
  if (status === 429) return "rate_limited";
  if (status !== undefined && status >= 500 && status <= 599) {
    return "provider_server";
  }
  return undefined;
}

/**
 * Compatibility boundary for SDKs which flatten an HTTP response into text.
 * Requiring an explicit HTTP marker avoids treating arbitrary numbers as status.
 */
export function routeFailureClassFromHttpDiagnostic(
  diagnostic: string,
): RouteFailureClass | undefined {
  const match = HTTP_STATUS_EVIDENCE.exec(diagnostic);
  return match ? routeFailureClassFromHttpStatus(Number(match[1])) : undefined;
}
