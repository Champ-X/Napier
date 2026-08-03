import type { ExecutionPlan } from "@napier/contracts";
import type { Context } from "hono";

import {
  type LedgerEventReceiptProjection,
  setBodyContentSha256Header,
  setLedgerEventReceiptHeaders,
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

function setPlanArtifactHeaders(
  context: Context,
  plan: ExecutionPlan,
  artifact: PlanArtifact,
  receipt: Partial<LedgerEventReceiptProjection>,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, receipt);
  context.header("X-Napier-Thread-Id", plan.threadId);
  context.header("X-Napier-Plan-Id", plan.id);
  context.header("X-Napier-Plan-Revision", String(plan.revision));
  context.header("X-Napier-Plan-Artifact-Id", artifact.id);
  context.header("X-Napier-Plan-Artifact-Status", artifact.status);
  context.header(
    "X-Napier-Plan-Artifact-Path-SHA256",
    sha256Text(artifact.path),
  );
  setLedgerEventReceiptHeaders(context, receipt);
}
