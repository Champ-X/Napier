import {
  type ContextCheckpointCalibrationReport,
  type EvaluationAdjudication,
  type EvaluationCalibrationReport,
  type EvaluationConsensusGate,
  type EvaluationConsensusReport,
  type EvaluationConsensusResolution,
  type EvaluationReviewerBallot,
  type ResolveEvaluationConsensusRequest,
  type ResolveEvaluationConsensusResult,
  type ReviewRunEvaluationRequest,
  type RunEvaluationRecord,
  type SubmitEvaluationReviewerBallotRequest,
} from "@napier/contracts";
import { createContextCheckpointCalibrationReport } from "./checkpoint-calibration.js";
import {
  createEvaluationCalibrationReport,
  reviewRunEvaluation as reviewRunEvaluationRecord,
} from "./evaluation-calibration.js";
import {
  consensusAdjudicationRequest,
  createEvaluationConsensusReport,
  createEvaluationConsensusResolution,
  MAX_EVALUATION_CONSENSUS_RESOLUTIONS,
  MAX_EVALUATION_REVIEWERS,
  submitEvaluationReviewerBallot,
  validateEvaluationConsensusResolution,
} from "./evaluation-consensus.js";

import type { StoreRepositoryHost } from "./store-repository-host.js";

export class EvaluationReviewRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  listRunEvaluations(threadId: string): RunEvaluationRecord[] {
    this.host.assertInitialized();
    return structuredClone(
      this.host.state.evaluations
        .filter((evaluation) => evaluation.threadId === threadId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  listEvaluationAdjudications(threadId: string): EvaluationAdjudication[] {
    this.host.assertInitialized();
    this.host.getThread(threadId);
    return structuredClone(
      this.host.state.evaluationAdjudications
        .filter((adjudication) => adjudication.threadId === threadId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  async reviewRunEvaluation(
    threadId: string,
    evaluationId: string,
    request: ReviewRunEvaluationRequest,
  ): Promise<EvaluationAdjudication> {
    this.host.assertInitialized();
    this.host.getThread(threadId);
    return this.host.stateQueue.run(async () => {
      const evaluation = this.host.state.evaluations.find(
        (candidate) =>
          candidate.id === evaluationId && candidate.threadId === threadId,
      );
      if (!evaluation) {
        throw new Error(`Run evaluation not found: ${evaluationId}`);
      }
      const index = this.host.state.evaluationAdjudications.findIndex(
        (candidate) => candidate.evaluationId === evaluationId,
      );
      const current =
        index >= 0 ? this.host.state.evaluationAdjudications[index] : undefined;
      const updated = reviewRunEvaluationRecord(current, evaluation, request);
      if (current && updated.currentRevision === current.currentRevision) {
        return structuredClone(current);
      }
      if (index >= 0) this.host.state.evaluationAdjudications[index] = updated;
      else this.host.state.evaluationAdjudications.push(updated);
      await this.host.persistState();
      return structuredClone(updated);
    });
  }

  listEvaluationReviewerBallots(
    threadId: string,
    evaluationId?: string,
  ): EvaluationReviewerBallot[] {
    this.host.assertInitialized();
    this.host.getThread(threadId);
    return structuredClone(
      this.host.state.evaluationReviewerBallots
        .filter(
          (ballot) =>
            ballot.threadId === threadId &&
            (!evaluationId || ballot.evaluationId === evaluationId),
        )
        .sort((left, right) =>
          `${left.evaluationId}/${left.reviewerId}`.localeCompare(
            `${right.evaluationId}/${right.reviewerId}`,
          ),
        ),
    );
  }

  async submitEvaluationReviewerBallot(
    threadId: string,
    evaluationId: string,
    request: SubmitEvaluationReviewerBallotRequest,
  ): Promise<EvaluationReviewerBallot> {
    this.host.assertInitialized();
    this.host.getThread(threadId);
    return this.host.stateQueue.run(async () => {
      const evaluation = this.host.state.evaluations.find(
        (candidate) =>
          candidate.id === evaluationId && candidate.threadId === threadId,
      );
      if (!evaluation) {
        throw new Error(`Run evaluation not found: ${evaluationId}`);
      }
      const normalizedReviewerId = request.reviewerId.trim().toLowerCase();
      const index = this.host.state.evaluationReviewerBallots.findIndex(
        (candidate) =>
          candidate.evaluationId === evaluationId &&
          candidate.reviewerId === normalizedReviewerId,
      );
      const current =
        index >= 0
          ? this.host.state.evaluationReviewerBallots[index]
          : undefined;
      if (
        !current &&
        this.host.state.evaluationReviewerBallots.filter(
          (candidate) => candidate.evaluationId === evaluationId,
        ).length >= MAX_EVALUATION_REVIEWERS
      ) {
        throw new Error(
          `Evaluation consensus exceeds ${MAX_EVALUATION_REVIEWERS} reviewers`,
        );
      }
      const updated = submitEvaluationReviewerBallot(
        current,
        evaluation,
        request,
      );
      if (current && updated.currentRevision === current.currentRevision) {
        return structuredClone(current);
      }
      if (index >= 0)
        this.host.state.evaluationReviewerBallots[index] = updated;
      else this.host.state.evaluationReviewerBallots.push(updated);
      await this.host.persistState();
      return structuredClone(updated);
    });
  }

  getEvaluationConsensusReport(
    threadId: string,
    evaluationId: string,
    gate?: Partial<EvaluationConsensusGate>,
  ): EvaluationConsensusReport {
    this.host.assertInitialized();
    this.host.getThread(threadId);
    const evaluation = this.host.state.evaluations.find(
      (candidate) =>
        candidate.id === evaluationId && candidate.threadId === threadId,
    );
    if (!evaluation) {
      throw new Error(`Run evaluation not found: ${evaluationId}`);
    }
    return createEvaluationConsensusReport(
      evaluation,
      this.host.state.evaluationReviewerBallots.filter(
        (candidate) => candidate.evaluationId === evaluationId,
      ),
      gate,
    );
  }

  listEvaluationConsensusResolutions(
    threadId: string,
    evaluationId?: string,
  ): EvaluationConsensusResolution[] {
    this.host.assertInitialized();
    this.host.getThread(threadId);
    return structuredClone(
      this.host.state.evaluationConsensusResolutions
        .filter(
          (resolution) =>
            resolution.threadId === threadId &&
            (!evaluationId || resolution.evaluationId === evaluationId),
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  async resolveEvaluationConsensus(
    threadId: string,
    evaluationId: string,
    request: ResolveEvaluationConsensusRequest,
  ): Promise<ResolveEvaluationConsensusResult> {
    this.host.assertInitialized();
    this.host.getThread(threadId);
    return this.host.stateQueue.run(async () => {
      const evaluation = this.host.state.evaluations.find(
        (candidate) =>
          candidate.id === evaluationId && candidate.threadId === threadId,
      );
      if (!evaluation) {
        throw new Error(`Run evaluation not found: ${evaluationId}`);
      }
      const ballots = this.host.state.evaluationReviewerBallots.filter(
        (candidate) => candidate.evaluationId === evaluationId,
      );
      const report = createEvaluationConsensusReport(
        evaluation,
        ballots,
        request.gate,
      );
      consensusAdjudicationRequest(report);
      const existing = this.host.state.evaluationConsensusResolutions.find(
        (candidate) =>
          candidate.evaluationId === evaluationId &&
          candidate.report.contentSha256 === report.contentSha256,
      );
      const adjudicationIndex =
        this.host.state.evaluationAdjudications.findIndex(
          (candidate) => candidate.evaluationId === evaluationId,
        );
      const currentAdjudication =
        adjudicationIndex >= 0
          ? this.host.state.evaluationAdjudications[adjudicationIndex]
          : undefined;
      if (existing) {
        if (!currentAdjudication) {
          throw new Error(
            `Evaluation consensus adjudication is missing: ${existing.id}`,
          );
        }
        return {
          report: structuredClone(existing.report),
          resolution: structuredClone(existing),
          adjudication: structuredClone(currentAdjudication),
          created: false,
        };
      }
      if (
        this.host.state.evaluationConsensusResolutions.filter(
          (candidate) => candidate.evaluationId === evaluationId,
        ).length >= MAX_EVALUATION_CONSENSUS_RESOLUTIONS
      ) {
        throw new Error(
          `Evaluation exceeds ${MAX_EVALUATION_CONSENSUS_RESOLUTIONS} consensus resolutions`,
        );
      }
      const adjudication = reviewRunEvaluationRecord(
        currentAdjudication,
        evaluation,
        consensusAdjudicationRequest(report),
      );
      const resolution = createEvaluationConsensusResolution(
        evaluation,
        report,
        adjudication,
      );
      validateEvaluationConsensusResolution(
        resolution,
        evaluation,
        ballots,
        adjudication,
      );
      if (adjudicationIndex >= 0) {
        this.host.state.evaluationAdjudications[adjudicationIndex] =
          adjudication;
      } else {
        this.host.state.evaluationAdjudications.push(adjudication);
      }
      this.host.state.evaluationConsensusResolutions.push(resolution);
      await this.host.persistState();
      return {
        report: structuredClone(report),
        resolution: structuredClone(resolution),
        adjudication: structuredClone(adjudication),
        created: true,
      };
    });
  }

  getEvaluationCalibration(threadId: string): EvaluationCalibrationReport {
    this.host.assertInitialized();
    this.host.getThread(threadId);
    return createEvaluationCalibrationReport(
      threadId,
      this.host.state.evaluations,
      this.host.state.evaluationAdjudications,
    );
  }

  async getContextCheckpointCalibration(
    threadId: string,
  ): Promise<ContextCheckpointCalibrationReport> {
    this.host.assertInitialized();
    this.host.getThread(threadId);
    return createContextCheckpointCalibrationReport(
      threadId,
      await this.host.listEvents(threadId),
    );
  }
}
