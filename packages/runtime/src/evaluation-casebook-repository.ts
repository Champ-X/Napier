import {
  type CreateEvaluationCasebookRequest,
  type CurateEvaluationCaseRequest,
  type EvaluationCasebook,
  type EvaluationCasebookArtifact,
  type EvaluationCasebookCalibrationReport,
  type EvaluationCasebookQualificationExecution,
  type EvaluationCasebookQualificationReceipt,
  type EvaluationQualificationBaseline,
  type PromoteEvaluationQualificationBaselineResult,
  type RemoveEvaluationCaseRequest,
  type RunEvaluationRecord,
  type TrustedReceiptEnvelope,
  type UpdateEvaluationCasebookRequest,
} from "@napier/contracts";
import { validateEvaluationCasebookQualificationExecution } from "./evaluation-casebook-qualification.js";
import {
  createEvaluationCasebookArtifact,
  createEvaluationCasebookCalibrationReport,
  createEvaluationCasebook as createEvaluationCasebookRecord,
  curateEvaluationCase,
  removeEvaluationCase,
  updateEvaluationCasebook as updateEvaluationCasebookRecord,
} from "./evaluation-casebooks.js";
import { validatePersistedRunEvaluation } from "./evaluation-record-validation.js";
import {
  createEvaluationQualificationBaseline,
  MAX_QUALIFICATION_BASELINES_PER_CASEBOOK,
  verifyTrustedReceiptEnvelope,
} from "./receipt-trust-envelopes.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";

export class EvaluationCasebookRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  listEvaluationCasebooks(): EvaluationCasebook[] {
    this.host.assertInitialized();
    return structuredClone(
      this.host.state.evaluationCasebooks
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
  }

  getEvaluationCasebook(casebookId: string): EvaluationCasebook {
    this.host.assertInitialized();
    const casebook = this.host.state.evaluationCasebooks.find(
      (candidate) => candidate.id === casebookId,
    );
    if (!casebook) {
      throw new Error(`Evaluation Casebook not found: ${casebookId}`);
    }
    return structuredClone(casebook);
  }

