import { contentText, type Api, type Model } from "@earendil-works/pi-ai";
import type {
  ExecutionPlan,
  ExecutionPlanReplanDraftModelReview,
  ExecutionPlanReplanDraftReviewVerdict,
  ModelContextEnvelopeReceipt,
  ModelRef,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { nowIso } from "./ids.js";
import { createModelContextEnvelopeReceipt } from "./model-context-envelope.js";
import type { ModelRegistry } from "./models.js";

const REPLAN_DRAFT_REVIEW_POLICY_ID = "napier.replan-draft-model-review.v1";
const REPLAN_DRAFT_REVIEW_KIND = "napier.execution-plan-replan-draft-review";
const REVIEW_VERDICTS = new Set<ExecutionPlanReplanDraftReviewVerdict>([
  "approve",
  "revise",
  "reject",
  "inconclusive",
]);
const REVIEW_RISKS = new Set(["low", "medium", "high"]);
const REVIEW_SCHEMA = {
  verdict: "approve|revise|reject|inconclusive",
  score: "integer 0-100",
  risk: "low|medium|high",
  reason: "string <= 1000 characters",
  concerns: "array of <= 8 strings, each <= 200 characters",
} as const;

export async function reviewExecutionPlanReplanDraft(
  models: ModelRegistry,
  plan: ExecutionPlan,
  model: ModelRef,
): Promise<ExecutionPlanReplanDraftModelReview> {
  const prompt = buildReplanDraftReviewPrompt(plan);
  if (model.provider === "napier" && model.id === "demo") {
    return createReplanDraftModelReview(plan, model, prompt, {
      verdict: "inconclusive",
      score: 0,
      risk: "high",
      reason:
        "The deterministic demo model cannot independently score a replan draft.",
      concerns: ["live_model_required"],
      responseSha256: sha256("napier/demo:inconclusive"),
    });
  }
  const resolved = models.resolve(model);
  if (!resolved) {
    throw new Error(
      `Replan reviewer model not found: ${model.provider}/${model.id}`,
    );
  }
  const response = await completeReview(models, resolved, prompt);
  return createReplanDraftModelReview(plan, model, prompt, response);
}

interface ReplanDraftReviewPrompt {
  system: string;
  user: string;
  inputSha256: string;
  promptSha256: string;
  reviewSchemaSha256: string;
}

interface ParsedReplanDraftReview {
  verdict: ExecutionPlanReplanDraftReviewVerdict;
  score: number;
  risk: ExecutionPlanReplanDraftModelReview["risk"];
  reason: string;
  concerns: string[];
  responseSha256: string;
  modelContextEnvelope?: ModelContextEnvelopeReceipt;
}

async function completeReview(
  models: ModelRegistry,
  model: Model<Api>,
  prompt: ReplanDraftReviewPrompt,
): Promise<ParsedReplanDraftReview> {
  const requestContext = {
    systemPrompt: prompt.system,
    messages: [
      {
        role: "user" as const,
        content: prompt.user,
        timestamp: Date.now(),
      },
    ],
    tools: [],
  };
  const modelContextEnvelope = createModelContextEnvelopeReceipt({
    turnIndex: 0,
    systemPrompt: requestContext.systemPrompt,
    messages: requestContext.messages,
    tools: requestContext.tools,
  });
  try {
    const response = await models.models.completeSimple(model, requestContext, {
      maxTokens: 1_000,
      temperature: 0,
    });
    const text = contentText(response.content);
    return {
      ...parseReplanDraftReviewResponse(text),
      responseSha256: sha256(text),
      modelContextEnvelope,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      verdict: "inconclusive",
      score: 0,
      risk: "high",
      reason: `Replan draft reviewer failed closed: ${normalizeText(message, 920)}`,
      concerns: ["review_failed_closed"],
      responseSha256: sha256(message),
      modelContextEnvelope,
    };
  }
}

export function buildReplanDraftReviewPrompt(
  plan: ExecutionPlan,
): ReplanDraftReviewPrompt {
  const recommendation = plan.replanRecommendation;
  if (!recommendation) {
    throw new Error("Plan has no active replan recommendation");
  }
  const input = {
    plan: {
      id: plan.id,
      threadId: plan.threadId,
      objective: plan.objective,
      status: plan.status,
      revision: plan.revision,
      criticalPathStepIds: plan.criticalPathStepIds,
      readyStepIds: plan.readyStepIds,
      blockedStepIds: plan.blockedStepIds,
      steps: plan.steps.map((step) => ({
        id: step.id,
        title: step.title,
        status: step.status,
        dependsOn: step.dependsOn,
        ...(step.blocker ? { blocker: step.blocker } : {}),
      })),
      artifacts: plan.artifacts.map((artifact) => ({
        id: artifact.id,
        path: artifact.path,
        kind: artifact.kind,
        status: artifact.status,
      })),
    },
    recommendation: {
      strategy: recommendation.strategy,
      reason: recommendation.reason,
      evidence: recommendation.evidence,
      expectedRevision: recommendation.expectedRevision,
      supersedeStepIds: recommendation.supersedeStepIds,
      supersedeArtifactIds: recommendation.supersedeArtifactIds,
      affectedStepIds: recommendation.affectedStepIds,
      affectedArtifactIds: recommendation.affectedArtifactIds,
      recommendationSha256: recommendation.recommendationSha256,
      draft: {
        draftSha256: recommendation.draft.draftSha256,
        request: recommendation.draft.request,
        deterministicEvaluation: recommendation.draft.evaluation,
      },
    },
  };
  const reviewSchemaSha256 = sha256(canonicalJson(REVIEW_SCHEMA));
  const inputJson = canonicalJson(input);
  const system =
    "You are reviewing a Napier execution-plan replan draft. Return exactly one JSON object matching the provided schema. Do not authorize mutation; only score the draft.";
  const user = [
    "Review this hash-bound replan draft.",
    `Response schema SHA-256: ${reviewSchemaSha256}`,
    `Schema: ${canonicalJson(REVIEW_SCHEMA)}`,
    `Input SHA-256: ${sha256(inputJson)}`,
    inputJson,
  ].join("\n\n");
  return {
    system,
    user,
    inputSha256: sha256(inputJson),
    promptSha256: sha256(canonicalJson({ system, user, reviewSchemaSha256 })),
    reviewSchemaSha256,
  };
}

export function parseReplanDraftReviewResponse(
  text: string,
): Omit<ParsedReplanDraftReview, "responseSha256"> {
  const source = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Replan draft review did not contain JSON");
  }
  const parsed = JSON.parse(source.slice(start, end + 1)) as Record<
    string,
    unknown
  >;
  const verdict = parsed["verdict"];
  const risk = parsed["risk"];
  const score = parsed["score"];
  const concerns = parsed["concerns"];
  if (
    typeof verdict !== "string" ||
    !REVIEW_VERDICTS.has(verdict as ExecutionPlanReplanDraftReviewVerdict) ||
    typeof risk !== "string" ||
    !REVIEW_RISKS.has(risk) ||
    typeof score !== "number" ||
    !Number.isSafeInteger(score) ||
    score < 0 ||
    score > 100 ||
    !Array.isArray(concerns) ||
    concerns.length > 8
  ) {
    throw new Error("Replan draft review JSON is invalid");
  }
  return {
    verdict: verdict as ExecutionPlanReplanDraftReviewVerdict,
    score,
    risk: risk as ExecutionPlanReplanDraftModelReview["risk"],
    reason: normalizeText(parsed["reason"], 1_000),
    concerns: concerns
      .map((concern) => normalizeText(concern, 200))
      .filter(Boolean),
  };
}

