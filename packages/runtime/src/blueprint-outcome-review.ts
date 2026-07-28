import { contentText, type Api, type Model } from "@earendil-works/pi-ai";
import type {
  ExecutionPlanBlueprintOutcomeReviewCriteria,
  ExecutionPlanBlueprintOutcomeReviewRisk,
  ExecutionPlanBlueprintOutcomeReviewScore,
  ExecutionPlanBlueprintOutcomeReviewVerdict,
  ExecutionPlanBlueprintRecordOutcomeReview,
  ExecutionPlanBlueprintRecordReplayOutcomes,
  ModelContextEnvelopeReceipt,
  ModelRef,
  ReviewExecutionPlanBlueprintRecordOutcomesRequest,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { nowIso } from "./ids.js";
import { createModelContextEnvelopeReceipt } from "./model-context-envelope.js";
import type { ModelRegistry } from "./models.js";
import type { LocalStore } from "./store.js";

const BLUEPRINT_OUTCOME_REVIEW_POLICY_ID = "napier.blueprint-outcome-review.v1";
const BLUEPRINT_OUTCOME_REVIEW_KIND =
  "napier.execution-plan-blueprint-outcome-review";
const REVIEW_VERDICTS = new Set<ExecutionPlanBlueprintOutcomeReviewVerdict>([
  "promote",
  "revise",
  "reject",
  "inconclusive",
]);
const REVIEW_RISKS = new Set<ExecutionPlanBlueprintOutcomeReviewRisk>([
  "low",
  "medium",
  "high",
]);
const REVIEW_SCHEMA = {
  verdict: "promote|revise|reject|inconclusive",
  score: "integer 0-100",
  risk: "low|medium|high",
  reason: "string <= 1000 characters",
  concerns: "array of <= 8 strings, each <= 200 characters",
  scores:
    "array with one item per criterion: {criterionId, score integer 0-100, reason <= 300 characters}",
} as const;

export const DEFAULT_BLUEPRINT_OUTCOME_REVIEW_CRITERIA: ExecutionPlanBlueprintOutcomeReviewCriteria =
  {
    name: "Reusable workflow delivery",
    criteria: [
      {
        id: "completion",
        name: "Completion",
        description:
          "Replay outcomes should show completed plans without active, blocked, missing, or identity-mismatched delivery.",
      },
      {
        id: "stability",
        name: "Stability",
        description:
          "The template should have enough replay evidence to avoid promoting a one-off lucky result.",
      },
      {
        id: "auditability",
        name: "Auditability",
        description:
          "Outcome, replay-history, baseline, and Plan projection hashes should be present and current.",
      },
      {
        id: "reuse_risk",
        name: "Reuse risk",
        description:
          "The template should be safe to recommend for future Threads without hiding delivery drift or unresolved work.",
      },
    ],
  };

export async function reviewExecutionPlanBlueprintRecordOutcomes(
  store: LocalStore,
  models: ModelRegistry,
  recordId: string,
  request: ReviewExecutionPlanBlueprintRecordOutcomesRequest,
): Promise<ExecutionPlanBlueprintRecordOutcomeReview> {
  const record = store.getExecutionPlanBlueprintRecord(recordId);
  const criteria = normalizeBlueprintOutcomeReviewCriteria(
    request.criteria ?? DEFAULT_BLUEPRINT_OUTCOME_REVIEW_CRITERIA,
  );
  const sourceQualification =
    await store.qualifyExecutionPlanBlueprintRecord(recordId);
  const outcomeQualification =
    await store.qualifyExecutionPlanBlueprintRecordOutcomes(recordId);
  const outcomes =
    await store.getExecutionPlanBlueprintRecordReplayOutcomes(recordId);
  const prompt = buildBlueprintOutcomeReviewPrompt({
    recordId,
    blueprintSha256: record.blueprintSha256,
    sourceQualificationStatus: sourceQualification.status,
    sourceQualificationDiagnostics: sourceQualification.diagnostics,
    outcomeQualification,
    outcomes,
    criteria,
  });
  if (request.model.provider === "napier" && request.model.id === "demo") {
    return createBlueprintOutcomeReview({
      recordId,
      blueprintSha256: record.blueprintSha256,
      model: request.model,
      criteria,
      sourceQualificationStatus: sourceQualification.status,
      outcomeQualificationStatus: outcomeQualification.status,
      outcomeQualification,
      outcomes,
      prompt,
      response: {
        verdict: "inconclusive",
        score: 0,
        risk: "high",
        reason:
          "The deterministic demo model cannot independently score reusable workflow delivery outcomes.",
        concerns: ["live_model_required"],
        scores: [],
        responseSha256: sha256("napier/demo:blueprint-outcome-inconclusive"),
      },
    });
  }
  const model = models.resolve(request.model);
  if (!model) {
    throw new Error(
      `Blueprint outcome reviewer model not found: ${request.model.provider}/${request.model.id}`,
    );
  }
  const response = await completeBlueprintOutcomeReview(
    models,
    model,
    prompt,
    criteria,
  );
  return createBlueprintOutcomeReview({
    recordId,
    blueprintSha256: record.blueprintSha256,
    model: request.model,
    criteria,
    sourceQualificationStatus: sourceQualification.status,
    outcomeQualificationStatus: outcomeQualification.status,
    outcomeQualification,
    outcomes,
    prompt,
    response,
  });
}

interface BlueprintOutcomeReviewPromptInput {
  recordId: string;
  blueprintSha256: string;
  sourceQualificationStatus: ExecutionPlanBlueprintRecordOutcomeReview["sourceQualificationStatus"];
  sourceQualificationDiagnostics: string[];
  outcomeQualification: Awaited<
    ReturnType<LocalStore["qualifyExecutionPlanBlueprintRecordOutcomes"]>
  >;
  outcomes: ExecutionPlanBlueprintRecordReplayOutcomes;
  criteria: ExecutionPlanBlueprintOutcomeReviewCriteria;
}

interface BlueprintOutcomeReviewPrompt {
  system: string;
  user: string;
  inputSha256: string;
  promptSha256: string;
  reviewSchemaSha256: string;
}

interface ParsedBlueprintOutcomeReview {
  verdict: ExecutionPlanBlueprintOutcomeReviewVerdict;
  score: number;
  risk: ExecutionPlanBlueprintOutcomeReviewRisk;
  reason: string;
  concerns: string[];
  scores: ExecutionPlanBlueprintOutcomeReviewScore[];
  responseSha256: string;
  modelContextEnvelope?: ModelContextEnvelopeReceipt;
}

async function completeBlueprintOutcomeReview(
  models: ModelRegistry,
  model: Model<Api>,
  prompt: BlueprintOutcomeReviewPrompt,
  criteria: ExecutionPlanBlueprintOutcomeReviewCriteria,
): Promise<ParsedBlueprintOutcomeReview> {
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
      maxTokens: 1_200,
      temperature: 0,
    });
    const text = contentText(response.content);
    return {
      ...parseBlueprintOutcomeReviewResponse(text, criteria),
      responseSha256: sha256(text),
      modelContextEnvelope,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      verdict: "inconclusive",
      score: 0,
      risk: "high",
      reason: `Blueprint outcome reviewer failed closed: ${normalizeText(message, 900)}`,
      concerns: ["review_failed_closed"],
      scores: [],
      responseSha256: sha256(message),
      modelContextEnvelope,
    };
  }
}

