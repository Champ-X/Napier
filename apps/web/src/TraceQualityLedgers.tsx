import { RotateCcw, ShieldCheck } from "lucide-react";

import { copy } from "./copy";
import { modelAdvisorReviewCopy } from "./model-advisor-review-copy";
import {
  independentModelAdvisorVerificationState,
  type IndependentModelAdvisorReviewView,
} from "./model-advisor-review-view";
import { toolLoopGuardCopy } from "./tool-loop-guard-copy";
import type { ToolLoopGuardTriggerView } from "./tool-loop-guard-view";
import type {
  TraceSummaryCoverageReceipt,
  TraceSummaryCoverageReceiptVerification,
  TraceSummaryCoverageView,
} from "./trace-event-summary-view";

export function TraceSummaryCoverageCard({
  coverage,
  receipt,
  verification,
}: {
  coverage: TraceSummaryCoverageView;
  receipt: TraceSummaryCoverageReceipt | undefined;
  verification: TraceSummaryCoverageReceiptVerification | undefined;
}) {
  if (coverage.total === 0) return null;
  return (
    <section
      className="trace-summary-coverage"
      aria-labelledby="trace-summary-coverage-title"
    >
      <header>
        <div>
          <span>{copy.trace.summary.eyebrow}</span>
          <h3 id="trace-summary-coverage-title">{copy.trace.summary.title}</h3>
        </div>
        <code>{coverage.total}</code>
      </header>
      <dl>
        <div>
          <dt>{copy.trace.summary.sources.bounded}</dt>
          <dd>{coverage.bounded}</dd>
        </div>
        <div>
          <dt>{copy.trace.summary.sources.fixed}</dt>
          <dd>{coverage.fixed}</dd>
        </div>
        <div>
          <dt>{copy.trace.summary.sources.category}</dt>
          <dd>{coverage.category}</dd>
        </div>
        <div>
          <dt>{copy.trace.summary.sources.generic}</dt>
          <dd>{coverage.generic}</dd>
        </div>
      </dl>
      <p>
        <ShieldCheck size={10} aria-hidden="true" />
        {coverage.genericEventTypes.length > 0
          ? `${copy.trace.summary.genericTypes}: ${coverage.genericEventTypes.join(", ")}`
          : copy.trace.summary.noGeneric}
      </p>
      {receipt ? (
        <output
          className={`trace-summary-verification status-${verification?.status ?? "pending"}`}
          aria-live="polite"
        >
          <span>
            {verification
              ? verification.status === "valid"
                ? copy.trace.summary.verificationValid
                : copy.trace.summary.verificationInvalid
              : copy.trace.summary.verificationPending}
          </span>
          <code title={receipt.contentSha256}>
            {copy.trace.summary.receipt} {receipt.contentSha256.slice(0, 12)}
          </code>
          <small>
            {verification && verification.diagnostics.length > 0
              ? verification.diagnostics.join(", ")
              : copy.trace.summary.noDiagnostics}
          </small>
        </output>
      ) : null}
    </section>
  );
}

