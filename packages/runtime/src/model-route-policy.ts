import type {
  ModelRouteSideEffectState,
  RouteFailureClass,
} from "@napier/contracts/model-route";

const RETRYABLE_FAILURES = new Set<RouteFailureClass>([
  "rate_limited",
  "provider_server",
  "network",
]);

export function classifyRouteFailure(error: unknown): RouteFailureClass {
  const message = routeErrorText(error).toLowerCase();
  const status = errorStatus(error);
  const code = errorCode(error).toLowerCase();
  if (
    status === 499 ||
    /\babort(?:ed|ing)?\b|cancelled|canceled/u.test(message)
  ) {
    return "cancelled";
  }
  if (
    /context_length_exceeded|maximum context|context.{0,24}(?:limit|window).{0,24}(?:exceed|too)|too many (?:input )?tokens|prompt (?:is )?too long/u.test(
      message,
    )
  ) {
    return "context";
  }
  if (
    status === 402 ||
    /insufficient (?:credit|balance)|billing|payment required/u.test(message)
  ) {
    return "billing";
  }
  if (
    status === 401 ||
    status === 403 ||
    /unauthori[sz]ed|forbidden|invalid api key|authentication/u.test(message)
  ) {
    return "authentication";
  }
  if (
    status === 429 ||
    /rate.?limit|too many requests|quota.{0,16}(?:rate|minute|second)/u.test(
      message,
    )
  ) {
    return "rate_limited";
  }
  if (
    (status !== undefined && status >= 500 && status <= 599) ||
    /bad gateway|service unavailable|gateway timeout|internal server error/u.test(
      message,
    )
  ) {
    return "provider_server";
  }
  if (
    /econnreset|econnrefused|enotfound|etimedout|socket hang up|network error|fetch failed|dns/u.test(
      `${code} ${message}`,
    )
  ) {
    return "network";
  }
  if (
    /tool.{0,24}(?:schema|dialect|choice|call).{0,24}(?:invalid|unsupported)|invalid.{0,24}tool/u.test(
      message,
    )
  ) {
    return "tool_dialect";
  }
  return "unknown";
}

export function routeCanFallback(input: {
  failureClass: RouteFailureClass;
  visibleOutputProduced: boolean;
  sideEffectState: ModelRouteSideEffectState;
  hasNextCandidate: boolean;
  aborted: boolean;
}): boolean {
  return (
    !input.aborted &&
    input.hasNextCandidate &&
    !input.visibleOutputProduced &&
    input.sideEffectState === "none" &&
    RETRYABLE_FAILURES.has(input.failureClass)
  );
}

export function cooldownDurationMs(failureClass: RouteFailureClass): number {
  if (failureClass === "rate_limited") return 60_000;
  if (failureClass === "provider_server") return 15_000;
  if (failureClass === "network") return 5_000;
  return 0;
}

export function routeErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = record["errorMessage"] ?? record["message"];
    if (typeof message === "string") return message;
  }
  return String(error);
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  const status = record["status"] ?? record["statusCode"];
  if (typeof status === "number") return status;
  const match = /(?:status|http)[ :=-]*(\d{3})/iu.exec(routeErrorText(error));
  return match ? Number(match[1]) : undefined;
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const code = (error as Record<string, unknown>)["code"];
  return typeof code === "string" ? code : "";
}
