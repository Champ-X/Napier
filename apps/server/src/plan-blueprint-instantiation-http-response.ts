import type {
  ExecutionPlan,
  ExecutionPlanBlueprint,
  ExecutionPlanBlueprintRecord,
  ExecutionPlanBlueprintRecordPreview,
  ExecutionPlanBlueprintRecordQualification,
  JsonValue,
  RunEvent,
} from "@napier/contracts";
import type { Context } from "hono";

import {
  setBodyContentSha256Header,
  sha256Json,
} from "./http-response-evidence.js";
import {
  setExecutionPlanBlueprintRecordMetadataHeaders,
  setExecutionPlanBlueprintRecordQualificationMetadataHeaders,
} from "./plan-blueprint-library-http-response.js";
import {
  setExecutionPlanBlueprintSourceHeaders,
  setExecutionPlanHeaders,
} from "./plan-lifecycle-http-response.js";

export function setExecutionPlanFromBlueprintHeaders(
  context: Context,
  plan: ExecutionPlan,
  blueprint: ExecutionPlanBlueprint,
): void {
  setExecutionPlanHeaders(context, plan);
  setExecutionPlanBlueprintSourceHeaders(context, blueprint);
}

export function setExecutionPlanBlueprintRecordPreviewHeaders(
  context: Context,
  preview: ExecutionPlanBlueprintRecordPreview,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, preview);
  context.header("X-Napier-Plan-Blueprint-Preview-Status", preview.status);
  context.header("X-Napier-Blueprint-Preview-SHA256", preview.previewSha256);
  context.header("X-Napier-Plan-Blueprint-Record-Id", preview.recordId);
  context.header("X-Napier-Thread-Id", preview.threadId);
  context.header("X-Napier-Has-Open-Plan", String(preview.hasOpenPlan));
  context.header(
    "X-Napier-Diagnostic-Count",
    String(preview.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(preview.diagnostics),
  );
  setExecutionPlanBlueprintRecordQualificationMetadataHeaders(
    context,
    preview.qualification,
  );
  if (preview.plan) {
    context.header("X-Napier-Plan-Id", preview.plan.id);
    context.header(
      "X-Napier-Plan-Step-Count",
      String(preview.plan.steps.length),
    );
    context.header(
      "X-Napier-Plan-Artifact-Count",
      String(preview.plan.artifacts.length),
    );
  }
}

export function setExecutionPlanFromBlueprintRecordHeaders(
  context: Context,
  plan: ExecutionPlan,
  record: ExecutionPlanBlueprintRecord,
  qualification: ExecutionPlanBlueprintRecordQualification,
  previewSha256: string,
  replayEvent: RunEvent,
): void {
  setExecutionPlanHeaders(context, plan);
  setExecutionPlanBlueprintRecordMetadataHeaders(context, record);
  setExecutionPlanBlueprintRecordQualificationMetadataHeaders(
    context,
    qualification,
  );
  context.header("X-Napier-Blueprint-Preview-SHA256", previewSha256);
  context.header("X-Napier-Blueprint-Replay-Event-Id", replayEvent.id);
  context.header(
    "X-Napier-Blueprint-Replay-Event-Seq",
    String(replayEvent.seq),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Event-SHA256",
    sha256Json(replayEvent as unknown as JsonValue),
  );
}
