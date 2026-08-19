import { useEffect, useState } from "react";

import type {
  EvaluationConsensusReport,
  EvaluationConsensusResolution,
  EvaluationReviewerBallot,
  RunEvaluationRecord,
  RunEvaluationVerdict,
} from "@napier/contracts";

import {
  previewEvaluationConsensus,
  resolveEvaluationConsensus,
  submitEvaluationReviewerBallot,
} from "./api";
import { toErrorMessage } from "./evaluation-suite-artifacts";

export interface UseEvaluationConsensusOptions {
  threadId: string;
  evaluation: RunEvaluationRecord;
  ballots: EvaluationReviewerBallot[];
  resolutions: EvaluationConsensusResolution[];
  onRefresh(): Promise<void>;
}

export function useEvaluationConsensus(options: UseEvaluationConsensusOptions) {
  const { threadId, evaluation, ballots, resolutions, onRefresh } = options;
  const [reviewerId, setReviewerId] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [expectedVerdict, setExpectedVerdict] = useState<RunEvaluationVerdict>(
    evaluation.verdict,
  );
  const [note, setNote] = useState("");
  const [minimumReviewers, setMinimumReviewers] = useState(2);
  const [minimumAgreementRate, setMinimumAgreementRate] = useState(67);
  const [allowInconclusive, setAllowInconclusive] = useState(false);
  const [report, setReport] = useState<EvaluationConsensusReport>();
  const [busyAction, setBusyAction] = useState<string>();
  const [error, setError] = useState<string>();
  const ballotKey = ballots
    .map((ballot) => `${ballot.id}:${ballot.currentRevision}`)
    .sort()
    .join("|");

  function gateRequest() {
    return {
      gate: {
        minimumReviewers,
        minimumAgreementRate: minimumAgreementRate / 100,
        allowInconclusive,
      },
    };
  }

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    void previewEvaluationConsensus(threadId, evaluation.id, gateRequest())
      .then((value) => {
        if (!cancelled) setReport(value);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(toErrorMessage(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [ballotKey, evaluation.id, threadId]);

  function editBallot(ballot: EvaluationReviewerBallot): void {
    const revision = ballot.revisions.at(-1)!;
    setReviewerId(ballot.reviewerId);
    setReviewerName(revision.reviewerName);
    setExpectedVerdict(revision.expectedVerdict);
    setNote(revision.note);
    setError(undefined);
  }

  function resetBallot(): void {
    setReviewerId("");
    setReviewerName("");
    setExpectedVerdict(evaluation.verdict);
    setNote("");
  }

  function invalidateReport(): void {
    setReport(undefined);
    setError(undefined);
  }

  async function submitBallot(): Promise<void> {
    if (
      !/^[a-z][a-z0-9_-]{1,63}$/i.test(reviewerId.trim()) ||
      !reviewerName.trim() ||
      busyAction
    )
      return;
    setBusyAction("ballot");
    setError(undefined);
    try {
      await submitEvaluationReviewerBallot(threadId, evaluation.id, {
        reviewerId,
        reviewerName,
        expectedVerdict,
        note,
      });
      await onRefresh();
      setReport(
        await previewEvaluationConsensus(
          threadId,
          evaluation.id,
          gateRequest(),
        ),
      );
      resetBallot();
    } catch (submitError) {
      setError(toErrorMessage(submitError));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function previewConsensus(): Promise<void> {
    setBusyAction("preview");
    setError(undefined);
    try {
      setReport(
        await previewEvaluationConsensus(
          threadId,
          evaluation.id,
          gateRequest(),
        ),
      );
    } catch (previewError) {
      setError(toErrorMessage(previewError));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function resolveConsensus(): Promise<void> {
    if (report?.status !== "ready") return;
    setBusyAction("resolve");
    setError(undefined);
    try {
      const result = await resolveEvaluationConsensus(
        threadId,
        evaluation.id,
        gateRequest(),
      );
      setReport(result.report);
      await onRefresh();
    } catch (resolutionError) {
      setError(toErrorMessage(resolutionError));
    } finally {
      setBusyAction(undefined);
    }
  }

  return {
    ...options,
    reviewerId,
    setReviewerId,
    reviewerName,
    setReviewerName,
    expectedVerdict,
    setExpectedVerdict,
    note,
    setNote,
    minimumReviewers,
    setMinimumReviewers,
    minimumAgreementRate,
    setMinimumAgreementRate,
    allowInconclusive,
    setAllowInconclusive,
    report,
    busyAction,
    error,
    sortedBallots: ballots
      .slice()
      .sort((left, right) => left.reviewerId.localeCompare(right.reviewerId)),
    latestResolution: resolutions
      .slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0],
    canSubmitBallot:
      /^[a-z][a-z0-9_-]{1,63}$/i.test(reviewerId.trim()) &&
      Boolean(reviewerName.trim()) &&
      !busyAction,
    editBallot,
    resetBallot,
    invalidateReport,
    submitBallot,
    previewConsensus,
    resolveConsensus,
  };
}
