import { useEffect, useState } from "react";

import type {
  EvaluationAdjudication,
  EvaluationCasebook,
  EvaluationCasebookCalibrationReport,
  EvaluationCasebookCase,
  EvaluationCasebookQualificationExecution,
  EvaluationQualificationBaseline,
  ModelSummary,
  ReceiptTrustAnchor,
  RunRecord,
  RunEvaluationRecord,
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
import {
  downloadArtifact,
  downloadQualificationReceipt,
  downloadTrustedReceipt,
  parseModelKey,
  toErrorMessage,
} from "./evaluation-casebook-artifacts";
import { useEvaluationCasebookProjection } from "./evaluation-casebook-projection";
import {
  getSignedCasebookQualificationReceipt,
  listEvaluationQualificationBaselines,
  promoteEvaluationQualificationBaseline,
} from "./receipt-trust-api";
import { useEvaluationCasebookTemplates } from "./use-evaluation-casebook-templates";

export interface UseEvaluationCasebookOptions {
  threadId: string;
  runs: RunRecord[];
  evaluations: RunEvaluationRecord[];
  adjudications: EvaluationAdjudication[];
  models: ModelSummary[];
  selectedModelKey: string;
  trustAnchors: ReceiptTrustAnchor[];
  selectedTrustAnchorId: string;
  onRefresh(): Promise<void>;
  onUseTaskPrompt(prompt: string): void;
}

export function useEvaluationCasebook({
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
}: UseEvaluationCasebookOptions) {
  const [casebooks, setCasebooks] = useState<EvaluationCasebook[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [calibration, setCalibration] =
    useState<EvaluationCasebookCalibrationReport>();
  const [qualifications, setQualifications] = useState<
    EvaluationCasebookQualificationExecution[]
  >([]);
  const [qualificationBaselines, setQualificationBaselines] = useState<
    EvaluationQualificationBaseline[]
  >([]);
  const [qualifierModelKey, setQualifierModelKey] = useState(selectedModelKey);
  const [minimumAgreementRate, setMinimumAgreementRate] = useState(80);
  const [allowQualificationInconclusive, setAllowQualificationInconclusive] =
    useState(false);
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

  const projection = useEvaluationCasebookProjection({
    adjudications,
    evaluations,
    casebooks,
    selectedId,
    templates,
    models,
    qualifications,
    qualificationBaselines,
    trustAnchors,
    selectedTrustAnchorId,
    curationEvaluationId,
    templateCaseId,
  });
  const {
    reviewedEvaluations,
    selected,
    revision,
    currentCases,
    selectedTemplate,
    releaseTemplate,
    selectedEvaluation,
    curationState,
    qualificationModelOptions,
  } = projection;

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    void listEvaluationCasebooks()
      .then((items) => {
        if (cancelled) return;
        setCasebooks(items);
        setSelectedId((current) =>
          items.some((item) => item.id === current)
            ? current
            : (items[0]?.id ?? ""),
        );
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
    if (
      qualificationModelOptions.some(
        (option) => option.key === selectedModelKey,
      )
    ) {
      setQualifierModelKey(selectedModelKey);
      return;
    }
    setQualifierModelKey(qualificationModelOptions[0]?.key ?? "");
  }, [qualificationModelOptions, selectedModelKey]);

  useEffect(() => {
    if (
      reviewedEvaluations.some(
        (evaluation) => evaluation.id === curationEvaluationId,
      )
    ) {
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
    setTemplateCaseId(
      selectedTemplate.cases.find((item) => !covered.has(item.id))?.id ??
        selectedTemplate.cases[0]?.id ??
        "",
    );
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
      downloadQualificationReceipt(
        await getEvaluationCasebookQualificationReceipt(selected.id),
      );
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
      const envelope = await getSignedCasebookQualificationReceipt(
        selected.id,
        threadId,
        selectedTrustAnchorId,
      );
      downloadTrustedReceipt(
        envelope,
        `napier-signed-casebook-qualification-${selected.id}-r${selected.currentRevision}-${envelope.contentSha256.slice(0, 12)}.json`,
      );
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
      const result = await promoteEvaluationQualificationBaseline(
        selected.id,
        threadId,
        selectedTrustAnchorId,
      );
      setQualificationBaselines((current) =>
        result.created ? [...current, result.baseline] : current,
      );
      await onRefresh();
    } catch (baselineError) {
      setError(toErrorMessage(baselineError));
    } finally {
      setBusyId(undefined);
    }
  }

  function commitCasebook(casebook: EvaluationCasebook): void {
    setCasebooks((current) =>
      [casebook, ...current.filter((item) => item.id !== casebook.id)].sort(
        (left, right) => right.updatedAt.localeCompare(left.updatedAt),
      ),
    );
    setSelectedId(casebook.id);
  }

  return {
    threadId,
    runs,
    onUseTaskPrompt,
    onRefresh,
    selectedTrustAnchorId,
    casebooks,
    selectedId,
    setSelectedId,
    calibration,
    qualifications,
    setQualifications,
    qualificationBaselines,
    qualifierModelKey,
    setQualifierModelKey,
    minimumAgreementRate,
    setMinimumAgreementRate,
    allowQualificationInconclusive,
    setAllowQualificationInconclusive,
    creating,
    editing,
    name,
    setName,
    description,
    setDescription,
    curationEvaluationId,
    setCurationEvaluationId,
    templateCaseId,
    setTemplateCaseId,
    pendingRemoveId,
    setPendingRemoveId,
    busyId,
    setBusyId,
    error,
    setError,
    templates,
    ...projection,
    beginCreate,
    beginEdit,
    cancelForm,
    submitMetadata,
    createReleaseTemplate,
    curate,
    remove,
    exportArtifact,
    runQualificationTrial,
    exportQualificationReceipt,
    exportSignedQualificationReceipt,
    promoteBaseline,
  };
}
