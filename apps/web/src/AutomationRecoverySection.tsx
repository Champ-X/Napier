import { RotateCcw, ShieldCheck } from "lucide-react";

import type {
  AutomaticRecoveryAssessment,
  AutomaticRecoveryAttempt,
} from "@napier/contracts";

import { automationCopy as copy } from "./automation-copy";
import { formatAutomationDateTime } from "./automation-panel-helpers";

export interface AutomationRecoverySectionProps {
  assessments: AutomaticRecoveryAssessment[];
  attempts: AutomaticRecoveryAttempt[];
}

export function AutomationRecoverySection({
  assessments,
  attempts,
}: AutomationRecoverySectionProps) {
  return (
    <section
      className="automation-register recovery-register"
      aria-labelledby="recovery-ledger-title"
    >
      <header className="automation-section-heading">
        <span className="automation-glyph recovery" aria-hidden="true">
          <RotateCcw size={14} />
        </span>
        <div>
          <span>{copy.recoveryEyebrow}</span>
          <h3 id="recovery-ledger-title">{copy.recovery}</h3>
        </div>
        <span className="recovery-count">
          {attempts.length.toString().padStart(2, "0")}
        </span>
      </header>
      <RecoverySummary assessments={assessments} attempts={attempts} />
      {assessments.length === 0 ? (
        <p className="empty-panel">{copy.noRecoveries}</p>
      ) : (
        <div className="recovery-ledger-list">
          {assessments
            .slice()
            .reverse()
            .slice(0, 8)
            .map((assessment) => (
              <RecoveryCard
                key={assessment.contentSha256}
                assessment={assessment}
                attempt={attempts.find(
                  (candidate) =>
                    candidate.assessmentSha256 === assessment.contentSha256,
                )}
              />
            ))}
        </div>
      )}
      <p className="automation-safety">
        <ShieldCheck size={12} aria-hidden="true" />
        {copy.recoverySafety}
      </p>
    </section>
  );
}

interface RecoverySummaryProps {
  assessments: AutomaticRecoveryAssessment[];
  attempts: AutomaticRecoveryAttempt[];
}

function RecoverySummary({ assessments, attempts }: RecoverySummaryProps) {
  const values = [
    [
      copy.recoveryQualified,
      assessments.filter((assessment) => assessment.eligible).length,
    ],
    [
      copy.recoveryBlocked,
      assessments.filter((assessment) => !assessment.eligible).length,
    ],
    [
      copy.recoveryCompleted,
      attempts.filter((attempt) => attempt.status === "completed").length,
    ],
  ] as const;
  return (
    <div className="recovery-summary">
      {values.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

interface RecoveryCardProps {
  assessment: AutomaticRecoveryAssessment;
  attempt: AutomaticRecoveryAttempt | undefined;
}

function RecoveryCard({ assessment, attempt }: RecoveryCardProps) {
  const status = attempt?.status ?? "skipped";
  return (
    <article className={`recovery-ledger-card state-${status}`}>
      <header>
        <div>
          <span>
            {copy.recoveryAttempt}{" "}
            {attempt ? `${attempt.attempt}/${attempt.maxAttempts}` : "—"}
          </span>
          <strong>{copy.recoveryStatuses[status]}</strong>
        </div>
        <code title={assessment.contentSha256}>
          {assessment.contentSha256.slice(0, 10)}
        </code>
      </header>
      {assessment.blockReasons.length > 0 ? (
        <ul>
          {assessment.blockReasons.map((reason) => (
            <li key={reason}>{copy.recoveryReasons[reason]}</li>
          ))}
        </ul>
      ) : (
        <p>{copy.recoveryQualifiedBody}</p>
      )}
      <dl>
        <div>
          <dt>{copy.recoveryEvents}</dt>
          <dd>{assessment.eventRange.eventCount}</dd>
        </div>
        <div>
          <dt>{copy.recoveryTools}</dt>
          <dd>{assessment.toolCalls.total}</dd>
        </div>
        <div>
          <dt>{copy.recoverySource}</dt>
          <dd title={assessment.runId}>{assessment.runId.slice(-8)}</dd>
        </div>
      </dl>
      <footer>
        <time dateTime={assessment.assessedAt}>
          {formatAutomationDateTime(assessment.assessedAt)}
        </time>
        <code title={assessment.eventRange.eventStreamSha256}>
          EV {assessment.eventRange.eventStreamSha256.slice(0, 8)}
        </code>
      </footer>
    </article>
  );
}
