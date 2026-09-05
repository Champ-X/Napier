import {
  resolvePublicHost,
  validatePublicHttpUrl,
  type PublicHostLookup,
} from "./public-network.js";
import {
  localServiceUrl,
  type RunLocalServiceLeaseRegistry,
} from "./run-local-service-leases.js";

interface BrowserSessionIdentity {
  threadId: string;
  runId: string;
  sessionLane?: string;
}

interface BrowserNavigationRequest {
  action: string;
}

interface BrowserStartPreflightOptions {
  localServiceLeases?: RunLocalServiceLeaseRegistry;
  lookup?: PublicHostLookup;
}

export function browserSessionOwnerKey(owner: BrowserSessionIdentity): string {
  if (!owner.threadId || !owner.runId) {
    throw new Error("Browser Session owner is invalid");
  }
  const base = `${owner.threadId}\u0000${owner.runId}`;
  if (owner.sessionLane === undefined) return base;
  if (!/^[a-z][a-z0-9_.-]{0,63}$/u.test(owner.sessionLane)) {
    throw new Error("Browser Session lane is invalid");
  }
  return `${base}\u0000${owner.sessionLane}`;
}

export function isBrowserNavigationTimeout(
  request: BrowserNavigationRequest,
  error: unknown,
): boolean {
  if (
    request.action !== "start" &&
    request.action !== "navigate" &&
    request.action !== "tab_new"
  ) {
    return false;
  }
  const value =
    error && typeof error === "object"
      ? (error as { name?: unknown; message?: unknown })
      : undefined;
  const name = typeof value?.name === "string" ? value.name : "";
  const message =
    typeof value?.message === "string" ? value.message : String(error);
  return (
    name === "TimeoutError" ||
    /(?:page\.goto:\s*)?Timeout\s+\d+ms\s+exceeded/iu.test(message)
  );
}

export async function preflightBrowserStartUrl(
  owner: BrowserSessionIdentity,
  value: string,
  options: BrowserStartPreflightOptions,
): Promise<void> {
  if (localServiceUrl(options.localServiceLeases, owner, value)) return;
  const url = validatePublicHttpUrl(value);
  await resolvePublicHost(url.hostname, {
    ...(options.lookup ? { lookup: options.lookup } : {}),
  });
}
