import type { ExecutionPlanBlueprintRecord } from "@napier/contracts";

import {
  getExecutionPlanBlueprintRecordOutcomeQualification,
  getExecutionPlanBlueprintRecordReplayOutcomes,
  promoteExecutionPlanBlueprintRecordOutcomeBaseline,
  reviewExecutionPlanBlueprintRecordOutcomes,
  verifyExecutionPlanBlueprintRecordReplayOutcomes,
} from "./api";
import { formatApiErrorMessage } from "./api-error";
import type { PlanBlueprintLibraryCardActions } from "./PlanBlueprintLibraryCard";
import { replayOutcomesRecordId } from "./plan-blueprint-panel-model";
import {
  planBlueprintOutcomeBaselineReceipt,
  planBlueprintOutcomeQualificationReceipt,
  planBlueprintOutcomeReviewReceipt,
  planBlueprintReplayOutcomesFilename,
  planBlueprintReplayOutcomesReceipt,
  planBlueprintReplayOutcomesVerificationReceipt,
} from "./plan-blueprint-library-view-model";
import type { PlanBlueprintLibraryActionContext } from "./plan-blueprint-library-controller-types";
import {
  patchBlueprintLibraryState,
  runBlueprintLibraryAction,
} from "./plan-blueprint-library-controller-types";
import {
  downloadPlanJson,
  MAX_PLAN_BLUEPRINT_REPLAY_OUTCOMES_FILE_BYTES,
  parsePlanModelKey,
} from "./plan-panel-helpers";
import { planCopy } from "./plan-copy";

type OutcomeActions = Pick<
  PlanBlueprintLibraryCardActions,
  | "onOutcomes"
  | "onVerifyOutcomes"
  | "onPromoteOutcomeBaseline"
  | "onPromoteReviewedOutcomeBaseline"
  | "onQualifyOutcomes"
  | "onReviewOutcomes"
>;

export function createPlanBlueprintOutcomeActions(
  context: PlanBlueprintLibraryActionContext,
): OutcomeActions {
  const onOutcomes = (record: ExecutionPlanBlueprintRecord): void => {
    void runBlueprintLibraryAction(
      context,
      "outcomes",
      () => getExecutionPlanBlueprintRecordReplayOutcomes(record.id),
      (outcomes) => {
        downloadPlanJson(
          outcomes,
          planBlueprintReplayOutcomesFilename(outcomes),
        );
        return { receipt: planBlueprintReplayOutcomesReceipt(outcomes) };
      },
    );
  };

  const onVerifyOutcomes = (file: File): void => {
    if (file.size > MAX_PLAN_BLUEPRINT_REPLAY_OUTCOMES_FILE_BYTES) {
      patchBlueprintLibraryState(context, {
        error: planCopy.blueprint.library.errors.outcomesTooLarge,
      });
      return;
    }
    void runBlueprintLibraryAction(
      context,
      "verifyOutcomes",
      async () => {
        const outcomes = JSON.parse(await file.text()) as unknown;
        const recordId = replayOutcomesRecordId(outcomes);
        if (!recordId) {
          throw new Error(planCopy.blueprint.library.errors.outcomesInvalid);
        }
        return verifyExecutionPlanBlueprintRecordReplayOutcomes(recordId, {
          outcomes,
        });
      },
      (result) => ({
        receipt: planBlueprintReplayOutcomesVerificationReceipt(result),
      }),
      {
        formatError: (error) =>
          error instanceof SyntaxError
            ? planCopy.blueprint.library.errors.outcomesInvalid
            : formatApiErrorMessage(error),
      },
    );
  };

  const promote = (
    record: ExecutionPlanBlueprintRecord,
    reviewed: boolean,
  ): void => {
    const review = reviewed ? context.state.outcomeReview : undefined;
    if (reviewed && (!review || review.recordId !== record.id)) return;
    void runBlueprintLibraryAction(
      context,
      reviewed ? "promoteReviewedOutcomeBaseline" : "promoteOutcomeBaseline",
      async () => {
        const outcomes = await getExecutionPlanBlueprintRecordReplayOutcomes(
          record.id,
        );
        return promoteExecutionPlanBlueprintRecordOutcomeBaseline(record.id, {
          outcomes,
          ...(review ? { review } : {}),
        });
      },
      (result) => ({ receipt: planBlueprintOutcomeBaselineReceipt(result) }),
    );
  };

  const onQualifyOutcomes = (record: ExecutionPlanBlueprintRecord): void => {
    void runBlueprintLibraryAction(
      context,
      "qualifyOutcomes",
      () => getExecutionPlanBlueprintRecordOutcomeQualification(record.id),
      (result) => ({
        receipt: planBlueprintOutcomeQualificationReceipt(result),
      }),
    );
  };

  const onReviewOutcomes = (record: ExecutionPlanBlueprintRecord): void => {
    if (!context.selectedModelConfigured) {
      patchBlueprintLibraryState(context, {
        error: planCopy.modelUnavailableHint,
      });
      return;
    }
    void runBlueprintLibraryAction(
      context,
      "reviewOutcomes",
      () =>
        reviewExecutionPlanBlueprintRecordOutcomes(record.id, {
          model: parsePlanModelKey(context.selectedModelKey),
        }),
      (review) => ({
        outcomeReview: review,
        receipt: planBlueprintOutcomeReviewReceipt(review),
      }),
    );
  };

  return {
    onOutcomes,
    onVerifyOutcomes,
    onPromoteOutcomeBaseline: (record) => promote(record, false),
    onPromoteReviewedOutcomeBaseline: (record) => promote(record, true),
    onQualifyOutcomes,
    onReviewOutcomes,
  };
}
