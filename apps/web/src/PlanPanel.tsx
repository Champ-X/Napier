import { useEffect, useRef, useState } from "react";
import {
  Brain,
  ChevronRight,
  Download,
  KeyRound,
  ShieldCheck,
  Upload,
} from "lucide-react";

import type {
  ArtifactManifestEntry,
  ExecutionPlan,
  ExecutionPlanArchive,
  ExecutionPlanBlueprint,
  ExecutionPlanBlueprintRecord,
  ExecutionPlanBlueprintRecordPreview,
  ExecutionPlanBlueprintRecordQualification,
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
  type PlanArtifactLedgerEventReceipt,
  type PlanArtifactTextPreviewReceipt,
  previewPlanArtifactDirectoryManifest,
  verifyPlanArtifactFile,
  verifyPlanArtifactDataProfile,
  verifyPlanArtifactDirectoryManifest,
} from "./artifact-file-api";
import { formatApiErrorMessage, NapierApiError } from "./api-error";
import {
  artifactDirectoryManifestFilename,
  formatArtifactSizeBytes,
  projectArtifactDriftCheckAction,
  projectArtifactManifestActions,
  projectArtifactManifestEvidence,
} from "./artifact-manifest-view-model";
import {
  artifactDataProfileFilename,
  projectArtifactDataProfileView,
} from "./artifact-data-profile-view-model";
import {
  executionPlanArchiveFilename,
  executionPlanBlueprintFilename,
} from "./plan-archive-artifact-view-model";
import { planCopy } from "./plan-copy";
import {
  PlanArchiveCard,
  type PlanArchiveReceipt,
  PlanBlueprintCard,
  type PlanBlueprintReceipt,
} from "./PlanPortableEvidenceCards";
import {
  planBlueprintCreatedReceipt,
  type PlanBlueprintLibraryCreatedReceipt,
  planBlueprintOutcomeBaselineReceipt,
  type PlanBlueprintLibraryOutcomeBaselineReceipt,
  planBlueprintOutcomeQualificationReceipt,
  type PlanBlueprintLibraryOutcomeQualificationReceipt,
  planBlueprintOutcomeReviewReceipt,
  type PlanBlueprintLibraryOutcomeReviewReceipt,
  planBlueprintPortfolioCalibrationReceipt,
  type PlanBlueprintLibraryPortfolioCalibrationReceipt,
  planBlueprintPreviewReceipt,
  type PlanBlueprintLibraryPreviewReceipt,
  planBlueprintQualificationReceipt,
  type PlanBlueprintLibraryQualificationReceipt,
  planBlueprintReplayHistoryFilename,
  planBlueprintRecommendationPolicyBacktestReceipt,
  type PlanBlueprintLibraryRecommendationPolicyBacktestReceipt,
  planBlueprintRecommendationPolicyOverrideReceipt,
  planBlueprintRecommendationPolicyOverrideDriftReviewReceipt,
  type PlanBlueprintLibraryRecommendationPolicyOverrideDriftReviewReceipt,
  type PlanBlueprintLibraryRecommendationPolicyOverrideReceipt,
  planBlueprintRecommendationPolicyOverrideRetirementHistoryReceipt,
  planBlueprintRecommendationPolicyOverrideRetirementProofBundleReceipt,
  planBlueprintRecommendationPolicyOverrideRetirementProofBundleSignedReceipt,
  planBlueprintRecommendationPolicyOverrideRetirementHistoryVerificationReceipt,
  type PlanBlueprintLibraryRecommendationPolicyOverrideRetirementHistoryReceipt,
  type PlanBlueprintLibraryRecommendationPolicyOverrideRetirementProofBundleReceipt,
  type PlanBlueprintLibraryRecommendationPolicyOverrideRetirementProofBundleSignedReceipt,
  type PlanBlueprintLibraryRecommendationPolicyOverrideRetirementHistoryVerificationReceipt,
  planBlueprintRecommendationPolicyOverrideRetirementReceipt,
  planBlueprintReplayOutcomesFilename,
  type PlanBlueprintLibraryRecommendationPolicyOverrideRetirementReceipt,
  planBlueprintReplayHistoryReceipt,
  type PlanBlueprintLibraryReplayHistoryReceipt,
  planBlueprintReplayHistoryVerificationReceipt,
  type PlanBlueprintLibraryReplayHistoryVerificationReceipt,
  planBlueprintReplayOutcomesReceipt,
  type PlanBlueprintLibraryReplayOutcomesReceipt,
  planBlueprintReplayOutcomesVerificationReceipt,
  type PlanBlueprintLibraryReplayOutcomesVerificationReceipt,
  planBlueprintSelectionReceipt,
  type PlanBlueprintLibrarySelectionReceipt,
} from "./plan-blueprint-library-view-model";
import { listReceiptTrustAnchors } from "./receipt-trust-api";
import {
  projectReplanArtifactRoles,
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

type PlanBlueprintLibraryBusyAction =
  | "load"
  | "save"
  | "status"
  | "create"
  | "qualify"
  | "preview"
  | "history"
  | "verifyHistory"
  | "outcomes"
  | "verifyOutcomes"
  | "promoteOutcomeBaseline"
  | "promoteReviewedOutcomeBaseline"
  | "qualifyOutcomes"
  | "reviewOutcomes"
  | "calibratePortfolio"
  | "backtestPolicy"
  | "applyPolicyOverride"
  | "reviewPolicyOverrideDrift"
  | "retirePolicyOverride"
  | "auditPolicyOverrideRetirements"
  | "verifyPolicyOverrideRetirements"
  | "verifyPolicyOverrideRetirementProofBundle"
  | "signPolicyOverrideRetirementProofBundle"
  | "select";

type PlanBlueprintLibraryReceipt =
  | {
      action: "saved" | "reused" | "archived" | "restored";
      recordId: string;
      blueprintSha256: string;
      status: ExecutionPlanBlueprintRecord["status"];
      stepCount: number;
      artifactCount: number;
    }
  | PlanBlueprintLibraryCreatedReceipt
  | PlanBlueprintLibraryQualificationReceipt
  | PlanBlueprintLibraryPreviewReceipt
  | PlanBlueprintLibraryReplayHistoryReceipt
  | PlanBlueprintLibraryReplayHistoryVerificationReceipt
  | PlanBlueprintLibraryReplayOutcomesReceipt
  | PlanBlueprintLibraryReplayOutcomesVerificationReceipt
  | PlanBlueprintLibraryOutcomeBaselineReceipt
  | PlanBlueprintLibraryOutcomeQualificationReceipt
  | PlanBlueprintLibraryOutcomeReviewReceipt
  | PlanBlueprintLibraryPortfolioCalibrationReceipt
  | PlanBlueprintLibraryRecommendationPolicyBacktestReceipt
  | PlanBlueprintLibraryRecommendationPolicyOverrideReceipt
  | PlanBlueprintLibraryRecommendationPolicyOverrideDriftReviewReceipt
  | PlanBlueprintLibraryRecommendationPolicyOverrideRetirementReceipt
  | PlanBlueprintLibraryRecommendationPolicyOverrideRetirementHistoryReceipt
  | PlanBlueprintLibraryRecommendationPolicyOverrideRetirementHistoryVerificationReceipt
  | PlanBlueprintLibraryRecommendationPolicyOverrideRetirementProofBundleReceipt
  | PlanBlueprintLibraryRecommendationPolicyOverrideRetirementProofBundleSignedReceipt
  | PlanBlueprintLibrarySelectionReceipt;

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
    useState<
      PlanArtifactLedgerEventReceipt & {
        artifactId: string;
        filename: string;
        sha256: string;
        sizeBytes: number;
      }
    >();
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
          {plan.artifacts.length > 0 ? (
            <section
              className="artifact-manifest"
              aria-labelledby="artifact-manifest-title"
              aria-busy={Boolean(artifactBusyId)}
            >
              <header>
                <h3 id="artifact-manifest-title">{planCopy.artifacts}</h3>
                <span>{String(plan.artifacts.length).padStart(2, "0")}</span>
              </header>
              {plan.artifacts.map((artifact) => {
                const evidence = projectArtifactManifestEvidence(artifact);
                const actions = projectArtifactManifestActions(artifact);
                const replanRoles = projectReplanArtifactRoles(
                  artifact.id,
                  latestReplan,
                );
                const verifyLabel =
                  actions.verifyMode === "recheck"
                    ? planCopy.artifactActions.recheck
                    : planCopy.artifactActions.verify;
                const verifyingLabel =
                  actions.verifyMode === "recheck"
                    ? planCopy.artifactActions.rechecking
                    : planCopy.artifactActions.verifying;
                const driftCheckAction = projectArtifactDriftCheckAction(
                  artifact,
                  artifactDriftCheck,
                );
                const dataProfileView =
                  artifactDataProfile?.artifactId === artifact.id
                    ? projectArtifactDataProfileView(artifactDataProfile)
                    : undefined;
                const dataProfileVerification =
                  artifactDataProfileVerification?.artifactId === artifact.id
                    ? artifactDataProfileVerification
                    : undefined;
                const missingLabel =
                  actions.missingMode === "drifted"
                    ? planCopy.artifactActions.markDrifted
                    : planCopy.artifactActions.markMissing;
                const markingMissingLabel =
                  actions.missingMode === "drifted"
                    ? planCopy.artifactActions.markingDrifted
                    : planCopy.artifactActions.markingMissing;
                return (
                  <article key={artifact.id}>
                    <header>
                      <code>{artifact.path}</code>
                      <div className="plan-entity-status">
                        <span className="plan-status-badge">
                          {planCopy.statuses[artifact.status]}
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
                    <p>{artifact.description}</p>
                    {artifact.evidence ? (
                      <small>{artifact.evidence}</small>
                    ) : null}
                    {evidence.hasEvidence ? (
                      <dl>
                        {evidence.digestShort && evidence.digestFull ? (
                          <div>
                            <dt>{planCopy.digest}</dt>
                            <dd>
                              <code title={evidence.digestFull}>
                                {evidence.digestShort}
                              </code>
                            </dd>
                          </div>
                        ) : null}
                        {evidence.sizeBytesLabel ? (
                          <div>
                            <dt>{planCopy.size}</dt>
                            <dd>{evidence.sizeBytesLabel}</dd>
                          </div>
                        ) : null}
                        {artifact.sourceRunId ? (
                          <div>
                            <dt>{planCopy.source}</dt>
                            <dd>
                              <code>{shortId(artifact.sourceRunId)}</code>
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    ) : null}
                    {actions.hasActions ? (
                      <div className="artifact-actions">
                        {actions.canProduce ? (
                          <button
                            type="button"
                            aria-label={`${planCopy.artifactActions.produce}: ${artifact.path}`}
                            disabled={Boolean(artifactBusyId)}
                            onClick={() =>
                              void updateArtifact(artifact, "produced")
                            }
                          >
                            {artifactBusyId === `${artifact.id}:produced`
                              ? planCopy.artifactActions.producing
                              : planCopy.artifactActions.produce}
                          </button>
                        ) : null}
                        {actions.canPreview ? (
                          <button
                            type="button"
                            aria-label={`${planCopy.artifactActions.preview}: ${artifact.path}`}
                            disabled={Boolean(artifactBusyId)}
                            onClick={() => void previewArtifact(artifact)}
                          >
                            {artifactBusyId === `${artifact.id}:preview`
                              ? planCopy.artifactActions.previewing
                              : planCopy.artifactActions.preview}
                          </button>
                        ) : null}
                        {actions.canProfileData ? (
                          <button
                            type="button"
                            aria-label={`${planCopy.artifactActions.dataProfile}: ${artifact.path}`}
                            disabled={Boolean(artifactBusyId)}
                            onClick={() => void previewDataProfile(artifact)}
                          >
                            {artifactBusyId === `${artifact.id}:data`
                              ? planCopy.artifactActions.dataProfiling
                              : planCopy.artifactActions.dataProfile}
                          </button>
                        ) : null}
                        {actions.canInspectManifest ? (
                          <button
                            type="button"
                            aria-label={`${planCopy.artifactActions.manifest}: ${artifact.path}`}
                            disabled={Boolean(artifactBusyId)}
                            onClick={() =>
                              void previewDirectoryManifest(artifact)
                            }
                          >
                            {artifactBusyId === `${artifact.id}:manifest`
                              ? planCopy.artifactActions.manifesting
                              : planCopy.artifactActions.manifest}
                          </button>
                        ) : null}
                        {actions.canDownload ? (
                          <button
                            type="button"
                            aria-label={`${planCopy.artifactActions.download}: ${artifact.path}`}
                            disabled={Boolean(artifactBusyId)}
                            onClick={() => void downloadArtifact(artifact)}
                          >
                            {artifactBusyId === `${artifact.id}:download`
                              ? planCopy.artifactActions.downloading
                              : planCopy.artifactActions.download}
                          </button>
                        ) : null}
                        {actions.canVerifyFileArchive ? (
                          <label
                            className="artifact-profile-file-action"
                            aria-disabled={Boolean(artifactBusyId)}
                          >
                            {artifactBusyId === `${artifact.id}:file-verify`
                              ? planCopy.artifactActions.verifyingFile
                              : planCopy.artifactActions.verifyFile}
                            <input
                              className="fixture-file-input"
                              type="file"
                              disabled={Boolean(artifactBusyId)}
                              aria-label={planCopy.artifactActions.verifyFile}
                              onChange={(event) => {
                                const file = event.currentTarget.files?.[0];
                                event.currentTarget.value = "";
                                if (file) {
                                  void verifyArtifactFile(artifact, file);
                                }
                              }}
                            />
                          </label>
                        ) : null}
                        {actions.canVerify ? (
                          <button
                            type="button"
                            aria-label={`${verifyLabel}: ${artifact.path}`}
                            disabled={Boolean(artifactBusyId)}
                            onClick={() =>
                              void updateArtifact(artifact, "verified")
                            }
                          >
                            {artifactBusyId === `${artifact.id}:verified`
                              ? verifyingLabel
                              : verifyLabel}
                          </button>
                        ) : null}
                        {actions.canCheckDrift ? (
                          <button
                            type="button"
                            aria-label={`${planCopy.artifactActions.checkDrift}: ${artifact.path}`}
                            disabled={Boolean(artifactBusyId)}
                            onClick={() => void checkArtifactDrift(artifact)}
                          >
                            {artifactBusyId === `${artifact.id}:drift-check`
                              ? planCopy.artifactActions.checkingDrift
                              : planCopy.artifactActions.checkDrift}
                          </button>
                        ) : null}
                        {actions.canMarkMissing ? (
                          <button
                            type="button"
                            aria-label={`${missingLabel}: ${artifact.path}`}
                            disabled={Boolean(artifactBusyId)}
                            onClick={() =>
                              void updateArtifact(artifact, "missing")
                            }
                          >
                            {artifactBusyId === `${artifact.id}:missing`
                              ? markingMissingLabel
                              : missingLabel}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {artifactFileDownloadReceipt?.artifactId === artifact.id ? (
                      <div
                        className="artifact-data-profile-verification status-valid"
                        role="status"
                      >
                        <strong>{planCopy.artifactActions.download}</strong>
                        <small>
                          {planCopy.digest}:{" "}
                          <code title={artifactFileDownloadReceipt.sha256}>
                            {artifactFileDownloadReceipt.sha256.slice(0, 16)}
                          </code>
                          {" / "}
                          {planCopy.size}:{" "}
                          {formatArtifactSizeBytes(
                            artifactFileDownloadReceipt.sizeBytes,
                          )}
                          {" / "}
                          {artifactFileDownloadReceipt.filename}
                        </small>
                        <PlanArtifactLedgerReceiptLine
                          receipt={artifactFileDownloadReceipt}
                        />
                      </div>
                    ) : null}
                    {artifactFileVerification?.artifactId === artifact.id ? (
                      <div
                        className={`artifact-data-profile-verification status-${artifactFileVerification.verificationStatus}`}
                        role="status"
                      >
                        <strong>
                          {
                            planCopy.artifactActions.fileVerificationStatuses[
                              artifactFileVerification.verificationStatus
                            ]
                          }
                        </strong>
                        <small>
                          {planCopy.expected}:{" "}
                          <code title={artifactFileVerification.expectedSha256}>
                            {artifactFileVerification.expectedSha256.slice(
                              0,
                              16,
                            )}
                          </code>
                          {" / "}
                          {planCopy.observed}:{" "}
                          <code title={artifactFileVerification.observedSha256}>
                            {artifactFileVerification.observedSha256.slice(
                              0,
                              16,
                            )}
                          </code>
                        </small>
                        <small>
                          {planCopy.size}:{" "}
                          {formatArtifactSizeBytes(
                            artifactFileVerification.expectedSizeBytes,
                          )}
                          {" -> "}
                          {formatArtifactSizeBytes(
                            artifactFileVerification.observedSizeBytes,
                          )}
                        </small>
                        <PlanArtifactLedgerReceiptLine
                          receipt={artifactFileVerification}
                        />
                        {artifactFileVerification.diagnostics.length > 0 ? (
                          <small>
                            {artifactFileVerification.diagnostics.join(", ")}
                          </small>
                        ) : null}
                      </div>
                    ) : null}
                    {artifactPreview?.artifactId === artifact.id ? (
                      <div
                        className="artifact-preview"
                        role="region"
                        aria-label={planCopy.artifactActions.previewTitle}
                      >
                        <header>
                          <strong>
                            {planCopy.artifactActions.previewTitle}
                          </strong>
                          <button
                            type="button"
                            aria-label={planCopy.artifactActions.closePreview}
                            onClick={() => setArtifactPreview(undefined)}
                          >
                            {planCopy.artifactActions.closePreview}
                          </button>
                        </header>
                        <small>
                          {planCopy.digest}:{" "}
                          <code title={artifactPreview.textSha256}>
                            {artifactPreview.textSha256.slice(0, 16)}
                          </code>
                          {" / "}
                          {planCopy.size}:{" "}
                          {formatArtifactSizeBytes(artifactPreview.sizeBytes)}
                          {" / "}
                          {planCopy.lineCount}: {artifactPreview.lineCount}
                        </small>
                        <PlanArtifactLedgerReceiptLine
                          receipt={artifactPreview}
                        />
                        <pre>{artifactPreview.text}</pre>
                      </div>
                    ) : null}
                    {artifactDataProfile?.artifactId === artifact.id &&
                    dataProfileView ? (
                      <div
                        className="artifact-preview artifact-data-profile"
                        role="region"
                        aria-label={planCopy.artifactActions.dataProfileTitle}
                      >
                        <header>
                          <strong>
                            {planCopy.artifactActions.dataProfileTitle}
                          </strong>
                          <button
                            type="button"
                            aria-label={
                              planCopy.artifactActions.downloadDataProfile
                            }
                            onClick={() =>
                              downloadJson(
                                artifactDataProfile,
                                artifactDataProfileFilename(
                                  artifactDataProfile,
                                ),
                              )
                            }
                          >
                            {planCopy.artifactActions.downloadDataProfile}
                          </button>
                          <label
                            className="artifact-profile-file-action"
                            aria-disabled={Boolean(artifactBusyId)}
                          >
                            {artifactBusyId === `${artifact.id}:data-verify`
                              ? planCopy.artifactActions.verifyingDataProfile
                              : planCopy.artifactActions.verifyDataProfile}
                            <input
                              className="fixture-file-input"
                              type="file"
                              accept="application/json,.json"
                              disabled={Boolean(artifactBusyId)}
                              aria-label={
                                planCopy.artifactActions.verifyDataProfile
                              }
                              onChange={(event) => {
                                const file = event.currentTarget.files?.[0];
                                event.currentTarget.value = "";
                                if (file) {
                                  void verifyDataProfileFile(artifact, file);
                                }
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            aria-label={planCopy.artifactActions.closePreview}
                            onClick={() => {
                              setArtifactDataProfile(undefined);
                              setArtifactDataProfileVerification(undefined);
                            }}
                          >
                            {planCopy.artifactActions.closePreview}
                          </button>
                        </header>
                        <small>
                          {planCopy.artifactActions.dataFormat}:{" "}
                          {dataProfileView.formatLabel}
                          {" / "}
                          {planCopy.artifactActions.rows}:{" "}
                          {artifactDataProfile.rowCount}
                          {" / "}
                          {planCopy.artifactActions.columns}:{" "}
                          {artifactDataProfile.columnCount}
                          {" / "}
                          {planCopy.artifactActions.truncated}:{" "}
                          {String(artifactDataProfile.truncated)}
                        </small>
                        <small>
                          {planCopy.artifactActions.columnSet}:{" "}
                          <code title={artifactDataProfile.columnSetSha256}>
                            {dataProfileView.columnSetShortSha256}
                          </code>
                          {" / "}
                          {planCopy.artifactActions.sample}:{" "}
                          <code title={artifactDataProfile.sampleSha256}>
                            {dataProfileView.sampleShortSha256}
                          </code>
                        </small>
                        <PlanArtifactLedgerReceiptLine
                          receipt={artifactDataProfile}
                        />
                        {dataProfileVerification ? (
                          <div
                            className={`artifact-data-profile-verification status-${dataProfileVerification.verificationStatus}`}
                          >
                            <strong>
                              {
                                planCopy.artifactActions
                                  .dataProfileVerificationStatuses[
                                  dataProfileVerification.verificationStatus
                                ]
                              }
                            </strong>
                            <small>
                              {planCopy.artifactActions.observed}:{" "}
                              <code
                                title={dataProfileVerification.observedSha256}
                              >
                                {dataProfileVerification.observedSha256.slice(
                                  0,
                                  16,
                                )}
                              </code>
                              {" / "}
                              {planCopy.artifactActions.sample}:{" "}
                              <code
                                title={
                                  dataProfileVerification.observedSampleSha256
                                }
                              >
                                {dataProfileVerification.observedSampleSha256.slice(
                                  0,
                                  16,
                                )}
                              </code>
                            </small>
                            <PlanArtifactLedgerReceiptLine
                              receipt={dataProfileVerification}
                            />
                            {dataProfileVerification.diagnostics.length > 0 ? (
                              <small>
                                {dataProfileVerification.diagnostics.join(", ")}
                              </small>
                            ) : null}
                          </div>
                        ) : null}
                        {dataProfileView.hasColumns ? (
                          <div className="artifact-data-table">
                            <table>
                              <caption>
                                {planCopy.artifactActions.sampleRowsCaption}
                              </caption>
                              <thead>
                                <tr>
                                  {dataProfileView.columns.map((column) => (
                                    <th
                                      key={column.id}
                                      scope="col"
                                      title={column.label}
                                    >
                                      {column.label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {dataProfileView.hasSampleRows ? (
                                  dataProfileView.rows.map((row) => (
                                    <tr key={row.id}>
                                      {row.cells.map((cell) => (
                                        <td key={cell.id} title={cell.value}>
                                          {cell.value}
                                        </td>
                                      ))}
                                    </tr>
                                  ))
                                ) : (
                                  <tr>
                                    <td
                                      className="artifact-data-table-empty"
                                      colSpan={dataProfileView.columns.length}
                                    >
                                      {planCopy.artifactActions.noRows}
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <small>{planCopy.artifactActions.noRows}</small>
                        )}
                      </div>
                    ) : null}
                    {artifactDirectoryManifest?.artifactId === artifact.id ? (
                      <div
                        className="artifact-preview artifact-directory-manifest"
                        role="region"
                        aria-label={planCopy.artifactActions.manifestTitle}
                      >
                        <header>
                          <strong>
                            {planCopy.artifactActions.manifestTitle}
                          </strong>
                          <button
                            type="button"
                            aria-label={
                              planCopy.artifactActions.downloadManifest
                            }
                            onClick={() =>
                              downloadJson(
                                artifactDirectoryManifest,
                                artifactDirectoryManifestFilename(
                                  artifactDirectoryManifest,
                                ),
                              )
                            }
                          >
                            {planCopy.artifactActions.downloadManifest}
                          </button>
                          <label
                            className="artifact-profile-file-action"
                            aria-disabled={Boolean(artifactBusyId)}
                          >
                            {artifactBusyId === `${artifact.id}:manifest-verify`
                              ? planCopy.artifactActions.verifyingManifest
                              : planCopy.artifactActions.verifyManifest}
                            <input
                              className="fixture-file-input"
                              type="file"
                              accept="application/json,.json"
                              disabled={Boolean(artifactBusyId)}
                              aria-label={
                                planCopy.artifactActions.verifyManifest
                              }
                              onChange={(event) => {
                                const file = event.currentTarget.files?.[0];
                                event.currentTarget.value = "";
                                if (file) {
                                  void verifyDirectoryManifestFile(
                                    artifact,
                                    file,
                                  );
                                }
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            aria-label={planCopy.artifactActions.closePreview}
                            onClick={() => {
                              setArtifactDirectoryManifest(undefined);
                              setArtifactDirectoryManifestVerification(
                                undefined,
                              );
                            }}
                          >
                            {planCopy.artifactActions.closePreview}
                          </button>
                        </header>
                        <small>
                          {planCopy.digest}:{" "}
                          <code title={artifactDirectoryManifest.sha256}>
                            {artifactDirectoryManifest.sha256.slice(0, 16)}
                          </code>
                          {" / "}
                          {planCopy.size}:{" "}
                          {formatArtifactSizeBytes(
                            artifactDirectoryManifest.sizeBytes,
                          )}
                          {" / "}
                          {planCopy.artifactActions.entries}:{" "}
                          {artifactDirectoryManifest.entryCount.toLocaleString()}
                          {" / "}
                          {planCopy.artifactActions.files}:{" "}
                          {artifactDirectoryManifest.fileCount.toLocaleString()}
                          {" / "}
                          {planCopy.artifactActions.directories}:{" "}
                          {artifactDirectoryManifest.directoryCount.toLocaleString()}
                        </small>
                        <PlanArtifactLedgerReceiptLine
                          receipt={artifactDirectoryManifest}
                        />
                        {artifactDirectoryManifestVerification?.artifactId ===
                        artifact.id ? (
                          <div
                            className={`artifact-data-profile-verification status-${artifactDirectoryManifestVerification.verificationStatus}`}
                          >
                            <strong>
                              {
                                planCopy.artifactActions
                                  .manifestVerificationStatuses[
                                  artifactDirectoryManifestVerification
                                    .verificationStatus
                                ]
                              }
                            </strong>
                            <small>
                              {planCopy.artifactActions.observed}:{" "}
                              <code
                                title={
                                  artifactDirectoryManifestVerification.observedSha256
                                }
                              >
                                {artifactDirectoryManifestVerification.observedSha256.slice(
                                  0,
                                  16,
                                )}
                              </code>
                              {" / "}
                              {planCopy.artifactActions.entries}:{" "}
                              <code
                                title={
                                  artifactDirectoryManifestVerification.observedEntrySetSha256
                                }
                              >
                                {artifactDirectoryManifestVerification.observedEntrySetSha256.slice(
                                  0,
                                  16,
                                )}
                              </code>
                            </small>
                            <PlanArtifactLedgerReceiptLine
                              receipt={artifactDirectoryManifestVerification}
                            />
                            {artifactDirectoryManifestVerification.diagnostics
                              .length > 0 ? (
                              <small>
                                {artifactDirectoryManifestVerification.diagnostics.join(
                                  ", ",
                                )}
                              </small>
                            ) : null}
                          </div>
                        ) : null}
                        <ol>
                          {artifactDirectoryManifest.entries.map((entry) => (
                            <li key={`${entry.kind}:${entry.path}`}>
                              <code>{entry.path}</code>
                              <span>{entry.kind}</span>
                              {entry.sha256 ? (
                                <code title={entry.sha256}>
                                  {entry.sha256.slice(0, 16)}
                                </code>
                              ) : null}
                              {entry.sizeBytes !== undefined ? (
                                <span>
                                  {formatArtifactSizeBytes(entry.sizeBytes)}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : null}
                    {artifactDriftCheck?.artifactId === artifact.id ? (
                      <div
                        className={`artifact-drift-check artifact-drift-check--${artifactDriftCheck.result}`}
                        role="status"
                      >
                        <strong>
                          {planCopy.artifactActions.driftCheckTitle}
                        </strong>
                        <span>
                          {
                            planCopy.artifactActions.driftResults[
                              artifactDriftCheck.result
                            ]
                          }
                        </span>
                        <small>
                          {planCopy.expected}:{" "}
                          <code title={artifactDriftCheck.expectedSha256}>
                            {artifactDriftCheck.expectedSha256.slice(0, 16)}
                          </code>
                          {artifactDriftCheck.observedSha256 ? (
                            <>
                              {" / "}
                              {planCopy.observed}:{" "}
                              <code title={artifactDriftCheck.observedSha256}>
                                {artifactDriftCheck.observedSha256.slice(0, 16)}
                              </code>
                            </>
                          ) : null}
                          {artifactDriftCheck.sizeBytes !== undefined ? (
                            <>
                              {" / "}
                              {planCopy.size}:{" "}
                              {formatArtifactSizeBytes(
                                artifactDriftCheck.sizeBytes,
                              )}
                            </>
                          ) : null}
                        </small>
                        <PlanArtifactLedgerReceiptLine
                          receipt={artifactDriftCheck}
                        />
                        {driftCheckAction.hasAction ? (
                          <div className="artifact-drift-check__actions">
                            <button
                              type="button"
                              aria-label={`${
                                driftCheckAction.canRecheck
                                  ? verifyLabel
                                  : missingLabel
                              }: ${artifact.path}`}
                              disabled={Boolean(artifactBusyId)}
                              onClick={() =>
                                void updateArtifact(
                                  artifact,
                                  driftCheckAction.nextAction ?? "missing",
                                )
                              }
                            >
                              {artifactBusyId ===
                              `${artifact.id}:${driftCheckAction.nextAction}`
                                ? driftCheckAction.canRecheck
                                  ? verifyingLabel
                                  : markingMissingLabel
                                : driftCheckAction.canRecheck
                                  ? verifyLabel
                                  : missingLabel}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
              {artifactError ? (
                <p className="artifact-error" role="alert">
                  {artifactError}
                </p>
              ) : null}
            </section>
          ) : null}

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

function shortId(value: string): string {
  return value.length > 15
    ? `${value.slice(0, 7)}...${value.slice(-5)}`
    : value;
}

function PlanArtifactLedgerReceiptLine({
  receipt,
}: {
  receipt: PlanArtifactLedgerEventReceipt;
}) {
  return (
    <small>
      {planCopy.receipt}:{" "}
      <code title={receipt.ledgerEventId}>
        #{String(receipt.ledgerEventSeq).padStart(3, "0")}
      </code>
      {" / "}
      <code title={receipt.ledgerEventSha256}>
        {receipt.ledgerEventSha256.slice(0, 16)}
      </code>
    </small>
  );
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
  const historyInput = useRef<HTMLInputElement>(null);
  const outcomesInput = useRef<HTMLInputElement>(null);
  const policyOverrideRetirementsInput = useRef<HTMLInputElement>(null);
  const policyOverrideRetirementProofBundleInput =
    useRef<HTMLInputElement>(null);
  const policyOverrideRetirementProofBundleSignInput =
    useRef<HTMLInputElement>(null);
  const busy = Boolean(busyAction);
  const activeCount = records.filter(
    (record) => record.status === "active",
  ).length;
  const modelReviewWarningId = "plan-blueprint-model-unavailable";
  const archivedCount = records.length - activeCount;
  const canApplyPolicyOverride =
    receipt?.action === "policyBacktested" &&
    Boolean(receipt.topSelectedFamilySha256);
  const canRetirePolicyOverride =
    receipt?.action === "policyOverrideDriftReviewed" &&
    receipt.reviewedRecommendation === "retire" &&
    Boolean(receipt.reviewedFamilySha256 && receipt.reviewedOverrideSha256);
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
      <div className="fixture-actions">
        <button type="button" disabled={busy} onClick={onRefresh}>
          <Download size={12} aria-hidden="true" />
          {busyAction === "load"
            ? planCopy.blueprint.library.refreshing
            : planCopy.blueprint.library.refresh}
        </button>
        <button
          className="fixture-verify"
          type="button"
          disabled={busy || !canSelect || records.length === 0}
          onClick={onSelect}
        >
          <ShieldCheck size={12} aria-hidden="true" />
          {busyAction === "select"
            ? planCopy.blueprint.library.selecting
            : planCopy.blueprint.library.select}
        </button>
        <button type="button" disabled={busy} onClick={onCalibrate}>
          <ShieldCheck size={12} aria-hidden="true" />
          {busyAction === "calibratePortfolio"
            ? planCopy.blueprint.library.calibrating
            : planCopy.blueprint.library.calibrate}
        </button>
        <button type="button" disabled={busy} onClick={onBacktestPolicy}>
          <ShieldCheck size={12} aria-hidden="true" />
          {busyAction === "backtestPolicy"
            ? planCopy.blueprint.library.backtestingPolicy
            : planCopy.blueprint.library.backtestPolicy}
        </button>
        <button
          type="button"
          disabled={busy || !canApplyPolicyOverride}
          onClick={onApplyPolicyOverride}
        >
          <ShieldCheck size={12} aria-hidden="true" />
          {busyAction === "applyPolicyOverride"
            ? planCopy.blueprint.library.applyingPolicyOverride
            : planCopy.blueprint.library.applyPolicyOverride}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onReviewPolicyOverrideDrift}
        >
          <ShieldCheck size={12} aria-hidden="true" />
          {busyAction === "reviewPolicyOverrideDrift"
            ? planCopy.blueprint.library.reviewingPolicyOverrideDrift
            : planCopy.blueprint.library.reviewPolicyOverrideDrift}
        </button>
        <button
          type="button"
          disabled={busy || !canRetirePolicyOverride}
          onClick={onRetirePolicyOverride}
        >
          <ShieldCheck size={12} aria-hidden="true" />
          {busyAction === "retirePolicyOverride"
            ? planCopy.blueprint.library.retiringPolicyOverride
            : planCopy.blueprint.library.retirePolicyOverride}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onAuditPolicyOverrideRetirements}
        >
          <ShieldCheck size={12} aria-hidden="true" />
          {busyAction === "auditPolicyOverrideRetirements"
            ? planCopy.blueprint.library.auditingPolicyOverrideRetirements
            : planCopy.blueprint.library.auditPolicyOverrideRetirements}
        </button>
        <button
          className="fixture-verify"
          type="button"
          disabled={busy}
          onClick={() => policyOverrideRetirementsInput.current?.click()}
        >
          <Upload size={12} aria-hidden="true" />
          {busyAction === "verifyPolicyOverrideRetirements"
            ? planCopy.blueprint.library.verifyingPolicyOverrideRetirements
            : planCopy.blueprint.library.verifyPolicyOverrideRetirements}
        </button>
        <button
          className="fixture-verify"
          type="button"
          disabled={busy}
          onClick={() =>
            policyOverrideRetirementProofBundleInput.current?.click()
          }
        >
          <Upload size={12} aria-hidden="true" />
          {busyAction === "verifyPolicyOverrideRetirementProofBundle"
            ? planCopy.blueprint.library
                .verifyingPolicyOverrideRetirementProofBundle
            : planCopy.blueprint.library
                .verifyPolicyOverrideRetirementProofBundle}
        </button>
        <button
          className="fixture-verify"
          type="button"
          disabled={busy}
          title={
            canSignPolicyOverrideRetirementProofBundle
              ? planCopy.blueprint.library
                  .signPolicyOverrideRetirementProofBundle
              : planCopy.blueprint.library.errors
                  .policyOverrideProofBundleNoSigner
          }
          onClick={() =>
            policyOverrideRetirementProofBundleSignInput.current?.click()
          }
        >
          <KeyRound size={12} aria-hidden="true" />
          {busyAction === "signPolicyOverrideRetirementProofBundle"
            ? planCopy.blueprint.library
                .signingPolicyOverrideRetirementProofBundle
            : planCopy.blueprint.library
                .signPolicyOverrideRetirementProofBundle}
        </button>
        <button
          className="fixture-verify"
          type="button"
          disabled={busy}
          onClick={() => historyInput.current?.click()}
        >
          <Upload size={12} aria-hidden="true" />
          {busyAction === "verifyHistory"
            ? planCopy.blueprint.library.verifyingHistory
            : planCopy.blueprint.library.verifyHistory}
        </button>
        <button
          className="fixture-import"
          type="button"
          disabled={busy || !canSave}
          onClick={onSave}
        >
          <Upload size={12} aria-hidden="true" />
          {busyAction === "save"
            ? planCopy.blueprint.library.saving
            : planCopy.blueprint.library.save}
        </button>
        <button
          className="fixture-verify"
          type="button"
          disabled={busy}
          onClick={() => outcomesInput.current?.click()}
        >
          <Upload size={12} aria-hidden="true" />
          {busyAction === "verifyOutcomes"
            ? planCopy.blueprint.library.verifyingOutcomes
            : planCopy.blueprint.library.verifyOutcomes}
        </button>
        <input
          ref={historyInput}
          className="fixture-file-input"
          type="file"
          accept="application/json,.json"
          aria-label={planCopy.blueprint.library.verifyHistory}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onVerifyHistory(file);
          }}
        />
        <input
          ref={policyOverrideRetirementsInput}
          className="fixture-file-input"
          type="file"
          accept="application/json,.json"
          aria-label={
            planCopy.blueprint.library.verifyPolicyOverrideRetirements
          }
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onVerifyPolicyOverrideRetirements(file);
          }}
        />
        <input
          ref={policyOverrideRetirementProofBundleInput}
          className="fixture-file-input"
          type="file"
          accept="application/json,.json"
          multiple
          aria-label={
            planCopy.blueprint.library.verifyPolicyOverrideRetirementProofBundle
          }
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            if (files.length > 0) {
              onVerifyPolicyOverrideRetirementProofBundle(files);
            }
          }}
        />
        <input
          ref={policyOverrideRetirementProofBundleSignInput}
          className="fixture-file-input"
          type="file"
          accept="application/json,.json"
          multiple
          aria-label={
            planCopy.blueprint.library.signPolicyOverrideRetirementProofBundle
          }
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            if (files.length > 0) {
              onSignPolicyOverrideRetirementProofBundle(files);
            }
          }}
        />
        <input
          ref={outcomesInput}
          className="fixture-file-input"
          type="file"
          accept="application/json,.json"
          aria-label={planCopy.blueprint.library.verifyOutcomes}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onVerifyOutcomes(file);
          }}
        />
      </div>
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
            {activeCount.toLocaleString()} {planCopy.blueprint.library.active}
          </span>
          <span>
            {archivedCount.toLocaleString()}{" "}
            {planCopy.blueprint.library.archived}
          </span>
        </div>
      ) : null}
      {receipt ? <PlanBlueprintLibraryReceiptView receipt={receipt} /> : null}
      {error ? <p className="plan-review-error">{error}</p> : null}
      {loaded && records.length === 0 ? (
        <p className="blueprint-library-empty">
          {planCopy.blueprint.library.empty}
        </p>
      ) : null}
      {records.length > 0 ? (
        <div className="blueprint-record-list">
          {records.map((record) => (
            <article
              key={record.id}
              className={`blueprint-record blueprint-record-${record.status}`}
            >
              <header>
                <div>
                  <strong>{record.name}</strong>
                  <span>
                    {planCopy.blueprint.library.statuses[record.status]}
                  </span>
                </div>
                <code>{record.blueprintSha256.slice(0, 16)}</code>
              </header>
              {record.description ? <p>{record.description}</p> : null}
              <dl>
                <div>
                  <dt>{planCopy.blueprint.library.source}</dt>
                  <dd>
                    {shortId(record.sourcePlanId)} r{record.sourcePlanRevision}
                  </dd>
                </div>
                <div>
                  <dt>{planCopy.blueprint.library.shape}</dt>
                  <dd>
                    {record.blueprint.stepCount.toLocaleString()}{" "}
                    {planCopy.blueprint.steps}
                    {" / "}
                    {record.blueprint.artifactCount.toLocaleString()}{" "}
                    {planCopy.blueprint.artifacts}
                  </dd>
                </div>
                <div>
                  <dt>{planCopy.blueprint.library.updated}</dt>
                  <dd>{new Date(record.updatedAt).toLocaleDateString()}</dd>
                </div>
              </dl>
              <div className="blueprint-record-actions">
                <button
                  type="button"
                  disabled={
                    busy || !canCreateRecord || record.status !== "active"
                  }
                  onClick={() => onCreate(record)}
                >
                  {busyAction === "create"
                    ? planCopy.blueprint.library.creating
                    : planCopy.blueprint.library.create}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onQualify(record)}
                >
                  {busyAction === "qualify"
                    ? planCopy.blueprint.library.qualifying
                    : planCopy.blueprint.library.qualify}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPreview(record)}
                >
                  {busyAction === "preview"
                    ? planCopy.blueprint.library.previewing
                    : planCopy.blueprint.library.preview}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onHistory(record)}
                >
                  {busyAction === "history"
                    ? planCopy.blueprint.library.loadingHistory
                    : planCopy.blueprint.library.history}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onOutcomes(record)}
                >
                  {busyAction === "outcomes"
                    ? planCopy.blueprint.library.loadingOutcomes
                    : planCopy.blueprint.library.outcomes}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPromoteOutcomeBaseline(record)}
                >
                  {busyAction === "promoteOutcomeBaseline"
                    ? planCopy.blueprint.library.promotingOutcomeBaseline
                    : planCopy.blueprint.library.promoteOutcomeBaseline}
                </button>
                {latestOutcomeReview?.recordId === record.id ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onPromoteReviewedOutcomeBaseline(record)}
                  >
                    {busyAction === "promoteReviewedOutcomeBaseline"
                      ? planCopy.blueprint.library
                          .promotingReviewedOutcomeBaseline
                      : planCopy.blueprint.library
                          .promoteReviewedOutcomeBaseline}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onQualifyOutcomes(record)}
                >
                  {busyAction === "qualifyOutcomes"
                    ? planCopy.blueprint.library.qualifyingOutcomes
                    : planCopy.blueprint.library.qualifyOutcomes}
                </button>
                <button
                  type="button"
                  disabled={busy || !selectedModelConfigured}
                  aria-describedby={
                    !selectedModelConfigured ? modelReviewWarningId : undefined
                  }
                  onClick={() => onReviewOutcomes(record)}
                >
                  {busyAction === "reviewOutcomes"
                    ? planCopy.blueprint.library.reviewingOutcomes
                    : planCopy.blueprint.library.reviewOutcomes}
                </button>
                {record.status === "active" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onArchive(record)}
                  >
                    {busyAction === "status"
                      ? planCopy.blueprint.library.archiving
                      : planCopy.blueprint.library.archive}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRestore(record)}
                  >
                    {busyAction === "status"
                      ? planCopy.blueprint.library.restoring
                      : planCopy.blueprint.library.restore}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {!canCreateRecord ? (
        <small className="blueprint-library-hint">
          {planCopy.blueprint.library.locked}
        </small>
      ) : null}
      <p className="fixture-safety">
        <ShieldCheck size={13} aria-hidden="true" />
        {planCopy.blueprint.library.safety}
      </p>
    </section>
  );
}

function PlanBlueprintLibraryReceiptView({
  receipt,
}: {
  receipt: PlanBlueprintLibraryReceipt;
}) {
  const successful =
    receipt.action === "qualified"
      ? receipt.qualificationStatus === "qualified"
      : receipt.action === "previewed"
        ? receipt.previewStatus === "ready"
        : receipt.action === "historyVerified"
          ? receipt.verificationStatus === "valid"
          : receipt.action === "outcomesVerified"
            ? receipt.verificationStatus === "valid"
            : receipt.action === "outcomeQualified"
              ? receipt.qualificationStatus === "qualified"
              : receipt.action === "outcomeReviewed"
                ? receipt.verdict === "promote"
                : receipt.action === "selection"
                  ? Boolean(receipt.selectedRecordId)
                  : receipt.action === "portfolioCalibrated"
                    ? true
                    : receipt.action === "policyBacktested"
                      ? true
                      : receipt.action === "policyOverrideApplied"
                        ? true
                        : receipt.action === "policyOverrideDriftReviewed"
                          ? receipt.retireRecommendedCount === 0 &&
                            receipt.missingFamilyCount === 0
                          : receipt.action === "policyOverrideRetired"
                            ? true
                            : receipt.action === "policyOverrideRetirements"
                              ? true
                              : receipt.action ===
                                  "policyOverrideRetirementsVerified"
                                ? receipt.verificationStatus === "valid"
                                : receipt.action ===
                                    "policyOverrideRetirementProofBundle"
                                  ? receipt.verificationStatus === "aligned"
                                  : receipt.action ===
                                      "policyOverrideRetirementProofBundleSigned"
                                    ? receipt.verificationStatus !== "invalid"
                                    : receipt.action === "created" &&
                                        receipt.replayEventVerificationStatus
                                      ? receipt.replayEventVerificationStatus ===
                                        "valid"
                                      : receipt.action === "created" &&
                                          receipt.replayEventDiagnostics
                                        ? false
                                        : true;
  const title =
    receipt.action === "qualified"
      ? planCopy.blueprint.library.qualificationStatuses[
          receipt.qualificationStatus
        ]
      : receipt.action === "previewed"
        ? planCopy.blueprint.library.previewStatuses[receipt.previewStatus]
        : receipt.action === "historyVerified"
          ? planCopy.blueprint.library.verificationStatuses[
              receipt.verificationStatus
            ]
          : receipt.action === "outcomesVerified"
            ? planCopy.blueprint.library.outcomeVerificationStatuses[
                receipt.verificationStatus
              ]
            : receipt.action === "outcomeQualified"
              ? planCopy.blueprint.library.outcomeQualificationStatuses[
                  receipt.qualificationStatus
                ]
              : receipt.action === "outcomeReviewed"
                ? planCopy.blueprint.library.outcomeReviewVerdicts[
                    receipt.verdict
                  ]
                : receipt.action === "selection"
                  ? planCopy.blueprint.library.receipts.selection
                  : receipt.action === "portfolioCalibrated"
                    ? planCopy.blueprint.library.receipts.portfolioCalibrated
                    : receipt.action === "policyBacktested"
                      ? planCopy.blueprint.library.receipts.policyBacktested
                      : receipt.action === "policyOverrideApplied"
                        ? planCopy.blueprint.library.receipts
                            .policyOverrideApplied
                        : receipt.action === "policyOverrideDriftReviewed"
                          ? planCopy.blueprint.library.receipts
                              .policyOverrideDriftReviewed
                          : receipt.action === "policyOverrideRetired"
                            ? planCopy.blueprint.library.receipts
                                .policyOverrideRetired
                            : receipt.action === "policyOverrideRetirements"
                              ? planCopy.blueprint.library.receipts
                                  .policyOverrideRetirements
                              : receipt.action ===
                                  "policyOverrideRetirementsVerified"
                                ? planCopy.blueprint.library.receipts
                                    .policyOverrideRetirementsVerified
                                : receipt.action ===
                                    "policyOverrideRetirementProofBundle"
                                  ? planCopy.blueprint.library.receipts
                                      .policyOverrideRetirementProofBundle
                                  : receipt.action ===
                                      "policyOverrideRetirementProofBundleSigned"
                                    ? planCopy.blueprint.library.receipts
                                        .policyOverrideRetirementProofBundleSigned
                                    : planCopy.blueprint.library.receipts[
                                        receipt.action
                                      ];
  const receiptHash =
    "blueprintSha256" in receipt
      ? receipt.blueprintSha256
      : receipt.action === "history" ||
          receipt.action === "historyVerified" ||
          receipt.action === "outcomes" ||
          receipt.action === "outcomesVerified" ||
          receipt.action === "selection" ||
          receipt.action === "portfolioCalibrated" ||
          receipt.action === "policyBacktested" ||
          receipt.action === "policyOverrideApplied" ||
          receipt.action === "policyOverrideDriftReviewed" ||
          receipt.action === "policyOverrideRetired" ||
          receipt.action === "policyOverrideRetirements" ||
          receipt.action === "policyOverrideRetirementsVerified" ||
          receipt.action === "policyOverrideRetirementProofBundle" ||
          receipt.action === "policyOverrideRetirementProofBundleSigned" ||
          receipt.action === "outcomeQualified"
        ? receipt.contentSha256
        : receipt.action === "outcomeBaseline"
          ? receipt.baselineSha256
          : receipt.action === "outcomeReviewed"
            ? receipt.reviewSha256
            : undefined;
  const summary =
    receipt.action === "history" || receipt.action === "historyVerified"
      ? `${receipt.replayCount.toLocaleString()} ${planCopy.blueprint.library.replays} / ${receipt.threadCount.toLocaleString()} ${planCopy.blueprint.library.threads} / ${receipt.planCount.toLocaleString()} ${planCopy.blueprint.library.plans}`
      : receipt.action === "outcomes" ||
          receipt.action === "outcomesVerified" ||
          receipt.action === "outcomeBaseline" ||
          receipt.action === "outcomeReviewed" ||
          receipt.action === "outcomeQualified"
        ? `${receipt.replayCount.toLocaleString()} ${planCopy.blueprint.library.replays} / ${receipt.completedCount.toLocaleString()} ${planCopy.blueprint.library.completed} / ${receipt.blockedCount.toLocaleString()} ${planCopy.blueprint.library.blocked} / ${receipt.invalidCount.toLocaleString()} ${planCopy.blueprint.library.invalid}`
        : receipt.action === "selection"
          ? `${receipt.candidateCount.toLocaleString()} ${planCopy.blueprint.library.candidates} / ${receipt.qualifiedCandidateCount.toLocaleString()} ${planCopy.blueprint.library.qualified} / ${receipt.rejectedCandidateCount.toLocaleString()} ${planCopy.blueprint.library.rejected}`
          : receipt.action === "portfolioCalibrated"
            ? `${receipt.recordCount.toLocaleString()} ${planCopy.blueprint.library.records} / ${receipt.familyCount.toLocaleString()} ${planCopy.blueprint.library.families} / ${receipt.outcomeQualifiedCount.toLocaleString()} ${planCopy.blueprint.library.qualified}`
            : receipt.action === "policyBacktested"
              ? `${receipt.policyCount.toLocaleString()} ${planCopy.blueprint.library.policies} / ${receipt.recordCount.toLocaleString()} ${planCopy.blueprint.library.records} / ${receipt.divergentSelectionCount.toLocaleString()} ${planCopy.blueprint.library.divergent}`
              : receipt.action === "policyOverrideApplied"
                ? `${receipt.familyRecordCount.toLocaleString()} ${planCopy.blueprint.library.records} / ${receipt.familyOutcomeQualifiedCount.toLocaleString()} ${planCopy.blueprint.library.qualified} / ${planCopy.blueprint.library.recommendationPolicy}: ${receipt.recommendationPolicyTemplate}`
                : receipt.action === "policyOverrideDriftReviewed"
                  ? `${receipt.overrideCount.toLocaleString()} ${planCopy.blueprint.library.override} / ${receipt.alignedCount.toLocaleString()} ${planCopy.blueprint.library.aligned} / ${receipt.retireRecommendedCount.toLocaleString()} ${planCopy.blueprint.library.recommendedRetire}`
                  : receipt.action === "policyOverrideRetired"
                    ? `${planCopy.blueprint.library.retired}: ${receipt.retiredRecommendationPolicyTemplate} / ${planCopy.blueprint.library.remaining}: ${receipt.remainingOverrideSetSha256.slice(0, 12)}`
                    : receipt.action === "policyOverrideRetirements"
                      ? `${receipt.retirementCount.toLocaleString()} ${planCopy.blueprint.library.retired} / ${planCopy.blueprint.library.retirementSet}: ${receipt.retirementSetSha256.slice(0, 12)}`
                      : receipt.action === "policyOverrideRetirementsVerified"
                        ? `${receipt.observedRetirementCount.toLocaleString()} ${planCopy.blueprint.library.retired} / ${planCopy.blueprint.library.retirementSet}: ${receipt.observedRetirementSetSha256.slice(0, 12)}`
                        : receipt.action ===
                            "policyOverrideRetirementProofBundle"
                          ? `${receipt.validHistoryCount.toLocaleString()} ${planCopy.blueprint.library.valid} / ${receipt.invalidHistoryCount.toLocaleString()} ${planCopy.blueprint.library.invalid} / ${planCopy.blueprint.library.retirementSet}: ${receipt.distinctRetirementSetCount.toLocaleString()}`
                          : receipt.action ===
                              "policyOverrideRetirementProofBundleSigned"
                            ? `${receipt.historyCount.toLocaleString()} ${planCopy.blueprint.library.histories} / ${planCopy.blueprint.library.signer}: ${receipt.keyId.slice(0, 12)} / ${planCopy.blueprint.library.receipt}: ${receipt.receiptContentSha256.slice(0, 12)}`
                            : `${receipt.stepCount.toLocaleString()} ${planCopy.blueprint.steps} / ${receipt.artifactCount.toLocaleString()} ${planCopy.blueprint.artifacts}`;
  const identity =
    receipt.action === "qualified"
      ? shortId(receipt.recordId)
      : receipt.action === "previewed"
        ? shortId(receipt.planId ?? receipt.recordId)
        : receipt.action === "history"
          ? shortId(receipt.latestPlanId ?? receipt.recordId)
          : receipt.action === "outcomes"
            ? shortId(receipt.latestPlanId ?? receipt.recordId)
            : receipt.action === "outcomeBaseline"
              ? shortId(receipt.baselineId)
              : receipt.action === "outcomeReviewed"
                ? shortId(receipt.recordId)
                : receipt.action === "selection"
                  ? receipt.selectedRecordId
                    ? shortId(receipt.selectedRecordId)
                    : shortId(receipt.threadId)
                  : receipt.action === "portfolioCalibrated"
                    ? receipt.topRecordId
                      ? shortId(receipt.topRecordId)
                      : receipt.topFamilySha256?.slice(0, 12)
                    : receipt.action === "policyBacktested"
                      ? receipt.topSelectedRecordId
                        ? shortId(receipt.topSelectedRecordId)
                        : receipt.topSelectedFamilySha256?.slice(0, 12)
                      : receipt.action === "policyOverrideApplied"
                        ? receipt.familySha256.slice(0, 12)
                        : receipt.action === "policyOverrideDriftReviewed"
                          ? (receipt.reviewedFamilySha256?.slice(0, 12) ??
                            receipt.reviewSetSha256.slice(0, 12))
                          : receipt.action === "policyOverrideRetired"
                            ? receipt.familySha256.slice(0, 12)
                            : receipt.action === "policyOverrideRetirements"
                              ? (receipt.latestFamilySha256?.slice(0, 12) ??
                                receipt.retirementSetSha256.slice(0, 12))
                              : receipt.action ===
                                  "policyOverrideRetirementsVerified"
                                ? receipt.observedRetirementSetSha256.slice(
                                    0,
                                    12,
                                  )
                                : receipt.action ===
                                    "policyOverrideRetirementProofBundle"
                                  ? receipt.retirementSetBundleSha256.slice(
                                      0,
                                      12,
                                    )
                                  : receipt.action ===
                                      "policyOverrideRetirementProofBundleSigned"
                                    ? receipt.keyId.slice(0, 12)
                                    : receipt.action === "historyVerified" ||
                                        receipt.action === "outcomesVerified" ||
                                        receipt.action === "outcomeQualified"
                                      ? receipt.recordId
                                        ? shortId(receipt.recordId)
                                        : undefined
                                      : "status" in receipt
                                        ? planCopy.blueprint.library.statuses[
                                            receipt.status
                                          ]
                                        : shortId(receipt.planId);
  return (
    <div
      className={`fixture-receipt status-${successful ? "valid" : "invalid"}`}
    >
      <span>{title}</span>
      {receiptHash ? <code>{receiptHash.slice(0, 16)}</code> : null}
      <small>
        {summary}
        {identity ? ` / ${identity}` : ""}
      </small>
      {receipt.action === "qualified" || receipt.action === "previewed" ? (
        <>
          <small className="fixture-diagnostics">
            {receipt.diagnostics.length > 0
              ? receipt.diagnostics.join(", ")
              : planCopy.blueprint.library.noDiagnostics}
          </small>
          {receipt.action === "qualified" &&
          receipt.expectedPlanArchiveSha256 ? (
            <small className="fixture-diagnostics">
              {planCopy.blueprint.library.expected}:{" "}
              {receipt.expectedPlanArchiveSha256.slice(0, 16)}
              {receipt.actualPlanArchiveSha256
                ? ` / ${planCopy.blueprint.library.actual}: ${receipt.actualPlanArchiveSha256.slice(0, 16)}`
                : ""}
            </small>
          ) : null}
        </>
      ) : null}
      {receipt.action === "history" ? (
        <small className="fixture-diagnostics">
          {planCopy.blueprint.library.eventSet}:{" "}
          {receipt.eventSetSha256.slice(0, 16)}
          {receipt.latestPreviewSha256
            ? ` / ${planCopy.blueprint.library.latestPreview}: ${receipt.latestPreviewSha256.slice(0, 16)}`
            : ""}
        </small>
      ) : null}
      {receipt.action === "historyVerified" ? (
        <>
          <small className="fixture-diagnostics">
            {receipt.diagnostics.length > 0
              ? receipt.diagnostics.join(", ")
              : planCopy.blueprint.library.noDiagnostics}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.declared}:{" "}
            {receipt.declaredContentSha256?.slice(0, 16) ?? "missing"}
            {receipt.observedContentSha256
              ? ` / ${planCopy.blueprint.library.observed}: ${receipt.observedContentSha256.slice(0, 16)}`
              : ""}
          </small>
          {receipt.declaredEventSetSha256 || receipt.observedEventSetSha256 ? (
            <small className="fixture-diagnostics">
              {planCopy.blueprint.library.eventSet}:{" "}
              {receipt.declaredEventSetSha256?.slice(0, 16) ?? "missing"}
              {receipt.observedEventSetSha256
                ? ` / ${planCopy.blueprint.library.observed}: ${receipt.observedEventSetSha256.slice(0, 16)}`
                : ""}
            </small>
          ) : null}
        </>
      ) : null}
      {receipt.action === "outcomes" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.replayHistory}:{" "}
            {receipt.replayHistorySha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.outcomeSet}:{" "}
            {receipt.outcomeSetSha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.completion}:{" "}
            {(receipt.completionRateBps / 100).toFixed(2)}%{" / "}
            {receipt.activeCount.toLocaleString()}{" "}
            {planCopy.blueprint.library.active}
            {" / "}
            {receipt.cancelledCount.toLocaleString()}{" "}
            {planCopy.blueprint.library.cancelled}
            {receipt.latestStatus
              ? ` / ${planCopy.blueprint.library.latest}: ${planCopy.blueprint.library.outcomeStatuses[receipt.latestStatus]}`
              : ""}
          </small>
        </>
      ) : null}
      {receipt.action === "outcomesVerified" ? (
        <>
          <small className="fixture-diagnostics">
            {receipt.diagnostics.length > 0
              ? receipt.diagnostics.join(", ")
              : planCopy.blueprint.library.noDiagnostics}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.declared}:{" "}
            {receipt.declaredContentSha256?.slice(0, 16) ?? "missing"}
            {receipt.observedContentSha256
              ? ` / ${planCopy.blueprint.library.observed}: ${receipt.observedContentSha256.slice(0, 16)}`
              : ""}
          </small>
          {receipt.declaredOutcomeSetSha256 ||
          receipt.observedOutcomeSetSha256 ? (
            <small className="fixture-diagnostics">
              {planCopy.blueprint.library.outcomeSet}:{" "}
              {receipt.declaredOutcomeSetSha256?.slice(0, 16) ?? "missing"}
              {receipt.observedOutcomeSetSha256
                ? ` / ${planCopy.blueprint.library.observed}: ${receipt.observedOutcomeSetSha256.slice(0, 16)}`
                : ""}
            </small>
          ) : null}
        </>
      ) : null}
      {receipt.action === "outcomeBaseline" ? (
        <>
          <small className="fixture-diagnostics">
            {receipt.created
              ? planCopy.blueprint.library.outcomeBaselineCreated
              : planCopy.blueprint.library.outcomeBaselineReused}
            {" / "}
            {planCopy.blueprint.library.outcomeBaseline}:{" "}
            {receipt.baselineSha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.completion}:{" "}
            {(receipt.completionRateBps / 100).toFixed(2)}%{" / "}
            {planCopy.blueprint.library.min}:{" "}
            {(receipt.minCompletionRateBps / 100).toFixed(2)}%
          </small>
          {receipt.reviewSha256 ? (
            <small className="fixture-diagnostics">
              {planCopy.blueprint.library.review}:{" "}
              {receipt.reviewSha256.slice(0, 16)}
              {receipt.reviewScore !== undefined
                ? ` / ${planCopy.blueprint.library.score}: ${receipt.reviewScore.toLocaleString()}`
                : ""}
              {receipt.reviewRisk
                ? ` / ${planCopy.blueprint.library.risk}: ${planCopy.blueprint.library.outcomeReviewRisks[receipt.reviewRisk]}`
                : ""}
              {receipt.reviewVerdict
                ? ` / ${planCopy.blueprint.library.outcomeReviewVerdicts[receipt.reviewVerdict]}`
                : ""}
              {receipt.reviewGateMinScore !== undefined
                ? ` / ${planCopy.blueprint.library.min}: ${receipt.reviewGateMinScore.toLocaleString()}`
                : ""}
              {receipt.reviewModel ? ` / ${receipt.reviewModel}` : ""}
            </small>
          ) : null}
        </>
      ) : null}
      {receipt.action === "outcomeQualified" ? (
        <>
          <small className="fixture-diagnostics">
            {receipt.diagnostics.length > 0
              ? receipt.diagnostics.join(", ")
              : planCopy.blueprint.library.noDiagnostics}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.current}:{" "}
            {receipt.currentOutcomesSha256.slice(0, 16)}
            {receipt.baselineSha256
              ? ` / ${planCopy.blueprint.library.outcomeBaseline}: ${receipt.baselineSha256.slice(0, 16)}`
              : ""}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.completion}:{" "}
            {(receipt.completionRateBps / 100).toFixed(2)}%
            {receipt.minCompletionRateBps !== undefined
              ? ` / ${planCopy.blueprint.library.min}: ${(receipt.minCompletionRateBps / 100).toFixed(2)}%`
              : ""}
          </small>
        </>
      ) : null}
      {receipt.action === "outcomeReviewed" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.score}: {receipt.score.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.risk}:{" "}
            {planCopy.blueprint.library.outcomeReviewRisks[receipt.risk]}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.current}:{" "}
            {receipt.replayOutcomesSha256.slice(0, 16)}
            {receipt.baselineSha256
              ? ` / ${planCopy.blueprint.library.outcomeBaseline}: ${receipt.baselineSha256.slice(0, 16)}`
              : ""}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.input}:{" "}
            {receipt.inputSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.response}:{" "}
            {receipt.responseSha256.slice(0, 16)}
          </small>
          {receipt.reviewEnvelopeSha256 ? (
            <small className="fixture-diagnostics">
              {planCopy.envelope}: {receipt.reviewEnvelopeSha256.slice(0, 16)}
              {" / "}
              {planCopy.receipt}: {receipt.reviewSha256.slice(0, 16)}
            </small>
          ) : null}
          {receipt.concerns.length > 0 ? (
            <small className="fixture-diagnostics">
              {receipt.concerns.join(", ")}
            </small>
          ) : null}
        </>
      ) : null}
      {receipt.action === "selection" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.selectionSet}:{" "}
            {receipt.selectionSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.portfolioSet}:{" "}
            {receipt.portfolioSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.overrideSet}:{" "}
            {receipt.familyPolicyOverrideSetSha256.slice(0, 16)}
            {receipt.selectedPreviewSha256
              ? ` / ${planCopy.blueprint.library.latestPreview}: ${receipt.selectedPreviewSha256.slice(0, 16)}`
              : ""}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.recommendationPolicy}:{" "}
            {receipt.selectedRecommendationPolicyTemplate ??
              receipt.recommendationPolicyTemplate}
            {" / "}
            {(
              receipt.selectedRecommendationPolicySha256 ??
              receipt.recommendationPolicySha256
            ).slice(0, 16)}
            {receipt.selectedRecommendationPolicySource
              ? ` / ${planCopy.blueprint.library.policySource}: ${receipt.selectedRecommendationPolicySource}`
              : ""}
            {receipt.selectedFamilyPolicyOverrideSha256
              ? ` / ${planCopy.blueprint.library.override}: ${receipt.selectedFamilyPolicyOverrideSha256.slice(0, 16)}`
              : ""}
          </small>
          <small className="fixture-diagnostics">
            {receipt.selectedRecordId
              ? `${planCopy.blueprint.library.selected}: ${shortId(receipt.selectedRecordId)}`
              : receipt.diagnostics.length > 0
                ? receipt.diagnostics.join(", ")
                : planCopy.blueprint.library.noDiagnostics}
            {receipt.selectedBaselineSha256
              ? ` / ${planCopy.blueprint.library.outcomeBaseline}: ${receipt.selectedBaselineSha256.slice(0, 16)}`
              : ""}
            {receipt.selectedFamilySha256
              ? ` / ${planCopy.blueprint.library.topFamily}: ${receipt.selectedFamilySha256.slice(0, 16)}`
              : ""}
          </small>
          {receipt.selectedScoreBps !== undefined ? (
            <small className="fixture-diagnostics">
              {planCopy.blueprint.library.score}:{" "}
              {(receipt.selectedScoreBps / 100).toFixed(2)}%{" / "}
              {planCopy.blueprint.library.replays}:{" "}
              {(receipt.selectedReplayCount ?? 0).toLocaleString()}
              {receipt.selectedRecommendationScoreBps !== undefined
                ? ` / ${planCopy.blueprint.library.recommendation}: ${(receipt.selectedRecommendationScoreBps / 100).toFixed(2)}%`
                : ""}
              {receipt.selectedFamilyCompletionRateBps !== undefined
                ? ` / ${planCopy.blueprint.library.families}: ${(receipt.selectedFamilyCompletionRateBps / 100).toFixed(2)}%`
                : ""}
            </small>
          ) : null}
        </>
      ) : null}
      {receipt.action === "portfolioCalibrated" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.portfolioSet}:{" "}
            {receipt.portfolioSetSha256.slice(0, 16)}
            {receipt.topFamilySha256
              ? ` / ${planCopy.blueprint.library.topFamily}: ${receipt.topFamilySha256.slice(0, 16)}`
              : ""}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.active}:{" "}
            {receipt.activeCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.archived}:{" "}
            {receipt.archivedCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.reviewed}:{" "}
            {receipt.reviewedBaselineCount.toLocaleString()}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.missing}:{" "}
            {receipt.missingBaselineCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.policyFailed}:{" "}
            {receipt.policyFailedCount.toLocaleString()}
            {receipt.topRecordScoreBps !== undefined
              ? ` / ${planCopy.blueprint.library.score}: ${(receipt.topRecordScoreBps / 100).toFixed(2)}%`
              : ""}
          </small>
        </>
      ) : null}
      {receipt.action === "policyBacktested" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.portfolioSet}:{" "}
            {receipt.portfolioSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.policySet}:{" "}
            {receipt.policySetSha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.recommendationPolicy}:{" "}
            {receipt.topPolicyTemplate}
            {receipt.topPolicySha256
              ? ` / ${receipt.topPolicySha256.slice(0, 16)}`
              : ""}
            {receipt.topSelectedFamilySha256
              ? ` / ${planCopy.blueprint.library.topFamily}: ${receipt.topSelectedFamilySha256.slice(0, 16)}`
              : ""}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.active}:{" "}
            {receipt.activeCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.divergent}:{" "}
            {receipt.divergentSelectionCount.toLocaleString()}
            {receipt.topSelectedRecommendationScoreBps !== undefined
              ? ` / ${planCopy.blueprint.library.recommendation}: ${(receipt.topSelectedRecommendationScoreBps / 100).toFixed(2)}%`
              : ""}
            {" / "}
            {planCopy.blueprint.library.average}:{" "}
            {(receipt.averageRecommendationScoreBps / 100).toFixed(2)}%
          </small>
        </>
      ) : null}
      {receipt.action === "policyOverrideApplied" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.portfolioSet}:{" "}
            {receipt.portfolioSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.topFamily}:{" "}
            {receipt.familySha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.recommendationPolicy}:{" "}
            {receipt.recommendationPolicyTemplate}
            {" / "}
            {receipt.recommendationPolicySha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.qualified}:{" "}
            {receipt.familyOutcomeQualifiedCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.completion}:{" "}
            {(receipt.familyCompletionRateBps / 100).toFixed(2)}%
          </small>
        </>
      ) : null}
      {receipt.action === "policyOverrideDriftReviewed" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.portfolioSet}:{" "}
            {receipt.portfolioSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.overrideSet}:{" "}
            {receipt.overrideSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.driftReviewSet}:{" "}
            {receipt.reviewSetSha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.aligned}:{" "}
            {receipt.alignedCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.recommendedRetire}:{" "}
            {receipt.retireRecommendedCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.missing}:{" "}
            {receipt.missingFamilyCount.toLocaleString()}
          </small>
          {receipt.reviewedFamilySha256 ? (
            <small className="fixture-diagnostics">
              {planCopy.blueprint.library.topFamily}:{" "}
              {receipt.reviewedFamilySha256.slice(0, 16)}
              {receipt.reviewedStatus ? ` / ${receipt.reviewedStatus}` : ""}
              {receipt.reviewedRecommendation
                ? ` / ${planCopy.blueprint.library.recommendation}: ${receipt.reviewedRecommendation}`
                : ""}
            </small>
          ) : null}
          {receipt.overridePolicyTemplate || receipt.bestPolicyTemplate ? (
            <small className="fixture-diagnostics">
              {planCopy.blueprint.library.overridePolicy}:{" "}
              {receipt.overridePolicyTemplate ??
                planCopy.blueprint.library.current}
              {" / "}
              {planCopy.blueprint.library.bestPolicy}:{" "}
              {receipt.bestPolicyTemplate ?? planCopy.blueprint.library.current}
            </small>
          ) : null}
          {receipt.overrideSelectedRecordId || receipt.bestSelectedRecordId ? (
            <small className="fixture-diagnostics">
              {planCopy.blueprint.library.override}:{" "}
              {receipt.overrideSelectedRecordId
                ? shortId(receipt.overrideSelectedRecordId)
                : planCopy.blueprint.library.missing}
              {receipt.overrideSelectedRecommendationScoreBps !== undefined
                ? ` / ${(receipt.overrideSelectedRecommendationScoreBps / 100).toFixed(2)}%`
                : ""}
              {" / "}
              {planCopy.blueprint.library.selected}:{" "}
              {receipt.bestSelectedRecordId
                ? shortId(receipt.bestSelectedRecordId)
                : planCopy.blueprint.library.missing}
              {receipt.bestSelectedRecommendationScoreBps !== undefined
                ? ` / ${(receipt.bestSelectedRecommendationScoreBps / 100).toFixed(2)}%`
                : ""}
            </small>
          ) : null}
          <small className="fixture-diagnostics">
            {receipt.reviewedDiagnostics.length > 0
              ? receipt.reviewedDiagnostics.join(", ")
              : planCopy.blueprint.library.noDiagnostics}
          </small>
        </>
      ) : null}
      {receipt.action === "policyOverrideRetired" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.portfolioSet}:{" "}
            {receipt.portfolioSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.topFamily}:{" "}
            {receipt.familySha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.retired}:{" "}
            {receipt.retiredOverrideSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.recommendationPolicy}:{" "}
            {receipt.retiredRecommendationPolicyTemplate}
            {" / "}
            {receipt.retiredRecommendationPolicySha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.overrideSet}:{" "}
            {receipt.overrideSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.driftReviewSet}:{" "}
            {receipt.driftReviewSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.remaining}:{" "}
            {receipt.remainingOverrideSetSha256.slice(0, 16)}
          </small>
        </>
      ) : null}
      {receipt.action === "policyOverrideRetirements" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.portfolioSet}:{" "}
            {receipt.portfolioSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.overrideSet}:{" "}
            {receipt.currentOverrideSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.retirementSet}:{" "}
            {receipt.retirementSetSha256.slice(0, 16)}
          </small>
          {receipt.latestFamilySha256 ? (
            <small className="fixture-diagnostics">
              {planCopy.blueprint.library.latest}:{" "}
              {receipt.latestFamilySha256.slice(0, 16)}
              {receipt.latestRetiredOverrideSha256
                ? ` / ${planCopy.blueprint.library.retired}: ${receipt.latestRetiredOverrideSha256.slice(0, 16)}`
                : ""}
              {receipt.latestRetiredRecommendationPolicyTemplate
                ? ` / ${planCopy.blueprint.library.recommendationPolicy}: ${receipt.latestRetiredRecommendationPolicyTemplate}`
                : ""}
            </small>
          ) : null}
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.latest}:{" "}
            {receipt.latestRetiredAt ?? planCopy.blueprint.library.missing}
            {receipt.latestRemainingOverrideSetSha256
              ? ` / ${planCopy.blueprint.library.remaining}: ${receipt.latestRemainingOverrideSetSha256.slice(0, 16)}`
              : ""}
          </small>
        </>
      ) : null}
      {receipt.action === "policyOverrideRetirementsVerified" ? (
        <>
          <small className="fixture-diagnostics">
            {receipt.diagnostics.length > 0
              ? receipt.diagnostics.join(", ")
              : planCopy.blueprint.library.noDiagnostics}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.declared}:{" "}
            {receipt.declaredContentSha256?.slice(0, 16) ?? "missing"}
            {receipt.observedContentSha256
              ? ` / ${planCopy.blueprint.library.observed}: ${receipt.observedContentSha256.slice(0, 16)}`
              : ""}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.portfolioSet}:{" "}
            {receipt.declaredPortfolioSetSha256?.slice(0, 16) ?? "missing"}
            {" / "}
            {planCopy.blueprint.library.observed}:{" "}
            {receipt.observedPortfolioSetSha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.overrideSet}:{" "}
            {receipt.declaredCurrentOverrideSetSha256?.slice(0, 16) ??
              "missing"}
            {" / "}
            {planCopy.blueprint.library.observed}:{" "}
            {receipt.observedCurrentOverrideSetSha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.retirementSet}:{" "}
            {receipt.declaredRetirementSetSha256?.slice(0, 16) ?? "missing"}
            {receipt.recomputedRetirementSetSha256
              ? ` / ${planCopy.blueprint.library.actual}: ${receipt.recomputedRetirementSetSha256.slice(0, 16)}`
              : ""}
            {" / "}
            {planCopy.blueprint.library.observed}:{" "}
            {receipt.observedRetirementSetSha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.retired}:{" "}
            {receipt.retirementCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.observed}:{" "}
            {receipt.observedRetirementCount.toLocaleString()}
            {receipt.latestRetiredAt || receipt.observedLatestRetiredAt
              ? ` / ${planCopy.blueprint.library.latest}: ${receipt.latestRetiredAt ?? planCopy.blueprint.library.missing} / ${planCopy.blueprint.library.observed}: ${receipt.observedLatestRetiredAt ?? planCopy.blueprint.library.missing}`
              : ""}
          </small>
        </>
      ) : null}
      {receipt.action === "policyOverrideRetirementProofBundle" ? (
        <>
          <small className="fixture-diagnostics">
            {receipt.diagnostics.length > 0
              ? receipt.diagnostics.join(", ")
              : planCopy.blueprint.library.noDiagnostics}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.histories}:{" "}
            {receipt.historyCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.valid}:{" "}
            {receipt.validHistoryCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.invalid}:{" "}
            {receipt.invalidHistoryCount.toLocaleString()}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.retirementSet}:{" "}
            {receipt.retirementSetBundleSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.historySet}:{" "}
            {receipt.historySetSha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.portfolioSet}:{" "}
            {receipt.portfolioSetBundleSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.overrideSet}:{" "}
            {receipt.currentOverrideSetBundleSha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.divergent}:{" "}
            {receipt.distinctRetirementSetCount.toLocaleString()}{" "}
            {planCopy.blueprint.library.retirementSet}
            {" / "}
            {receipt.distinctPortfolioSetCount.toLocaleString()}{" "}
            {planCopy.blueprint.library.portfolioSet}
            {" / "}
            {receipt.distinctCurrentOverrideSetCount.toLocaleString()}{" "}
            {planCopy.blueprint.library.overrideSet}
          </small>
          {receipt.highlightedHistoryIndex !== undefined ? (
            <small className="fixture-diagnostics">
              {planCopy.blueprint.library.highlighted}:{" "}
              {receipt.highlightedHistoryIndex.toLocaleString()}
              {receipt.highlightedHistoryStatus
                ? ` / ${receipt.highlightedHistoryStatus}`
                : ""}
              {receipt.highlightedHistoryContentSha256
                ? ` / ${receipt.highlightedHistoryContentSha256.slice(0, 16)}`
                : ""}
              {receipt.highlightedRetirementSetSha256
                ? ` / ${planCopy.blueprint.library.retirementSet}: ${receipt.highlightedRetirementSetSha256.slice(0, 16)}`
                : ""}
            </small>
          ) : null}
          {receipt.highlightedHistoryDiagnostics.length > 0 ? (
            <small className="fixture-diagnostics">
              {receipt.highlightedHistoryDiagnostics.join(", ")}
            </small>
          ) : null}
        </>
      ) : null}
      {receipt.action === "policyOverrideRetirementProofBundleSigned" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.signed}: {receipt.signedAt}
            {" / "}
            {planCopy.blueprint.library.signer}: {receipt.keyId.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.receipt}:{" "}
            {receipt.receiptContentSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.artifact}:{" "}
            {receipt.receiptArtifactSha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.histories}:{" "}
            {receipt.historyCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.valid}:{" "}
            {receipt.validHistoryCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.invalid}:{" "}
            {receipt.invalidHistoryCount.toLocaleString()}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.historySet}:{" "}
            {receipt.distinctHistoryCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.retirementSet}:{" "}
            {receipt.distinctRetirementSetCount.toLocaleString()}
          </small>
        </>
      ) : null}
      {receipt.action === "created" &&
      (receipt.replayEventSha256 ||
        receipt.replayEventVerificationStatus ||
        receipt.replayEventDiagnostics) ? (
        <>
          {receipt.replayEventSha256 ? (
            <small className="fixture-diagnostics">
              {planCopy.blueprint.library.eventAnchor}:{" "}
              {receipt.replayEventSha256.slice(0, 16)}
              {receipt.replayEventId
                ? ` / ${shortId(receipt.replayEventId)}`
                : ""}
            </small>
          ) : null}
          {receipt.replayEventVerificationStatus ? (
            <small className="fixture-diagnostics">
              {receipt.replayEventVerificationStatus === "valid"
                ? planCopy.blueprint.library.eventVerified
                : planCopy.blueprint.library.eventInvalid}
              {receipt.replayEventVerificationSha256
                ? ` / ${planCopy.blueprint.library.eventVerification}: ${receipt.replayEventVerificationSha256.slice(0, 16)}`
                : ""}
            </small>
          ) : null}
          {receipt.replayEventDiagnostics ? (
            <small className="fixture-diagnostics">
              {receipt.replayEventDiagnostics.length > 0
                ? receipt.replayEventDiagnostics.join(", ")
                : planCopy.blueprint.library.noDiagnostics}
            </small>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function upsertBlueprintRecord(
  records: ExecutionPlanBlueprintRecord[],
  record: ExecutionPlanBlueprintRecord,
): ExecutionPlanBlueprintRecord[] {
  return [
    ...records.filter((candidate) => candidate.id !== record.id),
    record,
  ].toSorted(compareBlueprintRecords);
}

function firstSigningAnchor(
  anchors: ReceiptTrustAnchor[],
): ReceiptTrustAnchor | undefined {
  return anchors.find(
    (anchor) => anchor.status === "trusted" && Boolean(anchor.signingSource),
  );
}

function signingAnchorAvailable(
  anchors: ReceiptTrustAnchor[],
  anchorId: string,
): boolean {
  return anchors.some(
    (anchor) =>
      anchor.id === anchorId &&
      anchor.status === "trusted" &&
      Boolean(anchor.signingSource),
  );
}

function replayHistoryRecordId(history: unknown): string | undefined {
  if (!isPlainRecord(history)) return undefined;
  const recordId = history["recordId"];
  return typeof recordId === "string" && recordId.length > 0
    ? recordId
    : undefined;
}

function replayOutcomesRecordId(outcomes: unknown): string | undefined {
  if (
    !isPlainRecord(outcomes) ||
    outcomes["kind"] !== "napier.execution-plan-blueprint-replay-outcomes"
  ) {
    return undefined;
  }
  const recordId = outcomes["recordId"];
  return typeof recordId === "string" && recordId.length > 0
    ? recordId
    : undefined;
}

function planBlueprintPreviewFromError(
  error: unknown,
): ExecutionPlanBlueprintRecordPreview | undefined {
  if (!(error instanceof NapierApiError) || error.status !== 409) {
    return undefined;
  }
  return isExecutionPlanBlueprintRecordPreview(error.payload)
    ? error.payload
    : undefined;
}

function isExecutionPlanBlueprintRecordPreview(
  value: unknown,
): value is ExecutionPlanBlueprintRecordPreview {
  if (!isPlainRecord(value)) return false;
  const qualification = value["qualification"];
  const plan = value["plan"];
  return (
    isPlanBlueprintPreviewStatus(value["status"]) &&
    Array.isArray(value["diagnostics"]) &&
    value["diagnostics"].every(
      (diagnostic) => typeof diagnostic === "string",
    ) &&
    typeof value["threadId"] === "string" &&
    typeof value["recordId"] === "string" &&
    typeof value["hasOpenPlan"] === "boolean" &&
    isSha256(value["previewSha256"]) &&
    isExecutionPlanBlueprintRecordQualificationShape(qualification) &&
    (plan === undefined || isExecutionPlanPreviewShape(plan))
  );
}

function isExecutionPlanBlueprintRecordQualificationShape(
  value: unknown,
): value is ExecutionPlanBlueprintRecordQualification {
  return (
    isPlainRecord(value) &&
    isPlanBlueprintQualificationStatus(value["status"]) &&
    Array.isArray(value["diagnostics"]) &&
    value["diagnostics"].every(
      (diagnostic) => typeof diagnostic === "string",
    ) &&
    typeof value["recordId"] === "string" &&
    typeof value["stepCount"] === "number" &&
    typeof value["artifactCount"] === "number"
  );
}

function isExecutionPlanPreviewShape(value: unknown): value is ExecutionPlan {
  return (
    isPlainRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["threadId"] === "string" &&
    Array.isArray(value["steps"]) &&
    Array.isArray(value["artifacts"])
  );
}

function isPlanBlueprintPreviewStatus(
  value: unknown,
): value is ExecutionPlanBlueprintRecordPreview["status"] {
  return value === "ready" || value === "not_qualified" || value === "blocked";
}

function isPlanBlueprintQualificationStatus(
  value: unknown,
): value is ExecutionPlanBlueprintRecordQualification["status"] {
  return (
    value === "qualified" ||
    value === "archived" ||
    value === "source_missing" ||
    value === "source_drift" ||
    value === "invalid"
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
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

function compareBlueprintRecords(
  left: ExecutionPlanBlueprintRecord,
  right: ExecutionPlanBlueprintRecord,
): number {
  const leftRank = left.status === "active" ? 0 : 1;
  const rightRank = right.status === "active" ? 0 : 1;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.name.localeCompare(right.name)
  );
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
