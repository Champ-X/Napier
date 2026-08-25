import {
  type CreateInboundChannelRequest,
  type InboundChannelAdapter,
  type InboundChannelPolicyTemplateId,
  type InboundRetryPolicy,
  type InboundSignaturePolicy,
} from "@napier/contracts";
export {
  assertRepositoryLeaseToken as assertHashedToken,
  createRepositoryLeaseToken as createLeaseToken,
} from "./repository-lease.js";

export const DEFAULT_INBOUND_RETRY_POLICY: Readonly<InboundRetryPolicy> = {
  maxAttempts: 3,
  baseDelayMs: 5_000,
};

export const DEFAULT_INBOUND_SIGNATURE_POLICY: Readonly<InboundSignaturePolicy> =
  {
    required: false,
    algorithm: "hmac-sha256",
    header: "X-Napier-Channel-Signature",
    timestampHeader: "X-Napier-Channel-Timestamp",
    toleranceSeconds: 300,
  };

export const DEFAULT_INBOUND_CHANNEL_ADAPTER: InboundChannelAdapter =
  "napier_json";

export type NamedInboundChannelPolicyTemplateId = Exclude<
  InboundChannelPolicyTemplateId,
  "custom"
>;

export const INBOUND_CHANNEL_POLICY_TEMPLATES: Readonly<
  Record<
    NamedInboundChannelPolicyTemplateId,
    {
      retryPolicy: InboundRetryPolicy;
      signaturePolicy: InboundSignaturePolicy;
    }
  >
> = {
  legacy_bearer: {
    retryPolicy: { maxAttempts: 3, baseDelayMs: 5_000 },
    signaturePolicy: {
      required: false,
      algorithm: "hmac-sha256",
      header: "X-Napier-Channel-Signature",
      timestampHeader: "X-Napier-Channel-Timestamp",
      toleranceSeconds: 300,
    },
  },
  signed_standard: {
    retryPolicy: { maxAttempts: 3, baseDelayMs: 5_000 },
    signaturePolicy: {
      required: true,
      algorithm: "hmac-sha256",
      header: "X-Napier-Channel-Signature",
      timestampHeader: "X-Napier-Channel-Timestamp",
      toleranceSeconds: 300,
    },
  },
  signed_strict: {
    retryPolicy: { maxAttempts: 2, baseDelayMs: 1_000 },
    signaturePolicy: {
      required: true,
      algorithm: "hmac-sha256",
      header: "X-Napier-Channel-Signature",
      timestampHeader: "X-Napier-Channel-Timestamp",
      toleranceSeconds: 60,
    },
  },
};

export const MAX_INBOUND_ATTEMPTS = 10;

export const MIN_INBOUND_RETRY_BASE_MS = 250;

export const MAX_INBOUND_RETRY_BASE_MS = 60_000;

export const MIN_INBOUND_SIGNATURE_TOLERANCE_SECONDS = 30;

export const MAX_INBOUND_SIGNATURE_TOLERANCE_SECONDS = 900;

export function normalizeChannelName(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("Inbound channel name is required");
  if (normalized.length > 100) {
    throw new Error("Inbound channel name must be at most 100 characters");
  }
  return normalized;
}

export function normalizeInboundChannelAdapter(
  adapter: unknown,
): InboundChannelAdapter {
  if (adapter === undefined) return DEFAULT_INBOUND_CHANNEL_ADAPTER;
  if (
    adapter === "napier_json" ||
    adapter === "github_webhook" ||
    adapter === "slack_event" ||
    adapter === "linear_webhook"
  ) {
    return adapter;
  }
  throw new Error("Inbound channel adapter is invalid");
}

export function normalizeInboundChannelPolicy(
  request: CreateInboundChannelRequest,
): {
  retryPolicy: InboundRetryPolicy | undefined;
  signaturePolicy: Partial<InboundSignaturePolicy> | undefined;
} {
  const templateId =
    request.policyTemplate ??
    (request.retryPolicy || request.signaturePolicy
      ? "custom"
      : "legacy_bearer");
  if (templateId === "custom") {
    return {
      retryPolicy: request.retryPolicy,
      signaturePolicy: request.signaturePolicy,
    };
  }
  if (!isNamedInboundChannelPolicyTemplateId(templateId)) {
    throw new Error("Inbound channel policy template is invalid");
  }
  if (
    request.retryPolicy !== undefined ||
    request.signaturePolicy !== undefined
  ) {
    throw new Error(
      "Inbound channel policy template cannot be combined with explicit policies",
    );
  }
  const template = INBOUND_CHANNEL_POLICY_TEMPLATES[templateId];
  return {
    retryPolicy: structuredClone(template.retryPolicy),
    signaturePolicy: structuredClone(template.signaturePolicy),
  };
}

