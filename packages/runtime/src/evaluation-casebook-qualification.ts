import { createHash } from "node:crypto";

import {
  NAPIER_API_VERSION,
  type EvaluationCasebook,
  type EvaluationCasebookCase,
  type EvaluationCasebookQualificationCaseResult,
  type EvaluationCasebookQualificationExecution,
  type EvaluationCasebookQualificationGate,
  type EvaluationCasebookQualificationReceipt,
  type EvaluationCasebookQualificationStatus,
  type ExecuteEvaluationCasebookRequest,
  type ModelRef,
  type RunEvaluationVerdict,
} from "@napier/contracts";

import {
  RunEvaluationService,
  type RunEvaluationJudgment,
  type RunEvaluationTraceOptions,
} from "./evaluation.js";
import {
  MAX_EVALUATION_CASEBOOK_ARTIFACT_BYTES,
  currentCasebookRevision,
  validateEvaluationCasebook,
} from "./evaluation-casebooks.js";
import { createId, nowIso } from "./ids.js";
import type { ModelRegistry } from "./models.js";
import { aggregateRunUsage, createRunReplaySnapshot } from "./replay.js";
import type { EvaluationCasebookQualificationStorePort } from "./store-port.js";

export const DEFAULT_EVALUATION_CASEBOOK_QUALIFICATION_GATE: EvaluationCasebookQualificationGate =
  {
    minimumAgreementRate: 0.8,
    allowInconclusive: false,
  };

const VERDICTS = new Set<RunEvaluationVerdict>([
  "left_better",
  "right_better",
  "tie",
  "inconclusive",
]);
const EVIDENCE_STATES = new Set(["verified", "drifted", "missing"]);

export class EvaluationCasebookQualificationService {
  private readonly evaluator: RunEvaluationService;

  constructor(
    private readonly store: EvaluationCasebookQualificationStorePort,
    private readonly models: ModelRegistry,
  ) {
    this.evaluator = new RunEvaluationService(store, models);
  }

  async execute(
    casebookId: string,
    request: ExecuteEvaluationCasebookRequest,
  ): Promise<EvaluationCasebookQualificationExecution> {
    const auditThread = this.store.getThread(request.threadId);
    const casebook = this.store.getEvaluationCasebook(casebookId);
    const revision = currentCasebookRevision(casebook);
    const evaluatorModel = normalizeModel(request.model);
    assertAvailableEvaluator(this.models, evaluatorModel);
    const gate = normalizeEvaluationCasebookQualificationGate(request.gate);
    const qualificationRun = await this.store.createRun({
      threadId: request.threadId,
      agentId: auditThread.agentId,
      model: evaluatorModel,
    });
    try {
      const casesById = new Map(casebook.cases.map((item) => [item.id, item]));
      const startedAt = nowIso();
      const results: EvaluationCasebookQualificationCaseResult[] = [];
      let nextModelTurnIndex = 0;
      const nextTrace = (): RunEvaluationTraceOptions => ({
        run: qualificationRun,
        turnIndex: nextModelTurnIndex++,
      });
      for (const caseId of revision.caseIds) {
        const item = casesById.get(caseId)!;
        results.push(await this.evaluateCase(item, evaluatorModel, nextTrace));
      }
      const sampleCount = results.length;
      const agreementCount = results.filter((item) => item.agreement).length;
      const inconclusiveCount = results.filter(
        (item) => item.actualVerdict === "inconclusive",
      ).length;
      const unverifiedCount = results.filter(
        (item) => item.evidenceState !== "verified",
      ).length;
      const agreementRate =
        sampleCount > 0 ? Number((agreementCount / sampleCount).toFixed(4)) : 0;
      const status = qualificationStatus(
        gate,
        sampleCount,
        agreementRate,
        inconclusiveCount,
        unverifiedCount,
      );
      const evidence = {
        casebookId: casebook.id,
        casebookRevision: revision.revision,
        casebookRevisionSha256: revision.contentSha256,
        auditThreadId: request.threadId,
        name: revision.name,
        evaluatorModel,
        gate,
        caseIds: revision.caseIds,
        results,
        sampleCount,
        agreementCount,
        inconclusiveCount,
        unverifiedCount,
        agreementRate,
        status,
      };
      const execution: EvaluationCasebookQualificationExecution = {
        id: createId("casequal"),
        ...evidence,
        contentSha256: hashEvaluationCasebookQualificationExecution(evidence),
        startedAt,
        finishedAt: nowIso(),
      };
      const saved =
        await this.store.saveEvaluationCasebookQualificationExecution(
          execution,
        );
      await this.store.appendEvent({
        threadId: request.threadId,
        runId: qualificationRun.id,
        type: "evaluation.casebook.qualification.completed",
        category: "evaluation",
        visibility: "user",
        payload: {
          casebookId: saved.casebookId,
          casebookRevision: saved.casebookRevision,
          executionId: saved.id,
          evaluatorModel: {
            provider: saved.evaluatorModel.provider,
            id: saved.evaluatorModel.id,
          },
          sampleCount: saved.sampleCount,
          agreementCount: saved.agreementCount,
          inconclusiveCount: saved.inconclusiveCount,
          unverifiedCount: saved.unverifiedCount,
          agreementRate: saved.agreementRate,
          status: saved.status,
          contentSha256: saved.contentSha256,
        },
      });
      await this.store.finishRun(qualificationRun.id, "completed", {
        usage: await this.collectRunUsage(
          request.threadId,
          qualificationRun.id,
        ),
      });
      return saved;
    } catch (error) {
      await this.store.finishRun(qualificationRun.id, "failed", {
        error: safeErrorMessage(error),
        usage: await this.collectRunUsage(
          request.threadId,
          qualificationRun.id,
        ),
      });
      throw error;
    }
  }

