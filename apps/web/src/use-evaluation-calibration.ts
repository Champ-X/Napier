import { useEffect, useMemo, useState } from "react";

import type {
  EvaluationAdjudication,
  EvaluationCalibrationReport,
  EvaluationConsensusResolution,
  EvaluationReviewerBallot,
  RunEvaluationRecord,
  RunEvaluationVerdict,
} from "@napier/contracts";

import { getEvaluationCalibration, reviewRunEvaluation } from "./api";
import { toErrorMessage } from "./evaluation-suite-artifacts";

export interface UseEvaluationCalibrationOptions {
  threadId: string;
  evaluations: RunEvaluationRecord[];
  adjudications: EvaluationAdjudication[];
  reviewerBallots: EvaluationReviewerBallot[];
  consensusResolutions: EvaluationConsensusResolution[];
  onRefresh(): Promise<void>;
}

export function useEvaluationCalibration(
  options: UseEvaluationCalibrationOptions,
) {
  const { threadId, evaluations, adjudications, onRefresh } = options;
  const [report, setReport] = useState<EvaluationCalibrationReport>();
  const [reviewingEvaluationId, setReviewingEvaluationId] = useState<string>();
  const [panelEvaluationId, setPanelEvaluationId] = useState<string>();
  const [expectedVerdict, setExpectedVerdict] =
    useState<RunEvaluationVerdict>("tie");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [registerOpen, setRegisterOpen] = useState(
    adjudications.length === 0 && evaluations.length > 0,
  );
  const adjudicationKey = adjudications
    .map((item) => `${item.id}:${item.currentRevision}`)
    .join("|");
  const adjudicationByEvaluation = useMemo(
    () =>
      new Map(
        adjudications.map((adjudication) => [
          adjudication.evaluationId,
          adjudication,
        ]),
      ),
    [adjudications],
  );
  const reviewRegister = useMemo(
    () =>
      evaluations
        .slice()
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [evaluations],
  );

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    void getEvaluationCalibration(threadId)
      .then((value) => {
        if (!cancelled) setReport(value);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(toErrorMessage(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [adjudicationKey, threadId]);

  function beginReview(evaluation: RunEvaluationRecord): void {
    const current = adjudicationByEvaluation
      .get(evaluation.id)
      ?.revisions.at(-1);
    setReviewingEvaluationId(evaluation.id);
    setPanelEvaluationId(undefined);
    setExpectedVerdict(current?.expectedVerdict ?? evaluation.verdict);
    setNote(current?.note ?? "");
    setError(undefined);
  }

  function beginPanelReview(evaluationId: string): void {
    setPanelEvaluationId(evaluationId);
    setReviewingEvaluationId(undefined);
    setNote("");
    setError(undefined);
  }

  function cancelReview(): void {
    setReviewingEvaluationId(undefined);
    setNote("");
    setError(undefined);
  }

  async function submitReview(): Promise<void> {
    if (!reviewingEvaluationId || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await reviewRunEvaluation(threadId, reviewingEvaluationId, {
        expectedVerdict,
        note,
      });
      await onRefresh();
      setReport(await getEvaluationCalibration(threadId));
      setReviewingEvaluationId(undefined);
      setNote("");
    } catch (reviewError) {
      setError(toErrorMessage(reviewError));
    } finally {
      setBusy(false);
    }
  }

  return {
    ...options,
    report,
    reviewingEvaluationId,
    panelEvaluationId,
    expectedVerdict,
    setExpectedVerdict,
    note,
    setNote,
    busy,
    error,
    registerOpen,
    setRegisterOpen,
    adjudicationByEvaluation,
    reviewRegister,
    reviewedCount: report?.sampleCount ?? adjudications.length,
    agreementRate: report?.sampleCount
      ? Math.round(report.agreementRate * 100)
      : undefined,
    beginReview,
    beginPanelReview,
    closePanelReview: () => setPanelEvaluationId(undefined),
    cancelReview,
    submitReview,
  };
}
