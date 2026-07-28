import type {
  IndependentModelAdvisorIssueCode,
  IndependentModelAdvisorRisk,
  IndependentModelAdvisorVerdict,
  RunEvent,
} from "@napier/contracts";

import { modelAdvisorReviewCopy } from "./model-advisor-review-copy";

const VERDICTS = new Set<IndependentModelAdvisorVerdict>([
  "accept",
  "revise",
  "block",
  "inconclusive",
]);
const RISKS = new Set<IndependentModelAdvisorRisk>(["low", "medium", "high"]);
const ISSUE_CODES = new Set<IndependentModelAdvisorIssueCode>([
  "instruction_following",
  "correctness",
  "evidence",
  "safety",
  "scope",
  "regression",
]);

export interface IndependentModelAdvisorReviewView {
  eventSeq: number;
  verdict: IndependentModelAdvisorVerdict;
  risk: IndependentModelAdvisorRisk;
  score: number;
  reviewerModel: string;
  issueCodes: IndependentModelAdvisorIssueCode[];
  diagnosticCodes: string[];
  verificationToolCompleted?: boolean;
  verificationToolPassed?: boolean;
  workspaceWriteCompleted?: boolean;
  verificationToolPassedAfterWorkspaceWrite?: boolean;
  planCompleted?: boolean;
  planArtifactVerified?: boolean;
  goalSatisfied?: boolean;
  planCompletedAfterWorkspaceWrite?: boolean;
  planArtifactVerifiedAfterWorkspaceWrite?: boolean;
  goalSatisfiedAfterWorkspaceWrite?: boolean;
  latestWorkspaceWriteSeq?: number;
  latestPassedVerificationSeq?: number;
  latestPlanCompletedSeq?: number;
  latestPlanArtifactVerifiedSeq?: number;
  latestGoalSatisfiedSeq?: number;
  modelContextEnvelopeSha256?: string;
  contentSha256: string;
}

export function independentModelAdvisorReviewViews(
  events: RunEvent[],
): IndependentModelAdvisorReviewView[] {
  return events
    .flatMap((event): IndependentModelAdvisorReviewView[] => {
      if (
        event.type !== "model.advisor.independent.reviewed" ||
        !record(event.payload)
      ) {
        return [];
      }
      const payload = event.payload;
      const verdict = payload["verdict"];
      const risk = payload["risk"];
      const score = payload["score"];
      const reviewerModel = payload["reviewerModel"];
      const issues = payload["issues"];
      const diagnosticCodes = payload["diagnosticCodes"];
      const evidenceSummary = payload["evidenceSummary"];
      const modelContextEnvelope = payload["modelContextEnvelope"];
      const contentSha256 = payload["contentSha256"];
      if (
        typeof verdict !== "string" ||
        !VERDICTS.has(verdict as IndependentModelAdvisorVerdict) ||
        typeof risk !== "string" ||
        !RISKS.has(risk as IndependentModelAdvisorRisk) ||
        typeof score !== "number" ||
        !Number.isSafeInteger(score) ||
        !record(reviewerModel) ||
        typeof reviewerModel["provider"] !== "string" ||
        typeof reviewerModel["id"] !== "string" ||
        !Array.isArray(issues) ||
        !Array.isArray(diagnosticCodes) ||
        typeof contentSha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(contentSha256)
      ) {
        return [];
      }
      const issueCodes = issues.flatMap((issue) => {
        if (!record(issue)) return [];
        const code = issue["code"];
        return typeof code === "string" &&
          ISSUE_CODES.has(code as IndependentModelAdvisorIssueCode)
          ? [code as IndependentModelAdvisorIssueCode]
          : [];
      });
      if (issueCodes.length !== issues.length) return [];
      const diagnostics = diagnosticCodes.flatMap((code) =>
        typeof code === "string" ? [code] : [],
      );
      if (diagnostics.length !== diagnosticCodes.length) return [];
      const evidenceView = evidenceSummaryView(evidenceSummary);
      const modelContextEnvelopeSha256 = hash(
        record(modelContextEnvelope)
          ? modelContextEnvelope["contentSha256"]
          : undefined,
      );
      return [
        {
          eventSeq: event.seq,
          verdict: verdict as IndependentModelAdvisorVerdict,
          risk: risk as IndependentModelAdvisorRisk,
          score,
          reviewerModel: `${reviewerModel["provider"]}/${reviewerModel["id"]}`,
          issueCodes,
          diagnosticCodes: diagnostics,
          ...evidenceView,
          ...(modelContextEnvelopeSha256 ? { modelContextEnvelopeSha256 } : {}),
          contentSha256,
        },
      ];
    })
    .sort((left, right) => right.eventSeq - left.eventSeq);
}

export function independentModelAdvisorVerificationState(
  review: IndependentModelAdvisorReviewView,
): string {
  const states = modelAdvisorReviewCopy.verificationStates;
  const checkFreshness =
    review.verificationToolPassedAfterWorkspaceWrite === true
      ? states.current
      : review.verificationToolPassed === true &&
          review.workspaceWriteCompleted === true
        ? states.stale
        : states.notCurrent;
  const passed =
    review.verificationToolPassed === true
      ? states.passed
      : review.verificationToolCompleted
        ? states.notPassed
        : states.missing;
  const seqs = [
    ...(review.latestWorkspaceWriteSeq !== undefined
      ? [`w#${review.latestWorkspaceWriteSeq}`]
      : []),
    ...(review.latestPassedVerificationSeq !== undefined
      ? [`v#${review.latestPassedVerificationSeq}`]
      : []),
  ];
  return [
    `checks ${checkFreshness}`,
    passed,
    ...seqs,
    ...completionFreshnessParts(review),
  ].join(" / ");
}

