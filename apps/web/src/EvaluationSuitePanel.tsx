import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardCheck, Download, KeyRound, Pencil, Play, Save, ShieldCheck, Users, X } from "lucide-react";

import type {
  EvaluationAdjudication,
  EvaluationCalibrationReport,
  EvaluationConsensusReport,
  EvaluationConsensusResolution,
  EvaluationReviewerBallot,
  EvaluationSuite,
  EvaluationSuiteExecution,
  EvaluationSuiteGateReceipt,
  ModelSummary,
  ReceiptTrustAnchor,
  RunEvaluationRecord,
  RunEvaluationVerdict,
  RunRecord,
  TrustedReceiptEnvelope,
} from "@napier/contracts";

import {
  createEvaluationSuite,
  executeEvaluationSuite,
  getEvaluationCalibration,
  getEvaluationSuiteGateReceipt,
  previewEvaluationConsensus,
  resolveEvaluationConsensus,
  reviewRunEvaluation,
  submitEvaluationReviewerBallot,
  updateEvaluationSuite,
} from "./api";
import { copy } from "./copy";
import EvaluationCasebookPanel from "./EvaluationCasebookPanel";
import { evaluationSuiteGateReceiptFilename } from "./evaluation-artifact-view-model";
import ReceiptTrustPanel from "./ReceiptTrustPanel";
import { getSignedEvaluationSuiteReceipt, listReceiptTrustAnchors } from "./receipt-trust-api";
import { formatApiErrorMessage } from "./api-error";
import { modelProviderGroups, selectedModelAvailability } from "./model-selection-view-model";

