import type { RunEvent } from "@napier/contracts";

export interface CredentialEventTraceView {
  action: string;
  referenceId?: string;
  providerId?: string;
  sourceType?: string;
  status?: string;
  availability?: string;
  revision?: number;
}

const CREDENTIAL_EVENT =
  /^credential\.reference\.(created|keychain_created|checked|enabled|disabled)$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:/@-]{1,180}$/u;
const CREDENTIAL_RECEIPT_SUMMARY = "credential receipt";

export function credentialEventTraceView(
  event: RunEvent,
): CredentialEventTraceView | undefined {
  if (!CREDENTIAL_EVENT.test(event.type)) return undefined;
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  return {
    action: event.type.slice("credential.".length),
    ...safeTokenField(event.payload, "referenceId"),
    ...safeTokenField(event.payload, "providerId"),
    ...safeTokenField(event.payload, "sourceType"),
    ...safeTokenField(event.payload, "status"),
    ...safeTokenField(event.payload, "availability"),
    ...integerField(event.payload, "revision"),
  };
}

export function credentialEventTraceSummary(
  event: RunEvent,
): string | undefined {
  if (!event.type.startsWith("credential.")) return undefined;
  if (!CREDENTIAL_EVENT.test(event.type)) return event.category;
  const view = credentialEventTraceView(event);
  if (!view) return CREDENTIAL_RECEIPT_SUMMARY;
  return [
    `credential / ${view.action}`,
    ...idSummary("reference", view.referenceId),
    ...(view.providerId ? [`provider ${view.providerId}`] : []),
    ...(view.sourceType ? [`source ${view.sourceType}`] : []),
    ...(view.status ? [`status ${view.status}`] : []),
    ...(view.availability ? [`availability ${view.availability}`] : []),
    ...(view.revision !== undefined ? [`revision ${view.revision}`] : []),
  ].join(" / ");
}

function idSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(-10)}`] : [];
}

function safeTokenField(
  payload: Record<string, unknown>,
  key: keyof CredentialEventTraceView,
): Partial<CredentialEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function integerField(
  payload: Record<string, unknown>,
  key: keyof CredentialEventTraceView,
): Partial<CredentialEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? { [key]: value }
    : {};
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value)
    ? value
    : undefined;
}
