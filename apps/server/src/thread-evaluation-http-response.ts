import type {
  ContextCheckpointCalibrationReport,
  EvaluationAdjudication,
  EvaluationCalibrationReport,
  RunEvaluationRecord,
} from "@napier/contracts";
import type { Context } from "hono";

import {
  setBodyContentSha256Header,
  setStableContentSha256Header,
} from "./http-response-evidence.js";

export function setRunEvaluationListHeaders(
  context: Context,
  threadId: string,
  evaluations: readonly RunEvaluationRecord[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, evaluations);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Evaluation-Count", String(evaluations.length));
}

export function setEvaluationAdjudicationListHeaders(
  context: Context,
  threadId: string,
  adjudications: readonly EvaluationAdjudication[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, adjudications);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Adjudication-Count", String(adjudications.length));
  context.header(
    "X-Napier-Adjudication-Revision-Count",
    String(
      adjudications.reduce(
        (total, adjudication) => total + adjudication.revisions.length,
        0,
      ),
    ),
  );
}

export function setEvaluationCalibrationHeaders(
  context: Context,
  report: EvaluationCalibrationReport,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, report.contentSha256);
  context.header("X-Napier-Thread-Id", report.threadId);
  context.header(
    "X-Napier-Calibration-Sample-Count",
    String(report.sampleCount),
  );
  context.header(
    "X-Napier-Calibration-Agreement-Count",
    String(report.agreementCount),
  );
  context.header(
    "X-Napier-Calibration-Agreement-Rate",
    String(report.agreementRate),
  );
  context.header(
    "X-Napier-Calibration-Group-Count",
    String(report.groups.length),
  );
}

export function setContextCheckpointCalibrationHeaders(
  context: Context,
  report: ContextCheckpointCalibrationReport,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, report.contentSha256);
  context.header("X-Napier-Thread-Id", report.threadId);
  context.header("X-Napier-Event-Stream-SHA256", report.eventStreamSha256);
  context.header(
    "X-Napier-Message-Event-Count",
    String(report.messageEventCount),
  );
  context.header("X-Napier-Checkpoint-Count", String(report.checkpointCount));
  context.header(
    "X-Napier-Verified-Checkpoint-Count",
    String(report.verifiedCheckpointCount),
  );
  context.header(
    "X-Napier-Drifted-Checkpoint-Count",
    String(report.driftedCheckpointCount),
  );
  context.header(
    "X-Napier-Malformed-Checkpoint-Count",
    String(report.malformedCheckpointCount),
  );
  context.header(
    "X-Napier-Context-Compaction-Failure-Count",
    String(report.failureCount),
  );
  context.header(
    "X-Napier-Covered-Message-Count",
    String(report.coveredMessageCount),
  );
  context.header("X-Napier-Coverage-Rate", String(report.coverageRate));
  context.header("X-Napier-Compression-Ratio", String(report.compressionRatio));
  context.header(
    "X-Napier-Fallback-Omitted-Message-Count",
    String(report.fallbackOmittedMessageCount),
  );
  if (report.latestValidCheckpointId) {
    context.header(
      "X-Napier-Latest-Checkpoint-Id",
      report.latestValidCheckpointId,
    );
  }
  if (report.latestValidCheckpointSampleSha256) {
    context.header(
      "X-Napier-Latest-Checkpoint-Sample-SHA256",
      report.latestValidCheckpointSampleSha256,
    );
  }
}
