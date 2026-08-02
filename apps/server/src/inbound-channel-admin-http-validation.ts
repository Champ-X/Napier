import type {
  CreateInboundChannelRequest,
  InboundChannelPolicyTemplateId,
  PreviewInboundChannelAdapterRequest,
  SetInboundChannelStatusRequest,
  UpdateInboundRetryPolicyRequest,
  UpdateInboundSignaturePolicyRequest,
} from "@napier/contracts";

import {
  normalizeBoundedText,
  requestRecord,
  validThreadId,
} from "./http-request-validation.js";
import {
  MAX_INBOUND_BODY_BYTES,
  parseInboundChannelAdapter,
} from "./inbound-channel-adapter-catalog.js";

interface OptionalField<Value> {
  valid: boolean;
  value?: Value;
}

export function parseCreateInboundChannelRequest(
  input: unknown,
): CreateInboundChannelRequest | undefined {
  const record = requestRecord(input, [
    "name",
    "threadId",
    "adapter",
    "policyTemplate",
    "retryPolicy",
    "signaturePolicy",
  ]);
  if (!record) return undefined;
  const name = normalizeBoundedText(record["name"], 1, 100);
  const threadId = record["threadId"];
  const adapter = optionalField(record, "adapter", parseInboundChannelAdapter);
  const policyTemplate = optionalField(
    record,
    "policyTemplate",
    parseInboundChannelPolicyTemplate,
  );
  const retryPolicy = optionalField(
    record,
    "retryPolicy",
    parseInboundRetryPolicy,
  );
  const signaturePolicy = optionalField(
    record,
    "signaturePolicy",
    parseInboundSignaturePolicy,
  );
  if (
    !name ||
    !validThreadId(threadId) ||
    [adapter, policyTemplate, retryPolicy, signaturePolicy].some(
      (field) => !field.valid,
    ) ||
    !validPolicyOverrideCombination(record, policyTemplate.value)
  ) {
    return undefined;
  }
  return {
    name,
    threadId,
    ...(adapter.value ? { adapter: adapter.value } : {}),
    ...(policyTemplate.value ? { policyTemplate: policyTemplate.value } : {}),
    ...(retryPolicy.value ? { retryPolicy: retryPolicy.value } : {}),
    ...(signaturePolicy.value
      ? { signaturePolicy: signaturePolicy.value }
      : {}),
  };
}

export function parsePreviewInboundChannelAdapterRequest(
  input: unknown,
): PreviewInboundChannelAdapterRequest | undefined {
  const record = requestRecord(input, ["body", "headers"]);
  const body = record?.["body"];
  const headers =
    record?.["headers"] === undefined
      ? undefined
      : parsePreviewInboundHeaders(record["headers"]);
  if (
    !record ||
    typeof body !== "string" ||
    body.length === 0 ||
    Buffer.byteLength(body) > MAX_INBOUND_BODY_BYTES ||
    (record["headers"] !== undefined && !headers)
  ) {
    return undefined;
  }
  return {
    body,
    ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

export function parseSetInboundChannelStatusRequest(
  input: unknown,
): SetInboundChannelStatusRequest | undefined {
  const record = requestRecord(input, ["status"]);
  const status = record?.["status"];
  return record && (status === "active" || status === "disabled")
    ? { status }
    : undefined;
}

export function parseUpdateInboundRetryPolicyRequest(
  input: unknown,
): UpdateInboundRetryPolicyRequest | undefined {
  const record = requestRecord(input, ["retryPolicy"]);
  const retryPolicy = parseInboundRetryPolicy(record?.["retryPolicy"]);
  return record && retryPolicy ? { retryPolicy } : undefined;
}

export function parseUpdateInboundSignaturePolicyRequest(
  input: unknown,
): UpdateInboundSignaturePolicyRequest | undefined {
  const record = requestRecord(input, ["signaturePolicy"]);
  const signaturePolicy = parseInboundSignaturePolicy(
    record?.["signaturePolicy"],
  );
  return record && signaturePolicy ? { signaturePolicy } : undefined;
}

function optionalField<Value>(
  record: Record<string, unknown>,
  key: string,
  parse: (input: unknown) => Value | undefined,
): OptionalField<Value> {
  if (record[key] === undefined) return { valid: true };
  const value = parse(record[key]);
  return value === undefined ? { valid: false } : { valid: true, value };
}

function validPolicyOverrideCombination(
  record: Record<string, unknown>,
  policyTemplate: InboundChannelPolicyTemplateId | undefined,
): boolean {
  const retryProvided = record["retryPolicy"] !== undefined;
  const signatureProvided = record["signaturePolicy"] !== undefined;
  if (
    policyTemplate !== undefined &&
    policyTemplate !== "custom" &&
    (retryProvided || signatureProvided)
  ) {
    return false;
  }
  return policyTemplate !== "custom" || retryProvided || signatureProvided;
}

function parsePreviewInboundHeaders(
  input: unknown,
): Record<string, string> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 32) return undefined;
  const output: Record<string, string> = {};
  for (const [key, value] of entries) {
    const normalizedKey = key.trim().toLowerCase();
    if (
      !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(normalizedKey) ||
      typeof value !== "string" ||
      value.length > 1_000 ||
      /[\r\n\u0000]/u.test(value)
    ) {
      return undefined;
    }
    output[normalizedKey] = value.trim();
  }
  return output;
}

function parseInboundChannelPolicyTemplate(
  input: unknown,
): InboundChannelPolicyTemplateId | undefined {
  return input === "legacy_bearer" ||
    input === "signed_standard" ||
    input === "signed_strict" ||
    input === "custom"
    ? input
    : undefined;
}

function parseInboundSignaturePolicy(
  input: unknown,
): CreateInboundChannelRequest["signaturePolicy"] | undefined {
  const record = requestRecord(input, ["required", "toleranceSeconds"]);
  const required = record?.["required"];
  const toleranceSeconds = record?.["toleranceSeconds"];
  if (
    !record ||
    typeof required !== "boolean" ||
    (toleranceSeconds !== undefined &&
      (typeof toleranceSeconds !== "number" ||
        !Number.isInteger(toleranceSeconds) ||
        toleranceSeconds < 30 ||
        toleranceSeconds > 900))
  ) {
    return undefined;
  }
  return {
    required,
    ...(typeof toleranceSeconds === "number" ? { toleranceSeconds } : {}),
  };
}

function parseInboundRetryPolicy(
  input: unknown,
): UpdateInboundRetryPolicyRequest["retryPolicy"] | undefined {
  const record = requestRecord(input, ["maxAttempts", "baseDelayMs"]);
  const maxAttempts = record?.["maxAttempts"];
  const baseDelayMs = record?.["baseDelayMs"];
  if (
    !record ||
    typeof maxAttempts !== "number" ||
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 10 ||
    typeof baseDelayMs !== "number" ||
    !Number.isInteger(baseDelayMs) ||
    baseDelayMs < 250 ||
    baseDelayMs > 60_000
  ) {
    return undefined;
  }
  return { maxAttempts, baseDelayMs };
}
