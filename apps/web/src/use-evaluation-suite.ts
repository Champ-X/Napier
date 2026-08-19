import { useEffect, useMemo, useState } from "react";

import type {
  EvaluationAdjudication,
  EvaluationConsensusResolution,
  EvaluationReviewerBallot,
  EvaluationSuite,
  EvaluationSuiteExecution,
  ModelSummary,
  ReceiptTrustAnchor,
  RunEvaluationRecord,
  RunRecord,
} from "@napier/contracts";

import {
  createEvaluationSuite,
  executeEvaluationSuite,
  getEvaluationSuiteGateReceipt,
  updateEvaluationSuite,
} from "./api";
import { copy } from "./copy";
import {
  downloadGateReceipt,
  downloadTrustedReceipt,
  parseModelKey,
  toErrorMessage,
} from "./evaluation-suite-artifacts";
import {
  modelProviderGroups,
  selectedModelAvailability,
} from "./model-selection-view-model";
import {
  getSignedEvaluationSuiteReceipt,
  listReceiptTrustAnchors,
} from "./receipt-trust-api";

export interface UseEvaluationSuiteOptions {
  threadId: string;
  runs: RunRecord[];
  evaluations: RunEvaluationRecord[];
  adjudications: EvaluationAdjudication[];
  reviewerBallots: EvaluationReviewerBallot[];
  consensusResolutions: EvaluationConsensusResolution[];
  suites: EvaluationSuite[];
  executions: EvaluationSuiteExecution[];
  selectedModelKey: string;
  models: ModelSummary[];
  onRefresh(): Promise<void>;
  onUseTaskPrompt(prompt: string): void;
}