export function buildBlueprintOutcomeReviewPrompt(
  input: BlueprintOutcomeReviewPromptInput,
): BlueprintOutcomeReviewPrompt {
  const reviewInput = {
    recordId: input.recordId,
    blueprintSha256: input.blueprintSha256,
    sourceQualificationStatus: input.sourceQualificationStatus,
    sourceQualificationDiagnostics: input.sourceQualificationDiagnostics,
    outcomeQualification: {
      status: input.outcomeQualification.status,
      diagnostics: input.outcomeQualification.diagnostics,
      ...(input.outcomeQualification.baselineId
        ? { baselineId: input.outcomeQualification.baselineId }
        : {}),
      ...(input.outcomeQualification.baselineSha256
        ? { baselineSha256: input.outcomeQualification.baselineSha256 }
        : {}),
      ...(input.outcomeQualification.baselineOutcomesSha256
        ? {
            baselineOutcomesSha256:
              input.outcomeQualification.baselineOutcomesSha256,
          }
        : {}),
      currentOutcomesSha256: input.outcomeQualification.currentOutcomesSha256,
      currentReplayHistorySha256:
        input.outcomeQualification.currentReplayHistorySha256,
      currentOutcomeSetSha256:
        input.outcomeQualification.currentOutcomeSetSha256,
      replayCount: input.outcomeQualification.replayCount,
      completedCount: input.outcomeQualification.completedCount,
      blockedCount: input.outcomeQualification.blockedCount,
      invalidCount: input.outcomeQualification.invalidCount,
      completionRateBps: input.outcomeQualification.completionRateBps,
      ...(input.outcomeQualification.policy
        ? { policy: input.outcomeQualification.policy }
        : {}),
    },
    outcomes: {
      contentSha256: input.outcomes.contentSha256,
      replayHistorySha256: input.outcomes.replayHistorySha256,
      outcomeSetSha256: input.outcomes.outcomeSetSha256,
      replayCount: input.outcomes.replayCount,
      activeCount: input.outcomes.activeCount,
      completedCount: input.outcomes.completedCount,
      blockedCount: input.outcomes.blockedCount,
      cancelledCount: input.outcomes.cancelledCount,
      invalidCount: input.outcomes.invalidCount,
      completionRateBps: input.outcomes.completionRateBps,
      replays: input.outcomes.outcomes.map((outcome) => ({
        replayEventSeq: outcome.replayEventSeq,
        status: outcome.status,
        stepCount: outcome.stepCount,
        completedStepCount: outcome.completedStepCount,
        blockedStepCount: outcome.blockedStepCount,
        artifactCount: outcome.artifactCount,
        verifiedArtifactCount: outcome.verifiedArtifactCount,
        missingArtifactCount: outcome.missingArtifactCount,
        replanCount: outcome.replanCount,
        ...(outcome.planProjectionSha256
          ? { planProjectionSha256: outcome.planProjectionSha256 }
          : {}),
        outcomeSha256: outcome.outcomeSha256,
      })),
    },
    criteria: input.criteria,
  };
  const reviewSchemaSha256 = sha256(canonicalJson(REVIEW_SCHEMA));
  const inputJson = canonicalJson(reviewInput);
  const system =
    "You are reviewing Napier workflow blueprint replay outcomes for reusable delivery quality. Return exactly one JSON object matching the schema. Do not authorize mutation; only score the current hash-bound outcome evidence.";
  const user = [
    "Review these workflow blueprint replay outcomes against the reusable delivery criteria.",
    "Use only the hash-bound counts and statuses shown here; do not infer hidden objective, artifact path, blocker, or evidence prose.",
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

export function parseBlueprintOutcomeReviewResponse(
  text: string,
  criteria?: ExecutionPlanBlueprintOutcomeReviewCriteria,
): Omit<ParsedBlueprintOutcomeReview, "responseSha256"> {
  const source = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Blueprint outcome review did not contain JSON");
  }
  const parsed = JSON.parse(source.slice(start, end + 1)) as Record<
    string,
    unknown
  >;
  const verdict = parsed["verdict"];
  const risk = parsed["risk"];
  const score = parsed["score"];
  const concerns = parsed["concerns"];
  const scores = parsed["scores"];
  if (
    typeof verdict !== "string" ||
    !REVIEW_VERDICTS.has(
      verdict as ExecutionPlanBlueprintOutcomeReviewVerdict,
    ) ||
    typeof risk !== "string" ||
    !REVIEW_RISKS.has(risk as ExecutionPlanBlueprintOutcomeReviewRisk) ||
    typeof score !== "number" ||
    !Number.isSafeInteger(score) ||
    score < 0 ||
    score > 100 ||
    !Array.isArray(concerns) ||
    concerns.length > 8 ||
    !Array.isArray(scores) ||
    scores.length > 8
  ) {
    throw new Error("Blueprint outcome review JSON is invalid");
  }
  const parsedReview = {
    verdict: verdict as ExecutionPlanBlueprintOutcomeReviewVerdict,
    score,
    risk: risk as ExecutionPlanBlueprintOutcomeReviewRisk,
    reason: normalizeText(parsed["reason"], 1_000),
    concerns: concerns
      .map((concern) => normalizeText(concern, 200))
      .filter(Boolean),
    scores: scores.map(parseCriterionScore),
  };
  if (criteria && parsedReview.verdict !== "inconclusive") {
    const expected = new Set(
      criteria.criteria.map((criterion) => criterion.id),
    );
    if (parsedReview.scores.length !== expected.size) {
      throw new Error("Blueprint outcome review scores are incomplete");
    }
    for (const item of parsedReview.scores) {
      if (!expected.delete(item.criterionId)) {
        throw new Error("Blueprint outcome review scores are invalid");
      }
    }
  }
  return parsedReview;
}

function parseCriterionScore(
  value: unknown,
): ExecutionPlanBlueprintOutcomeReviewScore {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Blueprint outcome review score is invalid");
  }
  const record = value as Record<string, unknown>;
  const criterionId =
    typeof record["criterionId"] === "string"
      ? record["criterionId"].trim().toLowerCase()
      : "";
  const score = record["score"];
  if (
    !/^[a-z][a-z0-9_-]{0,63}$/.test(criterionId) ||
    typeof score !== "number" ||
    !Number.isSafeInteger(score) ||
    score < 0 ||
    score > 100
  ) {
    throw new Error("Blueprint outcome review score is invalid");
  }
  return {
    criterionId,
    score,
    reason: normalizeText(record["reason"], 300),
  };
}