export default function EvaluationSuitePanel({
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
}: {
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
  onRefresh: () => Promise<void>;
  onUseTaskPrompt(prompt: string): void;
}) {
  const [editingSuiteId, setEditingSuiteId] = useState<string>();
  const [name, setName] = useState("");
  const [baselineRunId, setBaselineRunId] = useState(runs[0]?.id ?? "");
  const [candidateRunIds, setCandidateRunIds] = useState<string[]>(runs[1] ? [runs[1].id] : []);
  const [minimumPassRate, setMinimumPassRate] = useState(100);
  const [minimumCandidateScore, setMinimumCandidateScore] = useState(3);
  const [allowInconclusive, setAllowInconclusive] = useState(false);
  const [evaluatorModelKey, setEvaluatorModelKey] = useState(selectedModelKey);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const [trustAnchors, setTrustAnchors] = useState<ReceiptTrustAnchor[]>([]);
  const [selectedTrustAnchorId, setSelectedTrustAnchorId] = useState("");

  const evaluatorModelGroups = useMemo(() => modelProviderGroups(models), [models]);
  const evaluatorModel = useMemo(() => selectedModelAvailability(models, evaluatorModelKey), [evaluatorModelKey, models]);
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
          anchors.some((anchor) => anchor.id === current && anchor.status === "trusted" && Boolean(anchor.signingSource))
            ? current
            : (anchors.find((anchor) => anchor.status === "trusted" && Boolean(anchor.signingSource))?.id ?? ""),
        );
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(toErrorMessage(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const sortedSuites = useMemo(() => suites.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), [suites]);
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
    setEvaluatorModelKey(`${suite.evaluatorModel.provider}/${suite.evaluatorModel.id}`);
    setError(undefined);
  }

  function toggleCandidate(runId: string): void {
    if (candidateRunIds.includes(runId)) {
      setCandidateRunIds((current) => current.filter((candidate) => candidate !== runId));
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
    const suiteEvaluator = suite ? selectedModelAvailability(models, `${suite.evaluatorModel.provider}/${suite.evaluatorModel.id}`) : undefined;
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
      const envelope = await getSignedEvaluationSuiteReceipt(threadId, suite.id, selectedTrustAnchorId);
      downloadTrustedReceipt(envelope, `napier-signed-gate-${suite.id}-r${suite.revision}-${envelope.contentSha256.slice(0, 12)}.json`);
    } catch (receiptError) {
      setError(toErrorMessage(receiptError));
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <section className="evaluation-suite-panel" aria-labelledby="evaluation-suite-title">
      <header>
        <div>
          <span>{copy.lab.suite.eyebrow}</span>
          <h3 id="evaluation-suite-title">{copy.lab.suite.title}</h3>
        </div>
        <ClipboardCheck size={16} aria-hidden="true" />
      </header>
      <p>{copy.lab.suite.body}</p>

      <ReceiptTrustPanel threadId={threadId} anchors={trustAnchors} selectedAnchorId={selectedTrustAnchorId} onSelect={setSelectedTrustAnchorId} onAnchors={setTrustAnchors} />

      <EvaluationCalibrationLedger
        threadId={threadId}
        evaluations={evaluations}
        adjudications={adjudications}
        reviewerBallots={reviewerBallots}
        consensusResolutions={consensusResolutions}
        onRefresh={onRefresh}
      />

      <EvaluationCasebookPanel
        threadId={threadId}
        runs={runs}
        evaluations={evaluations}
        adjudications={adjudications}
        models={models}
        selectedModelKey={selectedModelKey}
        trustAnchors={trustAnchors}
        selectedTrustAnchorId={selectedTrustAnchorId}
        onRefresh={onRefresh}
        onUseTaskPrompt={onUseTaskPrompt}
      />

      <div className="suite-compose">
        <div className="suite-compose-heading">
          <strong>{editingSuiteId ? copy.lab.suite.update : copy.lab.suite.create}</strong>
          <code>{evaluatorModelKey}</code>
        </div>
        <label>
          <span>{copy.lab.suite.name}</span>
          <input type="text" maxLength={100} value={name} placeholder={copy.lab.suite.namePlaceholder} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <span>{copy.lab.suite.evaluator}</span>
          <select value={evaluatorModelKey} disabled={Boolean(busyId)} onChange={(event) => setEvaluatorModelKey(event.target.value)}>
            {evaluatorModelGroups.map((group) => (
              <optgroup key={group.provider} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.key} value={option.key} disabled={!option.configured}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {!evaluatorModel.configured ? (
          <p className="suite-error" role="status">
            {copy.modelUnavailableHint}
          </p>
        ) : null}
        <label>
          <span>{copy.lab.suite.baseline}</span>
          <select
            value={baselineRunId}
            onChange={(event) => {
              const runId = event.target.value;
              setBaselineRunId(runId);
              setCandidateRunIds((current) => current.filter((candidate) => candidate !== runId));
            }}
          >
            <option value="">{copy.lab.selectRun}</option>
            {runs.map((run, index) => (
              <option key={run.id} value={run.id}>
                {runLabel(run, index)}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="suite-candidate-register">
          <legend>{copy.lab.suite.candidates}</legend>
          <small>{copy.lab.suite.candidatesHint}</small>
          <div>
            {runs.map((run, index) => (
              <label key={run.id}>
                <input type="checkbox" checked={candidateRunIds.includes(run.id)} disabled={run.id === baselineRunId} onChange={() => toggleCandidate(run.id)} />
                <span>{runLabel(run, index)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="suite-gate-grid">
          <label>
            <span>{copy.lab.suite.passRate}</span>
            <output>{minimumPassRate}%</output>
            <input type="range" min={0} max={100} step={5} value={minimumPassRate} onChange={(event) => setMinimumPassRate(event.currentTarget.valueAsNumber)} />
          </label>
          <label>
            <span>{copy.lab.suite.candidateScore}</span>
            <output>{minimumCandidateScore.toFixed(1)}</output>
            <input type="range" min={1} max={5} step={0.25} value={minimumCandidateScore} onChange={(event) => setMinimumCandidateScore(event.currentTarget.valueAsNumber)} />
          </label>
        </div>
        <label className="suite-inconclusive-toggle">
          <input type="checkbox" checked={allowInconclusive} onChange={(event) => setAllowInconclusive(event.target.checked)} />
          <span>{copy.lab.suite.allowInconclusive}</span>
        </label>
        {error ? <p className="suite-error">{error}</p> : null}
        <div className="suite-compose-actions">
          {editingSuiteId ? (
            <button type="button" disabled={Boolean(busyId)} onClick={resetForm}>
              <X size={11} aria-hidden="true" />
              {copy.lab.suite.cancel}
            </button>
          ) : null}
          <button className="suite-primary-action" type="button" disabled={!canSubmit} onClick={() => void submit()}>
            {editingSuiteId ? <Save size={11} aria-hidden="true" /> : <Check size={11} aria-hidden="true" />}
            {editingSuiteId ? copy.lab.suite.update : copy.lab.suite.create}
          </button>
        </div>
      </div>

      <div className="suite-register">
        {sortedSuites.length === 0 ? <p className="empty-panel">{copy.lab.suite.empty}</p> : null}
        {sortedSuites.map((suite) => {
          const executionHistory = executions.filter((execution) => execution.suiteId === suite.id).sort((left, right) => right.finishedAt.localeCompare(left.finishedAt));
          const latestExecution = executionHistory.find((execution) => execution.suiteRevision === suite.revision);
          const suiteEvaluator = selectedModelAvailability(models, `${suite.evaluatorModel.provider}/${suite.evaluatorModel.id}`);
          return (
            <article key={suite.id} className="suite-docket">
              <header>
                <div>
                  <span>
                    {copy.lab.suite.revision} {suite.revision}
                  </span>
                  <h4>{suite.name}</h4>
                </div>
                <strong className={`suite-status suite-status-${latestExecution?.status ?? "idle"}`}>
                  {latestExecution ? copy.lab.suite.statuses[latestExecution.status] : copy.lab.suite.neverRun}
                </strong>
              </header>
              <dl>
                <div>
                  <dt>{copy.lab.suite.cases}</dt>
                  <dd>{suite.candidateRunIds.length}</dd>
                </div>
                <div>
                  <dt>{copy.lab.suite.passRate}</dt>
                  <dd>{Math.round(suite.gate.minimumPassRate * 100)}%</dd>
                </div>
                <div>
                  <dt>{copy.lab.suite.candidateScore}</dt>
                  <dd>{suite.gate.minimumCandidateScore.toFixed(1)}</dd>
                </div>
                <div>
                  <dt>{copy.lab.suite.evaluator}</dt>
                  <dd>
                    {suite.evaluatorModel.provider}/{suite.evaluatorModel.id}
                  </dd>
                </div>
              </dl>
              {!suiteEvaluator.configured ? (
                <p className="suite-error" role="status">
                  {copy.modelUnavailableHint}
                </p>
              ) : null}
              {latestExecution ? (
                <div className="suite-result">
                  <div>
                    <span>{copy.lab.suite.latest}</span>
                    <strong>{Math.round(latestExecution.passRate * 100)}%</strong>
                    <small>
                      {latestExecution.passedCount}/{latestExecution.results.length}
                    </small>
                  </div>
                  <div>
                    <span>{copy.lab.suite.average}</span>
                    <strong>{latestExecution.averageCandidateScore?.toFixed(2) ?? "–"}</strong>
                    <small>/ 5</small>
                  </div>
                  <code title={latestExecution.contentSha256}>{latestExecution.contentSha256.slice(0, 12)}</code>
                </div>
              ) : null}
              {latestExecution ? (
                <section className="suite-case-evidence" aria-label={copy.lab.suite.caseEvidence}>
                  <header>
                    <span>{copy.lab.suite.caseEvidence}</span>
                    <code>{latestExecution.results.length}</code>
                  </header>
                  <ol>
                    {latestExecution.results.map((result) => {
                      const candidateIndex = runs.findIndex((run) => run.id === result.candidateRunId);
                      const candidate = runs[candidateIndex];
                      const adjudication = adjudications.find((item) => item.evaluationId === result.evaluationId);
                      const truth = adjudication?.revisions.at(-1);
                      return (
                        <li key={result.evaluationId}>
                          <header>
                            <span>{candidate ? runLabel(candidate, candidateIndex) : shortId(result.candidateRunId)}</span>
                            <strong className={`suite-status suite-status-${result.status}`}>{copy.lab.suite.statuses[result.status]}</strong>
                          </header>
                          <div className="suite-case-scores">
                            <span>
                              {copy.lab.suite.baselineScore}
                              <strong>{formatScore(result.baselineAverageScore)}</strong>
                            </span>
                            <span>
                              {copy.lab.suite.candidateScoreShort}
                              <strong>{formatScore(result.candidateAverageScore)}</strong>
                            </span>
                            <span>
                              {copy.lab.verdicts[result.verdict]}
                              <code title={result.evaluationSha256}>{result.evaluationSha256.slice(0, 12)}</code>
                            </span>
                          </div>
                          <div className={`suite-case-truth ${truth?.expectedVerdict === result.verdict ? "is-agreed" : truth ? "is-diverged" : ""}`}>
                            <span>{copy.lab.calibration.expectedVerdict}</span>
                            <strong>{truth ? copy.lab.verdicts[truth.expectedVerdict] : copy.lab.calibration.unreviewed}</strong>
                            {truth ? (
                              <code>
                                {copy.lab.calibration.revision} {truth.revision}
                              </code>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ) : null}
              {executionHistory.length > 0 ? (
                <details className="suite-history">
                  <summary>
                    <span>{copy.lab.suite.history}</span>
                    <code>{executionHistory.length}</code>
                  </summary>
                  <ol>
                    {executionHistory.slice(0, 5).map((execution) => (
                      <li key={execution.id}>
                        <span>
                          {copy.lab.suite.revision} {execution.suiteRevision}
                        </span>
                        <strong className={`suite-status suite-status-${execution.status}`}>{copy.lab.suite.statuses[execution.status]}</strong>
                        <code title={execution.contentSha256}>{execution.contentSha256.slice(0, 12)}</code>
                        <time dateTime={execution.finishedAt}>{formatDateTime(execution.finishedAt)}</time>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
              <footer>
                <button type="button" disabled={Boolean(busyId)} onClick={() => editSuite(suite)}>
                  <Pencil size={11} aria-hidden="true" />
                  {copy.lab.suite.edit}
                </button>
                <button type="button" disabled={Boolean(busyId)} onClick={() => void exportReceipt(suite)}>
                  <Download size={11} aria-hidden="true" />
                  {busyId === `receipt:${suite.id}` ? copy.lab.suite.exportingReceipt : copy.lab.suite.receipt}
                </button>
                <button
                  type="button"
                  title={selectedTrustAnchorId ? copy.lab.suite.signedReceipt : copy.lab.casebook.qualification.noSigner}
                  disabled={Boolean(busyId) || !selectedTrustAnchorId}
                  onClick={() => void exportSignedReceipt(suite)}
                >
                  <KeyRound size={11} aria-hidden="true" />
                  {busyId === `signed-receipt:${suite.id}` ? copy.lab.suite.exportingSignedReceipt : copy.lab.suite.signedReceipt}
                </button>
                <button className="suite-run-button" type="button" disabled={Boolean(busyId) || !suiteEvaluator.configured} onClick={() => void execute(suite.id)}>
                  <Play size={11} aria-hidden="true" />
                  {busyId === suite.id ? copy.lab.suite.running : copy.lab.suite.run}
                </button>
              </footer>
            </article>
          );
        })}
      </div>
      <p className="suite-safety">
        <ShieldCheck size={11} aria-hidden="true" />
        {copy.lab.suite.safety}
      </p>
    </section>
  );
}

const CALIBRATION_VERDICTS: readonly RunEvaluationVerdict[] = ["left_better", "right_better", "tie", "inconclusive"];

function EvaluationCalibrationLedger({
  threadId,
  evaluations,
  adjudications,
  reviewerBallots,
  consensusResolutions,
  onRefresh,
}: {
  threadId: string;
  evaluations: RunEvaluationRecord[];
  adjudications: EvaluationAdjudication[];
  reviewerBallots: EvaluationReviewerBallot[];
  consensusResolutions: EvaluationConsensusResolution[];
  onRefresh: () => Promise<void>;
}) {
  const [report, setReport] = useState<EvaluationCalibrationReport>();
  const [reviewingEvaluationId, setReviewingEvaluationId] = useState<string>();
  const [panelEvaluationId, setPanelEvaluationId] = useState<string>();
  const [expectedVerdict, setExpectedVerdict] = useState<RunEvaluationVerdict>("tie");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [registerOpen, setRegisterOpen] = useState(adjudications.length === 0 && evaluations.length > 0);
  const adjudicationKey = adjudications.map((item) => `${item.id}:${item.currentRevision}`).join("|");
  const adjudicationByEvaluation = useMemo(() => new Map(adjudications.map((adjudication) => [adjudication.evaluationId, adjudication])), [adjudications]);
  const reviewRegister = useMemo(() => evaluations.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [evaluations]);

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
    const current = adjudicationByEvaluation.get(evaluation.id)?.revisions.at(-1);
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

  const reviewedCount = report?.sampleCount ?? adjudications.length;
  const agreementRate = report?.sampleCount ? Math.round(report.agreementRate * 100) : undefined;

  return (
    <section className="calibration-ledger" aria-labelledby="calibration-ledger-title">
      <header>
        <div>
          <span>{copy.lab.calibration.eyebrow}</span>
          <h4 id="calibration-ledger-title">{copy.lab.calibration.title}</h4>
        </div>
        <ShieldCheck size={15} aria-hidden="true" />
      </header>
      <p>{copy.lab.calibration.body}</p>

      <div className="calibration-metrics" aria-live="polite">
        <div>
          <span>{copy.lab.calibration.reviewed}</span>
          <strong>
            {reviewedCount}/{evaluations.length}
          </strong>
          <progress value={reviewedCount} max={Math.max(evaluations.length, 1)} aria-label={copy.lab.calibration.reviewed} />
        </div>
        <div>
          <span>{copy.lab.calibration.agreement}</span>
          <strong>{agreementRate === undefined ? "–" : `${agreementRate}%`}</strong>
          <small>
            {report?.agreementCount ?? 0}/{report?.sampleCount ?? 0}
          </small>
        </div>
        <div>
          <span>{copy.lab.calibration.groups}</span>
          <strong>{report?.groups.length ?? 0}</strong>
          <small>{copy.lab.calibration.samples}</small>
        </div>
      </div>

      {report?.sampleCount ? (
        <div className="calibration-cohorts">
          {report.groups.map((group) => (
            <details key={`${group.evaluatorModel.provider}/${group.evaluatorModel.id}/${group.rubricSha256}`}>
              <summary>
                <span>
                  <strong>
                    {group.evaluatorModel.provider}/{group.evaluatorModel.id}
                  </strong>
                  <small>{group.rubricName}</small>
                </span>
                <span>
                  <strong>{Math.round(group.agreementRate * 100)}%</strong>
                  <small>
                    {group.sampleCount} {copy.lab.calibration.samples}
                  </small>
                </span>
              </summary>
              <table>
                <caption>{copy.lab.calibration.matrix}</caption>
                <thead>
                  <tr>
                    <th scope="col">{copy.lab.calibration.modelAxis}</th>
                    {CALIBRATION_VERDICTS.map((verdict) => (
                      <th key={verdict} scope="col" title={`${copy.lab.calibration.truthAxis}: ${copy.lab.verdicts[verdict]}`}>
                        {copy.lab.calibration.verdictMarks[verdict]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CALIBRATION_VERDICTS.map((modelVerdict) => (
                    <tr key={modelVerdict}>
                      <th scope="row" title={copy.lab.verdicts[modelVerdict]}>
                        {copy.lab.calibration.verdictMarks[modelVerdict]}
                      </th>
                      {CALIBRATION_VERDICTS.map((truthVerdict) => (
                        <td key={truthVerdict}>{group.confusionMatrix[modelVerdict][truthVerdict]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
        </div>
      ) : (
        <p className="calibration-empty">{copy.lab.calibration.noSamples}</p>
      )}

      <details className="calibration-register" open={registerOpen} onToggle={(event) => setRegisterOpen(event.currentTarget.open)}>
        <summary>
          <span>
            <strong>{copy.lab.calibration.register}</strong>
            <small>{copy.lab.calibration.registerHint}</small>
          </span>
          <code>
            {reviewedCount}/{evaluations.length}
          </code>
        </summary>
        {reviewRegister.length === 0 ? (
          <p className="calibration-empty">{copy.lab.calibration.empty}</p>
        ) : (
          <ol>
            {reviewRegister.map((evaluation) => {
              const adjudication = adjudicationByEvaluation.get(evaluation.id);
              const truth = adjudication?.revisions.at(-1);
              const agreed = truth?.expectedVerdict === evaluation.verdict;
              const reviewing = reviewingEvaluationId === evaluation.id;
              const panelReviewing = panelEvaluationId === evaluation.id;
              const evaluationBallots = reviewerBallots.filter((ballot) => ballot.evaluationId === evaluation.id);
              const evaluationResolutions = consensusResolutions.filter((resolution) => resolution.evaluationId === evaluation.id);
              return (
                <li key={evaluation.id}>
                  <header>
                    <span>
                      <strong>
                        {shortId(evaluation.leftRunId)} → {shortId(evaluation.rightRunId)}
                      </strong>
                      <small>
                        {evaluation.evaluatorModel.provider}/{evaluation.evaluatorModel.id}
                      </small>
                    </span>
                    <span className={`calibration-state ${truth ? (agreed ? "is-agreed" : "is-diverged") : ""}`}>
                      {truth ? (agreed ? copy.lab.calibration.agreed : copy.lab.calibration.disagreed) : copy.lab.calibration.unreviewed}
                    </span>
                  </header>
                  <div className="calibration-verdict-pair">
                    <span>
                      {copy.lab.calibration.modelVerdict}
                      <strong>{copy.lab.verdicts[evaluation.verdict]}</strong>
                    </span>
                    <span>
                      {copy.lab.calibration.expectedVerdict}
                      <strong>{truth ? copy.lab.verdicts[truth.expectedVerdict] : "–"}</strong>
                    </span>
                    <code title={truth?.contentSha256}>
                      {truth
                        ? `${copy.lab.calibration.revision} ${truth.revision} · ${truth.contentSha256.slice(0, 10)}${
                            truth.source === "reviewer_consensus" ? ` · ${copy.lab.calibration.consensus.provenance}` : ""
                          }`
                        : evaluation.id}
                    </code>
                  </div>
                  {reviewing ? (
                    <div className="calibration-review-form">
                      <label>
                        <span>{copy.lab.calibration.expectedVerdict}</span>
                        <select value={expectedVerdict} onChange={(event) => setExpectedVerdict(event.target.value as RunEvaluationVerdict)}>
                          {CALIBRATION_VERDICTS.map((verdict) => (
                            <option key={verdict} value={verdict}>
                              {copy.lab.verdicts[verdict]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>{copy.lab.calibration.note}</span>
                        <textarea rows={3} maxLength={1_000} value={note} placeholder={copy.lab.calibration.notePlaceholder} onChange={(event) => setNote(event.target.value)} />
                      </label>
                      <footer>
                        <button type="button" disabled={busy} onClick={cancelReview}>
                          <X size={11} aria-hidden="true" />
                          {copy.lab.calibration.cancel}
                        </button>
                        <button className="calibration-save" type="button" disabled={busy} onClick={() => void submitReview()}>
                          <Save size={11} aria-hidden="true" />
                          {busy ? copy.lab.calibration.saving : copy.lab.calibration.save}
                        </button>
                      </footer>
                    </div>
                  ) : panelReviewing ? (
                    <EvaluationConsensusDesk
                      threadId={threadId}
                      evaluation={evaluation}
                      ballots={evaluationBallots}
                      resolutions={evaluationResolutions}
                      onRefresh={onRefresh}
                      onClose={() => setPanelEvaluationId(undefined)}
                    />
                  ) : (
                    <div className="calibration-review-actions">
                      <button className="calibration-review-action" type="button" disabled={busy} aria-expanded={panelReviewing} onClick={() => beginPanelReview(evaluation.id)}>
                        <Users size={11} aria-hidden="true" />
                        {copy.lab.calibration.consensus.open}
                        {evaluationBallots.length ? <code>{evaluationBallots.length}</code> : null}
                      </button>
                      <button className="calibration-review-action" type="button" disabled={busy} aria-expanded={reviewing} onClick={() => beginReview(evaluation)}>
                        <Pencil size={11} aria-hidden="true" />
                        {truth ? copy.lab.calibration.revise : copy.lab.calibration.review}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </details>

      {error ? (
        <p className="suite-error" role="alert">
          {error}
        </p>
      ) : null}
      {report ? (
        <code className="calibration-report-hash" title={report.contentSha256}>
          {copy.lab.calibration.reportHash} {report.contentSha256.slice(0, 12)}
        </code>
      ) : null}
      <p className="calibration-safety">
        <ShieldCheck size={11} aria-hidden="true" />
        {copy.lab.calibration.safety}
      </p>
    </section>
  );
}

function EvaluationConsensusDesk({
  threadId,
  evaluation,
  ballots,
  resolutions,
  onRefresh,
  onClose,
}: {
  threadId: string;
  evaluation: RunEvaluationRecord;
  ballots: EvaluationReviewerBallot[];
  resolutions: EvaluationConsensusResolution[];
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [reviewerId, setReviewerId] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [expectedVerdict, setExpectedVerdict] = useState<RunEvaluationVerdict>(evaluation.verdict);
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
  const sortedBallots = ballots.slice().sort((left, right) => left.reviewerId.localeCompare(right.reviewerId));
  const latestResolution = resolutions.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const canSubmitBallot = /^[a-z][a-z0-9_-]{1,63}$/i.test(reviewerId.trim()) && Boolean(reviewerName.trim()) && !busyAction;

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
    if (!canSubmitBallot) return;
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
      setReport(await previewEvaluationConsensus(threadId, evaluation.id, gateRequest()));
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
      setReport(await previewEvaluationConsensus(threadId, evaluation.id, gateRequest()));
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
      const result = await resolveEvaluationConsensus(threadId, evaluation.id, gateRequest());
      setReport(result.report);
      await onRefresh();
    } catch (resolutionError) {
      setError(toErrorMessage(resolutionError));
    } finally {
      setBusyAction(undefined);
    }
  }

  return (
    <section className="consensus-desk" aria-labelledby={`consensus-desk-${evaluation.id}`}>
      <header>
        <div>
          <span>{copy.lab.calibration.consensus.eyebrow}</span>
          <h5 id={`consensus-desk-${evaluation.id}`}>{copy.lab.calibration.consensus.title}</h5>
        </div>
        <button type="button" disabled={Boolean(busyAction)} onClick={onClose}>
          <X size={10} aria-hidden="true" />
          {copy.lab.calibration.consensus.close}
        </button>
      </header>
      <p>{copy.lab.calibration.consensus.body}</p>

      <div className="consensus-roster">
        <header>
          <span>{copy.lab.calibration.consensus.roster}</span>
          <code>{sortedBallots.length}/9</code>
        </header>
        {sortedBallots.length ? (
          <ol>
            {sortedBallots.map((ballot) => {
              const revision = ballot.revisions.at(-1)!;
              return (
                <li key={ballot.id}>
                  <button type="button" disabled={Boolean(busyAction)} onClick={() => editBallot(ballot)}>
                    <span>
                      <strong>{revision.reviewerName}</strong>
                      <small>{ballot.reviewerId}</small>
                    </span>
                    <span>
                      <strong>{copy.lab.verdicts[revision.expectedVerdict]}</strong>
                      <code title={revision.contentSha256}>
                        r{revision.revision} · {revision.contentSha256.slice(0, 8)}
                      </code>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p>{copy.lab.calibration.consensus.emptyRoster}</p>
        )}
      </div>

      <div className="consensus-ballot-form">
        <div>
          <label>
            <span>{copy.lab.calibration.consensus.reviewerId}</span>
            <input
              type="text"
              maxLength={64}
              value={reviewerId}
              placeholder={copy.lab.calibration.consensus.reviewerIdPlaceholder}
              onChange={(event) => setReviewerId(event.target.value)}
            />
          </label>
          <label>
            <span>{copy.lab.calibration.consensus.reviewerName}</span>
            <input
              type="text"
              maxLength={80}
              value={reviewerName}
              placeholder={copy.lab.calibration.consensus.reviewerNamePlaceholder}
              onChange={(event) => setReviewerName(event.target.value)}
            />
          </label>
        </div>
        <label>
          <span>{copy.lab.calibration.expectedVerdict}</span>
          <select value={expectedVerdict} onChange={(event) => setExpectedVerdict(event.target.value as RunEvaluationVerdict)}>
            {CALIBRATION_VERDICTS.map((verdict) => (
              <option key={verdict} value={verdict}>
                {copy.lab.verdicts[verdict]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{copy.lab.calibration.consensus.ballotNote}</span>
          <textarea rows={2} maxLength={1_000} value={note} placeholder={copy.lab.calibration.consensus.ballotNotePlaceholder} onChange={(event) => setNote(event.target.value)} />
        </label>
        <footer>
          {reviewerId ? (
            <button type="button" disabled={Boolean(busyAction)} onClick={resetBallot}>
              <X size={10} aria-hidden="true" />
              {copy.lab.calibration.consensus.clear}
            </button>
          ) : null}
          <button className="consensus-record" type="button" disabled={!canSubmitBallot} onClick={() => void submitBallot()}>
            <Save size={10} aria-hidden="true" />
            {busyAction === "ballot" ? copy.lab.calibration.consensus.recording : copy.lab.calibration.consensus.record}
          </button>
        </footer>
      </div>

      <fieldset className="consensus-gate">
        <legend>{copy.lab.calibration.consensus.gate}</legend>
        <label>
          <span>{copy.lab.calibration.consensus.minimumReviewers}</span>
          <select
            value={minimumReviewers}
            disabled={Boolean(busyAction)}
            onChange={(event) => {
              setMinimumReviewers(Number(event.currentTarget.value));
              invalidateReport();
            }}
          >
            {Array.from({ length: 8 }, (_, index) => index + 2).map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
        <label className="consensus-rate">
          <span>{copy.lab.calibration.consensus.minimumAgreement}</span>
          <output>{minimumAgreementRate}%</output>
          <input
            type="range"
            min={50}
            max={100}
            step={1}
            value={minimumAgreementRate}
            disabled={Boolean(busyAction)}
            onChange={(event) => {
              setMinimumAgreementRate(event.currentTarget.valueAsNumber);
              invalidateReport();
            }}
          />
        </label>
        <label className="consensus-inconclusive">
          <input
            type="checkbox"
            checked={allowInconclusive}
            disabled={Boolean(busyAction)}
            onChange={(event) => {
              setAllowInconclusive(event.target.checked);
              invalidateReport();
            }}
          />
          <span>{copy.lab.calibration.consensus.allowInconclusive}</span>
        </label>
      </fieldset>

      <div className="consensus-actions">
        <button type="button" disabled={Boolean(busyAction)} onClick={() => void previewConsensus()}>
          <Play size={10} aria-hidden="true" />
          {busyAction === "preview" ? copy.lab.calibration.consensus.previewing : copy.lab.calibration.consensus.preview}
        </button>
        <button className="consensus-resolve" type="button" disabled={report?.status !== "ready" || Boolean(busyAction)} onClick={() => void resolveConsensus()}>
          <Check size={10} aria-hidden="true" />
          {busyAction === "resolve" ? copy.lab.calibration.consensus.resolving : copy.lab.calibration.consensus.resolve}
        </button>
      </div>

      {report ? (
        <div className="consensus-report" aria-live="polite">
          <header>
            <span>{copy.lab.calibration.consensus.statuses[report.status]}</span>
            <strong>{report.consensusVerdict ? copy.lab.verdicts[report.consensusVerdict] : copy.lab.calibration.consensus.noLeader}</strong>
            <code title={report.contentSha256}>{report.contentSha256.slice(0, 10)}</code>
          </header>
          <div className="consensus-distribution">
            {CALIBRATION_VERDICTS.map((verdict) => (
              <span key={verdict}>
                {copy.lab.calibration.verdictMarks[verdict]}
                <strong>{report.verdictCounts[verdict]}</strong>
              </span>
            ))}
          </div>
          <p>
            {report.consensusCount}/{report.reviewerCount} · {Math.round(report.agreementRate * 100)}% {copy.lab.calibration.consensus.agreement}
          </p>
        </div>
      ) : (
        <p className="consensus-report-stale">{copy.lab.calibration.consensus.previewRequired}</p>
      )}

      {latestResolution ? (
        <footer className="consensus-resolution">
          <span>{copy.lab.calibration.consensus.latestResolution}</span>
          <code title={latestResolution.contentSha256}>
            r{latestResolution.adjudicationRevision.revision} · {latestResolution.contentSha256.slice(0, 10)}
          </code>
          <time dateTime={latestResolution.createdAt}>{formatDateTime(latestResolution.createdAt)}</time>
        </footer>
      ) : null}
      {error ? (
        <p className="suite-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="consensus-safety">
        <ShieldCheck size={10} aria-hidden="true" />
        {copy.lab.calibration.consensus.safety}
      </p>
    </section>
  );
}

function runLabel(run: RunRecord, index: number): string {
  return `${String(index + 1).padStart(2, "0")} · ${run.status} · ${shortId(run.id)}`;
}

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function formatScore(value: number | undefined): string {
  return value === undefined ? "–" : value.toFixed(2);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function downloadGateReceipt(receipt: EvaluationSuiteGateReceipt): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(receipt, null, 2)}\n`], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = evaluationSuiteGateReceiptFilename(receipt);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadTrustedReceipt(envelope: TrustedReceiptEnvelope, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(envelope, null, 2)}\n`], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function parseModelKey(value: string): { provider: string; id: string } {
  const separator = value.indexOf("/");
  return separator > 0 && separator < value.length - 1
    ? {
        provider: value.slice(0, separator),
        id: value.slice(separator + 1),
      }
    : { provider: "napier", id: "demo" };
}

function toErrorMessage(error: unknown): string {
  return formatApiErrorMessage(error);
}