  async createEvaluationCasebook(
    request: CreateEvaluationCasebookRequest,
  ): Promise<EvaluationCasebook> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    const casebook = createEvaluationCasebookRecord(request);
    return this.host.stateQueue.run(async () => {
      this.host.state.evaluationCasebooks.push(casebook);
      await this.host.persistState();
      return structuredClone(casebook);
    });
  }

  async updateEvaluationCasebook(
    casebookId: string,
    request: UpdateEvaluationCasebookRequest,
  ): Promise<EvaluationCasebook> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    return this.host.stateQueue.run(async () => {
      const index = this.host.state.evaluationCasebooks.findIndex(
        (candidate) => candidate.id === casebookId,
      );
      const current = this.host.state.evaluationCasebooks[index];
      if (!current) {
        throw new Error(`Evaluation Casebook not found: ${casebookId}`);
      }
      const updated = updateEvaluationCasebookRecord(current, request);
      if (updated.currentRevision !== current.currentRevision) {
        this.host.state.evaluationCasebooks[index] = updated;
        await this.host.persistState();
      }
      return structuredClone(updated);
    });
  }

  async curateEvaluationCasebookCase(
    casebookId: string,
    request: CurateEvaluationCaseRequest,
  ): Promise<EvaluationCasebook> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    return this.host.stateQueue.run(async () => {
      const index = this.host.state.evaluationCasebooks.findIndex(
        (candidate) => candidate.id === casebookId,
      );
      const current = this.host.state.evaluationCasebooks[index];
      if (!current) {
        throw new Error(`Evaluation Casebook not found: ${casebookId}`);
      }
      const evaluation = this.host.state.evaluations.find(
        (candidate) =>
          candidate.id === request.evaluationId &&
          candidate.threadId === request.threadId,
      );
      if (!evaluation) {
        throw new Error(`Run evaluation not found: ${request.evaluationId}`);
      }
      const adjudication = this.host.state.evaluationAdjudications.find(
        (candidate) =>
          candidate.evaluationId === evaluation.id &&
          candidate.threadId === request.threadId,
      );
      if (!adjudication) {
        throw new Error(
          `Evaluation requires human adjudication before curation: ${evaluation.id}`,
        );
      }
      const truth = adjudication.revisions.at(-1)!;
      const consensusResolution =
        truth.source === "reviewer_consensus"
          ? this.host.state.evaluationConsensusResolutions.find(
              (resolution) =>
                resolution.adjudicationId === adjudication.id &&
                resolution.adjudicationRevision.revision === truth.revision &&
                resolution.report.contentSha256 === truth.sourceSha256,
            )
          : undefined;
      if (truth.source === "reviewer_consensus" && !consensusResolution) {
        throw new Error(
          `Consensus evidence is missing for curation: ${evaluation.id}`,
        );
      }
      const consensusEvidence = consensusResolution
        ? {
            resolution: consensusResolution,
            reviewerBallots: consensusResolution.report.votes.map((vote) => {
              const ballot = this.host.state.evaluationReviewerBallots.find(
                (candidate) => candidate.id === vote.ballotId,
              );
              const revision = ballot?.revisions.find(
                (candidate) => candidate.revision === vote.ballotRevision,
              );
              if (!ballot || !revision) {
                throw new Error(
                  `Consensus reviewer evidence is missing: ${vote.ballotId}`,
                );
              }
              return {
                ...structuredClone(ballot),
                revisions: ballot.revisions
                  .slice(0, vote.ballotRevision)
                  .map((item) => structuredClone(item)),
                currentRevision: vote.ballotRevision,
                updatedAt: revision.createdAt,
              };
            }),
          }
        : undefined;
      const updated = curateEvaluationCase(
        current,
        evaluation,
        adjudication,
        consensusEvidence,
        request.templateCaseId,
      );
      if (updated.currentRevision !== current.currentRevision) {
        this.host.state.evaluationCasebooks[index] = updated;
        await this.host.persistState();
      }
      return structuredClone(updated);
    });
  }

  async removeEvaluationCasebookCase(
    casebookId: string,
    caseId: string,
    request: RemoveEvaluationCaseRequest,
  ): Promise<EvaluationCasebook> {
    this.host.assertInitialized();
    this.host.getThread(request.threadId);
    return this.host.stateQueue.run(async () => {
      const index = this.host.state.evaluationCasebooks.findIndex(
        (candidate) => candidate.id === casebookId,
      );
      const current = this.host.state.evaluationCasebooks[index];
      if (!current) {
        throw new Error(`Evaluation Casebook not found: ${casebookId}`);
      }
      const updated = removeEvaluationCase(current, caseId);
      this.host.state.evaluationCasebooks[index] = updated;
      await this.host.persistState();
      return structuredClone(updated);
    });
  }

  getEvaluationCasebookCalibration(
    casebookId: string,
  ): EvaluationCasebookCalibrationReport {
    return createEvaluationCasebookCalibrationReport(
      this.host.getEvaluationCasebook(casebookId),
    );
  }

  exportEvaluationCasebook(casebookId: string): EvaluationCasebookArtifact {
    return createEvaluationCasebookArtifact(
      this.host.getEvaluationCasebook(casebookId),
    );
  }

  listEvaluationCasebookQualificationExecutions(
    casebookId: string,
  ): EvaluationCasebookQualificationExecution[] {
    this.host.assertInitialized();
    this.host.getEvaluationCasebook(casebookId);
    return structuredClone(
      this.host.state.evaluationCasebookQualificationExecutions
        .filter((execution) => execution.casebookId === casebookId)
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
    );
  }

  async saveEvaluationCasebookQualificationExecution(
    execution: EvaluationCasebookQualificationExecution,
  ): Promise<EvaluationCasebookQualificationExecution> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const casebook = this.host.state.evaluationCasebooks.find(
        (candidate) => candidate.id === execution.casebookId,
      );
      if (!casebook) {
        throw new Error(
          `Evaluation Casebook not found: ${execution.casebookId}`,
        );
      }
      if (execution.casebookRevision !== casebook.currentRevision) {
        throw new Error(
          `Evaluation Casebook changed during qualification: ${execution.casebookId}`,
        );
      }
      if (
        !this.host.state.threads.some(
          (thread) => thread.id === execution.auditThreadId,
        )
      ) {
        throw new Error(
          `Evaluation Casebook qualification audit thread is missing: ${execution.auditThreadId}`,
        );
      }
      validateEvaluationCasebookQualificationExecution(execution, casebook);
      if (
        this.host.state.evaluationCasebookQualificationExecutions.some(
          (candidate) => candidate.id === execution.id,
        )
      ) {
        throw new Error(
          `Evaluation Casebook qualification execution already exists: ${execution.id}`,
        );
      }
      this.host.state.evaluationCasebookQualificationExecutions.push(
        structuredClone(execution),
      );
      const executions =
        this.host.state.evaluationCasebookQualificationExecutions
          .filter((candidate) => candidate.casebookId === execution.casebookId)
          .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
      if (executions.length > 20) {
        const protectedExecutionIds = new Set([
          execution.id,
          ...this.host.state.evaluationQualificationBaselines
            .filter((baseline) => baseline.casebookId === execution.casebookId)
            .map((baseline) => baseline.qualificationExecutionId),
        ]);
        const removeIds = new Set(
          executions
            .filter((candidate) => !protectedExecutionIds.has(candidate.id))
            .slice(0, Math.max(0, executions.length - 20))
            .map((candidate) => candidate.id),
        );
        this.host.state.evaluationCasebookQualificationExecutions =
          this.host.state.evaluationCasebookQualificationExecutions.filter(
            (candidate) => !removeIds.has(candidate.id),
          );
      }
      await this.host.persistState();
      return structuredClone(execution);
    });
  }

  listEvaluationQualificationBaselines(
    casebookId?: string,
  ): EvaluationQualificationBaseline[] {
    this.host.assertInitialized();
    if (casebookId) this.host.getEvaluationCasebook(casebookId);
    return structuredClone(
      this.host.state.evaluationQualificationBaselines
        .filter((baseline) => !casebookId || baseline.casebookId === casebookId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  async promoteEvaluationQualificationBaseline(
    casebookId: string,
    promotedByThreadId: string,
    envelope: TrustedReceiptEnvelope<EvaluationCasebookQualificationReceipt>,
  ): Promise<PromoteEvaluationQualificationBaselineResult> {
    this.host.assertInitialized();
    this.host.getThread(promotedByThreadId);
    return this.host.stateQueue.run(async () => {
      const casebook = this.host.state.evaluationCasebooks.find(
        (candidate) => candidate.id === casebookId,
      );
      if (!casebook) {
        throw new Error(`Evaluation Casebook not found: ${casebookId}`);
      }
      const anchor = this.host.state.receiptTrustAnchors.find(
        (candidate) => candidate.keyId === envelope.signature.keyId,
      );
      if (!anchor) {
        throw new Error(
          `Receipt trust anchor not found for key: ${envelope.signature.keyId}`,
        );
      }
      const verification = verifyTrustedReceiptEnvelope(envelope, [anchor]);
      if (verification.status !== "trusted") {
        throw new Error(
          `Qualification baseline receipt is not trusted: ${verification.reason}`,
        );
      }
      const existing = this.host.state.evaluationQualificationBaselines.find(
        (baseline) =>
          baseline.casebookId === casebookId &&
          baseline.casebookRevision === casebook.currentRevision &&
          baseline.envelope.receipt.contentSha256 ===
            envelope.receipt.contentSha256 &&
          baseline.envelope.signature.keyId === envelope.signature.keyId,
      );
      if (existing) {
        return {
          baseline: structuredClone(existing),
          created: false,
        };
      }
      const casebookBaselines =
        this.host.state.evaluationQualificationBaselines.filter(
          (baseline) => baseline.casebookId === casebookId,
        );
      if (
        casebookBaselines.length >= MAX_QUALIFICATION_BASELINES_PER_CASEBOOK
      ) {
        throw new Error(
          `Evaluation Casebook exceeds ${MAX_QUALIFICATION_BASELINES_PER_CASEBOOK} qualification baselines`,
        );
      }
      const current = casebookBaselines.at(-1);
      const baseline = createEvaluationQualificationBaseline(
        envelope,
        casebook,
        promotedByThreadId,
        current?.id,
      );
      const execution =
        this.host.state.evaluationCasebookQualificationExecutions.find(
          (candidate) =>
            candidate.id === baseline.qualificationExecutionId &&
            candidate.casebookId === casebookId &&
            candidate.contentSha256 === baseline.qualificationExecutionSha256,
        );
      if (!execution) {
        throw new Error(
          `Qualification baseline execution is missing: ${baseline.qualificationExecutionId}`,
        );
      }
      this.host.state.evaluationQualificationBaselines.push(baseline);
      await this.host.persistState();
      return {
        baseline: structuredClone(baseline),
        created: true,
      };
    });
  }

  async saveRunEvaluation(
    evaluation: RunEvaluationRecord,
  ): Promise<RunEvaluationRecord> {
    this.host.assertInitialized();
    this.host.getThread(evaluation.threadId);
    if (evaluation.leftRunId === evaluation.rightRunId) {
      throw new Error("Run evaluation requires two distinct runs");
    }
    const runIds = new Set(
      this.host.state.runs
        .filter((run) => run.threadId === evaluation.threadId)
        .map((run) => run.id),
    );
    if (
      !runIds.has(evaluation.leftRunId) ||
      !runIds.has(evaluation.rightRunId)
    ) {
      throw new Error("Evaluation runs must belong to the target thread");
    }
    validatePersistedRunEvaluation(
      evaluation,
      this.host.state.threads,
      this.host.state.runs,
      this.host.state.subagents,
      this.host.requireLedger().listEvents(evaluation.threadId),
    );
    return this.host.stateQueue.run(async () => {
      if (
        this.host.state.evaluations.some(
          (candidate) => candidate.id === evaluation.id,
        )
      ) {
        throw new Error(`Run evaluation already exists: ${evaluation.id}`);
      }
      this.host.state.evaluations.push(structuredClone(evaluation));
      const threadEvaluations = this.host.state.evaluations
        .filter((candidate) => candidate.threadId === evaluation.threadId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      if (threadEvaluations.length > 50) {
        const protectedEvaluationIds = new Set([
          ...this.host.state.evaluationSuiteExecutions.flatMap((execution) =>
            execution.results.map((result) => result.evaluationId),
          ),
          ...this.host.state.evaluationAdjudications.map(
            (adjudication) => adjudication.evaluationId,
          ),
          ...this.host.state.evaluationReviewerBallots.map(
            (ballot) => ballot.evaluationId,
          ),
          ...this.host.state.evaluationConsensusResolutions.map(
            (resolution) => resolution.evaluationId,
          ),
        ]);
        const removeIds = new Set(
          threadEvaluations
            .filter((candidate) => !protectedEvaluationIds.has(candidate.id))
            .slice(0, threadEvaluations.length - 50)
            .map((candidate) => candidate.id),
        );
        this.host.state.evaluations = this.host.state.evaluations.filter(
          (candidate) => !removeIds.has(candidate.id),
        );
      }
      await this.host.persistState();
      return structuredClone(evaluation);
    });
  }
}
