import path from "node:path";

import type { ExecutionPlan } from "@napier/contracts";
import type { Context } from "hono";

import {
  type LedgerEventReceiptProjection,
  setBodyContentSha256Header,
  setLedgerEventReceiptHeaders,
  setStableContentSha256Header,
  sha256Json,
  sha256Text,
} from "./http-response-evidence.js";

type PlanArtifact = ExecutionPlan["artifacts"][number];

export function setPlanArtifactDriftCheckHeaders(
  context: Context,
  plan: ExecutionPlan,
  artifact: PlanArtifact,
  inspection: {
    expectedSha256: string;
    result: string;
    observedSha256?: string;
    sizeBytes?: number;
  } & Partial<LedgerEventReceiptProjection>,
): void {
  setPlanArtifactHeaders(context, plan, artifact, inspection);
  context.header(
    "X-Napier-Plan-Artifact-Expected-SHA256",
    inspection.expectedSha256,
  );
  context.header("X-Napier-Plan-Artifact-Drift-Result", inspection.result);
  if (inspection.observedSha256) {
    context.header(
      "X-Napier-Plan-Artifact-Observed-SHA256",
      inspection.observedSha256,
    );
  }
  if (inspection.sizeBytes !== undefined) {
    context.header(
      "X-Napier-Plan-Artifact-Size-Bytes",
      String(inspection.sizeBytes),
    );
  }
}

export function setPlanArtifactTextPreviewHeaders(
  context: Context,
  plan: ExecutionPlan,
  artifact: PlanArtifact,
  preview: {
    sha256: string;
    sizeBytes: number;
    lineCount: number;
    textSha256: string;
  } & Partial<LedgerEventReceiptProjection>,
): void {
  setPlanArtifactHeaders(context, plan, artifact, preview);
  context.header("X-Napier-Plan-Artifact-SHA256", preview.sha256);
  context.header(
    "X-Napier-Plan-Artifact-Size-Bytes",
    String(preview.sizeBytes),
  );
  context.header(
    "X-Napier-Plan-Artifact-Line-Count",
    String(preview.lineCount),
  );
  context.header("X-Napier-Plan-Artifact-Text-SHA256", preview.textSha256);
}

export function setPlanArtifactFileExportHeaders(
  context: Context,
  plan: ExecutionPlan,
  artifact: PlanArtifact,
  exported: {
    sha256: string;
    sizeBytes: number;
  } & Partial<LedgerEventReceiptProjection>,
): void {
  context.header("Cache-Control", "no-store");
  context.header(
    "Content-Disposition",
    `attachment; filename="${planArtifactDownloadFilename(artifact, exported.sha256)}"`,
  );
  setStableContentSha256Header(context, exported.sha256);
  setPlanArtifactIdentityHeaders(context, plan, artifact);
  context.header("X-Napier-Plan-Artifact-SHA256", exported.sha256);
  context.header(
    "X-Napier-Plan-Artifact-Size-Bytes",
    String(exported.sizeBytes),
  );
  setLedgerEventReceiptHeaders(context, exported);
}

export function setPlanArtifactFileVerificationHeaders(
  context: Context,
  verification: {
    verificationStatus: "valid" | "drifted";
    diagnostics: string[];
    threadId: string;
    planId: string;
    artifactId: string;
    expectedSha256: string;
    observedSha256: string;
    expectedSizeBytes: number;
    observedSizeBytes: number;
  } & Partial<LedgerEventReceiptProjection>,
): void {
  setPlanArtifactVerificationHeaders(context, verification);
  context.header(
    "X-Napier-Expected-Artifact-SHA256",
    verification.expectedSha256,
  );
  context.header(
    "X-Napier-Observed-Artifact-SHA256",
    verification.observedSha256,
  );
  context.header(
    "X-Napier-Expected-Artifact-Size-Bytes",
    String(verification.expectedSizeBytes),
  );
  context.header(
    "X-Napier-Observed-Artifact-Size-Bytes",
    String(verification.observedSizeBytes),
  );
}

export function setPlanArtifactDataProfileHeaders(
  context: Context,
  plan: ExecutionPlan,
  artifact: PlanArtifact,
  profile: {
    sha256: string;
    sizeBytes: number;
    format: string;
    rowCount: number;
    columnCount: number;
    truncated: boolean;
    columnSetSha256: string;
    sampleSha256: string;
  } & Partial<LedgerEventReceiptProjection>,
): void {
  setPlanArtifactHeaders(context, plan, artifact, profile);
  context.header("X-Napier-Plan-Artifact-SHA256", profile.sha256);
  context.header(
    "X-Napier-Plan-Artifact-Size-Bytes",
    String(profile.sizeBytes),
  );
  context.header("X-Napier-Plan-Artifact-Data-Format", profile.format);
  context.header("X-Napier-Plan-Artifact-Row-Count", String(profile.rowCount));
  context.header(
    "X-Napier-Plan-Artifact-Column-Count",
    String(profile.columnCount),
  );
  context.header(
    "X-Napier-Plan-Artifact-Data-Truncated",
    String(profile.truncated),
  );
  context.header(
    "X-Napier-Plan-Artifact-Column-Set-SHA256",
    profile.columnSetSha256,
  );
  context.header("X-Napier-Plan-Artifact-Sample-SHA256", profile.sampleSha256);
}

