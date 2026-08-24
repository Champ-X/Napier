import type {
  EvaluationAdjudication,
  EvaluationConsensusReport,
  EvaluationConsensusResolution,
  EvaluationReviewerBallot,
  EvaluationSuite,
  EvaluationSuiteExecution,
  RunEvaluationRecord,
  ThreadReplayBundle,
} from "@napier/contracts";
import {
  hashEvaluationAdjudicationRevision,
  validateEvaluationAdjudication,
} from "./evaluation-calibration.js";
import {
  hashEvaluationConsensusReport,
  hashEvaluationConsensusResolution,
  hashEvaluationReviewerBallotRevision,
  validateEvaluationConsensusReport,
  validateEvaluationConsensusResolution,
  validateEvaluationReviewerBallot,
} from "./evaluation-consensus.js";
import { validateEvaluationSuiteExecution } from "./evaluation-suite-validation.js";
import {
  hashEvaluationSuiteExecution,
  hashRunEvaluation,
} from "./evaluation-suites.js";
import type { StorePersistedRunRecord } from "./store-repository-host.js";
import type { ThreadReplayImportIds } from "./thread-replay-import-context.js";

export interface ImportedEvaluationRecords {
  evaluations: RunEvaluationRecord[];
  evaluationAdjudications: EvaluationAdjudication[];
  evaluationReviewerBallots: EvaluationReviewerBallot[];
  evaluationConsensusResolutions: EvaluationConsensusResolution[];
  evaluationSuites: EvaluationSuite[];
  evaluationSuiteExecutions: EvaluationSuiteExecution[];
}

interface EvaluationImportContext {
  bundle: ThreadReplayBundle;
  ids: ThreadReplayImportIds;
  evaluations: RunEvaluationRecord[];
  evaluationsBySourceId: Map<string, RunEvaluationRecord>;
}

function createEvaluations(
  bundle: ThreadReplayBundle,
  ids: ThreadReplayImportIds,
): RunEvaluationRecord[] {
  return bundle.evaluations.map((source) => ({
    ...structuredClone(source),
    id: ids.evaluationIds.get(source.id)!,
    threadId: ids.threadId,
    leftRunId: ids.runIds.get(source.leftRunId)!,
    rightRunId: ids.runIds.get(source.rightRunId)!,
  }));
}

function createEvaluationImportContext(
  bundle: ThreadReplayBundle,
  ids: ThreadReplayImportIds,
): EvaluationImportContext {
  const evaluations = createEvaluations(bundle, ids);
  return {
    bundle,
    ids,
    evaluations,
    evaluationsBySourceId: new Map(
      bundle.evaluations.map((source, index) => [
        source.id,
        evaluations[index]!,
      ]),
    ),
  };
}

function createReviewerBallots(
  context: EvaluationImportContext,
): EvaluationReviewerBallot[] {
  const { bundle, ids, evaluationsBySourceId } = context;
  return (bundle.evaluationReviewerBallots ?? []).map((source) => {
    const evaluation = evaluationsBySourceId.get(source.evaluationId)!;
    const ballotId = ids.evaluationReviewerBallotIds.get(source.id)!;
    const revisions = source.revisions.map((revision) => {
      const content = {
        revision: revision.revision,
        reviewerName: revision.reviewerName,
        expectedVerdict: revision.expectedVerdict,
        note: revision.note,
        evaluationSha256: hashRunEvaluation(evaluation),
        createdAt: revision.createdAt,
      };
      return {
        ...content,
        contentSha256: hashEvaluationReviewerBallotRevision(
          ballotId,
          ids.threadId,
          evaluation.id,
          source.reviewerId,
          content,
        ),
      };
    });
    return validateEvaluationReviewerBallot(
      {
        ...structuredClone(source),
        id: ballotId,
        threadId: ids.threadId,
        evaluationId: evaluation.id,
        revisions,
      },
      evaluation,
    );
  });
}

