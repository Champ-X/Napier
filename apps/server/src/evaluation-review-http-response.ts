import type { Context } from "hono";

import type {
  EvaluationAdjudication,
  EvaluationConsensusReport,
  EvaluationConsensusResolution,
  EvaluationReviewerBallot,
  ResolveEvaluationConsensusResult,
} from "@napier/contracts";

import {
  setBodyContentSha256Header,
  setStableContentSha256Header,
} from "./http-response-evidence.js";

export function setEvaluationAdjudicationHeaders(
  context: Context,
  adjudication: EvaluationAdjudication,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, adjudication);
  context.header("X-Napier-Thread-Id", adjudication.threadId);
  context.header("X-Napier-Evaluation-Id", adjudication.evaluationId);
  context.header("X-Napier-Adjudication-Id", adjudication.id);
  context.header(
    "X-Napier-Adjudication-Revision",
    String(adjudication.currentRevision),
  );
  context.header(
    "X-Napier-Adjudication-Revision-Count",
    String(adjudication.revisions.length),
  );
  const latest = adjudication.revisions.at(-1);
  if (latest) {
    context.header("X-Napier-Adjudication-SHA256", latest.contentSha256);
    context.header("X-Napier-Expected-Verdict", latest.expectedVerdict);
    context.header("X-Napier-Evaluation-SHA256", latest.evaluationSha256);
  }
}

export function setEvaluationReviewerBallotListHeaders(
  context: Context,
  threadId: string,
  evaluationId: string,
  ballots: readonly EvaluationReviewerBallot[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, ballots);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Evaluation-Id", evaluationId);
  context.header("X-Napier-Reviewer-Ballot-Count", String(ballots.length));
  context.header(
    "X-Napier-Reviewer-Ballot-Revision-Count",
    String(
      ballots.reduce((total, ballot) => total + ballot.revisions.length, 0),
    ),
  );
}

export function setEvaluationReviewerBallotHeaders(
  context: Context,
  ballot: EvaluationReviewerBallot,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, ballot);
  context.header("X-Napier-Thread-Id", ballot.threadId);
  context.header("X-Napier-Evaluation-Id", ballot.evaluationId);
  context.header("X-Napier-Reviewer-Ballot-Id", ballot.id);
  context.header("X-Napier-Reviewer-Id", ballot.reviewerId);
  context.header(
    "X-Napier-Reviewer-Ballot-Revision",
    String(ballot.currentRevision),
  );
  context.header(
    "X-Napier-Reviewer-Ballot-Revision-Count",
    String(ballot.revisions.length),
  );
  const latest = ballot.revisions.at(-1);
  if (latest) {
    context.header("X-Napier-Reviewer-Ballot-SHA256", latest.contentSha256);
    context.header("X-Napier-Expected-Verdict", latest.expectedVerdict);
    context.header("X-Napier-Evaluation-SHA256", latest.evaluationSha256);
  }
}

export function setEvaluationConsensusReportHeaders(
  context: Context,
  report: EvaluationConsensusReport,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, report.contentSha256);
  context.header("X-Napier-Thread-Id", report.threadId);
  context.header("X-Napier-Evaluation-Id", report.evaluationId);
  context.header("X-Napier-Consensus-Status", report.status);
  context.header("X-Napier-Reviewer-Count", String(report.reviewerCount));
  context.header("X-Napier-Consensus-Count", String(report.consensusCount));
  context.header("X-Napier-Agreement-Rate", String(report.agreementRate));
  if (report.consensusVerdict) {
    context.header("X-Napier-Consensus-Verdict", report.consensusVerdict);
  }
}

export function setEvaluationConsensusResolutionListHeaders(
  context: Context,
  threadId: string,
  evaluationId: string,
  resolutions: readonly EvaluationConsensusResolution[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, resolutions);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Evaluation-Id", evaluationId);
  context.header(
    "X-Napier-Consensus-Resolution-Count",
    String(resolutions.length),
  );
}

export function setEvaluationConsensusResolutionResultHeaders(
  context: Context,
  result: ResolveEvaluationConsensusResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Thread-Id", result.report.threadId);
  context.header("X-Napier-Evaluation-Id", result.report.evaluationId);
  context.header(
    "X-Napier-Consensus-Resolution-Created",
    String(result.created),
  );
  context.header("X-Napier-Consensus-Status", result.report.status);
  context.header(
    "X-Napier-Reviewer-Count",
    String(result.report.reviewerCount),
  );
  context.header(
    "X-Napier-Consensus-Count",
    String(result.report.consensusCount),
  );
  context.header(
    "X-Napier-Agreement-Rate",
    String(result.report.agreementRate),
  );
  context.header(
    "X-Napier-Consensus-Report-SHA256",
    result.report.contentSha256,
  );
  context.header("X-Napier-Adjudication-Id", result.adjudication.id);
  context.header(
    "X-Napier-Adjudication-Revision",
    String(result.adjudication.currentRevision),
  );
  if (result.report.consensusVerdict) {
    context.header(
      "X-Napier-Consensus-Verdict",
      result.report.consensusVerdict,
    );
  }
  context.header("X-Napier-Consensus-Resolution-Id", result.resolution.id);
  context.header(
    "X-Napier-Consensus-Resolution-SHA256",
    result.resolution.contentSha256,
  );
}
