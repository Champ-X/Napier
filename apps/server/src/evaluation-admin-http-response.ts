import type { Context } from "hono";

import type {
  EvaluationCasebook,
  EvaluationCasebookQualificationExecution,
  EvaluationSuite,
  EvaluationSuiteExecution,
} from "@napier/contracts";

import {
  setBodyContentSha256Header,
  setStableContentSha256Header,
} from "./http-response-evidence.js";

export function setEvaluationCasebookProjectionHeaders(
  context: Context,
  casebook: EvaluationCasebook,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, casebook);
  context.header("X-Napier-Casebook-Id", casebook.id);
  context.header(
    "X-Napier-Casebook-Revision",
    String(casebook.currentRevision),
  );
  context.header("X-Napier-Case-Count", String(casebook.cases.length));
  context.header(
    "X-Napier-Casebook-Revision-Count",
    String(casebook.revisions.length),
  );
}

export function setEvaluationCasebookQualificationExecutionHeaders(
  context: Context,
  execution: EvaluationCasebookQualificationExecution,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, execution.contentSha256);
  context.header("X-Napier-Casebook-Id", execution.casebookId);
  context.header(
    "X-Napier-Casebook-Revision",
    String(execution.casebookRevision),
  );
  context.header("X-Napier-Qualification-Execution-Id", execution.id);
  context.header("X-Napier-Qualification-Execution-Status", execution.status);
  context.header("X-Napier-Audit-Thread-Id", execution.auditThreadId);
  context.header(
    "X-Napier-Qualification-Sample-Count",
    String(execution.sampleCount),
  );
  context.header(
    "X-Napier-Qualification-Agreement-Count",
    String(execution.agreementCount),
  );
  context.header(
    "X-Napier-Qualification-Inconclusive-Count",
    String(execution.inconclusiveCount),
  );
  context.header(
    "X-Napier-Qualification-Unverified-Count",
    String(execution.unverifiedCount),
  );
  context.header(
    "X-Napier-Qualification-Agreement-Rate",
    String(execution.agreementRate),
  );
}

export function setEvaluationSuiteProjectionHeaders(
  context: Context,
  suite: EvaluationSuite,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, suite);
  context.header("X-Napier-Thread-Id", suite.threadId);
  context.header("X-Napier-Evaluation-Suite-Id", suite.id);
  context.header("X-Napier-Evaluation-Suite-Revision", String(suite.revision));
  context.header(
    "X-Napier-Evaluation-Suite-Candidate-Count",
    String(suite.candidateRunIds.length),
  );
  context.header("X-Napier-Baseline-Run-Id", suite.baselineRunId);
}

export function setEvaluationSuiteExecutionHeaders(
  context: Context,
  execution: EvaluationSuiteExecution,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, execution.contentSha256);
  context.header("X-Napier-Thread-Id", execution.threadId);
  context.header("X-Napier-Evaluation-Suite-Id", execution.suiteId);
  context.header("X-Napier-Evaluation-Suite-Execution-Id", execution.id);
  context.header(
    "X-Napier-Evaluation-Suite-Revision",
    String(execution.suiteRevision),
  );
  context.header(
    "X-Napier-Evaluation-Suite-Execution-Status",
    execution.status,
  );
  context.header(
    "X-Napier-Evaluation-Suite-Case-Count",
    String(execution.results.length),
  );
  context.header(
    "X-Napier-Evaluation-Suite-Passed-Count",
    String(execution.passedCount),
  );
  context.header(
    "X-Napier-Evaluation-Suite-Failed-Count",
    String(execution.failedCount),
  );
  context.header(
    "X-Napier-Evaluation-Suite-Inconclusive-Count",
    String(execution.inconclusiveCount),
  );
  context.header(
    "X-Napier-Evaluation-Suite-Pass-Rate",
    String(execution.passRate),
  );
}
