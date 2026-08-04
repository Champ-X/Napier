import { useEffect, useState } from "react";
import { Brain, ChevronRight, Download, ShieldCheck } from "lucide-react";

import type {
  ArtifactManifestEntry,
  ExecutionPlan,
  ExecutionPlanArchive,
  ExecutionPlanBlueprint,
  ExecutionPlanBlueprintRecord,
  ExecutionPlanBlueprintRecordReplayEventVerification,
  ExecutionPlanBlueprintRecordOutcomeReview,
  ExecutionPlanReplanDraftModelReview,
  ReceiptTrustAnchor,
  RunEvent,
} from "@napier/contracts";

import {
  applyReplanDraft,
  createExecutionPlanFromBlueprint,
  createExecutionPlanFromBlueprintRecordWithReplayEvent,
  getExecutionPlanArchive,
  getExecutionPlanBlueprint,
  getExecutionPlanBlueprintPortfolioCalibration,
  getExecutionPlanBlueprintRecommendationPolicyBacktest,
  getExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview,
  getExecutionPlanBlueprintRecommendationPolicyOverrideRetirements,
  getExecutionPlanBlueprintRecordQualification,
  getExecutionPlanBlueprintRecordOutcomeQualification,
  getExecutionPlanBlueprintRecordReplayOutcomes,
  getExecutionPlanBlueprintRecordReplays,
  getExecutionPlanBlueprintRecords,
  previewExecutionPlanFromBlueprintRecord,
  promoteExecutionPlanBlueprintRecordOutcomeBaseline,
  reviewExecutionPlanBlueprintRecordOutcomes,
  reviewReplanDraft,
  retireExecutionPlanBlueprintRecommendationPolicyOverride,
  saveExecutionPlanBlueprint,
  selectExecutionPlanBlueprintRecord,
  setExecutionPlanBlueprintRecommendationPolicyOverride,
  setExecutionPlanBlueprintRecordStatus,
  signExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle,
  updatePlanArtifact,
  verifyExecutionPlanArchive,
  verifyExecutionPlanBlueprint,
  verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle,
  verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirements,
  verifyExecutionPlanBlueprintRecordReplayEvent,
  verifyExecutionPlanBlueprintRecordReplayOutcomes,
  verifyExecutionPlanBlueprintRecordReplays,
} from "./api";
import {
  checkPlanArtifactDrift,
  downloadPlanArtifactFile,
  previewPlanArtifactDataProfile,
  previewPlanArtifactText,
  type PlanArtifactDataProfile,
  type PlanArtifactDataProfileReceipt,
  type PlanArtifactDataProfileVerification,
  type PlanArtifactDriftCheckReceipt,
  type PlanArtifactDirectoryManifest,
  type PlanArtifactDirectoryManifestReceipt,
  type PlanArtifactDirectoryManifestVerification,
  type PlanArtifactFileVerification,
  type PlanArtifactTextPreviewReceipt,
  previewPlanArtifactDirectoryManifest,
  verifyPlanArtifactFile,
  verifyPlanArtifactDataProfile,
  verifyPlanArtifactDirectoryManifest,
} from "./artifact-file-api";
import { formatApiErrorMessage } from "./api-error";
import { artifactDirectoryManifestFilename } from "./artifact-manifest-view-model";
import { artifactDataProfileFilename } from "./artifact-data-profile-view-model";
import type { PlanArtifactFileDownloadReceipt } from "./plan-artifact-manifest-types";
import {
  executionPlanArchiveFilename,
  executionPlanBlueprintFilename,
} from "./plan-archive-artifact-view-model";
import {
  blueprintLibraryRecordCounts,
  firstSigningAnchor,
  planBlueprintPreviewFromError,
  replayHistoryRecordId,
  replayOutcomesRecordId,
  signingAnchorAvailable,
  upsertBlueprintRecord,
} from "./plan-blueprint-panel-model";
import type {
  PlanBlueprintLibraryBusyAction,
  PlanBlueprintLibraryReceipt,
} from "./plan-blueprint-library-panel-types";
import { planCopy } from "./plan-copy";
import { PlanArtifactManifest } from "./PlanArtifactManifest";
import { PlanBlueprintLibraryControls } from "./PlanBlueprintLibraryControls";
import { PlanBlueprintLibraryReceiptView } from "./PlanBlueprintLibraryReceiptView";
import { PlanBlueprintRecordList } from "./PlanBlueprintRecordList";
import {
  PlanArchiveCard,
  type PlanArchiveReceipt,
  PlanBlueprintCard,
  type PlanBlueprintReceipt,
} from "./PlanPortableEvidenceCards";
import {
  planBlueprintCreatedReceipt,
  planBlueprintOutcomeBaselineReceipt,
  planBlueprintOutcomeQualificationReceipt,
  planBlueprintOutcomeReviewReceipt,
  planBlueprintPortfolioCalibrationReceipt,
  planBlueprintPreviewReceipt,
  planBlueprintQualificationReceipt,
  planBlueprintReplayHistoryFilename,
  planBlueprintRecommendationPolicyBacktestReceipt,
  planBlueprintRecommendationPolicyOverrideReceipt,
  planBlueprintRecommendationPolicyOverrideDriftReviewReceipt,
  planBlueprintRecommendationPolicyOverrideRetirementHistoryReceipt,
  planBlueprintRecommendationPolicyOverrideRetirementProofBundleReceipt,
  planBlueprintRecommendationPolicyOverrideRetirementProofBundleSignedReceipt,
  planBlueprintRecommendationPolicyOverrideRetirementHistoryVerificationReceipt,
  planBlueprintRecommendationPolicyOverrideRetirementReceipt,
  planBlueprintReplayOutcomesFilename,
  planBlueprintReplayHistoryReceipt,
  planBlueprintReplayHistoryVerificationReceipt,
  planBlueprintReplayOutcomesReceipt,
  planBlueprintReplayOutcomesVerificationReceipt,
  planBlueprintSelectionReceipt,
} from "./plan-blueprint-library-view-model";
import { listReceiptTrustAnchors } from "./receipt-trust-api";
import {
  projectReplanDraftSummary,
  projectReplanHistorySummary,
  projectReplanRecoveryNextAction,
  projectReplanRecordSummary,
  projectReplanRecoveryProgress,
  projectReplanStepRoles,
} from "./replan-draft-view-model";
import WorkflowWorkbenchSlot from "./WorkflowWorkbenchSlot";

const MAX_PLAN_ARCHIVE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PLAN_BLUEPRINT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PLAN_BLUEPRINT_REPLAY_HISTORY_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PLAN_BLUEPRINT_REPLAY_OUTCOMES_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PLAN_BLUEPRINT_POLICY_OVERRIDE_RETIREMENT_HISTORY_FILE_BYTES =
  2 * 1024 * 1024;