function createConsensusReports(
  context: EvaluationImportContext,
  ballots: EvaluationReviewerBallot[],
): {
  reportsByResolutionId: Map<string, EvaluationConsensusReport>;
  reportSha256BySourceSha256: Map<string, string>;
} {
  const { bundle, ids, evaluationsBySourceId } = context;
  const ballotsBySourceId = new Map(
    (bundle.evaluationReviewerBallots ?? []).map((source, index) => [
      source.id,
      ballots[index]!,
    ]),
  );
  const reportsByResolutionId = new Map<string, EvaluationConsensusReport>();
  const reportSha256BySourceSha256 = new Map<string, string>();
  for (const source of bundle.evaluationConsensusResolutions ?? []) {
    const evaluation = evaluationsBySourceId.get(source.evaluationId)!;
    const mapped: EvaluationConsensusReport = {
      ...structuredClone(source.report),
      threadId: ids.threadId,
      evaluationId: evaluation.id,
      evaluationSha256: hashRunEvaluation(evaluation),
      votes: source.report.votes.map((vote) => {
        const ballot = ballotsBySourceId.get(vote.ballotId)!;
        const revision = ballot.revisions.find(
          (candidate) => candidate.revision === vote.ballotRevision,
        )!;
        return {
          ...structuredClone(vote),
          ballotId: ballot.id,
          ballotSha256: revision.contentSha256,
        };
      }),
      contentSha256: "",
    };
    const {
      generatedAt: _generatedAt,
      contentSha256: _contentSha256,
      ...content
    } = mapped;
    mapped.contentSha256 = hashEvaluationConsensusReport(content);
    validateEvaluationConsensusReport(
      mapped,
      evaluation,
      ballots.filter((ballot) => ballot.evaluationId === evaluation.id),
      { requireCurrent: false },
    );
    reportsByResolutionId.set(source.id, mapped);
    reportSha256BySourceSha256.set(
      source.report.contentSha256,
      mapped.contentSha256,
    );
  }
  return { reportsByResolutionId, reportSha256BySourceSha256 };
}

function createAdjudications(
  context: EvaluationImportContext,
  reportSha256BySourceSha256: ReadonlyMap<string, string>,
): EvaluationAdjudication[] {
  const { bundle, ids, evaluationsBySourceId } = context;
  return (bundle.evaluationAdjudications ?? []).map((source) => {
    const evaluation = evaluationsBySourceId.get(source.evaluationId)!;
    const adjudicationId = ids.evaluationAdjudicationIds.get(source.id)!;
    const revisions = source.revisions.map((revision) => {
      const mappedSourceSha256 = revision.sourceSha256
        ? reportSha256BySourceSha256.get(revision.sourceSha256)
        : undefined;
      if (revision.source && !mappedSourceSha256) {
        throw new Error(
          `Imported consensus report is missing: ${revision.sourceSha256}`,
        );
      }
      const content = {
        revision: revision.revision,
        expectedVerdict: revision.expectedVerdict,
        note: revision.note,
        evaluationSha256: hashRunEvaluation(evaluation),
        ...(revision.source
          ? { source: revision.source, sourceSha256: mappedSourceSha256! }
          : {}),
        createdAt: revision.createdAt,
      };
      return {
        ...content,
        contentSha256: hashEvaluationAdjudicationRevision(
          adjudicationId,
          ids.threadId,
          evaluation.id,
          content,
        ),
      };
    });
    return validateEvaluationAdjudication(
      {
        ...structuredClone(source),
        id: adjudicationId,
        threadId: ids.threadId,
        evaluationId: evaluation.id,
        revisions,
      },
      evaluation,
    );
  });
}