function createReplanDraftModelReview(
  plan: ExecutionPlan,
  model: ModelRef,
  prompt: ReplanDraftReviewPrompt,
  response: ParsedReplanDraftReview,
): ExecutionPlanReplanDraftModelReview {
  const recommendation = plan.replanRecommendation;
  if (!recommendation) {
    throw new Error("Plan has no active replan recommendation");
  }
  const content = {
    kind: REPLAN_DRAFT_REVIEW_KIND,
    schemaVersion: 1 as const,
    policyId: REPLAN_DRAFT_REVIEW_POLICY_ID,
    planId: plan.id,
    threadId: plan.threadId,
    expectedRevision: recommendation.expectedRevision,
    recommendationSha256: recommendation.recommendationSha256,
    draftSha256: recommendation.draft.draftSha256,
    deterministicEvaluationSha256:
      recommendation.draft.evaluation.evaluationSha256,
    model,
    verdict: response.verdict,
    score: response.score,
    risk: response.risk,
    reason: response.reason,
    concerns: response.concerns,
    inputSha256: prompt.inputSha256,
    promptSha256: prompt.promptSha256,
    responseSha256: response.responseSha256,
    reviewSchemaSha256: prompt.reviewSchemaSha256,
    ...(response.modelContextEnvelope
      ? { modelContextEnvelope: response.modelContextEnvelope }
      : {}),
    createdAt: nowIso(),
  } satisfies Omit<ExecutionPlanReplanDraftModelReview, "reviewSha256">;
  return {
    ...content,
    reviewSha256: sha256(canonicalJson(content)),
  };
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}
