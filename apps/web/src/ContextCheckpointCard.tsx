import type { CSSProperties } from "react";
import { ShieldCheck } from "lucide-react";

import type {
  ContextCheckpointCalibrationReport,
  ContextCheckpointSnapshot,
} from "@napier/contracts";

import { contextCopy } from "./context-copy";
import "./context-evidence-card.css";

export interface ContextCheckpointCardProps {
  checkpoint: ContextCheckpointSnapshot;
  calibration?: ContextCheckpointCalibrationReport;
}

const responsiveCardStyle = {
  "--context-evidence-columns":
    "repeat(auto-fit, minmax(min(var(--context-evidence-column-min), 100%), 1fr))",
  "--context-evidence-heading-size":
    "clamp(var(--text-sm), calc(var(--text-sm) + 0.15vw), var(--text-base))",
} as CSSProperties;

export function ContextCheckpointCard({
  checkpoint,
  calibration,
}: ContextCheckpointCardProps) {
  const groups = [
    { label: contextCopy.decisions, values: checkpoint.decisions },
    { label: contextCopy.openLoops, values: checkpoint.openLoops },
    { label: contextCopy.artifacts, values: checkpoint.artifacts },
  ].filter((group) => group.values.length > 0);
  return (
    <section
      className="context-evidence-card context-checkpoint-card"
      aria-labelledby="context-checkpoint-title"
      style={responsiveCardStyle}
    >
      <header>
        <div>
          <span>{contextCopy.checkpointEyebrow}</span>
          <h3 id="context-checkpoint-title">{contextCopy.checkpoint}</h3>
        </div>
        <span>{contextCopy.coverage} #{checkpoint.fromSeq}–#{checkpoint.toSeq}</span>
      </header>
      <p>{checkpoint.summary}</p>
      {groups.map((group) => (
        <div className="checkpoint-group" key={group.label}>
          <span>{group.label}</span>
          <ul>
            {group.values.map((value) => <li key={value}>{value}</li>)}
          </ul>
        </div>
      ))}
      <dl>
        <HashMetric label={contextCopy.sourceHash} value={checkpoint.sourceSha256} />
        <HashMetric label={contextCopy.summaryHash} value={checkpoint.summarySha256} />
      </dl>
      {calibration ? (
        <dl className="checkpoint-calibration-metrics" aria-label={contextCopy.calibration}>
          <HashMetric label={contextCopy.calibrationHash} value={calibration.contentSha256} />
          <Metric label={contextCopy.coverageRate} value={formatPercent(calibration.coverageRate)} />
          <Metric label={contextCopy.compression} value={formatRatio(calibration.compressionRatio)} />
          <Metric
            label={contextCopy.fallbacks}
            value={`${calibration.failureCount} / ${calibration.fallbackOmittedMessageCount}`}
          />
        </dl>
      ) : null}
      <small>
        <ShieldCheck size={12} aria-hidden="true" />
        {calibration
          ? `${contextCopy.checkpointSafety} ${contextCopy.calibrationSafety}`
          : contextCopy.checkpointSafety}
      </small>
    </section>
  );
}

function HashMetric({ label, value }: { label: string; value: string }) {
  return <Metric label={label} value={value.slice(0, 12)} title={value} />;
}

function Metric({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd><code title={title}>{value}</code></dd>
    </div>
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatRatio(value: number): string {
  return value > 0 ? `${value.toFixed(value >= 10 ? 0 : 1)}x` : "0x";
}