export function deriveInboundChannelPolicyTemplate(
  retryPolicy: InboundRetryPolicy,
  signaturePolicy: InboundSignaturePolicy,
): InboundChannelPolicyTemplateId {
  for (const [templateId, template] of Object.entries(
    INBOUND_CHANNEL_POLICY_TEMPLATES,
  ) as Array<
    [
      NamedInboundChannelPolicyTemplateId,
      (typeof INBOUND_CHANNEL_POLICY_TEMPLATES)[NamedInboundChannelPolicyTemplateId],
    ]
  >) {
    if (
      sameInboundRetryPolicy(retryPolicy, template.retryPolicy) &&
      sameInboundSignaturePolicy(signaturePolicy, template.signaturePolicy)
    ) {
      return templateId;
    }
  }
  return "custom";
}

export function isNamedInboundChannelPolicyTemplateId(
  value: unknown,
): value is NamedInboundChannelPolicyTemplateId {
  return (
    typeof value === "string" &&
    Object.hasOwn(INBOUND_CHANNEL_POLICY_TEMPLATES, value)
  );
}

export function sameInboundRetryPolicy(
  left: InboundRetryPolicy,
  right: InboundRetryPolicy,
): boolean {
  return (
    left.maxAttempts === right.maxAttempts &&
    left.baseDelayMs === right.baseDelayMs
  );
}

export function sameInboundSignaturePolicy(
  left: InboundSignaturePolicy,
  right: InboundSignaturePolicy,
): boolean {
  return (
    left.required === right.required &&
    left.algorithm === right.algorithm &&
    left.header === right.header &&
    left.timestampHeader === right.timestampHeader &&
    left.toleranceSeconds === right.toleranceSeconds
  );
}

export function normalizeInboundRetryPolicy(
  policy: InboundRetryPolicy | undefined,
  allowDefault = true,
): InboundRetryPolicy {
  if (policy === undefined) {
    if (!allowDefault) {
      throw new Error("Inbound retry policy is required");
    }
    policy = structuredClone(DEFAULT_INBOUND_RETRY_POLICY);
  }
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("Inbound retry policy must be an object");
  }
  const normalized = policy;
  if (
    !Number.isInteger(normalized.maxAttempts) ||
    normalized.maxAttempts < 1 ||
    normalized.maxAttempts > MAX_INBOUND_ATTEMPTS
  ) {
    throw new Error(
      `Inbound retry maxAttempts must be an integer from 1 to ${MAX_INBOUND_ATTEMPTS}`,
    );
  }
  if (
    !Number.isInteger(normalized.baseDelayMs) ||
    normalized.baseDelayMs < MIN_INBOUND_RETRY_BASE_MS ||
    normalized.baseDelayMs > MAX_INBOUND_RETRY_BASE_MS
  ) {
    throw new Error(
      `Inbound retry baseDelayMs must be an integer from ${MIN_INBOUND_RETRY_BASE_MS} to ${MAX_INBOUND_RETRY_BASE_MS}`,
    );
  }
  return {
    maxAttempts: normalized.maxAttempts,
    baseDelayMs: normalized.baseDelayMs,
  };
}

export function normalizeInboundSignaturePolicy(
  policy: Partial<InboundSignaturePolicy> | undefined,
): InboundSignaturePolicy {
  if (policy === undefined) {
    return structuredClone(DEFAULT_INBOUND_SIGNATURE_POLICY);
  }
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("Inbound signature policy must be an object");
  }
  const required =
    typeof policy.required === "boolean" ? policy.required : false;
  const toleranceSeconds =
    policy.toleranceSeconds === undefined
      ? DEFAULT_INBOUND_SIGNATURE_POLICY.toleranceSeconds
      : policy.toleranceSeconds;
  if (
    !Number.isInteger(toleranceSeconds) ||
    toleranceSeconds < MIN_INBOUND_SIGNATURE_TOLERANCE_SECONDS ||
    toleranceSeconds > MAX_INBOUND_SIGNATURE_TOLERANCE_SECONDS
  ) {
    throw new Error(
      `Inbound signature toleranceSeconds must be an integer from ${MIN_INBOUND_SIGNATURE_TOLERANCE_SECONDS} to ${MAX_INBOUND_SIGNATURE_TOLERANCE_SECONDS}`,
    );
  }
  return {
    required,
    algorithm: "hmac-sha256",
    header: "X-Napier-Channel-Signature",
    timestampHeader: "X-Napier-Channel-Timestamp",
    toleranceSeconds,
  };
}

export function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 8 ||
    normalized.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error("Inbound idempotency key must be 8-200 visible characters");
  }
  return normalized;
}

export function normalizeInboundMessage(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) throw new Error("Inbound message is required");
  if (normalized.length > 20_000) {
    throw new Error("Inbound message must be at most 20000 characters");
  }
  return normalized;
}

export function normalizeOptionalSha256(
  value: string | undefined,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

export function normalizeInboundModel(model: { provider: string; id: string }) {
  const provider = model.provider.trim().toLowerCase();
  const id = model.id.trim();
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(provider) || !id || /\s/.test(id)) {
    throw new Error("Inbound model is invalid");
  }
  return { provider, id };
}