function createConsensusResolutions(
  context: EvaluationImportContext,
  ballots: EvaluationReviewerBallot[],
  adjudications: EvaluationAdjudication[],
  reportsByResolutionId: ReadonlyMap<string, EvaluationConsensusReport>,
): EvaluationConsensusResolution[] {
  const { bundle, ids, evaluationsBySourceId } = context;
  const adjudicationsBySourceId = new Map(
    (bundle.evaluationAdjudications ?? []).map((source, index) => [
      source.id,
      adjudications[index]!,
    ]),
  );
  return (bundle.evaluationConsensusResolutions ?? []).map((source) => {
    const evaluation = evaluationsBySourceId.get(source.evaluationId)!;
    const report = reportsByResolutionId.get(source.id)!;
    const adjudication = adjudicationsBySourceId.get(source.adjudicationId)!;
    const adjudicationRevision = adjudication.revisions.find(
      (revision) => revision.revision === source.adjudicationRevision.revision,
    )!;
    const id = ids.evaluationConsensusResolutionIds.get(source.id)!;
    const content = {
      threadId: ids.threadId,
      evaluationId: evaluation.id,
      evaluationSha256: hashRunEvaluation(evaluation),
      report,
      adjudicationId: adjudication.id,
      adjudicationRevision,
      createdAt: source.createdAt,
    };
    const resolution: EvaluationConsensusResolution = {
      id,
      ...content,
      contentSha256: hashEvaluationConsensusResolution(id, content),
    };
    return validateEvaluationConsensusResolution(
      resolution,
      evaluation,
      ballots.filter((ballot) => ballot.evaluationId === evaluation.id),
      adjudication,
    );
  });
}

function createSuites(
  bundle: ThreadReplayBundle,
  ids: ThreadReplayImportIds,
): EvaluationSuite[] {
  return (bundle.evaluationSuites ?? []).map((source) => ({
    ...structuredClone(source),
    id: ids.evaluationSuiteIds.get(source.id)!,
    threadId: ids.threadId,
    baselineRunId: ids.runIds.get(source.baselineRunId)!,
    candidateRunIds: source.candidateRunIds.map(
      (runId) => ids.runIds.get(runId)!,
    ),
  }));
}

function createSuiteExecutions(
  context: EvaluationImportContext,
  suites: EvaluationSuite[],
  runs: StorePersistedRunRecord[],
): EvaluationSuiteExecution[] {
  const { bundle, ids, evaluations, evaluationsBySourceId } = context;
  const executions = (bundle.evaluationSuiteExecutions ?? []).map((source) => {
    const mapped: EvaluationSuiteExecution = {
      ...structuredClone(source),
      id: ids.evaluationSuiteExecutionIds.get(source.id)!,
      suiteId: ids.evaluationSuiteIds.get(source.suiteId)!,
      threadId: ids.threadId,
      baselineRunId: ids.runIds.get(source.baselineRunId)!,
      candidateRunIds: source.candidateRunIds.map(
        (runId) => ids.runIds.get(runId)!,
      ),
      results: source.results.map((result) => {
        const evaluation = evaluationsBySourceId.get(result.evaluationId)!;
        return {
          ...structuredClone(result),
          candidateRunId: ids.runIds.get(result.candidateRunId)!,
          evaluationId: ids.evaluationIds.get(result.evaluationId)!,
          evaluationSha256: hashRunEvaluation(evaluation),
        };
      }),
      contentSha256: "",
    };
    const {
      id: _id,
      contentSha256: _contentSha256,
      startedAt: _startedAt,
      finishedAt: _finishedAt,
      ...hashInput
    } = mapped;
    mapped.contentSha256 = hashEvaluationSuiteExecution(hashInput);
    return mapped;
  });
  for (const execution of executions) {
    validateEvaluationSuiteExecution(execution, suites, evaluations, runs);
  }
  return executions;
}

export function createImportedEvaluationRecords(
  bundle: ThreadReplayBundle,
  ids: ThreadReplayImportIds,
  runs: StorePersistedRunRecord[],
): ImportedEvaluationRecords {
  const context = createEvaluationImportContext(bundle, ids);
  const evaluationReviewerBallots = createReviewerBallots(context);
  const { reportsByResolutionId, reportSha256BySourceSha256 } =
    createConsensusReports(context, evaluationReviewerBallots);
  const evaluationAdjudications = createAdjudications(
    context,
    reportSha256BySourceSha256,
  );
  const evaluationConsensusResolutions = createConsensusResolutions(
    context,
    evaluationReviewerBallots,
    evaluationAdjudications,
    reportsByResolutionId,
  );
  const evaluationSuites = createSuites(bundle, ids);
  const evaluationSuiteExecutions = createSuiteExecutions(
    context,
    evaluationSuites,
    runs,
  );
  return {
    evaluations: context.evaluations,
    evaluationAdjudications,
    evaluationReviewerBallots,
    evaluationConsensusResolutions,
    evaluationSuites,
    evaluationSuiteExecutions,
  };
}
