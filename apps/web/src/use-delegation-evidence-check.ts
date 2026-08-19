import { useEffect, useState } from "react";

import type {
  ModelRef,
  SubagentOutcomeEvidenceVerification,
  SubagentOutcomeReview,
  SubagentTask,
} from "@napier/contracts";

import { copy } from "./copy";

export interface UseDelegationEvidenceCheckOptions {
  task: SubagentTask;
  reviewerModel: ModelRef | undefined;
  reviewerModelConfigured: boolean;
}

export function useDelegationEvidenceCheck({
  task,
  reviewerModel,
  reviewerModelConfigured,
}: UseDelegationEvidenceCheckOptions) {
  const [verification, setVerification] =
    useState<SubagentOutcomeEvidenceVerification>();
  const [verifying, setVerifying] = useState(false);
  const [verificationFailed, setVerificationFailed] = useState(false);
  const [review, setReview] = useState<SubagentOutcomeReview>();
  const [reviewing, setReviewing] = useState(false);
  const [reviewFailed, setReviewFailed] = useState(false);
  const reviewerModelKey = reviewerModel
    ? `${reviewerModel.provider}/${reviewerModel.id}`
    : "";
  const { canReviewOutcome, reviewBlockedReason } = reviewAccess(
    reviewerModelKey,
    `${task.model.provider}/${task.model.id}`,
    reviewerModelConfigured,
  );

  useEffect(() => {
    setVerification(undefined);
    setVerificationFailed(false);
    setReview(undefined);
    setReviewFailed(false);
  }, [task.outcome?.contentSha256, reviewerModelKey]);

  async function verifyEvidence(): Promise<void> {
    if (!task.outcome || verifying) return;
    setVerifying(true);
    setVerificationFailed(false);
    try {
      const api = await import("./subagent-api");
      setVerification(
        await api.verifySubagentOutcomeEvidence(task.threadId, task.id),
      );
    } catch {
      setVerification(undefined);
      setVerificationFailed(true);
    } finally {
      setVerifying(false);
    }
  }

  async function reviewOutcome(): Promise<void> {
    if (!task.outcome || !reviewerModel || !canReviewOutcome || reviewing)
      return;
    setReviewing(true);
    setReviewFailed(false);
    try {
      const api = await import("./subagent-api");
      setReview(
        await api.reviewSubagentOutcome(task.threadId, task.id, reviewerModel),
      );
    } catch {
      setReview(undefined);
      setReviewFailed(true);
    } finally {
      setReviewing(false);
    }
  }

  return {
    verification,
    verifying,
    verificationFailed,
    review,
    reviewing,
    reviewFailed,
    reviewerModelKey,
    canReviewOutcome,
    reviewBlockedReason,
    verifyEvidence,
    reviewOutcome,
  };
}

function reviewAccess(
  reviewerModelKey: string,
  workerModelKey: string,
  reviewerModelConfigured: boolean,
): { canReviewOutcome: boolean; reviewBlockedReason: string | undefined } {
  const independent =
    reviewerModelKey.length > 0 && reviewerModelKey !== workerModelKey;
  return {
    canReviewOutcome: independent && reviewerModelConfigured,
    reviewBlockedReason: !reviewerModelConfigured
      ? copy.delegation.reviewerModelUnavailable
      : independent
        ? undefined
        : copy.delegation.independentReviewerRequired,
  };
}