export function ToolLoopGuardLedger({
  triggers,
}: {
  triggers: ToolLoopGuardTriggerView[];
}) {
  return (
    <section
      className="tool-loop-guard-ledger"
      aria-labelledby="tool-loop-guard-title"
    >
      <header>
        <div>
          <span>{toolLoopGuardCopy.eyebrow}</span>
          <h3 id="tool-loop-guard-title">{toolLoopGuardCopy.title}</h3>
        </div>
        <span>{String(triggers.length).padStart(2, "0")}</span>
      </header>
      {triggers.length === 0 ? (
        <p>{toolLoopGuardCopy.empty}</p>
      ) : (
        <ol>
          {triggers
            .slice()
            .reverse()
            .map((trigger) => (
              <li
                className="tool-loop-guard-card"
                key={`${trigger.eventSeq}:${trigger.contentSha256}`}
              >
                <header>
                  <span>
                    <RotateCcw size={11} aria-hidden="true" />
                    {trigger.toolName}
                  </span>
                  <code>#{String(trigger.eventSeq).padStart(3, "0")}</code>
                </header>
                <dl>
                  <div>
                    <dt>{toolLoopGuardCopy.attempts}</dt>
                    <dd>{trigger.attemptCount}</dd>
                  </div>
                  <div>
                    <dt>{toolLoopGuardCopy.range}</dt>
                    <dd>
                      {trigger.fromSeq}-{trigger.toSeq}
                    </dd>
                  </div>
                </dl>
                <p>
                  <span>{toolLoopGuardCopy.call}</span>
                  <code title={trigger.callSha256}>
                    {trigger.callSha256.slice(0, 12)}
                  </code>
                </p>
                <p>
                  <span>{toolLoopGuardCopy.result}</span>
                  <code title={trigger.resultSha256}>
                    {trigger.resultSha256.slice(0, 12)}
                  </code>
                </p>
                <footer>
                  <span>{toolLoopGuardCopy.receipt}</span>
                  <code title={trigger.contentSha256}>
                    {trigger.contentSha256.slice(0, 12)}
                  </code>
                </footer>
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}

export function IndependentAdvisorLedger({
  reviews,
}: {
  reviews: IndependentModelAdvisorReviewView[];
}) {
  return (
    <section
      className="independent-advisor-ledger"
      aria-labelledby="independent-advisor-title"
    >
      <header>
        <div>
          <span>{modelAdvisorReviewCopy.eyebrow}</span>
          <h3 id="independent-advisor-title">{modelAdvisorReviewCopy.title}</h3>
        </div>
        <span>{String(reviews.length).padStart(2, "0")}</span>
      </header>
      {reviews.length === 0 ? (
        <p>{modelAdvisorReviewCopy.empty}</p>
      ) : (
        <ol>
          {reviews.map((review) => (
            <li
              className={`independent-advisor-card verdict-${review.verdict}`}
              key={`${review.eventSeq}:${review.contentSha256}`}
            >
              <header>
                <strong>
                  {modelAdvisorReviewCopy.verdicts[review.verdict]}
                </strong>
                <code>#{String(review.eventSeq).padStart(3, "0")}</code>
              </header>
              <dl>
                <div>
                  <dt>{modelAdvisorReviewCopy.score}</dt>
                  <dd>{review.score}</dd>
                </div>
                <div>
                  <dt>{modelAdvisorReviewCopy.risk}</dt>
                  <dd>{review.risk}</dd>
                </div>
                <div>
                  <dt>{modelAdvisorReviewCopy.issues}</dt>
                  <dd>{review.issueCodes.length}</dd>
                </div>
                {review.verificationToolCompleted !== undefined ? (
                  <div>
                    <dt>{modelAdvisorReviewCopy.verification}</dt>
                    <dd>{independentModelAdvisorVerificationState(review)}</dd>
                  </div>
                ) : null}
              </dl>
              <p>
                <span>{modelAdvisorReviewCopy.reviewer}</span>
                <code>{review.reviewerModel}</code>
              </p>
              {review.issueCodes.length > 0 ? (
                <ul>
                  {review.issueCodes.map((code) => (
                    <li key={code}>{code}</li>
                  ))}
                </ul>
              ) : review.diagnosticCodes.length > 0 ? (
                <p>
                  <span>{modelAdvisorReviewCopy.diagnostics}</span>
                  <code>{review.diagnosticCodes.join(", ")}</code>
                </p>
              ) : null}
              <footer>
                {review.modelContextEnvelopeSha256 ? (
                  <span>
                    {modelAdvisorReviewCopy.envelope}{" "}
                    <code title={review.modelContextEnvelopeSha256}>
                      {review.modelContextEnvelopeSha256.slice(0, 12)}
                    </code>
                  </span>
                ) : null}
                <span>
                  {modelAdvisorReviewCopy.receipt}{" "}
                  <code title={review.contentSha256}>
                    {review.contentSha256.slice(0, 12)}
                  </code>
                </span>
              </footer>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
