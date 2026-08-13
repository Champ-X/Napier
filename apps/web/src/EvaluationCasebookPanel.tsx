import { useEffect, useMemo, useState } from "react";
import { BookOpen, Check, Download, KeyRound, Pencil, Plus, RefreshCw, Save, ShieldCheck, Trash2, X } from "lucide-react";

import type {
  EvaluationAdjudication,
  EvaluationCasebook,
  EvaluationCasebookArtifact,
  EvaluationCasebookCalibrationReport,
  EvaluationCasebookCase,
  EvaluationCasebookQualificationExecution,
  EvaluationCasebookQualificationReceipt,
  EvaluationQualificationBaseline,
  ModelSummary,
  ReceiptTrustAnchor,
  RunRecord,
  RunEvaluationRecord,
  TrustedReceiptEnvelope,
} from "@napier/contracts";

import { copy } from "./copy";
import {
  createEvaluationCasebook,
  curateEvaluationCase,
  executeEvaluationCasebookQualification,
  getEvaluationCasebookArtifact,
  getEvaluationCasebookCalibration,
  getEvaluationCasebookQualificationReceipt,
  listEvaluationCasebooks,
  listEvaluationCasebookQualifications,
  removeEvaluationCase,
  updateEvaluationCasebook,
} from "./evaluation-casebook-api";
import { getSignedCasebookQualificationReceipt, listEvaluationQualificationBaselines, promoteEvaluationQualificationBaseline } from "./receipt-trust-api";
import { evaluationCasebookArtifactFilename, evaluationCasebookQualificationReceiptFilename } from "./evaluation-artifact-view-model";
import { formatApiErrorMessage } from "./api-error";
import { configuredModelProviderGroups } from "./model-selection-view-model";
import { CasebookQualificationTrialControl } from "./CasebookQualificationTrialControl";
import { EvaluationCasebookTemplateCoverage, EvaluationCasebookTemplateCreateButton } from "./EvaluationCasebookTemplateControl";
import { useEvaluationCasebookTemplates } from "./use-evaluation-casebook-templates";
import { EvaluationReleaseGateControls } from "./EvaluationReleaseGateControls";
import {
  evaluationCasebookCurationState,
  evaluationCasebookQualificationDisabled,
  evaluationCasebookTemplateCoverageComplete,
  findEvaluationCasebookCurationCase,
} from "./evaluation-casebook-template-view-model";

