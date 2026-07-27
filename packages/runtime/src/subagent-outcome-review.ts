import {
  contentText,
  type Api,
  type Model,
  type Usage as PiUsage,
} from "@earendil-works/pi-ai";
import {
  emptyUsage,
  type ModelRef,
  type SubagentOutcomeReview,
  type SubagentOutcomeReviewRisk,
  type SubagentOutcomeReviewVerdict,
  type SubagentTask,
  type Usage,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { nowIso } from "./ids.js";
import type { ModelRegistry } from "./models.js";
import { assertSubagentOutcomeBinding } from "./subagent-outcomes.js";

const REVIEW_POLICY_ID = "napier.subagent-outcome-review.v1";
const REVIEW_VERDICTS = new Set<SubagentOutcomeReviewVerdict>([
  "accept",
  "revise",
  "reject",
  "inconclusive",
]);
const REVIEW_RISKS = new Set<SubagentOutcomeReviewRisk>([
  "low",
  "medium",
  "high",
]);
const MAX_REVIEW_RESPONSE_BYTES = 32 * 1024;
const REVIEW_CRITERIA = [
  {
    id: "task_alignment",
    description:
      "The outcome directly addresses the delegated task without changing scope.",
  },
  {
    id: "evidence_grounding",
    description:
      "Claims are proportionate to cited workspace evidence and receipt metadata.",
  },
  {
    id: "uncertainty_honesty",
    description:
      "Unknowns and limitations are explicit instead of being presented as facts.",
  },
  {
    id: "actionability",
    description:
      "Findings are specific enough for the parent Agent to use safely.",
  },
] as const;
const REVIEW_SCHEMA = {
  verdict: "accept|revise|reject|inconclusive",
  score: "integer 0-100",
  risk: "low|medium|high",
  reason: "string 1-1000 characters",
  concerns: "array of <= 8 unique strings, each 1-200 characters",
} as const;

interface SubagentOutcomeReviewPrompt {
  system: string;
  user: string;
  criteriaSha256: string;
  inputSha256: string;
  promptSha256: string;
  reviewSchemaSha256: string;
}

interface ParsedSubagentOutcomeReview {
  verdict: SubagentOutcomeReviewVerdict;
  score: number;
  risk: SubagentOutcomeReviewRisk;
  reason: string;
  concerns: string[];
  responseSha256: string;
  usage: Usage;
}

export async function reviewSubagentOutcome(
  models: ModelRegistry,
  task: SubagentTask,
  reviewerModel: ModelRef,
): Promise<SubagentOutcomeReview> {
  if (task.status !== "completed" || !task.outcome) {
    throw new Error("Subagent outcome review requires a completed task");
  }
  const outcome = assertSubagentOutcomeBinding(task.outcome, task);
  const normalizedReviewerModel = normalizeModel(reviewerModel);
  if (canonicalJson(normalizedReviewerModel) === canonicalJson(outcome.model)) {
    throw new Error(
      "Subagent outcome reviewer model must differ from the worker model",
    );
  }
  const prompt = buildSubagentOutcomeReviewPrompt(task);
  let response: ParsedSubagentOutcomeReview;
  if (
    normalizedReviewerModel.provider === "napier" &&
    normalizedReviewerModel.id === "demo"
  ) {
    response = {
      verdict: "inconclusive",
      score: 0,
      risk: "high",
      reason:
        "The deterministic demo model cannot independently review a Subagent outcome.",
      concerns: ["live_model_required"],
      responseSha256: sha256("napier/demo:subagent-outcome-inconclusive"),
      usage: emptyUsage(),
    };
  } else {
    const model = models.resolve(normalizedReviewerModel);
    if (!model) {
      throw new Error(
        `Subagent outcome reviewer model not found: ${normalizedReviewerModel.provider}/${normalizedReviewerModel.id}`,
      );
    }
    response = await completeSubagentOutcomeReview(models, model, prompt);
  }
  return createSubagentOutcomeReview({
    task,
    outcomeSha256: outcome.contentSha256,
    workerModel: outcome.model,
    reviewerModel: normalizedReviewerModel,
    prompt,
    response,
  });
}

export function buildSubagentOutcomeReviewPrompt(
  task: SubagentTask,
): SubagentOutcomeReviewPrompt {
  if (task.status !== "completed" || !task.outcome) {
    throw new Error("Subagent outcome review requires a completed task");
  }
  const outcome = assertSubagentOutcomeBinding(task.outcome, task);
  const reviewInput = {
    task: {
      id: task.id,
      role: task.role,
      description: task.description,
      prompt: task.prompt,
      workerModel: outcome.model,
    },
    outcome: {
      contentSha256: outcome.contentSha256,
      schemaVersion: outcome.schemaVersion,
      summary: outcome.summary,
      items: outcome.items,
      unknowns: outcome.unknowns,
      itemCount: outcome.itemCount,
      unknownCount: outcome.unknownCount,
      evidenceCount: outcome.evidenceCount ?? 0,
      promptSha256: outcome.promptSha256,
      instructionsSha256: outcome.instructionsSha256,
      resultSha256: outcome.resultSha256,
      itemSetSha256: outcome.itemSetSha256,
      ...(outcome.evidenceSetSha256
        ? { evidenceSetSha256: outcome.evidenceSetSha256 }
        : {}),
    },
    criteria: REVIEW_CRITERIA,
  };
  const inputJson = canonicalJson(reviewInput);
  const criteriaSha256 = sha256(canonicalJson(REVIEW_CRITERIA));
  const reviewSchemaSha256 = sha256(canonicalJson(REVIEW_SCHEMA));
  const system = [
    "You are an independent passive reviewer of one Napier Subagent outcome.",
    "You are not a peer agent and cannot call tools, change files, or authorize mutation.",
    "Judge only the delegated task, typed outcome, and grounded receipt evidence provided.",
    "Return exactly one JSON object matching the response schema.",
  ].join("\n");
  const user = [
    "Review whether this outcome is safe and useful for the parent Agent.",
    `Criteria SHA-256: ${criteriaSha256}`,
    `Response schema SHA-256: ${reviewSchemaSha256}`,
    `Schema: ${canonicalJson(REVIEW_SCHEMA)}`,
    `Input SHA-256: ${sha256(inputJson)}`,
    inputJson,
  ].join("\n\n");
  return {
    system,
    user,
    criteriaSha256,
    inputSha256: sha256(inputJson),
    promptSha256: sha256(
      canonicalJson({ system, user, criteriaSha256, reviewSchemaSha256 }),
    ),
    reviewSchemaSha256,
  };
}

export function parseSubagentOutcomeReviewResponse(
  text: string,
): Omit<ParsedSubagentOutcomeReview, "responseSha256" | "usage"> {
  if (Buffer.byteLength(text, "utf8") > MAX_REVIEW_RESPONSE_BYTES) {
    throw new Error("Subagent outcome review response is too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim()) as unknown;
  } catch {
    throw new Error("Subagent outcome review must be one valid JSON object");
  }
  const record = exactRecord(parsed, [
    "verdict",
    "score",
    "risk",
    "reason",
    "concerns",
  ]);
  const verdict = record["verdict"];
  const score = record["score"];
  const risk = record["risk"];
  const reason = boundedReviewText(record["reason"], "reason", 1_000);
  const concerns = record["concerns"];
  if (
    typeof verdict !== "string" ||
    !REVIEW_VERDICTS.has(verdict as SubagentOutcomeReviewVerdict) ||
    typeof score !== "number" ||
    !Number.isSafeInteger(score) ||
    score < 0 ||
    score > 100 ||
    typeof risk !== "string" ||
    !REVIEW_RISKS.has(risk as SubagentOutcomeReviewRisk) ||
    !reason ||
    !Array.isArray(concerns) ||
    concerns.length > 8
  ) {
    throw new Error("Subagent outcome review JSON is invalid");
  }
  const normalizedConcerns = [
    ...new Set(
      concerns.map((concern) => boundedReviewText(concern, "concern", 200)),
    ),
  ].sort((left, right) => left.localeCompare(right));
  if (normalizedConcerns.length !== concerns.length) {
    throw new Error("Subagent outcome review concerns are invalid");
  }
  return {
    verdict: verdict as SubagentOutcomeReviewVerdict,
    score,
    risk: risk as SubagentOutcomeReviewRisk,
    reason,
    concerns: normalizedConcerns,
  };
}

async function completeSubagentOutcomeReview(
  models: ModelRegistry,
  model: Model<Api>,
  prompt: SubagentOutcomeReviewPrompt,
): Promise<ParsedSubagentOutcomeReview> {
  let responseText = "";
  let usage = emptyUsage();
  try {
    const response = await models.models.completeSimple(
      model,
      {
        systemPrompt: prompt.system,
        messages: [
          {
            role: "user",
            content: prompt.user,
            timestamp: Date.now(),
          },
        ],
        tools: [],
      },
      {
        maxTokens: 1_000,
        temperature: 0,
        timeoutMs: 30_000,
        maxRetries: 0,
      },
    );
    responseText = contentText(response.content);
    usage = normalizeUsage(response.usage);
    return {
      ...parseSubagentOutcomeReviewResponse(responseText),
      responseSha256: sha256(responseText),
      usage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      verdict: "inconclusive",
      score: 0,
      risk: "high",
      reason: "The independent Subagent outcome reviewer failed closed.",
      concerns: ["review_failed_closed"],
      responseSha256: sha256(responseText || message),
      usage,
    };
  }
}

function createSubagentOutcomeReview(input: {
  task: SubagentTask;
  outcomeSha256: string;
  workerModel: ModelRef;
  reviewerModel: ModelRef;
  prompt: SubagentOutcomeReviewPrompt;
  response: ParsedSubagentOutcomeReview;
}): SubagentOutcomeReview {
  const outcome = input.task.outcome;
  if (!outcome) {
    throw new Error("Subagent outcome review requires a completed task");
  }
  const content = {
    kind: "napier.subagent-outcome-review" as const,
    schemaVersion: 1 as const,
    policyId: REVIEW_POLICY_ID,
    taskId: input.task.id,
    role: input.task.role,
    outcomeSha256: input.outcomeSha256,
    workerModel: input.workerModel,
    reviewerModel: input.reviewerModel,
    verdict: input.response.verdict,
    score: input.response.score,
    risk: input.response.risk,
    reason: input.response.reason,
    concerns: input.response.concerns,
    criteria: REVIEW_CRITERIA.map((criterion) => criterion.id),
    itemCount: outcome.itemCount,
    unknownCount: outcome.unknownCount,
    evidenceCount: outcome.evidenceCount ?? 0,
    usage: input.response.usage,
    criteriaSha256: input.prompt.criteriaSha256,
    inputSha256: input.prompt.inputSha256,
    promptSha256: input.prompt.promptSha256,
    responseSha256: input.response.responseSha256,
    reviewSchemaSha256: input.prompt.reviewSchemaSha256,
    createdAt: nowIso(),
  } satisfies Omit<SubagentOutcomeReview, "reviewSha256">;
  return {
    ...content,
    reviewSha256: sha256(canonicalJson(content)),
  };
}

function normalizeModel(model: ModelRef): ModelRef {
  const provider = model.provider.trim();
  const id = model.id.trim();
  if (!provider || !id || provider.length > 100 || id.length > 200) {
    throw new Error("Subagent outcome reviewer model is invalid");
  }
  return { provider, id };
}

function normalizeUsage(input: PiUsage): Usage {
  return {
    inputTokens: input.input,
    outputTokens: input.output,
    cacheReadTokens: input.cacheRead,
    cacheWriteTokens: input.cacheWrite,
    costUsd: input.cost.total,
  };
}

function boundedReviewText(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new Error(`Subagent outcome review ${label} is invalid`);
  }
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`Subagent outcome review ${label} is invalid`);
  }
  return normalized;
}

function exactRecord(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Subagent outcome review must be an object");
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set(keys);
  const unsupported = Object.keys(record).find((key) => !allowed.has(key));
  const missing = keys.find((key) => !(key in record));
  if (unsupported || missing) {
    throw new Error(
      unsupported
        ? `Subagent outcome review has unsupported field: ${unsupported}`
        : `Subagent outcome review is missing field: ${missing}`,
    );
  }
  return record;
}