function createBlueprintOutcomeReview(input: {
  recordId: string;
  blueprintSha256: string;
  model: ModelRef;
  criteria: ExecutionPlanBlueprintOutcomeReviewCriteria;
  sourceQualificationStatus: ExecutionPlanBlueprintRecordOutcomeReview["sourceQualificationStatus"];
  outcomeQualificationStatus: ExecutionPlanBlueprintRecordOutcomeReview["outcomeQualificationStatus"];
  outcomeQualification: Awaited<
    ReturnType<LocalStore["qualifyExecutionPlanBlueprintRecordOutcomes"]>
  >;
  outcomes: ExecutionPlanBlueprintRecordReplayOutcomes;
  prompt: BlueprintOutcomeReviewPrompt;
  response: ParsedBlueprintOutcomeReview;
}): ExecutionPlanBlueprintRecordOutcomeReview {
  const content = {
    kind: BLUEPRINT_OUTCOME_REVIEW_KIND,
    schemaVersion: 1 as const,
    policyId: BLUEPRINT_OUTCOME_REVIEW_POLICY_ID,
    recordId: input.recordId,
    blueprintSha256: input.blueprintSha256,
    model: input.model,
    criteria: input.criteria,
    verdict: input.response.verdict,
    score: input.response.score,
    risk: input.response.risk,
    reason: input.response.reason,
    concerns: input.response.concerns,
    scores: input.response.scores,
    sourceQualificationStatus: input.sourceQualificationStatus,
    outcomeQualificationStatus: input.outcomeQualificationStatus,
    replayOutcomesSha256: input.outcomes.contentSha256,
    replayHistorySha256: input.outcomes.replayHistorySha256,
    outcomeSetSha256: input.outcomes.outcomeSetSha256,
    replayCount: input.outcomes.replayCount,
    completedCount: input.outcomes.completedCount,
    blockedCount: input.outcomes.blockedCount,
    invalidCount: input.outcomes.invalidCount,
    completionRateBps: input.outcomes.completionRateBps,
    ...(input.outcomeQualification.baselineId
      ? { baselineId: input.outcomeQualification.baselineId }
      : {}),
    ...(input.outcomeQualification.baselineSha256
      ? { baselineSha256: input.outcomeQualification.baselineSha256 }
      : {}),
    ...(input.outcomeQualification.baselineOutcomesSha256
      ? {
          baselineOutcomesSha256:
            input.outcomeQualification.baselineOutcomesSha256,
        }
      : {}),
    inputSha256: input.prompt.inputSha256,
    promptSha256: input.prompt.promptSha256,
    responseSha256: input.response.responseSha256,
    reviewSchemaSha256: input.prompt.reviewSchemaSha256,
    ...(input.response.modelContextEnvelope
      ? { modelContextEnvelope: input.response.modelContextEnvelope }
      : {}),
    createdAt: nowIso(),
  } satisfies Omit<ExecutionPlanBlueprintRecordOutcomeReview, "reviewSha256">;
  return {
    ...content,
    reviewSha256: sha256(canonicalJson(content)),
  };
}

export function normalizeBlueprintOutcomeReviewCriteria(
  input: ExecutionPlanBlueprintOutcomeReviewCriteria,
): ExecutionPlanBlueprintOutcomeReviewCriteria {
  const name = normalizeText(input.name, 100);
  if (!name) {
    throw new Error("Blueprint outcome review criteria name is required");
  }
  if (input.criteria.length < 2 || input.criteria.length > 6) {
    throw new Error("Blueprint outcome review criteria require 2 to 6 items");
  }
  const seenIds = new Set<string>();
  const criteria = input.criteria.map((criterion) => {
    const id = criterion.id.trim().toLowerCase();
    const criterionName = normalizeText(criterion.name, 80);
    const description = normalizeText(criterion.description, 300);
    if (
      !/^[a-z][a-z0-9_-]{0,63}$/.test(id) ||
      !criterionName ||
      !description ||
      seenIds.has(id)
    ) {
      throw new Error("Blueprint outcome review criteria are invalid");
    }
    seenIds.add(id);
    return {
      id,
      name: criterionName,
      description,
    };
  });
  return { name, criteria };
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}