export default function PlanPanel({
  threadId,
  plans,
  events,
  running,
  selectedModelKey,
  selectedModelConfigured,
  onContinue,
  onDraftApplied,
  onOpenThread,
}: {
  threadId: string | undefined;
  plans: ExecutionPlan[];
  events: RunEvent[];
  running: boolean;
  selectedModelKey: string;
  selectedModelConfigured: boolean;
  onContinue: () => void;
  onDraftApplied: () => void | Promise<void>;
  onOpenThread: (threadId: string) => void | Promise<void>;
}) {
  const plan =
    plans.findLast((candidate) => candidate.status === "active") ??
    plans.findLast((candidate) => candidate.status === "blocked") ??
    plans.at(-1);
  const settled =
    plan?.steps.filter(
      (step) => step.status === "completed" || step.status === "skipped",
    ).length ?? 0;
  const readyStep =
    plan?.steps.find((step) => step.id === plan.readyStepIds[0]) ??
    plan?.steps.find((step) => step.status === "ready");
  const criticalPath = plan?.criticalPathStepIds ?? [];
  const activePhase = plan?.phaseWaves.find(
    (wave) => wave.index === plan.activePhaseIndex,
  );
  const criticalPathSet = new Set(criticalPath);
  const latestReplan = plan?.replans.at(-1);
  const latestReplanSummary = latestReplan
    ? projectReplanRecordSummary(latestReplan)
    : undefined;
  const latestReplanRecoveryProgress =
    plan && latestReplan
      ? projectReplanRecoveryProgress(plan, latestReplan)
      : undefined;
  const latestReplanRecoveryNextAction = projectReplanRecoveryNextAction(
    latestReplanRecoveryProgress,
    {
      planStatus: plan?.status,
      readyStepId: readyStep?.id,
      running,
    },
  );
  const canContinueLatestReplanRecovery = latestReplanRecoveryNextAction.canRun;
  const replanHistorySummary =
    plan && plan.replans.length > 0
      ? projectReplanHistorySummary(plan.replans)
      : undefined;
  const replanRecommendation = plan?.replanRecommendation;
  const replanDraftSummary = replanRecommendation
    ? projectReplanDraftSummary(replanRecommendation)
    : undefined;
  const recommendationHash = replanRecommendation?.recommendationSha256;
  const hasOpenPlan = plans.some(
    (candidate) =>
      candidate.status === "active" || candidate.status === "blocked",
  );
  const [draftReview, setDraftReview] =
    useState<ExecutionPlanReplanDraftModelReview>();
  const [draftReviewBusy, setDraftReviewBusy] = useState(false);
  const [draftApplyBusy, setDraftApplyBusy] = useState(false);
  const [draftReviewError, setDraftReviewError] = useState<string>();
  const [artifactBusyId, setArtifactBusyId] = useState<string>();
  const [artifactError, setArtifactError] = useState<string>();
  const [artifactFileDownloadReceipt, setArtifactFileDownloadReceipt] =
    useState<PlanArtifactFileDownloadReceipt>();
  const [artifactFileVerification, setArtifactFileVerification] =
    useState<PlanArtifactFileVerification>();
  const [artifactPreview, setArtifactPreview] =
    useState<PlanArtifactTextPreviewReceipt>();
  const [artifactDataProfile, setArtifactDataProfile] =
    useState<PlanArtifactDataProfileReceipt>();
  const [artifactDataProfileVerification, setArtifactDataProfileVerification] =
    useState<PlanArtifactDataProfileVerification>();
  const [artifactDirectoryManifest, setArtifactDirectoryManifest] =
    useState<PlanArtifactDirectoryManifestReceipt>();
  const [
    artifactDirectoryManifestVerification,
    setArtifactDirectoryManifestVerification,
  ] = useState<PlanArtifactDirectoryManifestVerification>();
  const [artifactDriftCheck, setArtifactDriftCheck] =
    useState<PlanArtifactDriftCheckReceipt>();
  const [archiveBusyAction, setArchiveBusyAction] = useState<
    "export" | "verify" | undefined
  >();
  const [archiveReceipt, setArchiveReceipt] = useState<PlanArchiveReceipt>();
  const [archiveError, setArchiveError] = useState<string>();
  const [blueprintBusyAction, setBlueprintBusyAction] = useState<
    "export" | "verify" | "create" | undefined
  >();
  const [blueprintReceipt, setBlueprintReceipt] =
    useState<PlanBlueprintReceipt>();
  const [blueprintError, setBlueprintError] = useState<string>();
  const [verifiedBlueprint, setVerifiedBlueprint] =
    useState<ExecutionPlanBlueprint>();
  const [blueprintRecords, setBlueprintRecords] = useState<
    ExecutionPlanBlueprintRecord[]
  >([]);
  const [blueprintLibraryLoaded, setBlueprintLibraryLoaded] = useState(false);
  const [blueprintLibraryBusyAction, setBlueprintLibraryBusyAction] =
    useState<PlanBlueprintLibraryBusyAction>();
  const [blueprintLibraryReceipt, setBlueprintLibraryReceipt] =
    useState<PlanBlueprintLibraryReceipt>();
  const [blueprintLibraryOutcomeReview, setBlueprintLibraryOutcomeReview] =
    useState<ExecutionPlanBlueprintRecordOutcomeReview>();
  const [blueprintLibraryError, setBlueprintLibraryError] = useState<string>();
  const [receiptTrustAnchors, setReceiptTrustAnchors] = useState<
    ReceiptTrustAnchor[]
  >([]);
  const [selectedReceiptTrustAnchorId, setSelectedReceiptTrustAnchorId] =
    useState("");

  useEffect(() => {
    setDraftReview(undefined);
    setDraftReviewError(undefined);
    setArtifactBusyId(undefined);
    setArtifactError(undefined);
    setArtifactPreview(undefined);
    setArtifactDataProfile(undefined);
    setArtifactDataProfileVerification(undefined);
    setArtifactDirectoryManifest(undefined);
    setArtifactDirectoryManifestVerification(undefined);
    setArtifactDriftCheck(undefined);
    setArchiveReceipt(undefined);
    setArchiveError(undefined);
    setBlueprintReceipt(undefined);
    setBlueprintError(undefined);
    setVerifiedBlueprint(undefined);
    setBlueprintLibraryOutcomeReview(undefined);
  }, [recommendationHash]);

  useEffect(() => {
    let cancelled = false;
    setBlueprintLibraryBusyAction("load");
    setBlueprintLibraryError(undefined);
    getExecutionPlanBlueprintRecords()
      .then((records) => {
        if (cancelled) return;
        setBlueprintRecords(records);
        setBlueprintLibraryLoaded(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setBlueprintLibraryError(formatApiErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setBlueprintLibraryBusyAction(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listReceiptTrustAnchors()
      .then((anchors) => {
        if (cancelled) return;
        setReceiptTrustAnchors(anchors);
        setSelectedReceiptTrustAnchorId((current) =>
          signingAnchorAvailable(anchors, current)
            ? current
            : (firstSigningAnchor(anchors)?.id ?? ""),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setReceiptTrustAnchors([]);
        setSelectedReceiptTrustAnchorId("");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reviewDraft = async (): Promise<void> => {
    if (!plan || !replanRecommendation || draftReviewBusy) return;
    if (!selectedModelConfigured) {
      setDraftReviewError(planCopy.modelUnavailableHint);
      return;
    }
    setDraftReviewBusy(true);
    setDraftReviewError(undefined);
    try {
      const review = await reviewReplanDraft(plan.threadId, plan.id, {
        model: parseModelKey(selectedModelKey),
      });
      setDraftReview(review);
    } catch (error) {
      setDraftReviewError(formatApiErrorMessage(error));
    } finally {
      setDraftReviewBusy(false);
    }
  };

  const applyDraft = async (): Promise<void> => {
    if (!plan || !replanRecommendation || draftApplyBusy) return;
    setDraftApplyBusy(true);
    setDraftReviewError(undefined);
    try {
      await applyReplanDraft(
        plan.threadId,
        plan.id,
        replanRecommendation.draft.request,
      );
      setDraftReview(undefined);
      await onDraftApplied();
    } catch (error) {
      setDraftReviewError(formatApiErrorMessage(error));
    } finally {
      setDraftApplyBusy(false);
    }
  };

  const updateArtifact = async (
    artifact: ArtifactManifestEntry,
    action: "produced" | "verified" | "missing",
  ): Promise<void> => {
    if (!threadId || !plan || artifactBusyId) return;
    setArtifactBusyId(`${artifact.id}:${action}`);
    setArtifactError(undefined);
    setArtifactPreview(undefined);
    setArtifactDataProfile(undefined);
    setArtifactDataProfileVerification(undefined);
    setArtifactDirectoryManifest(undefined);
    setArtifactDirectoryManifestVerification(undefined);
    setArtifactDriftCheck(undefined);
    setArtifactFileDownloadReceipt(undefined);
    setArtifactFileVerification(undefined);
    try {
      await updatePlanArtifact(threadId, plan.id, artifact.id, {
        status: action,
        evidence: artifactActionEvidence(artifact, action),
        ...(action === "verified" ||
        (action === "missing" && artifact.status === "verified")
          ? { observeWorkspace: true }
          : {}),
      });
      await onDraftApplied();
    } catch (error) {
      setArtifactError(formatApiErrorMessage(error));
    } finally {
      setArtifactBusyId(undefined);
    }
  };

  const downloadArtifact = async (
    artifact: ArtifactManifestEntry,
  ): Promise<void> => {
    if (!threadId || !plan || artifactBusyId) return;
    setArtifactBusyId(`${artifact.id}:download`);
    setArtifactError(undefined);
    setArtifactFileDownloadReceipt(undefined);
    try {
      const download = await downloadPlanArtifactFile(
        threadId,
        plan.id,
        artifact.id,
      );
      downloadBlob(download.blob, download.filename);
      setArtifactFileDownloadReceipt({
        artifactId: artifact.id,
        filename: download.filename,
        sha256: download.sha256,
        sizeBytes: download.sizeBytes,
        ledgerEventId: download.ledgerEventId,
        ledgerEventSeq: download.ledgerEventSeq,
        ledgerEventSha256: download.ledgerEventSha256,
      });
      await onDraftApplied();
    } catch (error) {
      setArtifactError(formatApiErrorMessage(error));
    } finally {
      setArtifactBusyId(undefined);
    }
  };

  const previewArtifact = async (
    artifact: ArtifactManifestEntry,
  ): Promise<void> => {
    if (!threadId || !plan || artifactBusyId) return;
    setArtifactBusyId(`${artifact.id}:preview`);
    setArtifactError(undefined);
    setArtifactPreview(undefined);
    setArtifactDataProfile(undefined);
    setArtifactDirectoryManifest(undefined);
    setArtifactDirectoryManifestVerification(undefined);
    setArtifactDriftCheck(undefined);
    try {
      const preview = await previewPlanArtifactText(
        threadId,
        plan.id,
        artifact.id,
      );
      setArtifactPreview(preview);
      await onDraftApplied();
    } catch (error) {
      setArtifactError(formatApiErrorMessage(error));
    } finally {
      setArtifactBusyId(undefined);
    }
  };

  const verifyArtifactFile = async (
    artifact: ArtifactManifestEntry,
    file: File,
  ): Promise<void> => {
    if (!threadId || !plan || artifactBusyId) return;
    setArtifactBusyId(`${artifact.id}:file-verify`);
    setArtifactError(undefined);
    setArtifactFileVerification(undefined);
    try {
      const verification = await verifyPlanArtifactFile(
        threadId,
        plan.id,
        artifact.id,
        file,
      );
      setArtifactFileVerification(verification);
      await onDraftApplied();
    } catch (error) {
      setArtifactError(formatApiErrorMessage(error));
    } finally {
      setArtifactBusyId(undefined);
    }
  };

  const previewDataProfile = async (
    artifact: ArtifactManifestEntry,
  ): Promise<void> => {
    if (!threadId || !plan || artifactBusyId) return;
    setArtifactBusyId(`${artifact.id}:data`);
    setArtifactError(undefined);
    setArtifactPreview(undefined);
    setArtifactDataProfile(undefined);
    setArtifactDirectoryManifest(undefined);
    setArtifactDirectoryManifestVerification(undefined);
    setArtifactDriftCheck(undefined);
    try {
      const profile = await previewPlanArtifactDataProfile(
        threadId,
        plan.id,
        artifact.id,
      );
      setArtifactDataProfile(profile);
      await onDraftApplied();
    } catch (error) {
      setArtifactError(formatApiErrorMessage(error));
    } finally {
      setArtifactBusyId(undefined);
    }
  };

  const verifyDataProfileFile = async (
    artifact: ArtifactManifestEntry,
    file: File,
  ): Promise<void> => {
    if (!threadId || !plan || artifactBusyId) return;
    setArtifactBusyId(`${artifact.id}:data-verify`);
    setArtifactError(undefined);
    setArtifactDataProfileVerification(undefined);
    try {
      const profile = JSON.parse(await file.text()) as PlanArtifactDataProfile;
      const verification = await verifyPlanArtifactDataProfile(
        threadId,
        plan.id,
        artifact.id,
        profile,
      );
      setArtifactDataProfileVerification(verification);
      await onDraftApplied();
    } catch (error) {
      setArtifactError(
        error instanceof SyntaxError
          ? planCopy.artifactActions.dataProfileVerifyInvalidJson
          : formatApiErrorMessage(error),
      );
    } finally {
      setArtifactBusyId(undefined);
    }
  };

  const previewDirectoryManifest = async (
    artifact: ArtifactManifestEntry,
  ): Promise<void> => {
    if (!threadId || !plan || artifactBusyId) return;
    setArtifactBusyId(`${artifact.id}:manifest`);
    setArtifactError(undefined);
    setArtifactPreview(undefined);
    setArtifactDataProfile(undefined);
    setArtifactDataProfileVerification(undefined);
    setArtifactDirectoryManifest(undefined);
    setArtifactDirectoryManifestVerification(undefined);
    setArtifactDriftCheck(undefined);
    try {
      const manifest = await previewPlanArtifactDirectoryManifest(
        threadId,
        plan.id,
        artifact.id,
      );
      setArtifactDirectoryManifest(manifest);
      await onDraftApplied();
    } catch (error) {
      setArtifactError(formatApiErrorMessage(error));
    } finally {
      setArtifactBusyId(undefined);
    }
  };

  const verifyDirectoryManifestFile = async (
    artifact: ArtifactManifestEntry,
    file: File,
  ): Promise<void> => {
    if (!threadId || !plan || artifactBusyId) return;
    setArtifactBusyId(`${artifact.id}:manifest-verify`);
    setArtifactError(undefined);
    setArtifactDirectoryManifestVerification(undefined);
    try {
      const manifest = JSON.parse(
        await file.text(),
      ) as PlanArtifactDirectoryManifest;
      const verification = await verifyPlanArtifactDirectoryManifest(
        threadId,
        plan.id,
        artifact.id,
        manifest,
      );
      setArtifactDirectoryManifestVerification(verification);
      await onDraftApplied();
    } catch (error) {
      setArtifactError(
        error instanceof SyntaxError
          ? planCopy.artifactActions.manifestVerifyInvalidJson
          : formatApiErrorMessage(error),
      );
    } finally {
      setArtifactBusyId(undefined);
    }
  };

  const checkArtifactDrift = async (
    artifact: ArtifactManifestEntry,
  ): Promise<void> => {
    if (!threadId || !plan || artifactBusyId) return;
    setArtifactBusyId(`${artifact.id}:drift-check`);
    setArtifactError(undefined);
    setArtifactPreview(undefined);
    setArtifactDataProfile(undefined);
    setArtifactDirectoryManifest(undefined);
    setArtifactDirectoryManifestVerification(undefined);
    setArtifactDriftCheck(undefined);
    try {
      const check = await checkPlanArtifactDrift(
        threadId,
        plan.id,
        artifact.id,
      );
      setArtifactDriftCheck(check);
      await onDraftApplied();
    } catch (error) {
      setArtifactError(formatApiErrorMessage(error));
    } finally {
      setArtifactBusyId(undefined);
    }
  };

  const exportArchive = async (): Promise<void> => {
    if (!plan || archiveBusyAction) return;
    setArchiveBusyAction("export");
    setArchiveReceipt(undefined);
    setArchiveError(undefined);
    try {
      const archive = await getExecutionPlanArchive(plan.threadId, plan.id);
      downloadJson(archive, executionPlanArchiveFilename(archive));
      setArchiveReceipt({
        action: "exported",
        contentSha256: archive.contentSha256,
        eventStreamSha256: archive.eventStreamSha256,
        revision: archive.plan.revision,
        eventCount: archive.events.length,
        stepCount: archive.plan.steps.length,
        artifactCount: archive.plan.artifacts.length,
        replanCount: archive.plan.replans.length,
      });
    } catch (error) {
      setArchiveError(formatApiErrorMessage(error));
    } finally {
      setArchiveBusyAction(undefined);
    }
  };

  const verifyArchiveFile = async (file: File): Promise<void> => {
    if (!plan) return;
    if (file.size > MAX_PLAN_ARCHIVE_FILE_BYTES) {
      setArchiveError(planCopy.archive.errors.tooLarge);
      return;
    }
    setArchiveBusyAction("verify");
    setArchiveReceipt(undefined);
    setArchiveError(undefined);
    try {
      const archive = JSON.parse(await file.text()) as ExecutionPlanArchive;
      const verification = await verifyExecutionPlanArchive(
        plan.threadId,
        plan.id,
        { archive },
      );
      setArchiveReceipt({
        action: "verified",
        status: verification.status,
        diagnostics: verification.diagnostics,
        ...(verification.contentSha256
          ? { contentSha256: verification.contentSha256 }
          : {}),
        ...(verification.eventStreamSha256
          ? { eventStreamSha256: verification.eventStreamSha256 }
          : {}),
        ...(verification.revision !== undefined
          ? { revision: verification.revision }
          : {}),
        eventCount: verification.eventCount,
        stepCount: verification.stepCount,
        artifactCount: verification.artifactCount,
        replanCount: verification.replanCount,
      });
    } catch (error) {
      setArchiveError(
        error instanceof SyntaxError
          ? planCopy.archive.errors.invalid
          : formatApiErrorMessage(error),
      );
    } finally {
      setArchiveBusyAction(undefined);
    }
  };

  const exportBlueprint = async (): Promise<void> => {
    if (!plan || blueprintBusyAction) return;
    setBlueprintBusyAction("export");
    setBlueprintReceipt(undefined);
    setBlueprintError(undefined);
    setVerifiedBlueprint(undefined);
    try {
      const blueprint = await getExecutionPlanBlueprint(plan.threadId, plan.id);
      downloadJson(blueprint, executionPlanBlueprintFilename(blueprint));
      setBlueprintReceipt({
        action: "exported",
        contentSha256: blueprint.contentSha256,
        sourcePlanRevision: blueprint.source.planRevision,
        stepCount: blueprint.stepCount,
        artifactCount: blueprint.artifactCount,
      });
      setVerifiedBlueprint(blueprint);
    } catch (error) {
      setBlueprintError(formatApiErrorMessage(error));
    } finally {
      setBlueprintBusyAction(undefined);
    }
  };

  const verifyBlueprintFile = async (file: File): Promise<void> => {
    if (!threadId) return;
    if (file.size > MAX_PLAN_BLUEPRINT_FILE_BYTES) {
      setBlueprintError(planCopy.blueprint.errors.tooLarge);
      return;
    }
    setBlueprintBusyAction("verify");
    setBlueprintReceipt(undefined);
    setBlueprintError(undefined);
    setVerifiedBlueprint(undefined);
    try {
      const blueprint = JSON.parse(await file.text()) as ExecutionPlanBlueprint;
      const verification = await verifyExecutionPlanBlueprint(threadId, {
        blueprint,
      });
      setBlueprintReceipt({
        action: "verified",
        status: verification.status,
        diagnostics: verification.diagnostics,
        ...(verification.contentSha256
          ? { contentSha256: verification.contentSha256 }
          : {}),
        ...(verification.sourcePlanRevision !== undefined
          ? { sourcePlanRevision: verification.sourcePlanRevision }
          : {}),
        stepCount: verification.stepCount,
        artifactCount: verification.artifactCount,
      });
      if (verification.status === "valid") {
        setVerifiedBlueprint(blueprint);
      }
    } catch (error) {
      setBlueprintError(
        error instanceof SyntaxError
          ? planCopy.blueprint.errors.invalid
          : formatApiErrorMessage(error),
      );
    } finally {
      setBlueprintBusyAction(undefined);
    }
  };

  const createFromBlueprint = async (): Promise<void> => {
    if (!threadId || !verifiedBlueprint || blueprintBusyAction || hasOpenPlan) {
      return;
    }
    setBlueprintBusyAction("create");
    setBlueprintError(undefined);
    try {
      const created = await createExecutionPlanFromBlueprint(threadId, {
        blueprint: verifiedBlueprint,
      });
      setBlueprintReceipt({
        action: "created",
        contentSha256: verifiedBlueprint.contentSha256,
        planId: created.id,
        stepCount: created.steps.length,
        artifactCount: created.artifacts.length,
      });
      setVerifiedBlueprint(undefined);
      await onDraftApplied();
    } catch (error) {
      setBlueprintError(formatApiErrorMessage(error));
    } finally {
      setBlueprintBusyAction(undefined);
    }
  };

  const refreshBlueprintLibrary = async (): Promise<void> => {
    if (blueprintLibraryBusyAction) return;
    setBlueprintLibraryBusyAction("load");
    setBlueprintLibraryError(undefined);
    try {
      const records = await getExecutionPlanBlueprintRecords();
      setBlueprintRecords(records);
      setBlueprintLibraryLoaded(true);
    } catch (error) {
      setBlueprintLibraryError(formatApiErrorMessage(error));
    } finally {
      setBlueprintLibraryBusyAction(undefined);
    }
  };

  const saveBlueprintRecord = async (): Promise<void> => {
    if (!threadId || !verifiedBlueprint || blueprintLibraryBusyAction) return;
    setBlueprintLibraryBusyAction("save");
    setBlueprintLibraryReceipt(undefined);
    setBlueprintLibraryError(undefined);
    try {
      const result = await saveExecutionPlanBlueprint(threadId, {
        blueprint: verifiedBlueprint,
        name: verifiedBlueprint.title,
      });
      setBlueprintRecords((records) =>
        upsertBlueprintRecord(records, result.record),
      );
      setBlueprintLibraryLoaded(true);
      setBlueprintLibraryReceipt({
        action: result.created ? "saved" : "reused",
        recordId: result.record.id,
        blueprintSha256: result.record.blueprintSha256,
        status: result.record.status,
        stepCount: result.record.blueprint.stepCount,
        artifactCount: result.record.blueprint.artifactCount,
      });
    } catch (error) {
      setBlueprintLibraryError(formatApiErrorMessage(error));
    } finally {
      setBlueprintLibraryBusyAction(undefined);
    }
  };

  const updateBlueprintRecordStatus = async (
    record: ExecutionPlanBlueprintRecord,
    status: ExecutionPlanBlueprintRecord["status"],
  ): Promise<void> => {
    if (blueprintLibraryBusyAction) return;
    setBlueprintLibraryBusyAction("status");
    setBlueprintLibraryReceipt(undefined);
    setBlueprintLibraryError(undefined);
    try {
      const updated = await setExecutionPlanBlueprintRecordStatus(record.id, {
        status,
      });
      setBlueprintRecords((records) => upsertBlueprintRecord(records, updated));
      setBlueprintLibraryReceipt({
        action: status === "active" ? "restored" : "archived",
        recordId: updated.id,
        blueprintSha256: updated.blueprintSha256,
        status: updated.status,
        stepCount: updated.blueprint.stepCount,
        artifactCount: updated.blueprint.artifactCount,
      });
    } catch (error) {
      setBlueprintLibraryError(formatApiErrorMessage(error));
    } finally {
      setBlueprintLibraryBusyAction(undefined);
    }
  };

  const qualifyBlueprintRecord = async (
    record: ExecutionPlanBlueprintRecord,
  ): Promise<void> => {
    if (blueprintLibraryBusyAction) return;
    setBlueprintLibraryBusyAction("qualify");
    setBlueprintLibraryReceipt(undefined);
    setBlueprintLibraryError(undefined);
    try {
      const qualification = await getExecutionPlanBlueprintRecordQualification(
        record.id,
      );
      setBlueprintLibraryReceipt(
        planBlueprintQualificationReceipt(qualification),
      );
    } catch (error) {
      setBlueprintLibraryError(formatApiErrorMessage(error));
    } finally {
      setBlueprintLibraryBusyAction(undefined);
    }
  };

  const previewBlueprintRecord = async (
    record: ExecutionPlanBlueprintRecord,
  ): Promise<void> => {
    if (!threadId || blueprintLibraryBusyAction) return;
    setBlueprintLibraryBusyAction("preview");
    setBlueprintLibraryReceipt(undefined);
    setBlueprintLibraryError(undefined);
    try {
      const preview = await previewExecutionPlanFromBlueprintRecord(threadId, {
        recordId: record.id,
      });
      setBlueprintLibraryReceipt(planBlueprintPreviewReceipt(preview));
    } catch (error) {
      setBlueprintLibraryError(formatApiErrorMessage(error));
    } finally {
      setBlueprintLibraryBusyAction(undefined);
    }
  };

  const loadBlueprintRecordReplayHistory = async (
    record: ExecutionPlanBlueprintRecord,
  ): Promise<void> => {
    if (blueprintLibraryBusyAction) return;
    setBlueprintLibraryBusyAction("history");
    setBlueprintLibraryReceipt(undefined);
    setBlueprintLibraryError(undefined);
    try {
      const history = await getExecutionPlanBlueprintRecordReplays(record.id);
      downloadJson(history, planBlueprintReplayHistoryFilename(history));
      setBlueprintLibraryReceipt(planBlueprintReplayHistoryReceipt(history));
    } catch (error) {
      setBlueprintLibraryError(formatApiErrorMessage(error));
    } finally {
      setBlueprintLibraryBusyAction(undefined);
    }
  };

  const verifyBlueprintRecordReplayHistoryFile = async (
    file: File,
  ): Promise<void> => {
    if (blueprintLibraryBusyAction) return;
    if (file.size > MAX_PLAN_BLUEPRINT_REPLAY_HISTORY_FILE_BYTES) {
      setBlueprintLibraryError(planCopy.blueprint.library.errors.tooLarge);
      return;
    }
    setBlueprintLibraryBusyAction("verifyHistory");
    setBlueprintLibraryReceipt(undefined);
    setBlueprintLibraryError(undefined);
    try {
      const history = JSON.parse(await file.text()) as unknown;
      const recordId = replayHistoryRecordId(history);
      if (!recordId) {
        setBlueprintLibraryError(planCopy.blueprint.library.errors.invalid);
        return;
      }
      const verification = await verifyExecutionPlanBlueprintRecordReplays(
        recordId,
        { history },
      );
      setBlueprintLibraryReceipt(
        planBlueprintReplayHistoryVerificationReceipt(verification),
      );
    } catch (error) {
      setBlueprintLibraryError(
        error instanceof SyntaxError
          ? planCopy.blueprint.library.errors.invalid
          : formatApiErrorMessage(error),
      );
    } finally {
      setBlueprintLibraryBusyAction(undefined);
    }
  };

  const loadBlueprintRecordReplayOutcomes = async (
    record: ExecutionPlanBlueprintRecord,
  ): Promise<void> => {
    if (blueprintLibraryBusyAction) return;
    setBlueprintLibraryBusyAction("outcomes");
    setBlueprintLibraryReceipt(undefined);
    setBlueprintLibraryError(undefined);
    try {
      const outcomes = await getExecutionPlanBlueprintRecordReplayOutcomes(
        record.id,
      );
      downloadJson(outcomes, planBlueprintReplayOutcomesFilename(outcomes));
      setBlueprintLibraryReceipt(planBlueprintReplayOutcomesReceipt(outcomes));
    } catch (error) {
      setBlueprintLibraryError(formatApiErrorMessage(error));
    } finally {
      setBlueprintLibraryBusyAction(undefined);
    }
  };

  const verifyBlueprintRecordReplayOutcomesFile = async (
    file: File,
  ): Promise<void> => {
    if (blueprintLibraryBusyAction) return;
    if (file.size > MAX_PLAN_BLUEPRINT_REPLAY_OUTCOMES_FILE_BYTES) {
      setBlueprintLibraryError(
        planCopy.blueprint.library.errors.outcomesTooLarge,
      );
      return;
    }
    setBlueprintLibraryBusyAction("verifyOutcomes");
    setBlueprintLibraryReceipt(undefined);
    setBlueprintLibraryError(undefined);
    try {
      const outcomes = JSON.parse(await file.text()) as unknown;
      const recordId = replayOutcomesRecordId(outcomes);
      if (!recordId) {
        setBlueprintLibraryError(
          planCopy.blueprint.library.errors.outcomesInvalid,
        );
        return;
      }
      const verification =
        await verifyExecutionPlanBlueprintRecordReplayOutcomes(recordId, {
          outcomes,
        });
      setBlueprintLibraryReceipt(
        planBlueprintReplayOutcomesVerificationReceipt(verification),
      );
    } catch (error) {
      setBlueprintLibraryError(
        error instanceof SyntaxError
          ? planCopy.blueprint.library.errors.outcomesInvalid
          : formatApiErrorMessage(error),
      );
    } finally {
      setBlueprintLibraryBusyAction(undefined);
    }
  };

  const promoteBlueprintRecordOutcomeBaseline = async (
    record: ExecutionPlanBlueprintRecord,
  ): Promise<void> => {
    if (blueprintLibraryBusyAction) return;
    setBlueprintLibraryBusyAction("promoteOutcomeBaseline");
    setBlueprintLibraryReceipt(undefined);
    setBlueprintLibraryError(undefined);
    try {
      const outcomes = await getExecutionPlanBlueprintRecordReplayOutcomes(
        record.id,
      );
      const result = await promoteExecutionPlanBlueprintRecordOutcomeBaseline(
        record.id,
        {
          outcomes,
        },
      );
      setBlueprintLibraryReceipt(planBlueprintOutcomeBaselineReceipt(result));
    } catch (error) {
      setBlueprintLibraryError(formatApiErrorMessage(error));
    } finally {
      setBlueprintLibraryBusyAction(undefined);
    }
  };

  const promoteBlueprintRecordReviewedOutcomeBaseline = async (
    record: ExecutionPlanBlueprintRecord,
  ): Promise<void> => {
    const review = blueprintLibraryOutcomeReview;
    if (
      blueprintLibraryBusyAction ||
      !review ||
      review.recordId !== record.id
    ) {
      return;
    }
    setBlueprintLibraryBusyAction("promoteReviewedOutcomeBaseline");
    setBlueprintLibraryReceipt(undefined);
    setBlueprintLibraryError(undefined);
    try {
      const outcomes = await getExecutionPlanBlueprintRecordReplayOutcomes(
        record.id,
      );
      const result = await promoteExecutionPlanBlueprintRecordOutcomeBaseline(
        record.id,
        {
          outcomes,
          review,
        },
      );
      setBlueprintLibraryReceipt(planBlueprintOutcomeBaselineReceipt(result));
    } catch (error) {
      setBlueprintLibraryError(formatApiErrorMessage(error));
    } finally {
      setBlueprintLibraryBusyAction(undefined);
    }
  };

  const qualifyBlueprintRecordOutcomes = async (
    record: ExecutionPlanBlueprintRecord,
  ): Promise<void> => {
    if (blueprintLibraryBusyAction) return;
    setBlueprintLibraryBusyAction("qualifyOutcomes");
    setBlueprintLibraryReceipt(undefined);
    setBlueprintLibraryError(undefined);
    try {
      const qualification =
        await getExecutionPlanBlueprintRecordOutcomeQualification(record.id);
      setBlueprintLibraryReceipt(
        planBlueprintOutcomeQualificationReceipt(qualification),
      );
    } catch (error) {
      setBlueprintLibraryError(formatApiErrorMessage(error));
    } finally {
      setBlueprintLibraryBusyAction(undefined);
    }
  };

  const reviewBlueprintRecordOutcomes = async (
    record: ExecutionPlanBlueprintRecord,
  ): Promise<void> => {
    if (blueprintLibraryBusyAction) return;
    if (!selectedModelConfigured) {
      setBlueprintLibraryError(planCopy.modelUnavailableHint);
      return;
    }
    setBlueprintLibraryBusyAction("reviewOutcomes");
    setBlueprintLibraryReceipt(undefined);
    setBlueprintLibraryError(undefined);
    try {
      const review = await reviewExecutionPlanBlueprintRecordOutcomes(
        record.id,
        {
          model: parseModelKey(selectedModelKey),
        },
      );
      setBlueprintLibraryOutcomeReview(review);
      setBlueprintLibraryReceipt(planBlueprintOutcomeReviewReceipt(review));
    } catch (error) {
      setBlueprintLibraryError(formatApiErrorMessage(error));
    } finally {
      setBlueprintLibraryBusyAction(undefined);
    }
  };

  const selectBestBlueprintRecord = async (): Promise<void> => {
    if (!threadId || blueprintLibraryBusyAction) return;
    setBlueprintLibraryBusyAction("select");
    setBlueprintLibraryReceipt(undefined);
    setBlueprintLibraryError(undefined);
    try {
      const selection = await selectExecutionPlanBlueprintRecord(threadId);
      setBlueprintLibraryReceipt(planBlueprintSelectionReceipt(selection));
    } catch (error) {
      setBlueprintLibraryError(formatApiErrorMessage(error));
    } finally {
      setBlueprintLibraryBusyAction(undefined);
    }
  };

  const calibrateBlueprintPortfolio = async (): Promise<void> => {
    if (blueprintLibraryBusyAction) return;
    setBlueprintLibraryBusyAction("calibratePortfolio");
    setBlueprintLibraryReceipt(undefined);
    setBlueprintLibraryError(undefined);
    try {
      const calibration = await getExecutionPlanBlueprintPortfolioCalibration();
      setBlueprintLibraryReceipt(
        planBlueprintPortfolioCalibrationReceipt(calibration),
      );
    } catch (error) {
      setBlueprintLibraryError(formatApiErrorMessage(error));
    } finally {
      setBlueprintLibraryBusyAction(undefined);
    }
  };

  const backtestBlueprintRecommendationPolicies = async (): Promise<void> => {
    if (blueprintLibraryBusyAction) return;
    setBlueprintLibraryBusyAction("backtestPolicy");
    setBlueprintLibraryReceipt(undefined);
    setBlueprintLibraryError(undefined);
    try {
      const backtest =
        await getExecutionPlanBlueprintRecommendationPolicyBacktest();
      setBlueprintLibraryReceipt(
        planBlueprintRecommendationPolicyBacktestReceipt(backtest),
      );
    } catch (error) {
      setBlueprintLibraryError(formatApiErrorMessage(error));
    } finally {
      setBlueprintLibraryBusyAction(undefined);
    }
  };

  const applyBlueprintRecommendationPolicyOverride =
    async (): Promise<void> => {
      if (blueprintLibraryBusyAction) return;
      const receipt = blueprintLibraryReceipt;
      if (
        receipt?.action !== "policyBacktested" ||
        !receipt.topSelectedFamilySha256
      ) {
        return;
      }
      setBlueprintLibraryBusyAction("applyPolicyOverride");
      setBlueprintLibraryError(undefined);
      try {
        const override =
          await setExecutionPlanBlueprintRecommendationPolicyOverride({
            familySha256: receipt.topSelectedFamilySha256,
            policyTemplate: receipt.topPolicyTemplate,
            expectedPortfolioSetSha256: receipt.portfolioSetSha256,
          });
        setBlueprintLibraryReceipt(
          planBlueprintRecommendationPolicyOverrideReceipt(override),
        );
      } catch (error) {
        setBlueprintLibraryError(formatApiErrorMessage(error));
      } finally {
        setBlueprintLibraryBusyAction(undefined);
      }
    };

  const reviewBlueprintRecommendationPolicyOverrideDrift =
    async (): Promise<void> => {
      if (blueprintLibraryBusyAction) return;
      setBlueprintLibraryBusyAction("reviewPolicyOverrideDrift");
      setBlueprintLibraryReceipt(undefined);
      setBlueprintLibraryError(undefined);
      try {
        const review =
          await getExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview();
        setBlueprintLibraryReceipt(
          planBlueprintRecommendationPolicyOverrideDriftReviewReceipt(review),
        );
      } catch (error) {
        setBlueprintLibraryError(formatApiErrorMessage(error));
      } finally {
        setBlueprintLibraryBusyAction(undefined);
      }
    };

  const retireBlueprintRecommendationPolicyOverride =
    async (): Promise<void> => {
      if (blueprintLibraryBusyAction) return;
      const receipt = blueprintLibraryReceipt;
      if (
        receipt?.action !== "policyOverrideDriftReviewed" ||
        receipt.reviewedRecommendation !== "retire" ||
        !receipt.reviewedFamilySha256 ||
        !receipt.reviewedOverrideSha256
      ) {
        return;
      }
      setBlueprintLibraryBusyAction("retirePolicyOverride");
      setBlueprintLibraryError(undefined);
      try {
        const result =
          await retireExecutionPlanBlueprintRecommendationPolicyOverride({
            familySha256: receipt.reviewedFamilySha256,
            expectedOverrideSha256: receipt.reviewedOverrideSha256,
            expectedOverrideSetSha256: receipt.overrideSetSha256,
            expectedDriftReviewSetSha256: receipt.reviewSetSha256,
            expectedPortfolioSetSha256: receipt.portfolioSetSha256,
          });
        setBlueprintLibraryReceipt(
          planBlueprintRecommendationPolicyOverrideRetirementReceipt(result),
        );
      } catch (error) {
        setBlueprintLibraryError(formatApiErrorMessage(error));
      } finally {
        setBlueprintLibraryBusyAction(undefined);
      }
    };

  const auditBlueprintRecommendationPolicyOverrideRetirements =
    async (): Promise<void> => {
      if (blueprintLibraryBusyAction) return;
      setBlueprintLibraryBusyAction("auditPolicyOverrideRetirements");
      setBlueprintLibraryReceipt(undefined);
      setBlueprintLibraryError(undefined);
      try {
        const history =
          await getExecutionPlanBlueprintRecommendationPolicyOverrideRetirements();
        downloadJson(
          history,
          `napier-blueprint-policy-override-retirements-${history.retirementSetSha256.slice(0, 12)}.json`,
        );
        setBlueprintLibraryReceipt(
          planBlueprintRecommendationPolicyOverrideRetirementHistoryReceipt(
            history,
          ),
        );
      } catch (error) {
        setBlueprintLibraryError(formatApiErrorMessage(error));
      } finally {
        setBlueprintLibraryBusyAction(undefined);
      }
    };

  const verifyBlueprintRecommendationPolicyOverrideRetirementsFile = async (
    file: File,
  ): Promise<void> => {
    if (blueprintLibraryBusyAction) return;
    if (
      file.size >
      MAX_PLAN_BLUEPRINT_POLICY_OVERRIDE_RETIREMENT_HISTORY_FILE_BYTES
    ) {
      setBlueprintLibraryError(
        planCopy.blueprint.library.errors.policyOverrideRetirementsTooLarge,
      );
      return;
    }
    setBlueprintLibraryBusyAction("verifyPolicyOverrideRetirements");
    setBlueprintLibraryReceipt(undefined);
    setBlueprintLibraryError(undefined);
    try {
      const history = JSON.parse(await file.text()) as unknown;
      const verification =
        await verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(
          { history },
        );
      setBlueprintLibraryReceipt(
        planBlueprintRecommendationPolicyOverrideRetirementHistoryVerificationReceipt(
          verification,
        ),
      );
    } catch (error) {
      setBlueprintLibraryError(
        error instanceof SyntaxError
          ? planCopy.blueprint.library.errors.policyOverrideRetirementsInvalid
          : formatApiErrorMessage(error),
      );
    } finally {
      setBlueprintLibraryBusyAction(undefined);
    }
  };

  const verifyBlueprintRecommendationPolicyOverrideRetirementProofBundleFiles =
    async (files: File[]): Promise<void> => {
      if (blueprintLibraryBusyAction) return;
      if (
        files.some(
          (file) =>
            file.size >
            MAX_PLAN_BLUEPRINT_POLICY_OVERRIDE_RETIREMENT_HISTORY_FILE_BYTES,
        )
      ) {
        setBlueprintLibraryError(
          planCopy.blueprint.library.errors.policyOverrideRetirementsTooLarge,
        );
        return;
      }
      setBlueprintLibraryBusyAction(
        "verifyPolicyOverrideRetirementProofBundle",
      );
      setBlueprintLibraryReceipt(undefined);
      setBlueprintLibraryError(undefined);
      try {
        const histories = await Promise.all(
          files.map(async (file) => JSON.parse(await file.text()) as unknown),
        );
        const proofBundle =
          await verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle(
            { histories },
          );
        setBlueprintLibraryReceipt(
          planBlueprintRecommendationPolicyOverrideRetirementProofBundleReceipt(
            proofBundle,
          ),
        );
      } catch (error) {
        setBlueprintLibraryError(
          error instanceof SyntaxError
            ? planCopy.blueprint.library.errors.policyOverrideRetirementsInvalid
            : formatApiErrorMessage(error),
        );
      } finally {
        setBlueprintLibraryBusyAction(undefined);
      }
    };

  const signBlueprintRecommendationPolicyOverrideRetirementProofBundleFiles =
    async (files: File[]): Promise<void> => {
      if (blueprintLibraryBusyAction || !threadId) return;
      if (
        files.some(
          (file) =>
            file.size >
            MAX_PLAN_BLUEPRINT_POLICY_OVERRIDE_RETIREMENT_HISTORY_FILE_BYTES,
        )
      ) {
        setBlueprintLibraryError(
          planCopy.blueprint.library.errors.policyOverrideRetirementsTooLarge,
        );
        return;
      }
      setBlueprintLibraryBusyAction("signPolicyOverrideRetirementProofBundle");
      setBlueprintLibraryReceipt(undefined);
      setBlueprintLibraryError(undefined);
      try {
        const anchors = await listReceiptTrustAnchors();
        setReceiptTrustAnchors(anchors);
        const signer = signingAnchorAvailable(
          anchors,
          selectedReceiptTrustAnchorId,
        )
          ? anchors.find((anchor) => anchor.id === selectedReceiptTrustAnchorId)
          : firstSigningAnchor(anchors);
        if (!signer) {
          setSelectedReceiptTrustAnchorId("");
          setBlueprintLibraryError(
            planCopy.blueprint.library.errors.policyOverrideProofBundleNoSigner,
          );
          return;
        }
        setSelectedReceiptTrustAnchorId(signer.id);
        const histories = await Promise.all(
          files.map(async (file) => JSON.parse(await file.text()) as unknown),
        );
        const envelope =
          await signExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle(
            {
              histories,
              threadId,
              trustAnchorId: signer.id,
            },
          );
        downloadJson(
          envelope,
          `napier-signed-policy-retirement-proof-bundle-${envelope.contentSha256.slice(0, 12)}.json`,
        );
        setBlueprintLibraryReceipt(
          planBlueprintRecommendationPolicyOverrideRetirementProofBundleSignedReceipt(
            envelope,
          ),
        );
      } catch (error) {
        setBlueprintLibraryError(
          error instanceof SyntaxError
            ? planCopy.blueprint.library.errors.policyOverrideRetirementsInvalid
            : formatApiErrorMessage(error),
        );
      } finally {
        setBlueprintLibraryBusyAction(undefined);
      }
    };

  const createFromBlueprintRecord = async (
    record: ExecutionPlanBlueprintRecord,
  ): Promise<void> => {
    if (!threadId || blueprintLibraryBusyAction || hasOpenPlan) return;
    setBlueprintLibraryBusyAction("create");
    setBlueprintLibraryReceipt(undefined);
    setBlueprintLibraryError(undefined);
    try {
      const preview = await previewExecutionPlanFromBlueprintRecord(threadId, {
        recordId: record.id,
      });
      if (preview.status !== "ready") {
        setBlueprintLibraryReceipt(planBlueprintPreviewReceipt(preview));
        return;
      }
      const created =
        await createExecutionPlanFromBlueprintRecordWithReplayEvent(threadId, {
          recordId: record.id,
          expectedPreviewSha256: preview.previewSha256,
        });
      let replayEventVerification:
        | ExecutionPlanBlueprintRecordReplayEventVerification
        | undefined;
      let replayEventDiagnostics: string[] | undefined;
      if (created.replayEvent) {
        try {
          replayEventVerification =
            await verifyExecutionPlanBlueprintRecordReplayEvent(
              record.id,
              created.replayEvent,
            );
        } catch (error) {
          replayEventDiagnostics = [formatApiErrorMessage(error)];
        }
      }
      setBlueprintLibraryReceipt(
        planBlueprintCreatedReceipt({
          record,
          plan: created.plan,
          ...(created.replayEvent ? { replayEvent: created.replayEvent } : {}),
          ...(replayEventVerification ? { replayEventVerification } : {}),
          ...(replayEventDiagnostics ? { replayEventDiagnostics } : {}),
        }),
      );
      await onDraftApplied();
    } catch (error) {
      const preview = planBlueprintPreviewFromError(error);
      if (preview) {
        setBlueprintLibraryReceipt(planBlueprintPreviewReceipt(preview));
      } else {
        setBlueprintLibraryError(formatApiErrorMessage(error));
      }
    } finally {
      setBlueprintLibraryBusyAction(undefined);
    }
  };

  return (
    <section className="panel-section plan-panel" aria-labelledby="plan-title">
      <div className="panel-heading">
        <div>
          <span>{planCopy.eyebrow}</span>
          <h2 id="plan-title">{planCopy.title}</h2>
        </div>
        <span className="plan-count">
          {plans.length} {planCopy.count}
        </span>
      </div>
      <WorkflowWorkbenchSlot
        threadId={threadId}
        plans={plans}
        events={events}
        running={running}
        selectedModelKey={selectedModelKey}
        selectedModelConfigured={selectedModelConfigured}
        onWorkflowSettled={onDraftApplied}
        onOpenThread={onOpenThread}
      />
      {!plan ? (
        <p className="empty-panel">{planCopy.empty}</p>
      ) : (
        <>
          <article className={`plan-sheet plan-${plan.status}`}>
            <header>
              <div>
                <span>{planCopy.objective}</span>
                <h3>{plan.objective}</h3>
              </div>
              <span className="plan-status">
                {planCopy.statuses[plan.status]}
              </span>
            </header>
            <div className="plan-progress">
              <div>
                <span>{planCopy.progress}</span>
                <strong>
                  {settled} / {plan.steps.length}
                </strong>
              </div>
              <span aria-hidden="true">
                <i
                  style={{
                    width: `${(settled / Math.max(1, plan.steps.length)) * 100}%`,
                  }}
                />
              </span>
            </div>
            <div
              className="plan-critical-path"
              aria-label={planCopy.criticalPath}
            >
              <span>{planCopy.criticalPath}</span>
              <strong>
                {criticalPath.length > 0
                  ? criticalPath.join(" -> ")
                  : planCopy.none}
              </strong>
              <small>
                {planCopy.readyPath}:{" "}
                {plan.readyStepIds.length > 0
                  ? plan.readyStepIds.join(", ")
                  : planCopy.none}
                {" / "}
                {planCopy.blockedPath}:{" "}
                {plan.blockedStepIds.length > 0
                  ? plan.blockedStepIds.join(", ")
                  : planCopy.none}
              </small>
              <small>
                {planCopy.phase}:{" "}
                {activePhase
                  ? `${activePhase.index + 1} / ${plan.phaseWaves.length}`
                  : planCopy.none}
                {" / "}
                {planCopy.parallelReady}:{" "}
                {plan.parallelReadyStepIds.length > 0
                  ? plan.parallelReadyStepIds.join(", ")
                  : planCopy.none}
                {" / "}
                {planCopy.phaseHash}:{" "}
                <code title={plan.phaseProjectionSha256}>
                  {plan.phaseProjectionSha256.slice(0, 12)}
                </code>
              </small>
            </div>
            {latestReplan ? (
              <div className="plan-replan-ledger" aria-label={planCopy.replan}>
                <span>{planCopy.replan}</span>
                <strong>
                  {planCopy.replanStrategies[latestReplan.strategy]}
                </strong>
                <small>
                  r{latestReplan.fromRevision} {"->"} r{latestReplan.toRevision}
                  {" / "}
                  {planCopy.hash}: {latestReplan.replanSha256.slice(0, 12)}
                </small>
                {latestReplanSummary ? (
                  <div className="plan-replan-record-summary">
                    <span>{planCopy.appliedChanges}</span>
                    <strong>
                      {latestReplanSummary.structuralChangeCount.toLocaleString()}{" "}
                      {planCopy.changes}
                      {" / "}
                      {planCopy.hash}:{" "}
                      <code title={latestReplanSummary.replanSha256}>
                        {latestReplanSummary.replanSha256.slice(0, 12)}
                      </code>
                    </strong>
                    <dl>
                      {latestReplanSummary.supersededStepIds.length > 0 ? (
                        <div>
                          <dt>{planCopy.supersededSteps}</dt>
                          <dd>
                            {latestReplanSummary.supersededStepIds.join(", ")}
                          </dd>
                        </div>
                      ) : null}
                      {latestReplanSummary.supersededArtifactIds.length > 0 ? (
                        <div>
                          <dt>{planCopy.supersededArtifacts}</dt>
                          <dd>
                            {latestReplanSummary.supersededArtifactIds.join(
                              ", ",
                            )}
                          </dd>
                        </div>
                      ) : null}
                      {latestReplanSummary.addedStepIds.length > 0 ? (
                        <div>
                          <dt>{planCopy.addedSteps}</dt>
                          <dd>{latestReplanSummary.addedStepIds.join(", ")}</dd>
                        </div>
                      ) : null}
                      {latestReplanSummary.addedArtifactIds.length > 0 ? (
                        <div>
                          <dt>{planCopy.addedArtifacts}</dt>
                          <dd>
                            {latestReplanSummary.addedArtifactIds.join(", ")}
                          </dd>
                        </div>
                      ) : null}
                      {latestReplanSummary.dependencyUpdatedStepIds.length >
                      0 ? (
                        <div>
                          <dt>{planCopy.dependencyUpdates}</dt>
                          <dd>
                            {latestReplanSummary.dependencyUpdatedStepIds.join(
                              ", ",
                            )}
                          </dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>{planCopy.addedStepsHash}</dt>
                        <dd>
                          <code title={latestReplanSummary.addedStepsSha256}>
                            {latestReplanSummary.addedStepsSha256.slice(0, 12)}
                          </code>
                        </dd>
                      </div>
                      <div>
                        <dt>{planCopy.addedArtifactsHash}</dt>
                        <dd>
                          <code
                            title={latestReplanSummary.addedArtifactsSha256}
                          >
                            {latestReplanSummary.addedArtifactsSha256.slice(
                              0,
                              12,
                            )}
                          </code>
                        </dd>
                      </div>
                      <div>
                        <dt>{planCopy.dependencyUpdatesHash}</dt>
                        <dd>
                          <code
                            title={latestReplanSummary.dependencyUpdatesSha256}
                          >
                            {latestReplanSummary.dependencyUpdatesSha256.slice(
                              0,
                              12,
                            )}
                          </code>
                        </dd>
                      </div>
                    </dl>
                  </div>
                ) : null}
                {latestReplanRecoveryProgress?.hasRecoveryWork ? (
                  <div className="plan-replan-recovery-progress">
                    <span>{planCopy.recoveryProgress}</span>
                    <strong>
                      {latestReplanRecoveryProgress.isComplete
                        ? planCopy.recoveryComplete
                        : planCopy.recoveryInProgress}
                    </strong>
                    <small>
                      {latestReplanRecoveryProgress.settledStepCount.toLocaleString()}{" "}
                      /{" "}
                      {latestReplanRecoveryProgress.addedStepCount.toLocaleString()}{" "}
                      {planCopy.recoveryStepsSettled}
                      {" / "}
                      {latestReplanRecoveryProgress.verifiedArtifactCount.toLocaleString()}{" "}
                      /{" "}
                      {latestReplanRecoveryProgress.addedArtifactCount.toLocaleString()}{" "}
                      {planCopy.recoveryArtifactsVerified}
                    </small>
                    <small>
                      {planCopy.statuses.ready}:{" "}
                      {latestReplanRecoveryProgress.readyStepCount.toLocaleString()}
                      {" / "}
                      {planCopy.statuses.running}:{" "}
                      {latestReplanRecoveryProgress.runningStepCount.toLocaleString()}
                      {" / "}
                      {planCopy.statuses.blocked}:{" "}
                      {latestReplanRecoveryProgress.blockedStepCount.toLocaleString()}
                      {" / "}
                      {planCopy.statuses.produced}:{" "}
                      {latestReplanRecoveryProgress.producedArtifactCount.toLocaleString()}
                      {" / "}
                      {planCopy.statuses.expected}:{" "}
                      {latestReplanRecoveryProgress.pendingArtifactCount.toLocaleString()}
                      {" / "}
                      {planCopy.statuses.missing}:{" "}
                      {latestReplanRecoveryProgress.missingArtifactCount.toLocaleString()}
                    </small>
                    <small
                      className={`plan-replan-recovery-next plan-replan-recovery-next--${latestReplanRecoveryNextAction.action}`}
                    >
                      {
                        planCopy.recoveryNextActions[
                          latestReplanRecoveryNextAction.action
                        ]
                      }
                    </small>
                    {canContinueLatestReplanRecovery ? (
                      <button
                        className="plan-review-action plan-apply-action"
                        type="button"
                        onClick={onContinue}
                      >
                        <ChevronRight size={12} aria-hidden="true" />
                        {planCopy.runRecoveryStep}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            {replanHistorySummary?.hasMultipleRecords ? (
              <div
                className="plan-replan-ledger plan-replan-history"
                aria-label={planCopy.replanHistory}
              >
                <span>{planCopy.replanHistory}</span>
                <strong>
                  {replanHistorySummary.recordCount.toLocaleString()}{" "}
                  {planCopy.records}
                  {" / "}
                  {replanHistorySummary.totalStructuralChangeCount.toLocaleString()}{" "}
                  {planCopy.changes}
                </strong>
                <ol>
                  {replanHistorySummary.records.map((record, index) => (
                    <li key={record.id}>
                      <span>
                        #{String(index + 1).padStart(2, "0")}{" "}
                        {planCopy.replanStrategies[record.strategy]}
                      </span>
                      <small>
                        r{record.fromRevision} {"->"} r{record.toRevision}
                        {" / "}
                        {record.structuralChangeCount.toLocaleString()}{" "}
                        {planCopy.changes}
                        {" / "}
                        {planCopy.hash}:{" "}
                        <code title={record.replanSha256}>
                          {record.replanSha256.slice(0, 12)}
                        </code>
                      </small>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {replanRecommendation ? (
              <div
                className="plan-replan-ledger plan-replan-signal"
                aria-label={planCopy.replanSignal}
              >
                <span>{planCopy.replanSignal}</span>
                <strong>
                  {planCopy.replanStrategies[replanRecommendation.strategy]}
                </strong>
                <small>
                  r{replanRecommendation.expectedRevision}
                  {" / "}
                  {planCopy.hash}:{" "}
                  {replanRecommendation.recommendationSha256.slice(0, 12)}
                  {" / "}
                  {planCopy.draft}:{" "}
                  {replanRecommendation.draft.draftSha256.slice(0, 12)}
                  {" / "}
                  {planCopy.score}:{" "}
                  {replanRecommendation.draft.evaluation.score}
                  {" / "}
                  {planCopy.risk}:{" "}
                  {
                    planCopy.replanRisks[
                      replanRecommendation.draft.evaluation.risk
                    ]
                  }
                </small>
                {replanDraftSummary ? (
                  <div className="plan-replan-draft-summary">
                    <span>{planCopy.draftChanges}</span>
                    <strong>
                      {replanDraftSummary.structuralChangeCount.toLocaleString()}{" "}
                      {planCopy.changes}
                      {" / "}
                      {planCopy.expectedRevision} r
                      {replanDraftSummary.expectedRevision}
                    </strong>
                    <dl>
                      {replanDraftSummary.supersededStepIds.length > 0 ? (
                        <div>
                          <dt>{planCopy.supersededSteps}</dt>
                          <dd>
                            {replanDraftSummary.supersededStepIds.join(", ")}
                          </dd>
                        </div>
                      ) : null}
                      {replanDraftSummary.supersededArtifactIds.length > 0 ? (
                        <div>
                          <dt>{planCopy.supersededArtifacts}</dt>
                          <dd>
                            {replanDraftSummary.supersededArtifactIds.join(
                              ", ",
                            )}
                          </dd>
                        </div>
                      ) : null}
                      {replanDraftSummary.addedSteps.length > 0 ? (
                        <div>
                          <dt>{planCopy.addedSteps}</dt>
                          <dd>
                            {replanDraftSummary.addedSteps
                              .map((step) =>
                                step.dependsOn.length > 0
                                  ? `${step.id}: ${step.title} (${step.dependsOn.join(", ")})`
                                  : `${step.id}: ${step.title}`,
                              )
                              .join(", ")}
                          </dd>
                        </div>
                      ) : null}
                      {replanDraftSummary.addedArtifacts.length > 0 ? (
                        <div>
                          <dt>{planCopy.addedArtifacts}</dt>
                          <dd>
                            {replanDraftSummary.addedArtifacts
                              .map(
                                (artifact) =>
                                  `${artifact.id} (${artifact.kind}: ${artifact.path})`,
                              )
                              .join(", ")}
                          </dd>
                        </div>
                      ) : null}
                      {replanDraftSummary.dependencyUpdates.length > 0 ? (
                        <div>
                          <dt>{planCopy.dependencyUpdates}</dt>
                          <dd>
                            {replanDraftSummary.dependencyUpdates
                              .map(
                                (update) =>
                                  `${update.stepId} -> ${
                                    update.dependsOn.length > 0
                                      ? update.dependsOn.join(", ")
                                      : planCopy.none
                                  }`,
                              )
                              .join(" / ")}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                ) : null}
                <button
                  className="plan-review-action"
                  type="button"
                  disabled={
                    draftReviewBusy ||
                    draftApplyBusy ||
                    !selectedModelConfigured
                  }
                  aria-describedby={
                    !selectedModelConfigured
                      ? "plan-replan-model-unavailable"
                      : undefined
                  }
                  onClick={() => void reviewDraft()}
                >
                  <Brain size={12} aria-hidden="true" />
                  {draftReviewBusy
                    ? planCopy.reviewingDraft
                    : planCopy.reviewDraft}
                </button>
                <button
                  className="plan-review-action plan-apply-action"
                  type="button"
                  disabled={draftReviewBusy || draftApplyBusy || running}
                  onClick={() => void applyDraft()}
                >
                  <ChevronRight size={12} aria-hidden="true" />
                  {draftApplyBusy
                    ? planCopy.applyingDraft
                    : planCopy.applyDraft}
                </button>
                {!selectedModelConfigured ? (
                  <p
                    id="plan-replan-model-unavailable"
                    className="plan-review-error"
                    role="status"
                  >
                    {planCopy.modelUnavailableHint}
                  </p>
                ) : null}
                {draftReview ? (
                  <div className="plan-replan-review">
                    <span>{planCopy.modelReview}</span>
                    <strong>
                      {planCopy.reviewVerdicts[draftReview.verdict]} /{" "}
                      {planCopy.score} {draftReview.score} / {planCopy.risk}{" "}
                      {planCopy.replanRisks[draftReview.risk]}
                    </strong>
                    <small className="plan-review-hashes">
                      {draftReview.modelContextEnvelope ? (
                        <span>
                          {planCopy.envelope}:{" "}
                          <code
                            title={
                              draftReview.modelContextEnvelope.contentSha256
                            }
                          >
                            {draftReview.modelContextEnvelope.contentSha256.slice(
                              0,
                              12,
                            )}
                          </code>
                        </span>
                      ) : null}
                      <span>
                        {planCopy.receipt}:{" "}
                        <code title={draftReview.reviewSha256}>
                          {draftReview.reviewSha256.slice(0, 12)}
                        </code>
                      </span>
                      <span>
                        {planCopy.response}:{" "}
                        <code title={draftReview.responseSha256}>
                          {draftReview.responseSha256.slice(0, 12)}
                        </code>
                      </span>
                    </small>
                    <p>{draftReview.reason}</p>
                    {draftReview.concerns.length > 0 ? (
                      <ul>
                        {draftReview.concerns.map((concern) => (
                          <li key={concern}>{concern}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                {draftReviewError ? (
                  <p className="plan-review-error">{draftReviewError}</p>
                ) : null}
              </div>
            ) : null}
            <ol className="plan-steps">
              {plan.steps.map((step, index) => {
                const replanRoles = projectReplanStepRoles(
                  step.id,
                  latestReplan,
                );
                return (
                  <li
                    className={`plan-step step-${step.status}${
                      criticalPathSet.has(step.id) ? " on-critical-path" : ""
                    }`}
                    key={step.id}
                  >
                    <div className="step-index">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="step-body">
                      <header>
                        <h4>{step.title}</h4>
                        <div className="plan-entity-status">
                          <span className="plan-status-badge">
                            {planCopy.statuses[step.status]}
                          </span>
                          {replanRoles.length > 0 ? (
                            <div
                              className="plan-replan-entity-badges"
                              aria-label={planCopy.latestReplanImpact}
                            >
                              {replanRoles.map((role) => (
                                <span key={role}>
                                  {planCopy.replanEntityRoles[role]}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </header>
                      <p>{step.description}</p>
                      <dl>
                        <div>
                          <dt>{planCopy.dependsOn}</dt>
                          <dd>
                            {step.dependsOn.length > 0
                              ? step.dependsOn.join(", ")
                              : planCopy.none}
                          </dd>
                        </div>
                        <div>
                          <dt>{planCopy.verification}</dt>
                          <dd>{step.verification}</dd>
                        </div>
                        {step.evidence ? (
                          <div>
                            <dt>{planCopy.evidence}</dt>
                            <dd>{step.evidence}</dd>
                          </div>
                        ) : null}
                        {step.blocker ? (
                          <div>
                            <dt>{planCopy.blocker}</dt>
                            <dd>{step.blocker}</dd>
                          </div>
                        ) : null}
                      </dl>
                      {step.runId ? <code>{step.runId}</code> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </article>

          <PlanArchiveCard
            receipt={archiveReceipt}
            busyAction={archiveBusyAction}
            error={archiveError}
            onExport={() => void exportArchive()}
            onVerify={(file) => void verifyArchiveFile(file)}
          />
        </>
      )}
      <PlanBlueprintCard
        hasPlan={Boolean(plan)}
        canCreate={Boolean(threadId && verifiedBlueprint && !hasOpenPlan)}
        receipt={blueprintReceipt}
        busyAction={blueprintBusyAction}
        error={blueprintError}
        onExport={() => void exportBlueprint()}
        onVerify={(file) => void verifyBlueprintFile(file)}
        onCreate={() => void createFromBlueprint()}
      />
      <PlanBlueprintLibraryCard
        records={blueprintRecords}
        loaded={blueprintLibraryLoaded}
        hasVerifiedBlueprint={Boolean(verifiedBlueprint)}
        canSave={Boolean(threadId && verifiedBlueprint)}
        canSelect={Boolean(threadId)}
        canSignPolicyOverrideRetirementProofBundle={Boolean(
          threadId && firstSigningAnchor(receiptTrustAnchors),
        )}
        canCreateRecord={Boolean(threadId && !hasOpenPlan)}
        busyAction={blueprintLibraryBusyAction}
        receipt={blueprintLibraryReceipt}
        latestOutcomeReview={blueprintLibraryOutcomeReview}
        error={blueprintLibraryError}
        selectedModelConfigured={selectedModelConfigured}
        onRefresh={() => void refreshBlueprintLibrary()}
        onSave={() => void saveBlueprintRecord()}
        onSelect={() => void selectBestBlueprintRecord()}
        onCalibrate={() => void calibrateBlueprintPortfolio()}
        onBacktestPolicy={() => void backtestBlueprintRecommendationPolicies()}
        onApplyPolicyOverride={() =>
          void applyBlueprintRecommendationPolicyOverride()
        }
        onReviewPolicyOverrideDrift={() =>
          void reviewBlueprintRecommendationPolicyOverrideDrift()
        }
        onRetirePolicyOverride={() =>
          void retireBlueprintRecommendationPolicyOverride()
        }
        onAuditPolicyOverrideRetirements={() =>
          void auditBlueprintRecommendationPolicyOverrideRetirements()
        }
        onVerifyPolicyOverrideRetirements={(file) =>
          void verifyBlueprintRecommendationPolicyOverrideRetirementsFile(file)
        }
        onVerifyPolicyOverrideRetirementProofBundle={(files) =>
          void verifyBlueprintRecommendationPolicyOverrideRetirementProofBundleFiles(
            files,
          )
        }
        onSignPolicyOverrideRetirementProofBundle={(files) =>
          void signBlueprintRecommendationPolicyOverrideRetirementProofBundleFiles(
            files,
          )
        }
        onArchive={(record) =>
          void updateBlueprintRecordStatus(record, "archived")
        }
        onRestore={(record) =>
          void updateBlueprintRecordStatus(record, "active")
        }
        onQualify={(record) => void qualifyBlueprintRecord(record)}
        onPreview={(record) => void previewBlueprintRecord(record)}
        onHistory={(record) => void loadBlueprintRecordReplayHistory(record)}
        onVerifyHistory={(file) =>
          void verifyBlueprintRecordReplayHistoryFile(file)
        }
        onOutcomes={(record) => void loadBlueprintRecordReplayOutcomes(record)}
        onVerifyOutcomes={(file) =>
          void verifyBlueprintRecordReplayOutcomesFile(file)
        }
        onPromoteOutcomeBaseline={(record) =>
          void promoteBlueprintRecordOutcomeBaseline(record)
        }
        onPromoteReviewedOutcomeBaseline={(record) =>
          void promoteBlueprintRecordReviewedOutcomeBaseline(record)
        }
        onQualifyOutcomes={(record) =>
          void qualifyBlueprintRecordOutcomes(record)
        }
        onReviewOutcomes={(record) =>
          void reviewBlueprintRecordOutcomes(record)
        }
        onCreate={(record) => void createFromBlueprintRecord(record)}
      />
      {plan ? (
        <>
          <PlanArtifactManifest
            artifacts={plan.artifacts}
            latestReplan={latestReplan}
            state={{
              busyId: artifactBusyId,
              error: artifactError,
              fileDownload: artifactFileDownloadReceipt,
              fileVerification: artifactFileVerification,
              textPreview: artifactPreview,
              dataProfile: artifactDataProfile,
              dataProfileVerification: artifactDataProfileVerification,
              directoryManifest: artifactDirectoryManifest,
              directoryManifestVerification:
                artifactDirectoryManifestVerification,
              driftCheck: artifactDriftCheck,
            }}
            actions={{
              onUpdate: (artifact, action) =>
                void updateArtifact(artifact, action),
              onDownload: (artifact) => void downloadArtifact(artifact),
              onVerifyFile: (artifact, file) =>
                void verifyArtifactFile(artifact, file),
              onPreviewText: (artifact) => void previewArtifact(artifact),
              onCloseTextPreview: () => setArtifactPreview(undefined),
              onProfileData: (artifact) => void previewDataProfile(artifact),
              onDownloadDataProfile: (profile) =>
                downloadJson(profile, artifactDataProfileFilename(profile)),
              onVerifyDataProfile: (artifact, file) =>
                void verifyDataProfileFile(artifact, file),
              onCloseDataProfile: () => {
                setArtifactDataProfile(undefined);
                setArtifactDataProfileVerification(undefined);
              },
              onInspectDirectoryManifest: (artifact) =>
                void previewDirectoryManifest(artifact),
              onDownloadDirectoryManifest: (manifest) =>
                downloadJson(
                  manifest,
                  artifactDirectoryManifestFilename(manifest),
                ),
              onVerifyDirectoryManifest: (artifact, file) =>
                void verifyDirectoryManifestFile(artifact, file),
              onCloseDirectoryManifest: () => {
                setArtifactDirectoryManifest(undefined);
                setArtifactDirectoryManifestVerification(undefined);
              },
              onCheckDrift: (artifact) => void checkArtifactDrift(artifact),
            }}
          />

          <button
            className="plan-continue"
            type="button"
            disabled={!readyStep || running || plan.status !== "active"}
            onClick={onContinue}
          >
            <ChevronRight size={13} aria-hidden="true" />
            {readyStep ? planCopy.next : planCopy.noReady}
          </button>
        </>
      ) : null}
      <p className="guardrail-note">
        <ShieldCheck size={13} aria-hidden="true" />
        {planCopy.safety}
      </p>
    </section>
  );
}

function parseModelKey(value: string): { provider: string; id: string } {
  const separator = value.indexOf("/");
  if (separator < 1 || separator === value.length - 1) {
    return { provider: "napier", id: "demo" };
  }
  return {
    provider: value.slice(0, separator),
    id: value.slice(separator + 1),
  };
}

function PlanBlueprintLibraryCard({
  records,
  loaded,
  hasVerifiedBlueprint,
  canSave,
  canSelect,
  canSignPolicyOverrideRetirementProofBundle,
  canCreateRecord,
  busyAction,
  receipt,
  latestOutcomeReview,
  error,
  selectedModelConfigured,
  onRefresh,
  onSave,
  onSelect,
  onCalibrate,
  onBacktestPolicy,
  onApplyPolicyOverride,
  onReviewPolicyOverrideDrift,
  onRetirePolicyOverride,
  onAuditPolicyOverrideRetirements,
  onVerifyPolicyOverrideRetirements,
  onVerifyPolicyOverrideRetirementProofBundle,
  onSignPolicyOverrideRetirementProofBundle,
  onArchive,
  onRestore,
  onQualify,
  onPreview,
  onHistory,
  onVerifyHistory,
  onOutcomes,
  onVerifyOutcomes,
  onPromoteOutcomeBaseline,
  onPromoteReviewedOutcomeBaseline,
  onQualifyOutcomes,
  onReviewOutcomes,
  onCreate,
}: {
  records: ExecutionPlanBlueprintRecord[];
  loaded: boolean;
  hasVerifiedBlueprint: boolean;
  canSave: boolean;
  canSelect: boolean;
  canSignPolicyOverrideRetirementProofBundle: boolean;
  canCreateRecord: boolean;
  busyAction: PlanBlueprintLibraryBusyAction | undefined;
  receipt: PlanBlueprintLibraryReceipt | undefined;
  latestOutcomeReview: ExecutionPlanBlueprintRecordOutcomeReview | undefined;
  error: string | undefined;
  selectedModelConfigured: boolean;
  onRefresh: () => void;
  onSave: () => void;
  onSelect: () => void;
  onCalibrate: () => void;
  onBacktestPolicy: () => void;
  onApplyPolicyOverride: () => void;
  onReviewPolicyOverrideDrift: () => void;
  onRetirePolicyOverride: () => void;
  onAuditPolicyOverrideRetirements: () => void;
  onVerifyPolicyOverrideRetirements: (file: File) => void;
  onVerifyPolicyOverrideRetirementProofBundle: (files: File[]) => void;
  onSignPolicyOverrideRetirementProofBundle: (files: File[]) => void;
  onArchive: (record: ExecutionPlanBlueprintRecord) => void;
  onRestore: (record: ExecutionPlanBlueprintRecord) => void;
  onQualify: (record: ExecutionPlanBlueprintRecord) => void;
  onPreview: (record: ExecutionPlanBlueprintRecord) => void;
  onHistory: (record: ExecutionPlanBlueprintRecord) => void;
  onVerifyHistory: (file: File) => void;
  onOutcomes: (record: ExecutionPlanBlueprintRecord) => void;
  onVerifyOutcomes: (file: File) => void;
  onPromoteOutcomeBaseline: (record: ExecutionPlanBlueprintRecord) => void;
  onPromoteReviewedOutcomeBaseline: (
    record: ExecutionPlanBlueprintRecord,
  ) => void;
  onQualifyOutcomes: (record: ExecutionPlanBlueprintRecord) => void;
  onReviewOutcomes: (record: ExecutionPlanBlueprintRecord) => void;
  onCreate: (record: ExecutionPlanBlueprintRecord) => void;
}) {
  const recordCounts = blueprintLibraryRecordCounts(records);
  const modelReviewWarningId = "plan-blueprint-model-unavailable";
  return (
    <section
      className="fixture-docket plan-blueprint-library-card"
      aria-labelledby="plan-blueprint-library-title"
    >
      <header>
        <div>
          <span>{planCopy.blueprint.library.eyebrow}</span>
          <h3 id="plan-blueprint-library-title">
            {planCopy.blueprint.library.title}
          </h3>
        </div>
        <BookGlyph />
      </header>
      <p>{planCopy.blueprint.library.body}</p>
      {!selectedModelConfigured ? (
        <p
          id={modelReviewWarningId}
          className="plan-review-error"
          role="status"
        >
          {planCopy.modelUnavailableHint}
        </p>
      ) : null}
      <PlanBlueprintLibraryControls
        recordCount={records.length}
        canSave={canSave}
        canSelect={canSelect}
        canSignPolicyOverrideRetirementProofBundle={
          canSignPolicyOverrideRetirementProofBundle
        }
        busyAction={busyAction}
        receipt={receipt}
        onRefresh={onRefresh}
        onSave={onSave}
        onSelect={onSelect}
        onCalibrate={onCalibrate}
        onBacktestPolicy={onBacktestPolicy}
        onApplyPolicyOverride={onApplyPolicyOverride}
        onReviewPolicyOverrideDrift={onReviewPolicyOverrideDrift}
        onRetirePolicyOverride={onRetirePolicyOverride}
        onAuditPolicyOverrideRetirements={onAuditPolicyOverrideRetirements}
        onVerifyPolicyOverrideRetirements={onVerifyPolicyOverrideRetirements}
        onVerifyPolicyOverrideRetirementProofBundle={
          onVerifyPolicyOverrideRetirementProofBundle
        }
        onSignPolicyOverrideRetirementProofBundle={
          onSignPolicyOverrideRetirementProofBundle
        }
        onVerifyHistory={onVerifyHistory}
        onVerifyOutcomes={onVerifyOutcomes}
      />
      {!hasVerifiedBlueprint ? (
        <small className="blueprint-library-hint">
          {planCopy.blueprint.library.noVerified}
        </small>
      ) : null}
      {loaded ? (
        <div className="blueprint-library-summary">
          <span>
            {records.length.toLocaleString()}{" "}
            {planCopy.blueprint.library.records}
          </span>
          <span>
            {recordCounts.active.toLocaleString()}{" "}
            {planCopy.blueprint.library.active}
          </span>
          <span>
            {recordCounts.archived.toLocaleString()}{" "}
            {planCopy.blueprint.library.archived}
          </span>
        </div>
      ) : null}
      {receipt ? <PlanBlueprintLibraryReceiptView receipt={receipt} /> : null}
      {error ? <p className="plan-review-error">{error}</p> : null}
      <PlanBlueprintRecordList
        records={records}
        loaded={loaded}
        canCreateRecord={canCreateRecord}
        busyAction={busyAction}
        latestOutcomeReview={latestOutcomeReview}
        selectedModelConfigured={selectedModelConfigured}
        modelReviewWarningId={modelReviewWarningId}
        onArchive={onArchive}
        onRestore={onRestore}
        onQualify={onQualify}
        onPreview={onPreview}
        onHistory={onHistory}
        onOutcomes={onOutcomes}
        onPromoteOutcomeBaseline={onPromoteOutcomeBaseline}
        onPromoteReviewedOutcomeBaseline={onPromoteReviewedOutcomeBaseline}
        onQualifyOutcomes={onQualifyOutcomes}
        onReviewOutcomes={onReviewOutcomes}
        onCreate={onCreate}
      />
      <p className="fixture-safety">
        <ShieldCheck size={13} aria-hidden="true" />
        {planCopy.blueprint.library.safety}
      </p>
    </section>
  );
}

function artifactActionEvidence(
  artifact: ArtifactManifestEntry,
  action: "produced" | "verified" | "missing",
): string {
  if (action === "verified" && artifact.status === "verified") {
    return planCopy.artifactActions.evidence.rechecked;
  }
  if (action === "missing" && artifact.status === "verified") {
    return planCopy.artifactActions.evidence.drifted;
  }
  return planCopy.artifactActions.evidence[action];
}

function BookGlyph() {
  return <Download size={14} aria-hidden="true" />;
}

function downloadJson(value: unknown, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