function completionFreshnessParts(
  review: IndependentModelAdvisorReviewView,
): string[] {
  return [
    ...completionFreshnessPart(
      "plan",
      review.planCompleted,
      review.planCompletedAfterWorkspaceWrite,
      review.workspaceWriteCompleted,
      review.latestPlanCompletedSeq,
    ),
    ...completionFreshnessPart(
      "artifact",
      review.planArtifactVerified,
      review.planArtifactVerifiedAfterWorkspaceWrite,
      review.workspaceWriteCompleted,
      review.latestPlanArtifactVerifiedSeq,
    ),
    ...completionFreshnessPart(
      "goal",
      review.goalSatisfied,
      review.goalSatisfiedAfterWorkspaceWrite,
      review.workspaceWriteCompleted,
      review.latestGoalSatisfiedSeq,
    ),
  ];
}

function completionFreshnessPart(
  label: string,
  present: boolean | undefined,
  current: boolean | undefined,
  workspaceWriteCompleted: boolean | undefined,
  seq: number | undefined,
): string[] {
  if (present === undefined && current === undefined && seq === undefined) {
    return [];
  }
  const state =
    current === true
      ? "current"
      : present === true && workspaceWriteCompleted === true
        ? "stale"
        : present === true
          ? "not-current"
          : "missing";
  return [
    `${label} ${state}`,
    ...(seq !== undefined ? [`${label}#${seq}`] : []),
  ];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

function evidenceSummaryView(
  value: unknown,
):
  | Pick<
      IndependentModelAdvisorReviewView,
      | "verificationToolCompleted"
      | "verificationToolPassed"
      | "workspaceWriteCompleted"
      | "verificationToolPassedAfterWorkspaceWrite"
      | "planCompleted"
      | "planArtifactVerified"
      | "goalSatisfied"
      | "planCompletedAfterWorkspaceWrite"
      | "planArtifactVerifiedAfterWorkspaceWrite"
      | "goalSatisfiedAfterWorkspaceWrite"
      | "latestWorkspaceWriteSeq"
      | "latestPassedVerificationSeq"
      | "latestPlanCompletedSeq"
      | "latestPlanArtifactVerifiedSeq"
      | "latestGoalSatisfiedSeq"
    >
  | undefined {
  if (!record(value)) return undefined;
  const verificationToolCompleted = booleanValue(
    value["verificationToolCompleted"],
  );
  const verificationToolPassed = booleanValue(value["verificationToolPassed"]);
  const workspaceWriteCompleted = booleanValue(
    value["workspaceWriteCompleted"],
  );
  const verificationToolPassedAfterWorkspaceWrite = booleanValue(
    value["verificationToolPassedAfterWorkspaceWrite"],
  );
  const planCompleted = booleanValue(value["planCompleted"]);
  const planArtifactVerified = booleanValue(value["planArtifactVerified"]);
  const goalSatisfied = booleanValue(value["goalSatisfied"]);
  const planCompletedAfterWorkspaceWrite = booleanValue(
    value["planCompletedAfterWorkspaceWrite"],
  );
  const planArtifactVerifiedAfterWorkspaceWrite = booleanValue(
    value["planArtifactVerifiedAfterWorkspaceWrite"],
  );
  const goalSatisfiedAfterWorkspaceWrite = booleanValue(
    value["goalSatisfiedAfterWorkspaceWrite"],
  );
  return {
    ...(verificationToolCompleted !== undefined
      ? { verificationToolCompleted }
      : {}),
    ...(verificationToolPassed !== undefined ? { verificationToolPassed } : {}),
    ...(workspaceWriteCompleted !== undefined
      ? { workspaceWriteCompleted }
      : {}),
    ...(verificationToolPassedAfterWorkspaceWrite !== undefined
      ? { verificationToolPassedAfterWorkspaceWrite }
      : {}),
    ...(planCompleted !== undefined ? { planCompleted } : {}),
    ...(planArtifactVerified !== undefined ? { planArtifactVerified } : {}),
    ...(goalSatisfied !== undefined ? { goalSatisfied } : {}),
    ...(planCompletedAfterWorkspaceWrite !== undefined
      ? { planCompletedAfterWorkspaceWrite }
      : {}),
    ...(planArtifactVerifiedAfterWorkspaceWrite !== undefined
      ? { planArtifactVerifiedAfterWorkspaceWrite }
      : {}),
    ...(goalSatisfiedAfterWorkspaceWrite !== undefined
      ? { goalSatisfiedAfterWorkspaceWrite }
      : {}),
    ...numberField(value, "latestWorkspaceWriteSeq"),
    ...numberField(value, "latestPassedVerificationSeq"),
    ...numberField(value, "latestPlanCompletedSeq"),
    ...numberField(value, "latestPlanArtifactVerifiedSeq"),
    ...numberField(value, "latestGoalSatisfiedSeq"),
  };
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numberField(
  source: Record<string, unknown>,
  key:
    | "latestWorkspaceWriteSeq"
    | "latestPassedVerificationSeq"
    | "latestPlanCompletedSeq"
    | "latestPlanArtifactVerifiedSeq"
    | "latestGoalSatisfiedSeq",
): Pick<IndependentModelAdvisorReviewView, typeof key> | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? { [key]: value }
    : undefined;
}