  private async evaluateCase(
    item: EvaluationCasebookCase,
    evaluatorModel: ModelRef,
    nextTrace: () => RunEvaluationTraceOptions,
  ): Promise<EvaluationCasebookQualificationCaseResult> {
    let left;
    let right;
    try {
      [left, right] = await Promise.all([
        createRunReplaySnapshot(
          this.store,
          item.sourceThreadId,
          item.evaluation.leftRunId,
        ),
        createRunReplaySnapshot(
          this.store,
          item.sourceThreadId,
          item.evaluation.rightRunId,
        ),
      ]);
    } catch (error) {
      return failedCaseResult(
        item,
        "missing",
        `Casebook source evidence is unavailable: ${safeErrorMessage(error)}`,
      );
    }
    const observed = {
      observedLeftSnapshotSha256: left.eventStreamSha256,
      observedRightSnapshotSha256: right.eventStreamSha256,
    };
    if (
      left.eventStreamSha256 !== item.evaluation.leftSnapshotSha256 ||
      right.eventStreamSha256 !== item.evaluation.rightSnapshotSha256
    ) {
      return failedCaseResult(
        item,
        "drifted",
        "Casebook source evidence no longer matches its curated snapshot hashes.",
        observed,
      );
    }
    const judgment = await this.evaluator.judgeSnapshots(
      left,
      right,
      item.evaluation.rubric,
      evaluatorModel,
      item.evaluation.comparisonGovernance
        ? { comparisonGovernance: item.evaluation.comparisonGovernance }
        : undefined,
      nextTrace(),
    );
    return qualificationCaseResult(item, judgment, observed);
  }

  private async collectRunUsage(threadId: string, runId: string) {
    return aggregateRunUsage(
      (await this.store.listEvents(threadId)).filter(
        (event) => event.runId === runId,
      ),
      [],
    );
  }
}

