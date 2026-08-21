import type { RunComparison } from "@napier/contracts";

import { copy } from "./copy";
import { MetricDelta } from "./RunLabComparisonControls";
import {
  formatSignedDuration,
  formatSignedNumber,
  formatSignedPercent,
  harnessFairnessClassName,
  harnessFairnessStatusLabel,
} from "./run-lab-format";

export function RunHarnessComparison({
  harness,
}: {
  harness: RunComparison["harness"];
}) {
  const { delta, fairness } = harness;
  return (
    <div
      className={`configuration-drift ${harnessFairnessClassName(fairness.status)}`}
    >
      <div className="configuration-drift-heading">
        <span>{copy.lab.harnessFairness}</span>
        <strong>{harnessFairnessStatusLabel(fairness.status)}</strong>
      </div>
      <div className="comparison-metrics">
        <MetricDelta
          label={copy.lab.firstRead}
          value={duration(delta.firstReadElapsedMs)}
        />
        <MetricDelta
          label={copy.lab.firstWrite}
          value={duration(delta.firstWriteElapsedMs)}
        />
        <MetricDelta
          label={copy.lab.firstVerify}
          value={duration(delta.firstVerifyElapsedMs)}
        />
        <MetricDelta
          label={copy.lab.repeatedCalls}
          value={formatSignedNumber(delta.repeatedCallCount)}
        />
        <MetricDelta
          label={copy.lab.noNewInformation}
          value={formatSignedNumber(delta.noNewInformationCount)}
        />
        <MetricDelta
          label={copy.lab.interventions}
          value={formatSignedNumber(delta.interventionCount)}
        />
        <MetricDelta
          label={copy.lab.promptTokenShare}
          value={percent(delta.systemPromptTokenShare)}
        />
        <MetricDelta
          label={copy.lab.toolTokenShare}
          value={percent(delta.toolDefinitionTokenShare)}
        />
      </div>
      <div className="configuration-hashes">
        <code>
          {copy.lab.harnessResolution} {harness.harnessResolution.status}
        </code>
        {harness.harnessResolution.leftSha256 ? (
          <code title={harness.harnessResolution.leftSha256}>
            {copy.lab.harnessResolutionLeft}{" "}
            {harness.harnessResolution.leftSha256.slice(0, 12)}
          </code>
        ) : null}
        {harness.harnessResolution.rightSha256 ? (
          <code title={harness.harnessResolution.rightSha256}>
            {copy.lab.harnessResolutionRight}{" "}
            {harness.harnessResolution.rightSha256.slice(0, 12)}
          </code>
        ) : null}
        <code title={harness.contentSha256}>
          {copy.lab.harnessReceipt} {harness.contentSha256.slice(0, 12)}
        </code>
      </div>
      {fairness.diagnostics.length > 0 ? (
        <ul>
          {fairness.diagnostics.map((diagnostic) => (
            <li key={diagnostic}>
              <code>{diagnostic}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p>{copy.lab.harnessFairnessHealthy}</p>
      )}
    </div>
  );
}

function duration(value: number | null): string {
  return value === null
    ? copy.lab.configurationUnavailableShort
    : formatSignedDuration(value);
}

function percent(value: number | null): string {
  return value === null
    ? copy.lab.configurationUnavailableShort
    : formatSignedPercent(value);
}