export function useEvaluationSuite({
  threadId,
  runs,
  evaluations,
  adjudications,
  reviewerBallots,
  consensusResolutions,
  suites,
  executions,
  selectedModelKey,
  models,
  onRefresh,
  onUseTaskPrompt,
}: UseEvaluationSuiteOptions) {
  const [editingSuiteId, setEditingSuiteId] = useState<string>();
  const [name, setName] = useState("");
  const [baselineRunId, setBaselineRunId] = useState(runs[0]?.id ?? "");
  const [candidateRunIds, setCandidateRunIds] = useState<string[]>(
    runs[1] ? [runs[1].id] : [],
  );
  const [minimumPassRate, setMinimumPassRate] = useState(100);
  const [minimumCandidateScore, setMinimumCandidateScore] = useState(3);
  const [allowInconclusive, setAllowInconclusive] = useState(false);
  const [evaluatorModelKey, setEvaluatorModelKey] = useState(selectedModelKey);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const [trustAnchors, setTrustAnchors] = useState<ReceiptTrustAnchor[]>([]);
  const [selectedTrustAnchorId, setSelectedTrustAnchorId] = useState("");

  const evaluatorModelGroups = useMemo(
    () => modelProviderGroups(models),
    [models],
  );
  const evaluatorModel = useMemo(
    () => selectedModelAvailability(models, evaluatorModelKey),
    [evaluatorModelKey, models],
  );
  useEffect(() => {
    if (runs.some((run) => run.id === baselineRunId)) return;
    const baseline = runs[0]?.id ?? "";
    setBaselineRunId(baseline);
    setCandidateRunIds(runs[1] ? [runs[1].id] : []);
  }, [baselineRunId, runs]);

  useEffect(() => {
    if (!editingSuiteId) setEvaluatorModelKey(selectedModelKey);
  }, [editingSuiteId, selectedModelKey]);

  useEffect(() => {
    let cancelled = false;
    void listReceiptTrustAnchors()
      .then((anchors) => {
        if (cancelled) return;
        setTrustAnchors(anchors);
        setSelectedTrustAnchorId((current) =>
          anchors.some(
            (anchor) =>
              anchor.id === current &&
              anchor.status === "trusted" &&
              Boolean(anchor.signingSource),
          )
            ? current
            : (anchors.find(
                (anchor) =>
                  anchor.status === "trusted" && Boolean(anchor.signingSource),
              )?.id ?? ""),
        );
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(toErrorMessage(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const sortedSuites = useMemo(
    () =>
      suites
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [suites],
  );
  const canSubmit =
    Boolean(name.trim()) &&
    Boolean(baselineRunId) &&
    candidateRunIds.length > 0 &&
    candidateRunIds.length <= 8 &&
    !candidateRunIds.includes(baselineRunId) &&
    evaluatorModel.configured &&
    !busyId;

  function resetForm(): void {
    setEditingSuiteId(undefined);
    setName("");
    setBaselineRunId(runs[0]?.id ?? "");
    setCandidateRunIds(runs[1] ? [runs[1].id] : []);
    setMinimumPassRate(100);
    setMinimumCandidateScore(3);
    setAllowInconclusive(false);
    setEvaluatorModelKey(selectedModelKey);
    setError(undefined);
  }

  function editSuite(suite: EvaluationSuite): void {
    setEditingSuiteId(suite.id);
    setName(suite.name);
    setBaselineRunId(suite.baselineRunId);
    setCandidateRunIds(suite.candidateRunIds);
    setMinimumPassRate(Math.round(suite.gate.minimumPassRate * 100));
    setMinimumCandidateScore(suite.gate.minimumCandidateScore);
    setAllowInconclusive(suite.gate.allowInconclusive);
    setEvaluatorModelKey(
      `${suite.evaluatorModel.provider}/${suite.evaluatorModel.id}`,
    );
    setError(undefined);
  }

  function toggleCandidate(runId: string): void {
    if (candidateRunIds.includes(runId)) {
      setCandidateRunIds((current) =>
        current.filter((candidate) => candidate !== runId),
      );
      return;
    }
    if (candidateRunIds.length >= 8) {
      setError(copy.lab.suite.errors.maximum);
      return;
    }
    setCandidateRunIds((current) => [...current, runId]);
    setError(undefined);
  }

  async function submit(): Promise<void> {
    if (!evaluatorModel.configured) {
      setError(copy.modelUnavailableHint);
      return;
    }
    if (!canSubmit) {
      setError(copy.lab.suite.errors.candidates);
      return;
    }
    setBusyId(editingSuiteId ?? "create");
    setError(undefined);
    try {
      const request = {
        name: name.trim(),
        baselineRunId,
        candidateRunIds,
        model: parseModelKey(evaluatorModelKey),
        gate: {
          minimumPassRate: minimumPassRate / 100,
          minimumCandidateScore,
          allowInconclusive,
        },
      };
      if (editingSuiteId) {
        await updateEvaluationSuite(threadId, editingSuiteId, request);
      } else {
        await createEvaluationSuite(threadId, request);
      }
      await onRefresh();
      resetForm();
    } catch (submitError) {
      setError(toErrorMessage(submitError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function execute(suiteId: string): Promise<void> {
    const suite = suites.find((candidate) => candidate.id === suiteId);
    const suiteEvaluator = suite
      ? selectedModelAvailability(
          models,
          `${suite.evaluatorModel.provider}/${suite.evaluatorModel.id}`,
        )
      : undefined;
    if (!suiteEvaluator?.configured) {
      setError(copy.modelUnavailableHint);
      return;
    }
    setBusyId(suiteId);
    setError(undefined);
    try {
      await executeEvaluationSuite(threadId, suiteId);
      await onRefresh();
    } catch (executionError) {
      setError(toErrorMessage(executionError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function exportReceipt(suite: EvaluationSuite): Promise<void> {
    const actionId = `receipt:${suite.id}`;
    setBusyId(actionId);
    setError(undefined);
    try {
      const receipt = await getEvaluationSuiteGateReceipt(threadId, suite.id);
      downloadGateReceipt(receipt);
    } catch (receiptError) {
      setError(toErrorMessage(receiptError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function exportSignedReceipt(suite: EvaluationSuite): Promise<void> {
    if (!selectedTrustAnchorId) {
      setError(copy.lab.casebook.qualification.noSigner);
      return;
    }
    const actionId = `signed-receipt:${suite.id}`;
    setBusyId(actionId);
    setError(undefined);
    try {
      const envelope = await getSignedEvaluationSuiteReceipt(
        threadId,
        suite.id,
        selectedTrustAnchorId,
      );
      downloadTrustedReceipt(
        envelope,
        `napier-signed-gate-${suite.id}-r${suite.revision}-${envelope.contentSha256.slice(0, 12)}.json`,
      );
    } catch (receiptError) {
      setError(toErrorMessage(receiptError));
    } finally {
      setBusyId(undefined);
    }
  }

  return {
    threadId,
    runs,
    evaluations,
    adjudications,
    reviewerBallots,
    consensusResolutions,
    suites,
    executions,
    selectedModelKey,
    models,
    onRefresh,
    onUseTaskPrompt,
    editingSuiteId,
    name,
    setName,
    baselineRunId,
    setBaselineRunId,
    candidateRunIds,
    setCandidateRunIds,
    minimumPassRate,
    setMinimumPassRate,
    minimumCandidateScore,
    setMinimumCandidateScore,
    allowInconclusive,
    setAllowInconclusive,
    evaluatorModelKey,
    setEvaluatorModelKey,
    busyId,
    error,
    trustAnchors,
    setTrustAnchors,
    selectedTrustAnchorId,
    setSelectedTrustAnchorId,
    evaluatorModelGroups,
    evaluatorModel,
    sortedSuites,
    canSubmit,
    resetForm,
    editSuite,
    toggleCandidate,
    submit,
    execute,
    exportReceipt,
    exportSignedReceipt,
  };
}