export function normalizeEvaluationCasebookQualificationGate(
  input: Partial<EvaluationCasebookQualificationGate> | undefined,
): EvaluationCasebookQualificationGate {
  const gate = {
    ...DEFAULT_EVALUATION_CASEBOOK_QUALIFICATION_GATE,
    ...input,
  };
  if (
    !Number.isFinite(gate.minimumAgreementRate) ||
    gate.minimumAgreementRate < 0 ||
    gate.minimumAgreementRate > 1
  ) {
    throw new Error(
      "Evaluation Casebook qualification agreement rate must be 0-1",
    );
  }
  if (typeof gate.allowInconclusive !== "boolean") {
    throw new Error(
      "Evaluation Casebook qualification inconclusive policy is invalid",
    );
  }
  return gate;
}

export function hashEvaluationCasebookQualificationExecution(
  input: Omit<
    EvaluationCasebookQualificationExecution,
    "id" | "contentSha256" | "startedAt" | "finishedAt"
  >,
): string {
  return sha256(canonicalJson(input));
}

export function validateEvaluationCasebookQualificationExecution(
  input: EvaluationCasebookQualificationExecution,
  casebookInput: EvaluationCasebook,
): EvaluationCasebookQualificationExecution {
  const casebook = validateEvaluationCasebook(casebookInput);
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !input.evaluatorModel ||
    typeof input.evaluatorModel !== "object" ||
    typeof input.evaluatorModel.provider !== "string" ||
    typeof input.evaluatorModel.id !== "string" ||
    !input.gate ||
    typeof input.gate !== "object" ||
    !Array.isArray(input.caseIds) ||
    !Array.isArray(input.results)
  ) {
    throw new Error("Evaluation Casebook qualification execution is invalid");
  }
  const revision = casebook.revisions.find(
    (candidate) => candidate.revision === input.casebookRevision,
  );
  const normalizedModel = normalizeModel(input.evaluatorModel);
  if (
    !/^casequal_[a-z0-9]{8,80}$/.test(input.id) ||
    !revision ||
    input.casebookId !== casebook.id ||
    input.casebookRevisionSha256 !== revision.contentSha256 ||
    input.name !== revision.name ||
    !/^thread_[a-z0-9]{8,80}$/.test(input.auditThreadId) ||
    JSON.stringify(input.evaluatorModel) !== JSON.stringify(normalizedModel) ||
    JSON.stringify(input.gate) !==
      JSON.stringify(
        normalizeEvaluationCasebookQualificationGate(input.gate),
      ) ||
    JSON.stringify(input.caseIds) !== JSON.stringify(revision.caseIds) ||
    input.results.length !== revision.caseIds.length ||
    !Number.isFinite(Date.parse(input.startedAt)) ||
    !Number.isFinite(Date.parse(input.finishedAt)) ||
    Date.parse(input.finishedAt) < Date.parse(input.startedAt) ||
    !/^[a-f0-9]{64}$/.test(input.contentSha256)
  ) {
    throw new Error("Evaluation Casebook qualification execution is invalid");
  }
  const casesById = new Map(casebook.cases.map((item) => [item.id, item]));
  for (const [index, result] of input.results.entries()) {
    const item = casesById.get(revision.caseIds[index]!);
    if (!item) {
      throw new Error("Evaluation Casebook qualification case is missing");
    }
    validateQualificationCaseResult(result, item);
  }
  const sampleCount = input.results.length;
  const agreementCount = input.results.filter((item) => item.agreement).length;
  const inconclusiveCount = input.results.filter(
    (item) => item.actualVerdict === "inconclusive",
  ).length;
  const unverifiedCount = input.results.filter(
    (item) => item.evidenceState !== "verified",
  ).length;
  const agreementRate =
    sampleCount > 0 ? Number((agreementCount / sampleCount).toFixed(4)) : 0;
  const status = qualificationStatus(
    input.gate,
    sampleCount,
    agreementRate,
    inconclusiveCount,
    unverifiedCount,
  );
  if (
    input.sampleCount !== sampleCount ||
    input.agreementCount !== agreementCount ||
    input.inconclusiveCount !== inconclusiveCount ||
    input.unverifiedCount !== unverifiedCount ||
    input.agreementRate !== agreementRate ||
    input.status !== status
  ) {
    throw new Error("Evaluation Casebook qualification aggregate is invalid");
  }
  const {
    id: _id,
    contentSha256: _contentSha256,
    startedAt: _startedAt,
    finishedAt: _finishedAt,
    ...content
  } = input;
  if (
    hashEvaluationCasebookQualificationExecution(content) !==
    input.contentSha256
  ) {
    throw new Error(
      "Evaluation Casebook qualification execution hash mismatch",
    );
  }
  return structuredClone(input);
}