export default function EvaluationCasebookPanel({
  threadId,
  runs,
  evaluations,
  adjudications,
  models,
  selectedModelKey,
  trustAnchors,
  selectedTrustAnchorId,
  onRefresh,
  onUseTaskPrompt,
}: {
  threadId: string;
  runs: RunRecord[];
  evaluations: RunEvaluationRecord[];
  adjudications: EvaluationAdjudication[];
  models: ModelSummary[];
  selectedModelKey: string;
  trustAnchors: ReceiptTrustAnchor[];
  selectedTrustAnchorId: string;
  onRefresh: () => Promise<void>;
  onUseTaskPrompt(prompt: string): void;
}) {
  const [casebooks, setCasebooks] = useState<EvaluationCasebook[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [calibration, setCalibration] = useState<EvaluationCasebookCalibrationReport>();
  const [qualifications, setQualifications] = useState<EvaluationCasebookQualificationExecution[]>([]);
  const [qualificationBaselines, setQualificationBaselines] = useState<EvaluationQualificationBaseline[]>([]);
  const [qualifierModelKey, setQualifierModelKey] = useState(selectedModelKey);
  const [minimumAgreementRate, setMinimumAgreementRate] = useState(80);
  const [allowQualificationInconclusive, setAllowQualificationInconclusive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [curationEvaluationId, setCurationEvaluationId] = useState("");
  const [templateCaseId, setTemplateCaseId] = useState("");
  const [pendingRemoveId, setPendingRemoveId] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const templates = useEvaluationCasebookTemplates(setError);

  const adjudicationByEvaluation = useMemo(() => new Map(adjudications.map((adjudication) => [adjudication.evaluationId, adjudication])), [adjudications]);
  const reviewedEvaluations = useMemo(
    () => evaluations.filter((evaluation) => adjudicationByEvaluation.has(evaluation.id)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [adjudicationByEvaluation, evaluations],
  );
  const selected = casebooks.find((casebook) => casebook.id === selectedId) ?? casebooks[0];
  const revision = selected?.revisions.at(-1);
  const currentCases =
    selected && revision
      ? revision.caseIds.flatMap((caseId) => {
          const item = selected.cases.find((candidate) => candidate.id === caseId);
          return item ? [item] : [];
        })
      : [];
  const selectedTemplate = templates.find((template) => template.id === selected?.templateId);
  const releaseTemplate = templates.find((template) => template.id === "release-product-v1");
  const templateCoverageComplete = evaluationCasebookTemplateCoverageComplete(selectedTemplate, currentCases);
  const selectedEvaluation = reviewedEvaluations.find((evaluation) => evaluation.id === curationEvaluationId);
  const selectedTruth = selectedEvaluation ? adjudicationByEvaluation.get(selectedEvaluation.id)?.revisions.at(-1) : undefined;
  const existingCase = findEvaluationCasebookCurationCase(currentCases, Boolean(selected?.templateId), templateCaseId, selectedEvaluation);
  const curationState = evaluationCasebookCurationState(existingCase, selectedEvaluation, selectedTruth?.contentSha256);
  const qualificationModelGroups = useMemo(() => configuredModelProviderGroups(models), [models]);
  const qualificationModelOptions = useMemo(() => qualificationModelGroups.flatMap((group) => group.options), [qualificationModelGroups]);
  const qualificationHistory = useMemo(() => qualifications.slice().sort((left, right) => right.finishedAt.localeCompare(left.finishedAt)), [qualifications]);
  const currentQualification = qualificationHistory.find((execution) => execution.casebookRevision === selected?.currentRevision);
  const currentBaseline = qualificationBaselines.at(-1);
  const baselineAnchor = currentBaseline ? trustAnchors.find((anchor) => anchor.keyId === currentBaseline.envelope.signature.keyId) : undefined;
  const baselineState = !currentBaseline
    ? "missing"
    : baselineAnchor?.status === "revoked"
      ? "revoked"
      : currentBaseline.casebookRevision !== selected?.currentRevision
        ? "stale"
        : "current";
  const baselineUpToDate =
    baselineState === "current" &&
    currentBaseline?.qualificationExecutionId === currentQualification?.id &&
    currentBaseline?.envelope.signature.keyId === trustAnchors.find((anchor) => anchor.id === selectedTrustAnchorId)?.keyId;

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    void listEvaluationCasebooks()
      .then((items) => {
        if (cancelled) return;
        setCasebooks(items);
        setSelectedId((current) => (items.some((item) => item.id === current) ? current : (items[0]?.id ?? "")));
        setCreating(items.length === 0);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(toErrorMessage(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    if (!selected?.id) {
      setCalibration(undefined);
      return;
    }
    let cancelled = false;
    void getEvaluationCasebookCalibration(selected.id)
      .then((report) => {
        if (!cancelled) setCalibration(report);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(toErrorMessage(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.currentRevision, selected?.id]);

  useEffect(() => {
    if (!selected?.id) {
      setQualifications([]);
      setQualificationBaselines([]);
      return;
    }
    let cancelled = false;
    setQualifications([]);
    void listEvaluationCasebookQualifications(selected.id)
      .then((items) => {
        if (!cancelled) setQualifications(items);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(toErrorMessage(loadError));
      });
    void listEvaluationQualificationBaselines(selected.id)
      .then((items) => {
        if (!cancelled) setQualificationBaselines(items);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(toErrorMessage(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id]);

  useEffect(() => {
    if (qualificationModelOptions.some((option) => option.key === selectedModelKey)) {
      setQualifierModelKey(selectedModelKey);
      return;
    }
    setQualifierModelKey(qualificationModelOptions[0]?.key ?? "");
  }, [qualificationModelOptions, selectedModelKey]);

  useEffect(() => {
    if (reviewedEvaluations.some((evaluation) => evaluation.id === curationEvaluationId)) {
      return;
    }
    setCurationEvaluationId(reviewedEvaluations[0]?.id ?? "");
  }, [curationEvaluationId, reviewedEvaluations]);

  useEffect(() => {
    if (!selectedTemplate) {
      setTemplateCaseId("");
      return;
    }
    if (selectedTemplate.cases.some((item) => item.id === templateCaseId)) {
      return;
    }
    const covered = new Set(currentCases.map((item) => item.templateCaseId));
    setTemplateCaseId(selectedTemplate.cases.find((item) => !covered.has(item.id))?.id ?? selectedTemplate.cases[0]?.id ?? "");
  }, [currentCases, selectedTemplate, templateCaseId]);

  function beginCreate(): void {
    setCreating(true);
    setEditing(false);
    setName("");
    setDescription("");
    setError(undefined);
  }

  function beginEdit(): void {
    if (!revision) return;
    setEditing(true);
    setCreating(false);
    setName(revision.name);
    setDescription(revision.description);
    setError(undefined);
  }

  function cancelForm(): void {
    setCreating(false);
    setEditing(false);
    setName("");
    setDescription("");
    setError(undefined);
  }

  async function submitMetadata(): Promise<void> {
    if (!name.trim() || busyId) return;
    const actionId = editing && selected ? `edit:${selected.id}` : "create";
    setBusyId(actionId);
    setError(undefined);
    try {
      const casebook =
        editing && selected
          ? await updateEvaluationCasebook(selected.id, {
              threadId,
              name,
              description,
            })
          : await createEvaluationCasebook({
              threadId,
              name,
              description,
            });
      commitCasebook(casebook);
      await onRefresh();
      cancelForm();
    } catch (submitError) {
      setError(toErrorMessage(submitError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function createReleaseTemplate(): Promise<void> {
    if (!releaseTemplate || busyId) return;
    setBusyId("create-template");
    setError(undefined);
    try {
      const casebook = await createEvaluationCasebook({
        threadId,
        name: releaseTemplate.name,
        description: releaseTemplate.description,
        templateId: releaseTemplate.id,
      });
      commitCasebook(casebook);
      setCreating(false);
      await onRefresh();
    } catch (createError) {
      setError(toErrorMessage(createError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function curate(): Promise<void> {
    if (!selected || !selectedEvaluation || curationState === "current") {
      return;
    }
    setBusyId(`curate:${selectedEvaluation.id}`);
    setError(undefined);
    try {
      const casebook = await curateEvaluationCase(selected.id, {
        threadId,
        evaluationId: selectedEvaluation.id,
        ...(selected.templateId ? { templateCaseId } : {}),
      });
      commitCasebook(casebook);
      setCalibration(await getEvaluationCasebookCalibration(casebook.id));
      await onRefresh();
    } catch (curateError) {
      setError(toErrorMessage(curateError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function remove(item: EvaluationCasebookCase): Promise<void> {
    if (!selected) return;
    setBusyId(`remove:${item.id}`);
    setError(undefined);
    try {
      const casebook = await removeEvaluationCase(selected.id, item.id, {
        threadId,
      });
      commitCasebook(casebook);
      setCalibration(await getEvaluationCasebookCalibration(casebook.id));
      setPendingRemoveId(undefined);
      await onRefresh();
    } catch (removeError) {
      setError(toErrorMessage(removeError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function exportArtifact(): Promise<void> {
    if (!selected) return;
    setBusyId(`export:${selected.id}`);
    setError(undefined);
    try {
      downloadArtifact(await getEvaluationCasebookArtifact(selected.id));
    } catch (exportError) {
      setError(toErrorMessage(exportError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function runQualificationTrial(): Promise<EvaluationCasebookQualificationExecution> {
    if (!selected) throw new Error("Select an Evaluation Casebook first");
    return executeEvaluationCasebookQualification(selected.id, {
      threadId,
      model: parseModelKey(qualifierModelKey),
      gate: {
        minimumAgreementRate: minimumAgreementRate / 100,
        allowInconclusive: allowQualificationInconclusive,
      },
    });
  }

  async function exportQualificationReceipt(): Promise<void> {
    if (!selected || busyId) return;
    setBusyId(`qualification-receipt:${selected.id}`);
    setError(undefined);
    try {
      downloadQualificationReceipt(await getEvaluationCasebookQualificationReceipt(selected.id));
    } catch (receiptError) {
      setError(toErrorMessage(receiptError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function exportSignedQualificationReceipt(): Promise<void> {
    if (!selected || busyId) return;
    if (!selectedTrustAnchorId) {
      setError(copy.lab.casebook.qualification.noSigner);
      return;
    }
    setBusyId(`signed-qualification-receipt:${selected.id}`);
    setError(undefined);
    try {
      const envelope = await getSignedCasebookQualificationReceipt(selected.id, threadId, selectedTrustAnchorId);
      downloadTrustedReceipt(envelope, `napier-signed-casebook-qualification-${selected.id}-r${selected.currentRevision}-${envelope.contentSha256.slice(0, 12)}.json`);
    } catch (receiptError) {
      setError(toErrorMessage(receiptError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function promoteBaseline(): Promise<void> {
    if (!selected || busyId) return;
    if (!selectedTrustAnchorId) {
      setError(copy.lab.casebook.qualification.noSigner);
      return;
    }
    setBusyId(`promote-baseline:${selected.id}`);
    setError(undefined);
    try {
      const result = await promoteEvaluationQualificationBaseline(selected.id, threadId, selectedTrustAnchorId);
      setQualificationBaselines((current) => (result.created ? [...current, result.baseline] : current));
      await onRefresh();
    } catch (baselineError) {
      setError(toErrorMessage(baselineError));
    } finally {
      setBusyId(undefined);
    }
  }

  function commitCasebook(casebook: EvaluationCasebook): void {
    setCasebooks((current) => [casebook, ...current.filter((item) => item.id !== casebook.id)].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    setSelectedId(casebook.id);
  }

  return (
    <section className="casebook-panel" aria-labelledby="casebook-panel-title">
      <header>
        <div>
          <span>{copy.lab.casebook.eyebrow}</span>
          <h4 id="casebook-panel-title">{copy.lab.casebook.title}</h4>
        </div>
        <BookOpen size={15} aria-hidden="true" />
      </header>
      <p>{copy.lab.casebook.body}</p>

      <div className="casebook-toolbar">
        <label>
          <span>{copy.lab.casebook.select}</span>
          <select
            value={selected?.id ?? ""}
            disabled={casebooks.length === 0 || Boolean(busyId)}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setPendingRemoveId(undefined);
            }}
          >
            {casebooks.length === 0 ? <option value="">{copy.lab.casebook.empty}</option> : null}
            {casebooks.map((casebook) => {
              const latest = casebook.revisions.at(-1)!;
              return (
                <option key={casebook.id} value={casebook.id}>
                  {latest.name} · r{casebook.currentRevision}
                </option>
              );
            })}
          </select>
        </label>
        <button type="button" disabled={Boolean(busyId)} onClick={beginCreate}>
          <Plus size={11} aria-hidden="true" />
          {copy.lab.casebook.create}
        </button>
        {!casebooks.some((casebook) => casebook.templateId === releaseTemplate?.id) ? (
          <EvaluationCasebookTemplateCreateButton
            template={releaseTemplate}
            disabled={Boolean(busyId)}
            creating={busyId === "create-template"}
            onCreate={() => void createReleaseTemplate()}
          />
        ) : null}
      </div>

      {creating || editing ? (
        <div className="casebook-metadata-form">
          <label>
            <span>{copy.lab.casebook.name}</span>
            <input type="text" maxLength={100} value={name} placeholder={copy.lab.casebook.namePlaceholder} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            <span>{copy.lab.casebook.description}</span>
            <textarea
              rows={3}
              maxLength={1_000}
              value={description}
              placeholder={copy.lab.casebook.descriptionPlaceholder}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <footer>
            <button type="button" disabled={Boolean(busyId)} onClick={cancelForm}>
              <X size={11} aria-hidden="true" />
              {copy.lab.casebook.cancel}
            </button>
            <button className="casebook-primary" type="button" disabled={!name.trim() || Boolean(busyId)} onClick={() => void submitMetadata()}>
              {editing ? <Save size={11} aria-hidden="true" /> : <Check size={11} aria-hidden="true" />}
              {busyId ? (editing ? copy.lab.casebook.saving : copy.lab.casebook.creating) : editing ? copy.lab.casebook.save : copy.lab.casebook.create}
            </button>
          </footer>
        </div>
      ) : null}

      {selected && revision ? (
        <article className="casebook-volume">
          <header>
            <div>
              <span>
                {copy.lab.casebook.currentRevision} {revision.revision}
              </span>
              <h5>{revision.name}</h5>
            </div>
            <button type="button" disabled={Boolean(busyId)} onClick={beginEdit}>
              <Pencil size={10} aria-hidden="true" />
              {copy.lab.casebook.edit}
            </button>
          </header>
          {revision.description ? <p>{revision.description}</p> : null}
          <dl className="casebook-metrics">
            <div>
              <dt>{copy.lab.casebook.cases}</dt>
              <dd>{currentCases.length}</dd>
            </div>
            <div>
              <dt>{copy.lab.casebook.agreement}</dt>
              <dd>{calibration?.sampleCount ? `${Math.round(calibration.agreementRate * 100)}%` : "–"}</dd>
            </div>
            <div>
              <dt>{copy.lab.casebook.cohorts}</dt>
              <dd>{calibration?.groups.length ?? 0}</dd>
            </div>
          </dl>

          <EvaluationCasebookTemplateCoverage
            casebook={selected}
            cases={currentCases}
            template={selectedTemplate}
            selectedCaseId={templateCaseId}
            disabled={Boolean(busyId)}
            onSelect={setTemplateCaseId}
            onUseTaskPrompt={onUseTaskPrompt}
          />

          <EvaluationReleaseGateControls threadId={threadId} casebook={selected} template={selectedTemplate} selectedCaseId={templateCaseId} runs={runs} />

          <section className="casebook-curation" aria-labelledby="casebook-curation-title">
            <header>
              <span id="casebook-curation-title">{copy.lab.casebook.curate}</span>
              <code>{reviewedEvaluations.length}</code>
            </header>
            {reviewedEvaluations.length === 0 ? (
              <p>{copy.lab.casebook.noReviewed}</p>
            ) : (
              <div>
                <select
                  aria-label={copy.lab.casebook.curate}
                  value={curationEvaluationId}
                  disabled={Boolean(busyId)}
                  onChange={(event) => setCurationEvaluationId(event.target.value)}
                >
                  {reviewedEvaluations.map((evaluation) => {
                    const truth = adjudicationByEvaluation.get(evaluation.id)?.revisions.at(-1);
                    return (
                      <option key={evaluation.id} value={evaluation.id}>
                        {shortId(evaluation.id)} · {copy.lab.verdicts[evaluation.verdict]} → {truth ? copy.lab.verdicts[truth.expectedVerdict] : "–"}
                      </option>
                    );
                  })}
                </select>
                <button className="casebook-primary" type="button" disabled={!selectedEvaluation || curationState === "current" || Boolean(busyId)} onClick={() => void curate()}>
                  {curationState === "refresh" ? <RefreshCw size={11} aria-hidden="true" /> : <Plus size={11} aria-hidden="true" />}
                  {busyId?.startsWith("curate:")
                    ? copy.lab.casebook.curating
                    : curationState === "current"
                      ? copy.lab.casebook.upToDate
                      : curationState === "refresh"
                        ? copy.lab.casebook.refreshAction
                        : copy.lab.casebook.curateAction}
                </button>
              </div>
            )}
          </section>

          <ol className="casebook-case-list">
            {currentCases.map((item) => (
              <li key={item.id}>
                <header>
                  <span>
                    <strong>{shortId(item.sourceEvaluationId)}</strong>
                    <small>
                      {copy.lab.casebook.source} {shortId(item.sourceThreadId)}
                    </small>
                  </span>
                  <code>
                    {copy.lab.casebook.truthRevision} {item.adjudicationRevision.revision}
                    {item.adjudicationRevision.source === "reviewer_consensus" ? ` · ${copy.lab.calibration.consensus.provenance}` : ""}
                  </code>
                </header>
                <div className="casebook-verdicts">
                  <span>
                    {copy.lab.casebook.modelVerdict}
                    <strong>{copy.lab.verdicts[item.evaluation.verdict]}</strong>
                  </span>
                  <span>
                    {copy.lab.casebook.expectedVerdict}
                    <strong>{copy.lab.verdicts[item.adjudicationRevision.expectedVerdict]}</strong>
                  </span>
                </div>
                <div className="casebook-hashes">
                  <code title={item.contentSha256}>
                    {copy.lab.casebook.caseHash} {item.contentSha256.slice(0, 12)}
                  </code>
                  <code title={item.adjudicationRevision.evaluationSha256}>
                    {copy.lab.casebook.evaluationHash} {item.adjudicationRevision.evaluationSha256.slice(0, 12)}
                  </code>
                  {item.consensusResolution ? (
                    <code title={item.consensusResolution.contentSha256}>
                      {copy.lab.casebook.consensusEvidence} {item.consensusResolution.report.reviewerCount} · {item.consensusResolution.contentSha256.slice(0, 12)}
                    </code>
                  ) : null}
                </div>
                {pendingRemoveId === item.id ? (
                  <footer className="casebook-remove-confirm">
                    <button type="button" disabled={Boolean(busyId)} onClick={() => setPendingRemoveId(undefined)}>
                      <X size={10} aria-hidden="true" />
                      {copy.lab.casebook.cancel}
                    </button>
                    <button type="button" disabled={Boolean(busyId)} onClick={() => void remove(item)}>
                      <Trash2 size={10} aria-hidden="true" />
                      {busyId === `remove:${item.id}` ? copy.lab.casebook.removing : copy.lab.casebook.confirmRemove}
                    </button>
                  </footer>
                ) : (
                  <button className="casebook-remove" type="button" disabled={Boolean(busyId)} onClick={() => setPendingRemoveId(item.id)}>
                    <Trash2 size={10} aria-hidden="true" />
                    {copy.lab.casebook.remove}
                  </button>
                )}
              </li>
            ))}
          </ol>

          <section className="casebook-qualification" aria-labelledby={`casebook-qualification-${selected.id}`}>
            <header>
              <div>
                <span>{copy.lab.casebook.qualification.eyebrow}</span>
                <h6 id={`casebook-qualification-${selected.id}`}>{copy.lab.casebook.qualification.title}</h6>
              </div>
              <strong className={`casebook-qualification-status casebook-qualification-status-${currentQualification?.status ?? "idle"}`} role="status">
                {currentQualification ? copy.lab.casebook.qualification.statuses[currentQualification.status] : copy.lab.casebook.qualification.neverRun}
              </strong>
            </header>
            <p>{copy.lab.casebook.qualification.body}</p>

            <div className="casebook-qualification-compose">
              <label>
                <span>{copy.lab.casebook.qualification.evaluator}</span>
                <select value={qualifierModelKey} disabled={Boolean(busyId)} onChange={(event) => setQualifierModelKey(event.target.value)}>
                  {qualificationModelGroups.map((group) => (
                    <optgroup key={group.provider} label={group.label}>
                      {group.options.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="casebook-qualification-rate">
                <span>{copy.lab.casebook.qualification.minimumAgreement}</span>
                <output>{minimumAgreementRate}%</output>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={minimumAgreementRate}
                  disabled={Boolean(busyId)}
                  onChange={(event) => setMinimumAgreementRate(event.currentTarget.valueAsNumber)}
                />
              </label>
              <label className="casebook-qualification-toggle">
                <input
                  type="checkbox"
                  checked={allowQualificationInconclusive}
                  disabled={Boolean(busyId)}
                  onChange={(event) => setAllowQualificationInconclusive(event.target.checked)}
                />
                <span>{copy.lab.casebook.qualification.allowInconclusive}</span>
              </label>
              <CasebookQualificationTrialControl
                key={selected.id}
                disabled={evaluationCasebookQualificationDisabled(currentCases, templateCoverageComplete, qualifierModelKey, busyId)}
                runTrial={runQualificationTrial}
                onExecution={(execution) => setQualifications((current) => [...current.filter((item) => item.id !== execution.id), execution])}
                onBusyChange={(busy) => {
                  setBusyId(busy ? `qualify:${selected.id}` : undefined);
                  if (busy) setError(undefined);
                }}
                onSettled={onRefresh}
                onError={(trialError) => setError(toErrorMessage(trialError))}
              />
            </div>

            {currentQualification ? (
              <>
                <dl className="casebook-qualification-summary">
                  <div>
                    <dt>{copy.lab.casebook.qualification.agreement}</dt>
                    <dd>{Math.round(currentQualification.agreementRate * 100)}%</dd>
                  </div>
                  <div>
                    <dt>{copy.lab.casebook.qualification.verified}</dt>
                    <dd>
                      {currentQualification.sampleCount - currentQualification.unverifiedCount}/{currentQualification.sampleCount}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.lab.casebook.qualification.inconclusive}</dt>
                    <dd>{currentQualification.inconclusiveCount}</dd>
                  </div>
                  <div>
                    <dt>{copy.lab.casebook.qualification.executionHash}</dt>
                    <dd title={currentQualification.contentSha256}>{currentQualification.contentSha256.slice(0, 10)}</dd>
                  </div>
                </dl>
                <ol className="casebook-qualification-cases">
                  {currentQualification.results.map((result) => (
                    <li key={result.caseId} className={`casebook-qualification-case-${result.status}`}>
                      <header>
                        <span>
                          <strong>{shortId(result.sourceEvaluationId)}</strong>
                          <small>{shortId(result.sourceThreadId)}</small>
                        </span>
                        <strong>{copy.lab.casebook.qualification.caseStatuses[result.status]}</strong>
                      </header>
                      <div>
                        <span>
                          {copy.lab.casebook.qualification.expected}
                          <strong>{copy.lab.verdicts[result.expectedVerdict]}</strong>
                        </span>
                        <span aria-hidden="true">→</span>
                        <span>
                          {copy.lab.casebook.qualification.actual}
                          <strong>{copy.lab.verdicts[result.actualVerdict]}</strong>
                        </span>
                      </div>
                      <details>
                        <summary>
                          <span>{copy.lab.casebook.qualification.evidenceStates[result.evidenceState]}</span>
                          <code title={result.caseSha256}>{result.caseSha256.slice(0, 10)}</code>
                        </summary>
                        <p>{result.reason}</p>
                        <code title={result.expectedLeftSnapshotSha256}>
                          {copy.lab.casebook.qualification.expectedLeft} {result.expectedLeftSnapshotSha256.slice(0, 10)}
                        </code>
                        <code title={result.observedLeftSnapshotSha256}>
                          {copy.lab.casebook.qualification.observedLeft} {result.observedLeftSnapshotSha256?.slice(0, 10) ?? copy.lab.casebook.qualification.unavailable}
                        </code>
                        <code title={result.expectedRightSnapshotSha256}>
                          {copy.lab.casebook.qualification.expectedRight} {result.expectedRightSnapshotSha256.slice(0, 10)}
                        </code>
                        <code title={result.observedRightSnapshotSha256}>
                          {copy.lab.casebook.qualification.observedRight} {result.observedRightSnapshotSha256?.slice(0, 10) ?? copy.lab.casebook.qualification.unavailable}
                        </code>
                      </details>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="casebook-qualification-empty">{currentCases.length ? copy.lab.casebook.qualification.empty : copy.lab.casebook.qualification.noCases}</p>
            )}

            {qualificationHistory.length ? (
              <details className="casebook-qualification-history">
                <summary>
                  <span>{copy.lab.casebook.qualification.history}</span>
                  <code>{qualificationHistory.length}</code>
                </summary>
                <ol>
                  {qualificationHistory.slice(0, 8).map((execution) => (
                    <li key={execution.id}>
                      <span>
                        r{execution.casebookRevision} · {execution.evaluatorModel.provider}/{execution.evaluatorModel.id}
                      </span>
                      <strong className={`casebook-qualification-status casebook-qualification-status-${execution.status}`}>
                        {copy.lab.casebook.qualification.statuses[execution.status]}
                      </strong>
                      <code title={execution.contentSha256}>{execution.contentSha256.slice(0, 10)}</code>
                      <small>{execution.casebookRevision === selected.currentRevision ? copy.lab.casebook.qualification.current : copy.lab.casebook.qualification.stale}</small>
                      <time dateTime={execution.finishedAt}>{formatDateTime(execution.finishedAt)}</time>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}

            <section className={`qualification-baseline baseline-${baselineState}`} aria-label={copy.lab.casebook.qualification.baseline}>
              <header>
                <span>{copy.lab.casebook.qualification.baseline}</span>
                <strong>
                  {baselineState === "missing"
                    ? copy.lab.casebook.qualification.noBaseline
                    : baselineState === "revoked"
                      ? copy.lab.casebook.qualification.baselineRevoked
                      : baselineState === "stale"
                        ? copy.lab.casebook.qualification.baselineStale
                        : copy.lab.casebook.qualification.baselineCurrent}
                </strong>
              </header>
              {currentBaseline ? (
                <div>
                  <span>
                    <small>{copy.lab.casebook.qualification.baselineHash}</small>
                    <code title={currentBaseline.contentSha256}>{currentBaseline.contentSha256.slice(0, 12)}</code>
                  </span>
                  <span>
                    <small>{copy.lab.casebook.qualification.signer}</small>
                    <code title={currentBaseline.envelope.signature.keyId}>{currentBaseline.envelope.signature.keyId.slice(0, 12)}</code>
                  </span>
                  <span>
                    <small>{copy.lab.casebook.currentRevision}</small>
                    <code>r{currentBaseline.casebookRevision}</code>
                  </span>
                </div>
              ) : null}
            </section>

            <footer>
              <code title={revision.contentSha256}>
                r{revision.revision} · {revision.contentSha256.slice(0, 10)}
              </code>
              <button type="button" disabled={Boolean(busyId)} onClick={() => void exportQualificationReceipt()}>
                <Download size={11} aria-hidden="true" />
                {busyId === `qualification-receipt:${selected.id}` ? copy.lab.casebook.qualification.exportingReceipt : copy.lab.casebook.qualification.receipt}
              </button>
              <button
                type="button"
                title={selectedTrustAnchorId ? copy.lab.casebook.qualification.signedReceipt : copy.lab.casebook.qualification.noSigner}
                disabled={Boolean(busyId) || !selectedTrustAnchorId}
                onClick={() => void exportSignedQualificationReceipt()}
              >
                <KeyRound size={11} aria-hidden="true" />
                {busyId === `signed-qualification-receipt:${selected.id}` ? copy.lab.casebook.qualification.exportingSignedReceipt : copy.lab.casebook.qualification.signedReceipt}
              </button>
              <button
                className="qualification-baseline-promote"
                type="button"
                title={selectedTrustAnchorId ? copy.lab.casebook.qualification.promoteBaseline : copy.lab.casebook.qualification.noSigner}
                disabled={Boolean(busyId) || !selectedTrustAnchorId || currentQualification?.status !== "passed" || baselineUpToDate}
                onClick={() => void promoteBaseline()}
              >
                <ShieldCheck size={11} aria-hidden="true" />
                {busyId === `promote-baseline:${selected.id}` ? copy.lab.casebook.qualification.promotingBaseline : copy.lab.casebook.qualification.promoteBaseline}
              </button>
            </footer>
          </section>

          {calibration?.groups.length ? (
            <div className="casebook-cohorts">
              {calibration.groups.map((group) => (
                <div key={`${group.evaluatorModel.provider}/${group.evaluatorModel.id}/${group.rubricSha256}`}>
                  <span>
                    <strong>
                      {group.evaluatorModel.provider}/{group.evaluatorModel.id}
                    </strong>
                    <small>{group.rubricName}</small>
                  </span>
                  <span>
                    <strong>{Math.round(group.agreementRate * 100)}%</strong>
                    <small>
                      {group.sampleCount} {copy.lab.casebook.samples}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <details className="casebook-history">
            <summary>
              <span>{copy.lab.casebook.history}</span>
              <code>{selected.revisions.length}</code>
            </summary>
            <ol>
              {selected.revisions
                .slice()
                .reverse()
                .map((item) => (
                  <li key={item.revision}>
                    <span>
                      r{item.revision} · {copy.lab.casebook.revisionSources[item.source]}
                    </span>
                    <code title={item.contentSha256}>{item.contentSha256.slice(0, 10)}</code>
                    <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                  </li>
                ))}
            </ol>
          </details>

          <footer className="casebook-volume-footer">
            {calibration ? (
              <code title={calibration.contentSha256}>
                {copy.lab.casebook.reportHash} {calibration.contentSha256.slice(0, 12)}
              </code>
            ) : (
              <span />
            )}
            <button type="button" disabled={Boolean(busyId)} onClick={() => void exportArtifact()}>
              <Download size={11} aria-hidden="true" />
              {busyId === `export:${selected.id}` ? copy.lab.casebook.exporting : copy.lab.casebook.export}
            </button>
          </footer>
        </article>
      ) : null}

      {error ? (
        <p className="suite-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="casebook-safety">
        <ShieldCheck size={11} aria-hidden="true" />
        {copy.lab.casebook.safety}
      </p>
    </section>
  );
}

function downloadArtifact(artifact: EvaluationCasebookArtifact): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(artifact, null, 2)}\n`], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = evaluationCasebookArtifactFilename(artifact);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadQualificationReceipt(receipt: EvaluationCasebookQualificationReceipt): void {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(receipt, null, 2)}\n`], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = evaluationCasebookQualificationReceiptFilename(receipt);
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

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toErrorMessage(error: unknown): string {
  return formatApiErrorMessage(error);
}
