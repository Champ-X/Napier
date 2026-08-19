import { ShieldCheck, Sparkles } from "lucide-react";

import type {
  ModelRef,
  SubagentOutcomeEvidenceVerification,
  SubagentOutcomeReview,
  SubagentTask,
} from "@napier/contracts";

import { copy } from "./copy";
import { useDelegationEvidenceCheck } from "./use-delegation-evidence-check";

export interface DelegationEvidenceCheckProps {
  task: SubagentTask;
  reviewerModel: ModelRef | undefined;
  reviewerModelConfigured: boolean;
}

export function DelegationEvidenceCheck({
  task,
  reviewerModel,
  reviewerModelConfigured,
}: DelegationEvidenceCheckProps) {
  const evidence = useDelegationEvidenceCheck({
    task,
    reviewerModel,
    reviewerModelConfigured,
  });

  return (
    <div className="delegation-evidence-check">
      <div className="delegation-evidence-actions">
        <button
          type="button"
          disabled={evidence.verifying}
          onClick={() => void evidence.verifyEvidence()}
        >
          <ShieldCheck size={10} aria-hidden="true" />
          {evidence.verifying
            ? copy.delegation.verifyingEvidence
            : copy.delegation.verifyEvidence}
        </button>
        <button
          type="button"
          disabled={evidence.reviewing || !evidence.canReviewOutcome}
          title={
            evidence.canReviewOutcome
              ? evidence.reviewerModelKey
              : evidence.reviewBlockedReason
          }
          onClick={() => void evidence.reviewOutcome()}
        >
          <Sparkles size={10} aria-hidden="true" />
          {evidence.reviewing
            ? copy.delegation.reviewingOutcome
            : copy.delegation.reviewOutcome}
        </button>
      </div>
      {evidence.reviewBlockedReason ? (
        <p className="delegation-evidence-hint">
          {evidence.reviewBlockedReason}
        </p>
      ) : null}
      {evidence.verification ? (
        <VerificationReceipt verification={evidence.verification} />
      ) : null}
      {evidence.verificationFailed ? (
        <p className="delegation-evidence-error" role="status">
          {copy.delegation.verifyFailed}
        </p>
      ) : null}
      {evidence.review ? <ReviewReceipt review={evidence.review} /> : null}
      {evidence.reviewFailed ? (
        <p className="delegation-evidence-error" role="status">
          {copy.delegation.reviewFailed}
        </p>
      ) : null}
    </div>
  );
}

interface VerificationReceiptProps {
  verification: SubagentOutcomeEvidenceVerification;
}

function VerificationReceipt({ verification }: VerificationReceiptProps) {
  return (
    <output
      className={`delegation-evidence-receipt status-${verification.status}`}
      aria-live="polite"
    >
      <strong>
        {copy.delegation.verificationStatuses[verification.status]}
      </strong>
      {verification.status === "unavailable" ? (
        <span>{copy.delegation.legacyEvidence}</span>
      ) : (
        <span>
          {copy.delegation.aligned} {verification.alignedCount}
          {" · "}
          {copy.delegation.drifted} {verification.divergentCount}
          {" · "}
          {copy.delegation.missing} {verification.missingCount}
        </span>
      )}
      <code title={verification.contentSha256}>
        {verification.contentSha256.slice(0, 12)}
      </code>
    </output>
  );
}

interface ReviewReceiptProps {
  review: SubagentOutcomeReview;
}

function ReviewReceipt({ review }: ReviewReceiptProps) {
  return (
    <output
      className={`delegation-review-receipt verdict-${review.verdict}`}
      aria-live="polite"
    >
      <strong>{copy.delegation.reviewVerdicts[review.verdict]}</strong>
      <span>
        {copy.delegation.score} {review.score}
        {" · "}
        {copy.delegation.risk} {review.risk}
      </span>
      <small title={review.reason}>{review.reason}</small>
      <span className="delegation-review-hashes">
        {review.modelContextEnvelope ? (
          <span>
            {copy.delegation.envelope}{" "}
            <code title={review.modelContextEnvelope.contentSha256}>
              {review.modelContextEnvelope.contentSha256.slice(0, 12)}
            </code>
          </span>
        ) : null}
        <span>
          {copy.delegation.receipt}{" "}
          <code title={review.reviewSha256}>
            {review.reviewSha256.slice(0, 12)}
          </code>
        </span>
      </span>
    </output>
  );
}