export function createEvaluationCasebookQualificationReceipt(
  store: EvaluationCasebookQualificationStorePort,
  casebookId: string,
): EvaluationCasebookQualificationReceipt {
  const casebook = store.getEvaluationCasebook(casebookId);
  const execution = store
    .listEvaluationCasebookQualificationExecutions(casebookId)
    .filter(
      (candidate) => candidate.casebookRevision === casebook.currentRevision,
    )
    .at(-1);
  const content: Omit<
    EvaluationCasebookQualificationReceipt,
    "generatedAt" | "contentSha256"
  > = {
    kind: "napier.evaluation-casebook-qualification-receipt",
    schemaVersion: 1,
    apiVersion: NAPIER_API_VERSION,
    casebook,
    state: execution?.status ?? "not_run",
    ...(execution ? { execution } : {}),
  };
  const receipt = {
    ...content,
    generatedAt: nowIso(),
    contentSha256: hashEvaluationCasebookQualificationReceipt(content),
  };
  if (
    Buffer.byteLength(JSON.stringify(receipt)) >
    MAX_EVALUATION_CASEBOOK_ARTIFACT_BYTES
  ) {
    throw new Error(
      `Evaluation Casebook qualification receipt exceeds ${MAX_EVALUATION_CASEBOOK_ARTIFACT_BYTES} bytes`,
    );
  }
  return receipt;
}

export function hashEvaluationCasebookQualificationReceipt(
  input: Omit<
    EvaluationCasebookQualificationReceipt,
    "generatedAt" | "contentSha256"
  >,
): string {
  return sha256(canonicalJson(input));
}

export function validateEvaluationCasebookQualificationReceipt(
  value: unknown,
): EvaluationCasebookQualificationReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "Evaluation Casebook qualification receipt must be an object",
    );
  }
  const receipt = value as EvaluationCasebookQualificationReceipt;
  if (
    Buffer.byteLength(JSON.stringify(value)) >
      MAX_EVALUATION_CASEBOOK_ARTIFACT_BYTES ||
    receipt.kind !== "napier.evaluation-casebook-qualification-receipt" ||
    receipt.schemaVersion !== 1 ||
    receipt.apiVersion !== NAPIER_API_VERSION ||
    !Number.isFinite(Date.parse(receipt.generatedAt)) ||
    !/^[a-f0-9]{64}$/.test(receipt.contentSha256)
  ) {
    throw new Error("Evaluation Casebook qualification receipt is invalid");
  }
  const casebook = validateEvaluationCasebook(receipt.casebook);
  if (receipt.execution) {
    validateEvaluationCasebookQualificationExecution(
      receipt.execution,
      casebook,
    );
    if (
      receipt.execution.casebookRevision !== casebook.currentRevision ||
      receipt.state !== receipt.execution.status
    ) {
      throw new Error(
        "Evaluation Casebook qualification receipt execution is stale",
      );
    }
  } else if (receipt.state !== "not_run") {
    throw new Error(
      "Evaluation Casebook qualification receipt state is invalid",
    );
  }
  const {
    generatedAt: _generatedAt,
    contentSha256: _contentSha256,
    ...content
  } = receipt;
  if (
    hashEvaluationCasebookQualificationReceipt(content) !==
    receipt.contentSha256
  ) {
    throw new Error("Evaluation Casebook qualification receipt hash mismatch");
  }
  return structuredClone(receipt);
}

