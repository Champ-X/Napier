import type {
  InboundChannelAdapterDescriptor,
  InboundChannelPolicyTemplateId,
  InboundDeadLetterExport,
  InboundDeadLetterExportVerification,
  InboundDeadLetterRetryHistory,
  PreviewInboundChannelAdapterRequest,
} from "@napier/contracts";

import {
  deadLetterExportFilename,
  deadLetterRetryHistoryFilename,
} from "./automation-artifact-view-model";
import { automationCopy as copy } from "./automation-copy";

export const MAX_DEAD_LETTER_EXPORT_FILE_BYTES = 2 * 1024 * 1024;

export const CHANNEL_POLICY_TEMPLATES: Readonly<
  Record<
    Exclude<InboundChannelPolicyTemplateId, "custom">,
    { maxAttempts: number; retrySeconds: number; signatureRequired: boolean }
  >
> = {
  legacy_bearer: {
    maxAttempts: 3,
    retrySeconds: 5,
    signatureRequired: false,
  },
  signed_standard: {
    maxAttempts: 3,
    retrySeconds: 5,
    signatureRequired: true,
  },
  signed_strict: {
    maxAttempts: 2,
    retrySeconds: 1,
    signatureRequired: true,
  },
};

export const CHANNEL_POLICY_TEMPLATE_IDS: InboundChannelPolicyTemplateId[] = [
  "signed_standard",
  "signed_strict",
  "legacy_bearer",
  "custom",
];

export function formatAutomationDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function shortAutomationHash(value: string | undefined): string {
  return value ? value.slice(0, 12) : copy.hashMissing;
}

export function formatAutomationDuration(value: number): string {
  if (value < 1_000) return `${value} ms`;
  return `${Number((value / 1_000).toFixed(2))} s`;
}

export function parsePreviewHeaders(
  input: string,
): Pick<PreviewInboundChannelAdapterRequest, "headers"> {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "{}") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(copy.previewHeadersInvalid);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(copy.previewHeadersInvalid);
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") throw new Error(copy.previewHeadersInvalid);
    headers[key] = value;
  }
  return Object.keys(headers).length > 0 ? { headers } : {};
}

export function adapterSampleHeadersText(
  adapter: InboundChannelAdapterDescriptor | undefined,
): string {
  if (!adapter || Object.keys(adapter.sampleHeaders).length === 0) return "{}";
  return JSON.stringify(adapter.sampleHeaders, null, 2);
}

export function adapterSampleBody(
  adapter: InboundChannelAdapterDescriptor | undefined,
): string {
  return adapter?.sampleBody ?? "{}";
}

export function deadLetterQualificationSummary(
  artifact: InboundDeadLetterExport,
): {
  qualifiedCount: number;
  evidenceMissingCount: number;
  adapterCatalogDriftCount: number;
} {
  return {
    qualifiedCount:
      artifact.qualifiedCount ??
      artifact.deliveries.filter(
        (delivery) => delivery.qualificationStatus === "qualified",
      ).length,
    evidenceMissingCount:
      artifact.evidenceMissingCount ??
      artifact.deliveries.filter(
        (delivery) => delivery.qualificationStatus === "evidence_missing",
      ).length,
    adapterCatalogDriftCount:
      artifact.adapterCatalogDriftCount ??
      artifact.deliveries.filter(
        (delivery) => delivery.qualificationStatus === "adapter_catalog_drift",
      ).length,
  };
}

export function downloadDeadLetterArtifact(
  artifact: InboundDeadLetterExport,
): void {
  downloadJsonArtifact(artifact, deadLetterExportFilename(artifact));
}

export function downloadDeadLetterRetryHistoryArtifact(
  history: InboundDeadLetterRetryHistory,
): void {
  downloadJsonArtifact(history, deadLetterRetryHistoryFilename(history));
}

export function deadLetterVerificationHash(
  verification: InboundDeadLetterExportVerification,
): string {
  return (
    verification.declaredContentSha256 ??
    verification.recomputedContentSha256 ??
    verification.contentSha256
  );
}

export async function readAutomationJsonFile(file: File): Promise<unknown> {
  return JSON.parse(await file.text()) as unknown;
}

function downloadJsonArtifact(value: unknown, filename: string): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
