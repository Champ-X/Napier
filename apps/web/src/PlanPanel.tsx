import { useEffect, useRef, useState } from "react";
import {
  Brain,
  ChevronRight,
  Download,
  ShieldCheck,
  Upload,
} from "lucide-react";

import type {
  ExecutionPlan,
  ExecutionPlanArchive,
  ExecutionPlanArchiveVerification,
  ExecutionPlanBlueprint,
  ExecutionPlanBlueprintRecord,
  ExecutionPlanBlueprintRecordPreview,
  ExecutionPlanBlueprintRecordQualification,
  ExecutionPlanBlueprintRecordReplayEventVerification,
  ExecutionPlanBlueprintRecordOutcomeReview,
  ExecutionPlanBlueprintVerification,
  ExecutionPlanReplanDraftModelReview,
} from "@napier/contracts";

import {
  applyReplanDraft,
  createExecutionPlanFromBlueprint,
  createExecutionPlanFromBlueprintRecordWithReplayEvent,
  getExecutionPlanArchive,
  getExecutionPlanBlueprint,
  getExecutionPlanBlueprintRecordQualification,
  getExecutionPlanBlueprintRecordOutcomeQualification,
  getExecutionPlanBlueprintRecordReplayOutcomes,
  getExecutionPlanBlueprintRecordReplays,
  getExecutionPlanBlueprintRecords,
  previewExecutionPlanFromBlueprintRecord,
  promoteExecutionPlanBlueprintRecordOutcomeBaseline,
  reviewExecutionPlanBlueprintRecordOutcomes,
  reviewReplanDraft,
  saveExecutionPlanBlueprint,
  selectExecutionPlanBlueprintRecord,
  setExecutionPlanBlueprintRecordStatus,
  verifyExecutionPlanArchive,
  verifyExecutionPlanBlueprint,
  verifyExecutionPlanBlueprintRecordReplayEvent,
  verifyExecutionPlanBlueprintRecordReplayOutcomes,
  verifyExecutionPlanBlueprintRecordReplays,
} from "./api";
import { formatApiErrorMessage, NapierApiError } from "./api-error";
import { copy } from "./copy";
import {
  planBlueprintCreatedReceipt,
  type PlanBlueprintLibraryCreatedReceipt,
  planBlueprintOutcomeBaselineReceipt,
  type PlanBlueprintLibraryOutcomeBaselineReceipt,
  planBlueprintOutcomeQualificationReceipt,
  type PlanBlueprintLibraryOutcomeQualificationReceipt,
  planBlueprintOutcomeReviewReceipt,
  type PlanBlueprintLibraryOutcomeReviewReceipt,
  planBlueprintPreviewReceipt,
  type PlanBlueprintLibraryPreviewReceipt,
  planBlueprintQualificationReceipt,
  type PlanBlueprintLibraryQualificationReceipt,
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

const MAX_PLAN_ARCHIVE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PLAN_BLUEPRINT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PLAN_BLUEPRINT_REPLAY_HISTORY_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PLAN_BLUEPRINT_REPLAY_OUTCOMES_FILE_BYTES = 2 * 1024 * 1024;

type PlanArchiveReceipt =
  | {
      action: "exported";
      contentSha256: string;
      eventStreamSha256: string;
      revision: number;
      eventCount: number;
      stepCount: number;
      artifactCount: number;
      replanCount: number;
    }
  | {
      action: "verified";
      status: ExecutionPlanArchiveVerification["status"];
      diagnostics: string[];
      contentSha256?: string;
      eventStreamSha256?: string;
      revision?: number;
      eventCount: number;
      stepCount: number;
      artifactCount: number;
      replanCount: number;
    };

type PlanBlueprintReceipt =
  | {
      action: "exported";
      contentSha256: string;
      sourcePlanRevision: number;
      stepCount: number;
      artifactCount: number;
    }
  | {
      action: "verified";
      status: ExecutionPlanBlueprintVerification["status"];
      diagnostics: string[];
      contentSha256?: string;
      sourcePlanRevision?: number;
      stepCount: number;
      artifactCount: number;
    }
  | {
      action: "created";
      contentSha256: string;
      planId: string;
      stepCount: number;
      artifactCount: number;
    };

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
  | PlanBlueprintLibrarySelectionReceipt;

export default function PlanPanel({
  threadId,
  plans,
  running,
  selectedModelKey,
  onContinue,
  onDraftApplied,
}: {
  threadId: string | undefined;
  plans: ExecutionPlan[];
  running: boolean;
  selectedModelKey: string;
  onContinue: () => void;
  onDraftApplied: () => void | Promise<void>;
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
  const criticalPathSet = new Set(criticalPath);
  const latestReplan = plan?.replans.at(-1);
  const replanRecommendation = plan?.replanRecommendation;
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

  useEffect(() => {
    setDraftReview(undefined);
    setDraftReviewError(undefined);
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

  const reviewDraft = async (): Promise<void> => {
    if (!plan || !replanRecommendation || draftReviewBusy) return;
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

  const exportArchive = async (): Promise<void> => {
    if (!plan || archiveBusyAction) return;
    setArchiveBusyAction("export");
    setArchiveReceipt(undefined);
    setArchiveError(undefined);
    try {
      const archive = await getExecutionPlanArchive(plan.threadId, plan.id);
      downloadJson(
        archive,
        `napier-plan-${archive.plan.id}-r${archive.plan.revision}-${archive.contentSha256.slice(0, 12)}.json`,
      );
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
      setArchiveError(copy.plan.archive.errors.tooLarge);
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
          ? copy.plan.archive.errors.invalid
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
      downloadJson(
        blueprint,
        `napier-plan-blueprint-${blueprint.source.planId}-r${blueprint.source.planRevision}-${blueprint.contentSha256.slice(0, 12)}.json`,
      );
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
      setBlueprintError(copy.plan.blueprint.errors.tooLarge);
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
          ? copy.plan.blueprint.errors.invalid
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
      downloadJson(
        history,
        `napier-blueprint-replay-history-${history.recordId}-${history.contentSha256.slice(0, 12)}.json`,
      );
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
      setBlueprintLibraryError(copy.plan.blueprint.library.errors.tooLarge);
      return;
    }
    setBlueprintLibraryBusyAction("verifyHistory");
    setBlueprintLibraryReceipt(undefined);
    setBlueprintLibraryError(undefined);
    try {
      const history = JSON.parse(await file.text()) as unknown;
      const recordId = replayHistoryRecordId(history);
      if (!recordId) {
        setBlueprintLibraryError(copy.plan.blueprint.library.errors.invalid);
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
          ? copy.plan.blueprint.library.errors.invalid
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
      downloadJson(
        outcomes,
        `napier-blueprint-replay-outcomes-${outcomes.recordId}-${outcomes.contentSha256.slice(0, 12)}.json`,
      );
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
        copy.plan.blueprint.library.errors.outcomesTooLarge,
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
          copy.plan.blueprint.library.errors.outcomesInvalid,
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
          ? copy.plan.blueprint.library.errors.outcomesInvalid
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
    if (blueprintLibraryBusyAction || !review || review.recordId !== record.id) {
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
          <span>{copy.plan.eyebrow}</span>
          <h2 id="plan-title">{copy.plan.title}</h2>
        </div>
        <span className="plan-count">
          {plans.length} {copy.plan.count}
        </span>
      </div>
      {!plan ? (
        <p className="empty-panel">{copy.plan.empty}</p>
      ) : (
        <>
          <article className={`plan-sheet plan-${plan.status}`}>
            <header>
              <div>
                <span>{copy.plan.objective}</span>
                <h3>{plan.objective}</h3>
              </div>
              <span className="plan-status">
                {copy.plan.statuses[plan.status]}
              </span>
            </header>
            <div className="plan-progress">
              <div>
                <span>{copy.plan.progress}</span>
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
              aria-label={copy.plan.criticalPath}
            >
              <span>{copy.plan.criticalPath}</span>
              <strong>
                {criticalPath.length > 0
                  ? criticalPath.join(" -> ")
                  : copy.plan.none}
              </strong>
              <small>
                {copy.plan.readyPath}:{" "}
                {plan.readyStepIds.length > 0
                  ? plan.readyStepIds.join(", ")
                  : copy.plan.none}
                {" / "}
                {copy.plan.blockedPath}:{" "}
                {plan.blockedStepIds.length > 0
                  ? plan.blockedStepIds.join(", ")
                  : copy.plan.none}
              </small>
            </div>
            {latestReplan ? (
              <div className="plan-replan-ledger" aria-label={copy.plan.replan}>
                <span>{copy.plan.replan}</span>
                <strong>
                  {copy.plan.replanStrategies[latestReplan.strategy]}
                </strong>
                <small>
                  r{latestReplan.fromRevision} {"->"} r{latestReplan.toRevision}
                  {" / "}
                  {copy.plan.hash}: {latestReplan.replanSha256.slice(0, 12)}
                </small>
              </div>
            ) : null}
            {replanRecommendation ? (
              <div
                className="plan-replan-ledger plan-replan-signal"
                aria-label={copy.plan.replanSignal}
              >
                <span>{copy.plan.replanSignal}</span>
                <strong>
                  {copy.plan.replanStrategies[replanRecommendation.strategy]}
                </strong>
                <small>
                  r{replanRecommendation.expectedRevision}
                  {" / "}
                  {copy.plan.hash}:{" "}
                  {replanRecommendation.recommendationSha256.slice(0, 12)}
                  {" / "}
                  {copy.plan.draft}:{" "}
                  {replanRecommendation.draft.draftSha256.slice(0, 12)}
                  {" / "}
                  {copy.plan.score}:{" "}
                  {replanRecommendation.draft.evaluation.score}
                  {" / "}
                  {copy.plan.risk}:{" "}
                  {
                    copy.plan.replanRisks[
                      replanRecommendation.draft.evaluation.risk
                    ]
                  }
                </small>
                <button
                  className="plan-review-action"
                  type="button"
                  disabled={draftReviewBusy || draftApplyBusy}
                  onClick={() => void reviewDraft()}
                >
                  <Brain size={12} aria-hidden="true" />
                  {draftReviewBusy
                    ? copy.plan.reviewingDraft
                    : copy.plan.reviewDraft}
                </button>
                <button
                  className="plan-review-action plan-apply-action"
                  type="button"
                  disabled={draftReviewBusy || draftApplyBusy || running}
                  onClick={() => void applyDraft()}
                >
                  <ChevronRight size={12} aria-hidden="true" />
                  {draftApplyBusy
                    ? copy.plan.applyingDraft
                    : copy.plan.applyDraft}
                </button>
                {draftReview ? (
                  <div className="plan-replan-review">
                    <span>{copy.plan.modelReview}</span>
                    <strong>
                      {copy.plan.reviewVerdicts[draftReview.verdict]} /{" "}
                      {copy.plan.score} {draftReview.score} / {copy.plan.risk}{" "}
                      {copy.plan.replanRisks[draftReview.risk]}
                    </strong>
                    <small>
                      {copy.plan.hash}: {draftReview.reviewSha256.slice(0, 12)}
                      {" / "}
                      {copy.plan.response}:{" "}
                      {draftReview.responseSha256.slice(0, 12)}
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
              {plan.steps.map((step, index) => (
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
                      <span>{copy.plan.statuses[step.status]}</span>
                    </header>
                    <p>{step.description}</p>
                    <dl>
                      <div>
                        <dt>{copy.plan.dependsOn}</dt>
                        <dd>
                          {step.dependsOn.length > 0
                            ? step.dependsOn.join(", ")
                            : copy.plan.none}
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.plan.verification}</dt>
                        <dd>{step.verification}</dd>
                      </div>
                      {step.evidence ? (
                        <div>
                          <dt>{copy.plan.evidence}</dt>
                          <dd>{step.evidence}</dd>
                        </div>
                      ) : null}
                      {step.blocker ? (
                        <div>
                          <dt>{copy.plan.blocker}</dt>
                          <dd>{step.blocker}</dd>
                        </div>
                      ) : null}
                    </dl>
                    {step.runId ? <code>{step.runId}</code> : null}
                  </div>
                </li>
              ))}
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
        canCreateRecord={Boolean(threadId && !hasOpenPlan)}
        busyAction={blueprintLibraryBusyAction}
        receipt={blueprintLibraryReceipt}
        latestOutcomeReview={blueprintLibraryOutcomeReview}
        error={blueprintLibraryError}
        onRefresh={() => void refreshBlueprintLibrary()}
        onSave={() => void saveBlueprintRecord()}
        onSelect={() => void selectBestBlueprintRecord()}
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
            >
              <header>
                <h3 id="artifact-manifest-title">{copy.plan.artifacts}</h3>
                <span>{String(plan.artifacts.length).padStart(2, "0")}</span>
              </header>
              {plan.artifacts.map((artifact) => (
                <article key={artifact.id}>
                  <header>
                    <code>{artifact.path}</code>
                    <span>{copy.plan.statuses[artifact.status]}</span>
                  </header>
                  <p>{artifact.description}</p>
                  {artifact.evidence ? (
                    <small>{artifact.evidence}</small>
                  ) : null}
                  {artifact.sha256 ? (
                    <dl>
                      <div>
                        <dt>{copy.plan.digest}</dt>
                        <dd>
                          <code>{artifact.sha256.slice(0, 16)}</code>
                        </dd>
                      </div>
                      {artifact.sourceRunId ? (
                        <div>
                          <dt>{copy.plan.source}</dt>
                          <dd>
                            <code>{shortId(artifact.sourceRunId)}</code>
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}
                </article>
              ))}
            </section>
          ) : null}

          <button
            className="plan-continue"
            type="button"
            disabled={!readyStep || running || plan.status !== "active"}
            onClick={onContinue}
          >
            <ChevronRight size={13} aria-hidden="true" />
            {readyStep ? copy.plan.next : copy.plan.noReady}
          </button>
        </>
      ) : null}
      <p className="guardrail-note">
        <ShieldCheck size={13} aria-hidden="true" />
        {copy.plan.safety}
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

function PlanArchiveCard({
  receipt,
  busyAction,
  error,
  onExport,
  onVerify,
}: {
  receipt: PlanArchiveReceipt | undefined;
  busyAction: "export" | "verify" | undefined;
  error: string | undefined;
  onExport: () => void;
  onVerify: (file: File) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <section
      className="fixture-docket plan-archive-card"
      aria-labelledby="plan-archive-title"
    >
      <header>
        <div>
          <span>{copy.plan.archive.eyebrow}</span>
          <h3 id="plan-archive-title">{copy.plan.archive.title}</h3>
        </div>
        <Download size={14} aria-hidden="true" />
      </header>
      <p>{copy.plan.archive.body}</p>
      <div className="fixture-actions">
        <button type="button" disabled={Boolean(busyAction)} onClick={onExport}>
          <Download size={12} aria-hidden="true" />
          {busyAction === "export"
            ? copy.plan.archive.exporting
            : copy.plan.archive.export}
        </button>
        <button
          className="fixture-verify"
          type="button"
          disabled={Boolean(busyAction)}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={12} aria-hidden="true" />
          {busyAction === "verify"
            ? copy.plan.archive.verifying
            : copy.plan.archive.verify}
        </button>
        <input
          ref={fileInput}
          className="fixture-file-input"
          type="file"
          accept="application/json,.json"
          aria-label={copy.plan.archive.verify}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onVerify(file);
          }}
        />
      </div>
      {receipt ? <PlanArchiveReceiptView receipt={receipt} /> : null}
      {error ? <p className="plan-review-error">{error}</p> : null}
      <p className="fixture-safety">
        <ShieldCheck size={13} aria-hidden="true" />
        {copy.plan.archive.safety}
      </p>
    </section>
  );
}

function PlanArchiveReceiptView({ receipt }: { receipt: PlanArchiveReceipt }) {
  const status = receipt.action === "verified" ? receipt.status : "valid";
  const title =
    receipt.action === "exported"
      ? copy.plan.archive.exported
      : receipt.status === "valid"
        ? copy.plan.archive.verified
        : copy.plan.archive.invalid;
  return (
    <div className={`fixture-receipt status-${status}`}>
      <span>{title}</span>
      {receipt.contentSha256 ? (
        <code>{receipt.contentSha256.slice(0, 16)}</code>
      ) : null}
      <small>
        {receipt.revision !== undefined ? `r${receipt.revision} / ` : ""}
        {receipt.eventCount.toLocaleString()} {copy.plan.archive.events}
        {" / "}
        {receipt.stepCount.toLocaleString()} {copy.plan.archive.steps}
        {" / "}
        {receipt.artifactCount.toLocaleString()} {copy.plan.archive.artifacts}
        {" / "}
        {receipt.replanCount.toLocaleString()} {copy.plan.archive.replans}
      </small>
      {receipt.eventStreamSha256 ? (
        <small>
          {copy.plan.archive.eventStream}:{" "}
          {receipt.eventStreamSha256.slice(0, 16)}
        </small>
      ) : null}
      {receipt.action === "verified" ? (
        <small className="fixture-diagnostics">
          {receipt.diagnostics.length > 0
            ? receipt.diagnostics.join(", ")
            : copy.plan.archive.noDiagnostics}
        </small>
      ) : null}
    </div>
  );
}

function PlanBlueprintCard({
  hasPlan,
  canCreate,
  receipt,
  busyAction,
  error,
  onExport,
  onVerify,
  onCreate,
}: {
  hasPlan: boolean;
  canCreate: boolean;
  receipt: PlanBlueprintReceipt | undefined;
  busyAction: "export" | "verify" | "create" | undefined;
  error: string | undefined;
  onExport: () => void;
  onVerify: (file: File) => void;
  onCreate: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <section
      className="fixture-docket plan-blueprint-card"
      aria-labelledby="plan-blueprint-title"
    >
      <header>
        <div>
          <span>{copy.plan.blueprint.eyebrow}</span>
          <h3 id="plan-blueprint-title">{copy.plan.blueprint.title}</h3>
        </div>
        <BookGlyph />
      </header>
      <p>{copy.plan.blueprint.body}</p>
      <div className="fixture-actions">
        <button
          type="button"
          disabled={Boolean(busyAction) || !hasPlan}
          onClick={onExport}
        >
          <Download size={12} aria-hidden="true" />
          {busyAction === "export"
            ? copy.plan.blueprint.exporting
            : copy.plan.blueprint.export}
        </button>
        <button
          className="fixture-verify"
          type="button"
          disabled={Boolean(busyAction)}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={12} aria-hidden="true" />
          {busyAction === "verify"
            ? copy.plan.blueprint.verifying
            : copy.plan.blueprint.verify}
        </button>
        <button
          className="fixture-import"
          type="button"
          disabled={Boolean(busyAction) || !canCreate}
          onClick={onCreate}
        >
          <ChevronRight size={12} aria-hidden="true" />
          {busyAction === "create"
            ? copy.plan.blueprint.creating
            : copy.plan.blueprint.create}
        </button>
        <input
          ref={fileInput}
          className="fixture-file-input"
          type="file"
          accept="application/json,.json"
          aria-label={copy.plan.blueprint.verify}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onVerify(file);
          }}
        />
      </div>
      {receipt ? <PlanBlueprintReceiptView receipt={receipt} /> : null}
      {error ? <p className="plan-review-error">{error}</p> : null}
      <p className="fixture-safety">
        <ShieldCheck size={13} aria-hidden="true" />
        {copy.plan.blueprint.safety}
      </p>
    </section>
  );
}

function PlanBlueprintReceiptView({
  receipt,
}: {
  receipt: PlanBlueprintReceipt;
}) {
  const status = receipt.action === "verified" ? receipt.status : "valid";
  const title =
    receipt.action === "exported"
      ? copy.plan.blueprint.exported
      : receipt.action === "created"
        ? copy.plan.blueprint.created
        : receipt.status === "valid"
          ? copy.plan.blueprint.verified
          : copy.plan.blueprint.invalid;
  return (
    <div className={`fixture-receipt status-${status}`}>
      <span>{title}</span>
      {receipt.contentSha256 ? (
        <code>{receipt.contentSha256.slice(0, 16)}</code>
      ) : null}
      <small>
        {"sourcePlanRevision" in receipt &&
        receipt.sourcePlanRevision !== undefined
          ? `r${receipt.sourcePlanRevision} / `
          : ""}
        {receipt.stepCount.toLocaleString()} {copy.plan.blueprint.steps}
        {" / "}
        {receipt.artifactCount.toLocaleString()} {copy.plan.blueprint.artifacts}
        {"planId" in receipt ? ` / ${shortId(receipt.planId)}` : ""}
      </small>
      {receipt.action === "verified" ? (
        <small className="fixture-diagnostics">
          {receipt.diagnostics.length > 0
            ? receipt.diagnostics.join(", ")
            : copy.plan.blueprint.noDiagnostics}
        </small>
      ) : null}
    </div>
  );
}

function PlanBlueprintLibraryCard({
  records,
  loaded,
  hasVerifiedBlueprint,
  canSave,
  canSelect,
  canCreateRecord,
  busyAction,
  receipt,
  latestOutcomeReview,
  error,
  onRefresh,
  onSave,
  onSelect,
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
  canCreateRecord: boolean;
  busyAction: PlanBlueprintLibraryBusyAction | undefined;
  receipt: PlanBlueprintLibraryReceipt | undefined;
  latestOutcomeReview: ExecutionPlanBlueprintRecordOutcomeReview | undefined;
  error: string | undefined;
  onRefresh: () => void;
  onSave: () => void;
  onSelect: () => void;
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
  const busy = Boolean(busyAction);
  const activeCount = records.filter(
    (record) => record.status === "active",
  ).length;
  const archivedCount = records.length - activeCount;
  return (
    <section
      className="fixture-docket plan-blueprint-library-card"
      aria-labelledby="plan-blueprint-library-title"
    >
      <header>
        <div>
          <span>{copy.plan.blueprint.library.eyebrow}</span>
          <h3 id="plan-blueprint-library-title">
            {copy.plan.blueprint.library.title}
          </h3>
        </div>
        <BookGlyph />
      </header>
      <p>{copy.plan.blueprint.library.body}</p>
      <div className="fixture-actions">
        <button type="button" disabled={busy} onClick={onRefresh}>
          <Download size={12} aria-hidden="true" />
          {busyAction === "load"
            ? copy.plan.blueprint.library.refreshing
            : copy.plan.blueprint.library.refresh}
        </button>
        <button
          className="fixture-verify"
          type="button"
          disabled={busy || !canSelect || records.length === 0}
          onClick={onSelect}
        >
          <ShieldCheck size={12} aria-hidden="true" />
          {busyAction === "select"
            ? copy.plan.blueprint.library.selecting
            : copy.plan.blueprint.library.select}
        </button>
        <button
          className="fixture-verify"
          type="button"
          disabled={busy}
          onClick={() => historyInput.current?.click()}
        >
          <Upload size={12} aria-hidden="true" />
          {busyAction === "verifyHistory"
            ? copy.plan.blueprint.library.verifyingHistory
            : copy.plan.blueprint.library.verifyHistory}
        </button>
        <button
          className="fixture-import"
          type="button"
          disabled={busy || !canSave}
          onClick={onSave}
        >
          <Upload size={12} aria-hidden="true" />
          {busyAction === "save"
            ? copy.plan.blueprint.library.saving
            : copy.plan.blueprint.library.save}
        </button>
        <button
          className="fixture-verify"
          type="button"
          disabled={busy}
          onClick={() => outcomesInput.current?.click()}
        >
          <Upload size={12} aria-hidden="true" />
          {busyAction === "verifyOutcomes"
            ? copy.plan.blueprint.library.verifyingOutcomes
            : copy.plan.blueprint.library.verifyOutcomes}
        </button>
        <input
          ref={historyInput}
          className="fixture-file-input"
          type="file"
          accept="application/json,.json"
          aria-label={copy.plan.blueprint.library.verifyHistory}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onVerifyHistory(file);
          }}
        />
        <input
          ref={outcomesInput}
          className="fixture-file-input"
          type="file"
          accept="application/json,.json"
          aria-label={copy.plan.blueprint.library.verifyOutcomes}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onVerifyOutcomes(file);
          }}
        />
      </div>
      {!hasVerifiedBlueprint ? (
        <small className="blueprint-library-hint">
          {copy.plan.blueprint.library.noVerified}
        </small>
      ) : null}
      {loaded ? (
        <div className="blueprint-library-summary">
          <span>
            {records.length.toLocaleString()}{" "}
            {copy.plan.blueprint.library.records}
          </span>
          <span>
            {activeCount.toLocaleString()} {copy.plan.blueprint.library.active}
          </span>
          <span>
            {archivedCount.toLocaleString()}{" "}
            {copy.plan.blueprint.library.archived}
          </span>
        </div>
      ) : null}
      {receipt ? <PlanBlueprintLibraryReceiptView receipt={receipt} /> : null}
      {error ? <p className="plan-review-error">{error}</p> : null}
      {loaded && records.length === 0 ? (
        <p className="blueprint-library-empty">
          {copy.plan.blueprint.library.empty}
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
                    {copy.plan.blueprint.library.statuses[record.status]}
                  </span>
                </div>
                <code>{record.blueprintSha256.slice(0, 16)}</code>
              </header>
              {record.description ? <p>{record.description}</p> : null}
              <dl>
                <div>
                  <dt>{copy.plan.blueprint.library.source}</dt>
                  <dd>
                    {shortId(record.sourcePlanId)} r{record.sourcePlanRevision}
                  </dd>
                </div>
                <div>
                  <dt>{copy.plan.blueprint.library.shape}</dt>
                  <dd>
                    {record.blueprint.stepCount.toLocaleString()}{" "}
                    {copy.plan.blueprint.steps}
                    {" / "}
                    {record.blueprint.artifactCount.toLocaleString()}{" "}
                    {copy.plan.blueprint.artifacts}
                  </dd>
                </div>
                <div>
                  <dt>{copy.plan.blueprint.library.updated}</dt>
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
                    ? copy.plan.blueprint.library.creating
                    : copy.plan.blueprint.library.create}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onQualify(record)}
                >
                  {busyAction === "qualify"
                    ? copy.plan.blueprint.library.qualifying
                    : copy.plan.blueprint.library.qualify}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPreview(record)}
                >
                  {busyAction === "preview"
                    ? copy.plan.blueprint.library.previewing
                    : copy.plan.blueprint.library.preview}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onHistory(record)}
                >
                  {busyAction === "history"
                    ? copy.plan.blueprint.library.loadingHistory
                    : copy.plan.blueprint.library.history}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onOutcomes(record)}
                >
                  {busyAction === "outcomes"
                    ? copy.plan.blueprint.library.loadingOutcomes
                    : copy.plan.blueprint.library.outcomes}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPromoteOutcomeBaseline(record)}
                >
                  {busyAction === "promoteOutcomeBaseline"
                    ? copy.plan.blueprint.library.promotingOutcomeBaseline
                    : copy.plan.blueprint.library.promoteOutcomeBaseline}
                </button>
                {latestOutcomeReview?.recordId === record.id ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onPromoteReviewedOutcomeBaseline(record)}
                  >
                    {busyAction === "promoteReviewedOutcomeBaseline"
                      ? copy.plan.blueprint.library
                          .promotingReviewedOutcomeBaseline
                      : copy.plan.blueprint.library.promoteReviewedOutcomeBaseline}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onQualifyOutcomes(record)}
                >
                  {busyAction === "qualifyOutcomes"
                    ? copy.plan.blueprint.library.qualifyingOutcomes
                    : copy.plan.blueprint.library.qualifyOutcomes}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onReviewOutcomes(record)}
                >
                  {busyAction === "reviewOutcomes"
                    ? copy.plan.blueprint.library.reviewingOutcomes
                    : copy.plan.blueprint.library.reviewOutcomes}
                </button>
                {record.status === "active" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onArchive(record)}
                  >
                    {busyAction === "status"
                      ? copy.plan.blueprint.library.archiving
                      : copy.plan.blueprint.library.archive}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRestore(record)}
                  >
                    {busyAction === "status"
                      ? copy.plan.blueprint.library.restoring
                      : copy.plan.blueprint.library.restore}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {!canCreateRecord ? (
        <small className="blueprint-library-hint">
          {copy.plan.blueprint.library.locked}
        </small>
      ) : null}
      <p className="fixture-safety">
        <ShieldCheck size={13} aria-hidden="true" />
        {copy.plan.blueprint.library.safety}
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
                  : receipt.action === "created" &&
                      receipt.replayEventVerificationStatus
                    ? receipt.replayEventVerificationStatus === "valid"
                    : receipt.action === "created" &&
                        receipt.replayEventDiagnostics
                      ? false
                      : true;
  const title =
    receipt.action === "qualified"
      ? copy.plan.blueprint.library.qualificationStatuses[
          receipt.qualificationStatus
        ]
      : receipt.action === "previewed"
        ? copy.plan.blueprint.library.previewStatuses[receipt.previewStatus]
        : receipt.action === "historyVerified"
          ? copy.plan.blueprint.library.verificationStatuses[
              receipt.verificationStatus
            ]
          : receipt.action === "outcomesVerified"
            ? copy.plan.blueprint.library.outcomeVerificationStatuses[
                receipt.verificationStatus
              ]
            : receipt.action === "outcomeQualified"
              ? copy.plan.blueprint.library.outcomeQualificationStatuses[
                  receipt.qualificationStatus
                ]
              : receipt.action === "outcomeReviewed"
                ? copy.plan.blueprint.library.outcomeReviewVerdicts[
                    receipt.verdict
                  ]
                : receipt.action === "selection"
                  ? copy.plan.blueprint.library.receipts.selection
                  : copy.plan.blueprint.library.receipts[receipt.action];
  const receiptHash =
    "blueprintSha256" in receipt
      ? receipt.blueprintSha256
      : receipt.action === "history" ||
          receipt.action === "historyVerified" ||
          receipt.action === "outcomes" ||
          receipt.action === "outcomesVerified" ||
          receipt.action === "selection" ||
          receipt.action === "outcomeQualified"
        ? receipt.contentSha256
        : receipt.action === "outcomeBaseline"
          ? receipt.baselineSha256
          : receipt.action === "outcomeReviewed"
            ? receipt.reviewSha256
            : undefined;
  const summary =
    receipt.action === "history" || receipt.action === "historyVerified"
      ? `${receipt.replayCount.toLocaleString()} ${copy.plan.blueprint.library.replays} / ${receipt.threadCount.toLocaleString()} ${copy.plan.blueprint.library.threads} / ${receipt.planCount.toLocaleString()} ${copy.plan.blueprint.library.plans}`
      : receipt.action === "outcomes" ||
          receipt.action === "outcomesVerified" ||
          receipt.action === "outcomeBaseline" ||
          receipt.action === "outcomeReviewed" ||
          receipt.action === "outcomeQualified"
        ? `${receipt.replayCount.toLocaleString()} ${copy.plan.blueprint.library.replays} / ${receipt.completedCount.toLocaleString()} ${copy.plan.blueprint.library.completed} / ${receipt.blockedCount.toLocaleString()} ${copy.plan.blueprint.library.blocked} / ${receipt.invalidCount.toLocaleString()} ${copy.plan.blueprint.library.invalid}`
        : receipt.action === "selection"
          ? `${receipt.candidateCount.toLocaleString()} ${copy.plan.blueprint.library.candidates} / ${receipt.qualifiedCandidateCount.toLocaleString()} ${copy.plan.blueprint.library.qualified} / ${receipt.rejectedCandidateCount.toLocaleString()} ${copy.plan.blueprint.library.rejected}`
          : `${receipt.stepCount.toLocaleString()} ${copy.plan.blueprint.steps} / ${receipt.artifactCount.toLocaleString()} ${copy.plan.blueprint.artifacts}`;
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
                  : receipt.action === "historyVerified" ||
                      receipt.action === "outcomesVerified" ||
                      receipt.action === "outcomeQualified"
                    ? receipt.recordId
                      ? shortId(receipt.recordId)
                      : undefined
                    : "status" in receipt
                      ? copy.plan.blueprint.library.statuses[receipt.status]
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
              : copy.plan.blueprint.library.noDiagnostics}
          </small>
          {receipt.action === "qualified" &&
          receipt.expectedPlanArchiveSha256 ? (
            <small className="fixture-diagnostics">
              {copy.plan.blueprint.library.expected}:{" "}
              {receipt.expectedPlanArchiveSha256.slice(0, 16)}
              {receipt.actualPlanArchiveSha256
                ? ` / ${copy.plan.blueprint.library.actual}: ${receipt.actualPlanArchiveSha256.slice(0, 16)}`
                : ""}
            </small>
          ) : null}
        </>
      ) : null}
      {receipt.action === "history" ? (
        <small className="fixture-diagnostics">
          {copy.plan.blueprint.library.eventSet}:{" "}
          {receipt.eventSetSha256.slice(0, 16)}
          {receipt.latestPreviewSha256
            ? ` / ${copy.plan.blueprint.library.latestPreview}: ${receipt.latestPreviewSha256.slice(0, 16)}`
            : ""}
        </small>
      ) : null}
      {receipt.action === "historyVerified" ? (
        <>
          <small className="fixture-diagnostics">
            {receipt.diagnostics.length > 0
              ? receipt.diagnostics.join(", ")
              : copy.plan.blueprint.library.noDiagnostics}
          </small>
          <small className="fixture-diagnostics">
            {copy.plan.blueprint.library.declared}:{" "}
            {receipt.declaredContentSha256?.slice(0, 16) ?? "missing"}
            {receipt.observedContentSha256
              ? ` / ${copy.plan.blueprint.library.observed}: ${receipt.observedContentSha256.slice(0, 16)}`
              : ""}
          </small>
          {receipt.declaredEventSetSha256 || receipt.observedEventSetSha256 ? (
            <small className="fixture-diagnostics">
              {copy.plan.blueprint.library.eventSet}:{" "}
              {receipt.declaredEventSetSha256?.slice(0, 16) ?? "missing"}
              {receipt.observedEventSetSha256
                ? ` / ${copy.plan.blueprint.library.observed}: ${receipt.observedEventSetSha256.slice(0, 16)}`
                : ""}
            </small>
          ) : null}
        </>
      ) : null}
      {receipt.action === "outcomes" ? (
        <>
          <small className="fixture-diagnostics">
            {copy.plan.blueprint.library.replayHistory}:{" "}
            {receipt.replayHistorySha256.slice(0, 16)}
            {" / "}
            {copy.plan.blueprint.library.outcomeSet}:{" "}
            {receipt.outcomeSetSha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {copy.plan.blueprint.library.completion}:{" "}
            {(receipt.completionRateBps / 100).toFixed(2)}%{" / "}
            {receipt.activeCount.toLocaleString()}{" "}
            {copy.plan.blueprint.library.active}
            {" / "}
            {receipt.cancelledCount.toLocaleString()}{" "}
            {copy.plan.blueprint.library.cancelled}
            {receipt.latestStatus
              ? ` / ${copy.plan.blueprint.library.latest}: ${copy.plan.blueprint.library.outcomeStatuses[receipt.latestStatus]}`
              : ""}
          </small>
        </>
      ) : null}
      {receipt.action === "outcomesVerified" ? (
        <>
          <small className="fixture-diagnostics">
            {receipt.diagnostics.length > 0
              ? receipt.diagnostics.join(", ")
              : copy.plan.blueprint.library.noDiagnostics}
          </small>
          <small className="fixture-diagnostics">
            {copy.plan.blueprint.library.declared}:{" "}
            {receipt.declaredContentSha256?.slice(0, 16) ?? "missing"}
            {receipt.observedContentSha256
              ? ` / ${copy.plan.blueprint.library.observed}: ${receipt.observedContentSha256.slice(0, 16)}`
              : ""}
          </small>
          {receipt.declaredOutcomeSetSha256 ||
          receipt.observedOutcomeSetSha256 ? (
            <small className="fixture-diagnostics">
              {copy.plan.blueprint.library.outcomeSet}:{" "}
              {receipt.declaredOutcomeSetSha256?.slice(0, 16) ?? "missing"}
              {receipt.observedOutcomeSetSha256
                ? ` / ${copy.plan.blueprint.library.observed}: ${receipt.observedOutcomeSetSha256.slice(0, 16)}`
                : ""}
            </small>
          ) : null}
        </>
      ) : null}
      {receipt.action === "outcomeBaseline" ? (
        <>
          <small className="fixture-diagnostics">
            {receipt.created
              ? copy.plan.blueprint.library.outcomeBaselineCreated
              : copy.plan.blueprint.library.outcomeBaselineReused}
            {" / "}
            {copy.plan.blueprint.library.outcomeBaseline}:{" "}
            {receipt.baselineSha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {copy.plan.blueprint.library.completion}:{" "}
            {(receipt.completionRateBps / 100).toFixed(2)}%{" / "}
            {copy.plan.blueprint.library.min}:{" "}
            {(receipt.minCompletionRateBps / 100).toFixed(2)}%
          </small>
          {receipt.reviewSha256 ? (
            <small className="fixture-diagnostics">
              {copy.plan.blueprint.library.review}:{" "}
              {receipt.reviewSha256.slice(0, 16)}
              {receipt.reviewScore !== undefined
                ? ` / ${copy.plan.blueprint.library.score}: ${receipt.reviewScore.toLocaleString()}`
                : ""}
              {receipt.reviewRisk
                ? ` / ${copy.plan.blueprint.library.risk}: ${copy.plan.blueprint.library.outcomeReviewRisks[receipt.reviewRisk]}`
                : ""}
              {receipt.reviewVerdict
                ? ` / ${copy.plan.blueprint.library.outcomeReviewVerdicts[receipt.reviewVerdict]}`
                : ""}
              {receipt.reviewGateMinScore !== undefined
                ? ` / ${copy.plan.blueprint.library.min}: ${receipt.reviewGateMinScore.toLocaleString()}`
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
              : copy.plan.blueprint.library.noDiagnostics}
          </small>
          <small className="fixture-diagnostics">
            {copy.plan.blueprint.library.current}:{" "}
            {receipt.currentOutcomesSha256.slice(0, 16)}
            {receipt.baselineSha256
              ? ` / ${copy.plan.blueprint.library.outcomeBaseline}: ${receipt.baselineSha256.slice(0, 16)}`
              : ""}
          </small>
          <small className="fixture-diagnostics">
            {copy.plan.blueprint.library.completion}:{" "}
            {(receipt.completionRateBps / 100).toFixed(2)}%
            {receipt.minCompletionRateBps !== undefined
              ? ` / ${copy.plan.blueprint.library.min}: ${(receipt.minCompletionRateBps / 100).toFixed(2)}%`
              : ""}
          </small>
        </>
      ) : null}
      {receipt.action === "outcomeReviewed" ? (
        <>
          <small className="fixture-diagnostics">
            {copy.plan.blueprint.library.score}:{" "}
            {receipt.score.toLocaleString()}
            {" / "}
            {copy.plan.blueprint.library.risk}:{" "}
            {copy.plan.blueprint.library.outcomeReviewRisks[receipt.risk]}
          </small>
          <small className="fixture-diagnostics">
            {copy.plan.blueprint.library.current}:{" "}
            {receipt.replayOutcomesSha256.slice(0, 16)}
            {receipt.baselineSha256
              ? ` / ${copy.plan.blueprint.library.outcomeBaseline}: ${receipt.baselineSha256.slice(0, 16)}`
              : ""}
          </small>
          <small className="fixture-diagnostics">
            {copy.plan.blueprint.library.input}:{" "}
            {receipt.inputSha256.slice(0, 16)}
            {" / "}
            {copy.plan.blueprint.library.response}:{" "}
            {receipt.responseSha256.slice(0, 16)}
          </small>
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
            {copy.plan.blueprint.library.selectionSet}:{" "}
            {receipt.selectionSetSha256.slice(0, 16)}
            {receipt.selectedPreviewSha256
              ? ` / ${copy.plan.blueprint.library.latestPreview}: ${receipt.selectedPreviewSha256.slice(0, 16)}`
              : ""}
          </small>
          <small className="fixture-diagnostics">
            {receipt.selectedRecordId
              ? `${copy.plan.blueprint.library.selected}: ${shortId(receipt.selectedRecordId)}`
              : receipt.diagnostics.length > 0
                ? receipt.diagnostics.join(", ")
                : copy.plan.blueprint.library.noDiagnostics}
            {receipt.selectedBaselineSha256
              ? ` / ${copy.plan.blueprint.library.outcomeBaseline}: ${receipt.selectedBaselineSha256.slice(0, 16)}`
              : ""}
          </small>
          {receipt.selectedScoreBps !== undefined ? (
            <small className="fixture-diagnostics">
              {copy.plan.blueprint.library.score}:{" "}
              {(receipt.selectedScoreBps / 100).toFixed(2)}%{" / "}
              {copy.plan.blueprint.library.replays}:{" "}
              {(receipt.selectedReplayCount ?? 0).toLocaleString()}
            </small>
          ) : null}
        </>
      ) : null}
      {receipt.action === "created" &&
      (receipt.replayEventSha256 ||
        receipt.replayEventVerificationStatus ||
        receipt.replayEventDiagnostics) ? (
        <>
          {receipt.replayEventSha256 ? (
            <small className="fixture-diagnostics">
              {copy.plan.blueprint.library.eventAnchor}:{" "}
              {receipt.replayEventSha256.slice(0, 16)}
              {receipt.replayEventId
                ? ` / ${shortId(receipt.replayEventId)}`
                : ""}
            </small>
          ) : null}
          {receipt.replayEventVerificationStatus ? (
            <small className="fixture-diagnostics">
              {receipt.replayEventVerificationStatus === "valid"
                ? copy.plan.blueprint.library.eventVerified
                : copy.plan.blueprint.library.eventInvalid}
              {receipt.replayEventVerificationSha256
                ? ` / ${copy.plan.blueprint.library.eventVerification}: ${receipt.replayEventVerificationSha256.slice(0, 16)}`
                : ""}
            </small>
          ) : null}
          {receipt.replayEventDiagnostics ? (
            <small className="fixture-diagnostics">
              {receipt.replayEventDiagnostics.length > 0
                ? receipt.replayEventDiagnostics.join(", ")
                : copy.plan.blueprint.library.noDiagnostics}
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