function qualificationCaseResult(
  item: EvaluationCasebookCase,
  judgment: RunEvaluationJudgment,
  observed: {
    observedLeftSnapshotSha256: string;
    observedRightSnapshotSha256: string;
  },
): EvaluationCasebookQualificationCaseResult {
  const agreement =
    judgment.verdict === item.adjudicationRevision.expectedVerdict;
  return {
    ...caseResultEvidence(item),
    actualVerdict: judgment.verdict,
    agreement,
    evidenceState: "verified",
    reason: judgment.reason,
    evidence: judgment.evidence,
    scores: structuredClone(judgment.scores),
    ...observed,
    status:
      judgment.verdict === "inconclusive"
        ? "inconclusive"
        : agreement
          ? "agreed"
          : "disagreed",
  };
}

function failedCaseResult(
  item: EvaluationCasebookCase,
  evidenceState: "drifted" | "missing",
  reason: string,
  observed?: {
    observedLeftSnapshotSha256: string;
    observedRightSnapshotSha256: string;
  },
): EvaluationCasebookQualificationCaseResult {
  return {
    ...caseResultEvidence(item),
    actualVerdict: "inconclusive",
    agreement: false,
    evidenceState,
    reason,
    evidence: "",
    scores: [],
    ...(observed ?? {}),
    status: "inconclusive",
  };
}

function caseResultEvidence(item: EvaluationCasebookCase) {
  return {
    caseId: item.id,
    sourceThreadId: item.sourceThreadId,
    sourceEvaluationId: item.sourceEvaluationId,
    caseSha256: item.contentSha256,
    evaluationSha256: item.adjudicationRevision.evaluationSha256,
    rubricSha256: item.rubricSha256,
    expectedVerdict: item.adjudicationRevision.expectedVerdict,
    expectedLeftSnapshotSha256: item.evaluation.leftSnapshotSha256,
    expectedRightSnapshotSha256: item.evaluation.rightSnapshotSha256,
  };
}

function validateQualificationCaseResult(
  result: EvaluationCasebookQualificationCaseResult,
  item: EvaluationCasebookCase,
): void {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error(
      `Evaluation Casebook qualification judgment is invalid: ${item.id}`,
    );
  }
  const evidence = caseResultEvidence(item);
  for (const [key, expected] of Object.entries(evidence)) {
    if (
      result[key as keyof EvaluationCasebookQualificationCaseResult] !==
      expected
    ) {
      throw new Error(
        `Evaluation Casebook qualification case evidence is invalid: ${item.id}`,
      );
    }
  }
  const expectedAgreement =
    result.evidenceState === "verified" &&
    result.actualVerdict === result.expectedVerdict;
  if (
    !VERDICTS.has(result.actualVerdict) ||
    !EVIDENCE_STATES.has(result.evidenceState) ||
    result.agreement !== expectedAgreement ||
    !Array.isArray(result.scores) ||
    typeof result.reason !== "string" ||
    !result.reason.trim() ||
    result.reason.length > 2_000 ||
    typeof result.evidence !== "string" ||
    result.evidence.length > 2_000
  ) {
    throw new Error(
      `Evaluation Casebook qualification judgment is invalid: ${item.id}`,
    );
  }
  const observedLeft = result.observedLeftSnapshotSha256;
  const observedRight = result.observedRightSnapshotSha256;
  if (
    (observedLeft !== undefined && !/^[a-f0-9]{64}$/.test(observedLeft)) ||
    (observedRight !== undefined && !/^[a-f0-9]{64}$/.test(observedRight))
  ) {
    throw new Error(
      `Evaluation Casebook qualification observed evidence is invalid: ${item.id}`,
    );
  }
  if (
    result.evidenceState === "verified" &&
    (observedLeft !== result.expectedLeftSnapshotSha256 ||
      observedRight !== result.expectedRightSnapshotSha256)
  ) {
    throw new Error(
      `Evaluation Casebook qualification verified evidence is invalid: ${item.id}`,
    );
  }
  if (
    result.evidenceState === "drifted" &&
    (!observedLeft ||
      !observedRight ||
      (observedLeft === result.expectedLeftSnapshotSha256 &&
        observedRight === result.expectedRightSnapshotSha256))
  ) {
    throw new Error(
      `Evaluation Casebook qualification drift evidence is invalid: ${item.id}`,
    );
  }
  if (
    result.evidenceState === "missing" &&
    (observedLeft !== undefined || observedRight !== undefined)
  ) {
    throw new Error(
      `Evaluation Casebook qualification missing evidence is invalid: ${item.id}`,
    );
  }
  if (
    result.evidenceState !== "verified" &&
    (result.actualVerdict !== "inconclusive" ||
      result.agreement ||
      result.scores.length > 0 ||
      result.evidence.length > 0)
  ) {
    throw new Error(
      `Evaluation Casebook qualification unverified judgment is invalid: ${item.id}`,
    );
  }
  validateQualificationScores(result, item);
  const expectedStatus =
    result.evidenceState !== "verified" ||
    result.actualVerdict === "inconclusive"
      ? "inconclusive"
      : result.agreement
        ? "agreed"
        : "disagreed";
  if (result.status !== expectedStatus) {
    throw new Error(
      `Evaluation Casebook qualification case status is invalid: ${item.id}`,
    );
  }
}

