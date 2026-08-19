import type { CSSProperties } from "react";
import { Link2 } from "lucide-react";

import { copy } from "./copy";
import type { ContextCheckpointContinuityView } from "./context-checkpoint-continuity-view";
import "./context-checkpoint-continuity-ledger.css";

export interface ContextCheckpointContinuityLedgerProps {
  checkpoints: ContextCheckpointContinuityView[];
}

const responsiveLedgerStyle = {
  "--context-continuity-grid":
    "repeat(auto-fit, minmax(min(var(--context-continuity-column-min), 100%), 1fr))",
  "--context-continuity-heading-size":
    "clamp(var(--text-sm), calc(var(--text-sm) + 0.15vw), var(--text-base))",
} as CSSProperties;

export function ContextCheckpointContinuityLedger({
  checkpoints,
}: ContextCheckpointContinuityLedgerProps) {
  const labels = copy.trace.contextContinuity;
  return (
    <section
      className="tool-loop-guard-ledger model-context-envelope-ledger context-checkpoint-continuity-ledger"
      aria-labelledby="context-checkpoint-continuity-title"
      style={responsiveLedgerStyle}
    >
      <header>
        <div>
          <span>{labels.eyebrow}</span>
          <h3 id="context-checkpoint-continuity-title">{labels.title}</h3>
        </div>
        <span>{String(checkpoints.length).padStart(2, "0")}</span>
      </header>
      {checkpoints.length === 0 ? (
        <p>{labels.empty}</p>
      ) : (
        <ol>
          {checkpoints.slice().reverse().map((checkpoint) => (
            <li
              className="tool-loop-guard-card model-context-envelope-card"
              key={`${checkpoint.eventSeq}:${checkpoint.checkpointId}`}
            >
              <header>
                <span>
                  <Link2 size={12} aria-hidden="true" />
                  {labels.states[checkpoint.state]}
                </span>
                <code>#{String(checkpoint.eventSeq).padStart(3, "0")}</code>
              </header>
              <dl>
                <div>
                  <dt>{labels.coverage}</dt>
                  <dd>#{checkpoint.fromSeq}–#{checkpoint.toSeq}</dd>
                </div>
                <div>
                  <dt>{labels.retained}</dt>
                  <dd>#{checkpoint.retainedFromSeq}</dd>
                </div>
                <div>
                  <dt>{labels.messages}</dt>
                  <dd>{checkpoint.sourceEventCount}</dd>
                </div>
                <div>
                  <dt>{labels.executionEvents}</dt>
                  <dd>{checkpoint.continuityEventCount ?? labels.unavailable}</dd>
                </div>
                <div>
                  <dt>{labels.decisions}</dt>
                  <dd>{checkpoint.decisionCount}</dd>
                </div>
                <div>
                  <dt>{labels.openLoops}</dt>
                  <dd>{checkpoint.openLoopCount}</dd>
                </div>
                <div>
                  <dt>{labels.artifacts}</dt>
                  <dd>{checkpoint.artifactCount}</dd>
                </div>
              </dl>
              <p>
                <span>{labels.executionBinding}</span>
                <code title={checkpoint.continuitySha256}>
                  {checkpoint.continuitySha256?.slice(0, 12) ?? labels.unavailable}
                </code>
              </p>
              <p>
                <span>{labels.messageBinding}</span>
                <code title={checkpoint.sourceSha256}>
                  {checkpoint.sourceSha256.slice(0, 12)}
                </code>
              </p>
              <footer>
                <span>{labels.summary}</span>
                <code title={checkpoint.summarySha256}>
                  {checkpoint.summarySha256.slice(0, 12)}
                </code>
              </footer>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
