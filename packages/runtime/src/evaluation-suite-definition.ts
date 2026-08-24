import {
  type CreateEvaluationSuiteRequest,
  type EvaluationSuite,
  type EvaluationSuiteGate,
  type ModelRef,
  type UpdateEvaluationSuiteRequest,
} from "@napier/contracts";
import { DEFAULT_EVALUATION_RUBRIC, normalizeRubric } from "./evaluation.js";
import { createId, nowIso } from "./ids.js";

export const DEFAULT_EVALUATION_SUITE_GATE: EvaluationSuiteGate = {
  minimumPassRate: 1,
  minimumCandidateScore: 3,
  allowInconclusive: false,
};

export function createEvaluationSuiteRecord(
  threadId: string,
  request: CreateEvaluationSuiteRequest,
  defaultModel: ModelRef,
): EvaluationSuite {
  const timestamp = nowIso();
  const baselineRunId = normalizeRunId(request.baselineRunId, "baseline");
  return {
    id: createId("suite"),
    threadId,
    name: normalizeSuiteName(request.name),
    baselineRunId,
    candidateRunIds: normalizeCandidateRunIds(
      request.candidateRunIds,
      baselineRunId,
    ),
    rubric: normalizeRubric(request.rubric ?? DEFAULT_EVALUATION_RUBRIC),
    evaluatorModel: normalizeModel(request.model ?? defaultModel),
    gate: normalizeEvaluationSuiteGate(request.gate),
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function updateEvaluationSuiteRecord(
  current: EvaluationSuite,
  request: UpdateEvaluationSuiteRequest,
): EvaluationSuite {
  const baselineRunId = normalizeRunId(
    request.baselineRunId ?? current.baselineRunId,
    "baseline",
  );
  const updated: EvaluationSuite = {
    ...current,
    name:
      request.name === undefined
        ? current.name
        : normalizeSuiteName(request.name),
    baselineRunId,
    candidateRunIds:
      request.candidateRunIds === undefined
        ? current.candidateRunIds
        : normalizeCandidateRunIds(request.candidateRunIds, baselineRunId),
    rubric:
      request.rubric === undefined
        ? current.rubric
        : normalizeRubric(request.rubric),
    evaluatorModel:
      request.model === undefined
        ? current.evaluatorModel
        : normalizeModel(request.model),
    gate:
      request.gate === undefined
        ? current.gate
        : normalizeEvaluationSuiteGate(request.gate, current.gate),
    revision: current.revision + 1,
    updatedAt: nowIso(),
  };
  const semanticCurrent = {
    name: current.name,
    baselineRunId: current.baselineRunId,
    candidateRunIds: current.candidateRunIds,
    rubric: current.rubric,
    evaluatorModel: current.evaluatorModel,
    gate: current.gate,
  };
  const semanticUpdated = {
    name: updated.name,
    baselineRunId: updated.baselineRunId,
    candidateRunIds: updated.candidateRunIds,
    rubric: updated.rubric,
    evaluatorModel: updated.evaluatorModel,
    gate: updated.gate,
  };
  return JSON.stringify(semanticCurrent) === JSON.stringify(semanticUpdated)
    ? structuredClone(current)
    : updated;
}

export function normalizeEvaluationSuiteGate(
  input: Partial<EvaluationSuiteGate> | undefined,
  defaults: EvaluationSuiteGate = DEFAULT_EVALUATION_SUITE_GATE,
): EvaluationSuiteGate {
  const gate = { ...defaults, ...input };
  if (
    !Number.isFinite(gate.minimumPassRate) ||
    gate.minimumPassRate < 0 ||
    gate.minimumPassRate > 1
  ) {
    throw new Error("Evaluation suite minimum pass rate must be 0-1");
  }
  if (
    !Number.isFinite(gate.minimumCandidateScore) ||
    gate.minimumCandidateScore < 1 ||
    gate.minimumCandidateScore > 5
  ) {
    throw new Error("Evaluation suite minimum candidate score must be 1-5");
  }
  if (typeof gate.allowInconclusive !== "boolean") {
    throw new Error("Evaluation suite allowInconclusive must be boolean");
  }
  return gate;
}

export function normalizeSuiteName(value: string): string {
  const name = value.replace(/\s+/g, " ").trim().slice(0, 100);
  if (!name) throw new Error("Evaluation suite name is required");
  return name;
}

export function normalizeCandidateRunIds(
  values: readonly string[],
  baselineRunId: string,
): string[] {
  if (!Array.isArray(values)) {
    throw new Error("Evaluation suite candidate runs are required");
  }
  const normalized = values.map((value) => normalizeRunId(value, "candidate"));
  if (
    normalized.length < 1 ||
    normalized.length > 8 ||
    new Set(normalized).size !== normalized.length ||
    normalized.includes(baselineRunId)
  ) {
    throw new Error(
      "Evaluation suite requires 1-8 unique candidates distinct from baseline",
    );
  }
  return normalized;
}

export function normalizeRunId(value: string, label: string): string {
  const runId = value.trim();
  if (!/^run_[a-z0-9]{8,80}$/.test(runId)) {
    throw new Error(`Evaluation suite ${label} run ID is invalid`);
  }
  return runId;
}

export function normalizeModel(value: ModelRef): ModelRef {
  const provider = value.provider.trim();
  const id = value.id.trim();
  if (!provider || !id || provider.length > 100 || id.length > 200) {
    throw new Error("Evaluation suite model is invalid");
  }
  return { provider, id };
}