function validateQualificationScores(
  result: EvaluationCasebookQualificationCaseResult,
  item: EvaluationCasebookCase,
): void {
  if (
    result.evidenceState !== "verified" ||
    result.actualVerdict === "inconclusive"
  ) {
    if (result.scores.length !== 0) {
      throw new Error(
        `Evaluation Casebook qualification scores are invalid: ${item.id}`,
      );
    }
    return;
  }
  if (result.scores.length !== item.evaluation.rubric.criteria.length) {
    throw new Error(
      `Evaluation Casebook qualification scores are invalid: ${item.id}`,
    );
  }
  for (const [index, criterion] of item.evaluation.rubric.criteria.entries()) {
    const score = result.scores[index];
    if (
      !score ||
      score.criterionId !== criterion.id ||
      !Number.isInteger(score.leftScore) ||
      score.leftScore < 1 ||
      score.leftScore > 5 ||
      !Number.isInteger(score.rightScore) ||
      score.rightScore < 1 ||
      score.rightScore > 5 ||
      typeof score.reason !== "string" ||
      !score.reason.trim() ||
      score.reason.length > 500
    ) {
      throw new Error(
        `Evaluation Casebook qualification scores are invalid: ${item.id}`,
      );
    }
  }
}

function qualificationStatus(
  gate: EvaluationCasebookQualificationGate,
  sampleCount: number,
  agreementRate: number,
  inconclusiveCount: number,
  unverifiedCount: number,
): EvaluationCasebookQualificationStatus {
  if (
    sampleCount === 0 ||
    unverifiedCount > 0 ||
    (!gate.allowInconclusive && inconclusiveCount > 0)
  ) {
    return "inconclusive";
  }
  return agreementRate >= gate.minimumAgreementRate ? "passed" : "failed";
}

function normalizeModel(input: ModelRef): ModelRef {
  const model = {
    provider: input.provider.trim().toLowerCase(),
    id: input.id.trim(),
  };
  if (!model.provider || !model.id) {
    throw new Error("Evaluation Casebook qualification model is required");
  }
  return model;
}

function assertAvailableEvaluator(
  models: ModelRegistry,
  model: ModelRef,
): void {
  if (
    !(model.provider === "napier" && model.id === "demo") &&
    !models.resolve(model)
  ) {
    throw new Error(`Evaluator model not found: ${model.provider}/${model.id}`);
  }
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 500);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
