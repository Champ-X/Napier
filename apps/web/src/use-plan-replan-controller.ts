import { useEffect, useState } from "react";

import type {
  ExecutionPlan,
  ExecutionPlanReplanDraftModelReview,
} from "@napier/contracts";

import { applyReplanDraft, reviewReplanDraft } from "./api";
import { formatApiErrorMessage } from "./api-error";
import { parsePlanModelKey } from "./plan-panel-helpers";
import { planCopy } from "./plan-copy";

type ReplanRecommendation = NonNullable<ExecutionPlan["replanRecommendation"]>;

export interface PlanReplanController {
  review: ExecutionPlanReplanDraftModelReview | undefined;
  reviewBusy: boolean;
  applyBusy: boolean;
  error: string | undefined;
  onReview: () => Promise<void>;
  onApply: () => Promise<void>;
}

export interface UsePlanReplanControllerOptions {
  plan: ExecutionPlan | undefined;
  recommendation: ReplanRecommendation | undefined;
  selectedModelKey: string;
  selectedModelConfigured: boolean;
  onChanged: () => void | Promise<void>;
}

export function usePlanReplanController({
  plan,
  recommendation,
  selectedModelKey,
  selectedModelConfigured,
  onChanged,
}: UsePlanReplanControllerOptions): PlanReplanController {
  const [review, setReview] = useState<ExecutionPlanReplanDraftModelReview>();
  const [reviewBusy, setReviewBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setReview(undefined);
    setError(undefined);
  }, [recommendation?.recommendationSha256]);

  const onReview = async (): Promise<void> => {
    if (!plan || !recommendation || reviewBusy) return;
    if (!selectedModelConfigured) {
      setError(planCopy.modelUnavailableHint);
      return;
    }
    setReviewBusy(true);
    setError(undefined);
    try {
      setReview(
        await reviewReplanDraft(plan.threadId, plan.id, {
          model: parsePlanModelKey(selectedModelKey),
        }),
      );
    } catch (nextError) {
      setError(formatApiErrorMessage(nextError));
    } finally {
      setReviewBusy(false);
    }
  };

  const onApply = async (): Promise<void> => {
    if (!plan || !recommendation || applyBusy) return;
    setApplyBusy(true);
    setError(undefined);
    try {
      await applyReplanDraft(
        plan.threadId,
        plan.id,
        recommendation.draft.request,
      );
      setReview(undefined);
      await onChanged();
    } catch (nextError) {
      setError(formatApiErrorMessage(nextError));
    } finally {
      setApplyBusy(false);
    }
  };

  return { review, reviewBusy, applyBusy, error, onReview, onApply };
}
