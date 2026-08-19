import type {
  ExecutionPlanBlueprintRecord,
  ExecutionPlanBlueprintRecordReplayEventVerification,
} from "@napier/contracts";

import {
  createExecutionPlanFromBlueprintRecordWithReplayEvent,
  getExecutionPlanBlueprintRecordQualification,
  getExecutionPlanBlueprintRecordReplays,
  getExecutionPlanBlueprintRecords,
  previewExecutionPlanFromBlueprintRecord,
  saveExecutionPlanBlueprint,
  setExecutionPlanBlueprintRecordStatus,
  verifyExecutionPlanBlueprintRecordReplayEvent,
  verifyExecutionPlanBlueprintRecordReplays,
} from "./api";
import { formatApiErrorMessage } from "./api-error";
import type { PlanBlueprintLibraryCardActions } from "./PlanBlueprintLibraryCard";
import {
  planBlueprintPreviewFromError,
  replayHistoryRecordId,
  upsertBlueprintRecord,
} from "./plan-blueprint-panel-model";
import {
  planBlueprintCreatedReceipt,
  planBlueprintPreviewReceipt,
  planBlueprintQualificationReceipt,
  planBlueprintReplayHistoryFilename,
  planBlueprintReplayHistoryReceipt,
  planBlueprintReplayHistoryVerificationReceipt,
} from "./plan-blueprint-library-view-model";
import type { PlanBlueprintLibraryActionContext } from "./plan-blueprint-library-controller-types";
import {
  patchBlueprintLibraryState,
  runBlueprintLibraryAction,
} from "./plan-blueprint-library-controller-types";
import {
  downloadPlanJson,
  MAX_PLAN_BLUEPRINT_REPLAY_HISTORY_FILE_BYTES,
} from "./plan-panel-helpers";
import { planCopy } from "./plan-copy";

type RecordActions = Pick<
  PlanBlueprintLibraryCardActions,
  | "onRefresh"
  | "onSave"
  | "onArchive"
  | "onRestore"
  | "onQualify"
  | "onPreview"
  | "onHistory"
  | "onVerifyHistory"
  | "onCreate"
>;

export function createPlanBlueprintRecordActions(
  context: PlanBlueprintLibraryActionContext,
): RecordActions {
  const onRefresh = (): void => {
    void runBlueprintLibraryAction(
      context,
      "load",
      getExecutionPlanBlueprintRecords,
      (records) => ({ records, loaded: true }),
    );
  };

  const onSave = (): void => {
    if (!context.threadId || !context.verifiedBlueprint) return;
    const blueprint = context.verifiedBlueprint;
    void runBlueprintLibraryAction(
      context,
      "save",
      () =>
        saveExecutionPlanBlueprint(context.threadId!, {
          blueprint,
          name: blueprint.title,
        }),
      (result) => ({
        records: upsertBlueprintRecord(context.state.records, result.record),
        loaded: true,
        receipt: {
          action: result.created ? "saved" : "reused",
          recordId: result.record.id,
          blueprintSha256: result.record.blueprintSha256,
          status: result.record.status,
          stepCount: result.record.blueprint.stepCount,
          artifactCount: result.record.blueprint.artifactCount,
        },
      }),
    );
  };

  const updateStatus = (
    record: ExecutionPlanBlueprintRecord,
    status: ExecutionPlanBlueprintRecord["status"],
  ): void => {
    void runBlueprintLibraryAction(
      context,
      "status",
      () => setExecutionPlanBlueprintRecordStatus(record.id, { status }),
      (updated) => ({
        records: upsertBlueprintRecord(context.state.records, updated),
        receipt: {
          action: status === "active" ? "restored" : "archived",
          recordId: updated.id,
          blueprintSha256: updated.blueprintSha256,
          status: updated.status,
          stepCount: updated.blueprint.stepCount,
          artifactCount: updated.blueprint.artifactCount,
        },
      }),
    );
  };

  const onQualify = (record: ExecutionPlanBlueprintRecord): void => {
    void runBlueprintLibraryAction(
      context,
      "qualify",
      () => getExecutionPlanBlueprintRecordQualification(record.id),
      (result) => ({ receipt: planBlueprintQualificationReceipt(result) }),
    );
  };

  const onPreview = (record: ExecutionPlanBlueprintRecord): void => {
    if (!context.threadId) return;
    void runBlueprintLibraryAction(
      context,
      "preview",
      () =>
        previewExecutionPlanFromBlueprintRecord(context.threadId!, {
          recordId: record.id,
        }),
      (result) => ({ receipt: planBlueprintPreviewReceipt(result) }),
    );
  };

  const onHistory = (record: ExecutionPlanBlueprintRecord): void => {
    void runBlueprintLibraryAction(
      context,
      "history",
      () => getExecutionPlanBlueprintRecordReplays(record.id),
      (history) => {
        downloadPlanJson(history, planBlueprintReplayHistoryFilename(history));
        return { receipt: planBlueprintReplayHistoryReceipt(history) };
      },
    );
  };

  const onVerifyHistory = (file: File): void => {
    if (file.size > MAX_PLAN_BLUEPRINT_REPLAY_HISTORY_FILE_BYTES) {
      patchBlueprintLibraryState(context, {
        error: planCopy.blueprint.library.errors.tooLarge,
      });
      return;
    }
    void runBlueprintLibraryAction(
      context,
      "verifyHistory",
      async () => {
        const history = JSON.parse(await file.text()) as unknown;
        const recordId = replayHistoryRecordId(history);
        if (!recordId)
          throw new Error(planCopy.blueprint.library.errors.invalid);
        return verifyExecutionPlanBlueprintRecordReplays(recordId, { history });
      },
      (result) => ({
        receipt: planBlueprintReplayHistoryVerificationReceipt(result),
      }),
      {
        formatError: (error) =>
          error instanceof SyntaxError
            ? planCopy.blueprint.library.errors.invalid
            : formatApiErrorMessage(error),
      },
    );
  };

  const onCreate = (record: ExecutionPlanBlueprintRecord): void => {
    if (!context.threadId || context.hasOpenPlan) return;
    void runBlueprintLibraryAction(
      context,
      "create",
      () => createPlanFromRecord(context, record),
      async (receipt) => {
        if (receipt.action === "created") await context.onChanged();
        return { receipt };
      },
    );
  };

  return {
    onRefresh,
    onSave,
    onArchive: (record) => updateStatus(record, "archived"),
    onRestore: (record) => updateStatus(record, "active"),
    onQualify,
    onPreview,
    onHistory,
    onVerifyHistory,
    onCreate,
  };
}

async function createPlanFromRecord(
  context: PlanBlueprintLibraryActionContext,
  record: ExecutionPlanBlueprintRecord,
) {
  try {
    const preview = await previewExecutionPlanFromBlueprintRecord(
      context.threadId!,
      { recordId: record.id },
    );
    if (preview.status !== "ready") return planBlueprintPreviewReceipt(preview);
    const created = await createExecutionPlanFromBlueprintRecordWithReplayEvent(
      context.threadId!,
      { recordId: record.id, expectedPreviewSha256: preview.previewSha256 },
    );
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
    return planBlueprintCreatedReceipt({
      record,
      plan: created.plan,
      ...(created.replayEvent ? { replayEvent: created.replayEvent } : {}),
      ...(replayEventVerification ? { replayEventVerification } : {}),
      ...(replayEventDiagnostics ? { replayEventDiagnostics } : {}),
    });
  } catch (error) {
    const preview = planBlueprintPreviewFromError(error);
    if (preview) return planBlueprintPreviewReceipt(preview);
    throw error;
  }
}