export function setPlanArtifactDataProfileVerificationHeaders(
  context: Context,
  verification: {
    verificationStatus: "valid" | "drifted";
    diagnostics: string[];
    threadId: string;
    planId: string;
    artifactId: string;
    observedSha256: string;
    declaredSha256: string;
    observedColumnSetSha256: string;
    declaredColumnSetSha256: string;
    observedSampleSha256: string;
    declaredSampleSha256: string;
  } & Partial<LedgerEventReceiptProjection>,
): void {
  setPlanArtifactVerificationHeaders(context, verification);
  context.header(
    "X-Napier-Declared-Artifact-SHA256",
    verification.declaredSha256,
  );
  context.header(
    "X-Napier-Observed-Artifact-SHA256",
    verification.observedSha256,
  );
  context.header(
    "X-Napier-Declared-Column-Set-SHA256",
    verification.declaredColumnSetSha256,
  );
  context.header(
    "X-Napier-Observed-Column-Set-SHA256",
    verification.observedColumnSetSha256,
  );
  context.header(
    "X-Napier-Declared-Sample-SHA256",
    verification.declaredSampleSha256,
  );
  context.header(
    "X-Napier-Observed-Sample-SHA256",
    verification.observedSampleSha256,
  );
}

export function setPlanArtifactDirectoryManifestHeaders(
  context: Context,
  plan: ExecutionPlan,
  artifact: PlanArtifact,
  manifest: {
    sha256: string;
    sizeBytes: number;
    entryCount: number;
    fileCount: number;
    directoryCount: number;
  } & Partial<LedgerEventReceiptProjection>,
): void {
  setPlanArtifactHeaders(context, plan, artifact, manifest);
  context.header("X-Napier-Plan-Artifact-SHA256", manifest.sha256);
  context.header(
    "X-Napier-Plan-Artifact-Size-Bytes",
    String(manifest.sizeBytes),
  );
  context.header(
    "X-Napier-Plan-Artifact-Entry-Count",
    String(manifest.entryCount),
  );
  context.header(
    "X-Napier-Plan-Artifact-File-Count",
    String(manifest.fileCount),
  );
  context.header(
    "X-Napier-Plan-Artifact-Directory-Count",
    String(manifest.directoryCount),
  );
}

export function setPlanArtifactDirectoryManifestVerificationHeaders(
  context: Context,
  verification: {
    verificationStatus: "valid" | "drifted";
    diagnostics: string[];
    threadId: string;
    planId: string;
    artifactId: string;
    declaredSha256: string;
    observedSha256: string;
    declaredEntrySetSha256: string;
    observedEntrySetSha256: string;
  } & Partial<LedgerEventReceiptProjection>,
): void {
  setPlanArtifactVerificationHeaders(context, verification);
  context.header(
    "X-Napier-Declared-Artifact-SHA256",
    verification.declaredSha256,
  );
  context.header(
    "X-Napier-Observed-Artifact-SHA256",
    verification.observedSha256,
  );
  context.header(
    "X-Napier-Declared-Entry-Set-SHA256",
    verification.declaredEntrySetSha256,
  );
  context.header(
    "X-Napier-Observed-Entry-Set-SHA256",
    verification.observedEntrySetSha256,
  );
}

function setPlanArtifactHeaders(
  context: Context,
  plan: ExecutionPlan,
  artifact: PlanArtifact,
  receipt: Partial<LedgerEventReceiptProjection>,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, receipt);
  setPlanArtifactIdentityHeaders(context, plan, artifact);
  setLedgerEventReceiptHeaders(context, receipt);
}

function setPlanArtifactIdentityHeaders(
  context: Context,
  plan: ExecutionPlan,
  artifact: PlanArtifact,
): void {
  context.header("X-Napier-Thread-Id", plan.threadId);
  context.header("X-Napier-Plan-Id", plan.id);
  context.header("X-Napier-Plan-Revision", String(plan.revision));
  context.header("X-Napier-Plan-Artifact-Id", artifact.id);
  context.header("X-Napier-Plan-Artifact-Status", artifact.status);
  context.header(
    "X-Napier-Plan-Artifact-Path-SHA256",
    sha256Text(artifact.path),
  );
}

function setPlanArtifactVerificationHeaders(
  context: Context,
  verification: {
    verificationStatus: "valid" | "drifted";
    diagnostics: string[];
    threadId: string;
    planId: string;
    artifactId: string;
  } & Partial<LedgerEventReceiptProjection>,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header(
    "X-Napier-Verification-Status",
    verification.verificationStatus,
  );
  context.header("X-Napier-Thread-Id", verification.threadId);
  context.header("X-Napier-Plan-Id", verification.planId);
  context.header("X-Napier-Plan-Artifact-Id", verification.artifactId);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  setLedgerEventReceiptHeaders(context, verification);
}

function planArtifactDownloadFilename(
  artifact: PlanArtifact,
  sha256: string,
): string {
  const safeArtifactId = safePlanArtifactFilenameSegment(
    artifact.id,
    "artifact",
  );
  const safeName = safePlanArtifactFilenameSegment(
    path.basename(artifact.path),
    safeArtifactId,
  );
  return `napier-artifact-${safeArtifactId}-${sha256.slice(0, 12)}-${safeName}`;
}

function safePlanArtifactFilenameSegment(
  value: string,
  fallback: string,
): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized.length > 0 && normalized !== "." && normalized !== ".."
    ? normalized
    : fallback;
}
