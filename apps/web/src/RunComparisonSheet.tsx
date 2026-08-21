import type { RunComparison } from "@napier/contracts";

import { copy } from "./copy";
import { runConfigurationFieldCopy } from "./run-configuration-copy";
import { MetricDelta } from "./RunLabComparisonControls";
import { RunHarnessComparison } from "./RunHarnessComparison";
import {
  contextCoverageClassName,
  contextCoverageStatusLabel,
  formatPercent,
  formatSignedCost,
  formatSignedDuration,
  formatSignedNumber,
  formatSignedPercent,
  shortRunLabId,
  traceSummaryCoverageClassName,
  traceSummaryCoverageStatusLabel,
} from "./run-lab-format";
import type {
  TraceSummaryCoverageDeltaReceipt,
  TraceSummaryCoverageReceiptVerification,
} from "./trace-event-summary-view";

export interface RunComparisonSheetProps {
  comparison: RunComparison;
  eventDeltas: Array<[string, number]>;
  traceSummaryBoundaryDelta:
    | RunComparison["traceSummaryBoundaryDelta"]
    | undefined;
  traceSummaryReceipt: TraceSummaryCoverageDeltaReceipt | undefined;
  traceSummaryReceiptVerification:
    | TraceSummaryCoverageReceiptVerification
    | undefined;
}

export function RunComparisonSheet({
  comparison,
  eventDeltas,
  traceSummaryBoundaryDelta,
  traceSummaryReceipt,
  traceSummaryReceiptVerification,
}: RunComparisonSheetProps) {
  return (
    <section className="comparison-sheet" aria-labelledby="comparison-title">
      <header>
        <div>
          <span>{copy.lab.metricDelta}</span>
          <h3 id="comparison-title">
            {shortRunLabId(comparison.left.run.id)} {"->"}{" "}
            {shortRunLabId(comparison.right.run.id)}
          </h3>
        </div>
        <span
          className={`output-change ${comparison.outputChanged ? "is-changed" : ""}`}
        >
          {copy.lab.output}:{" "}
          {comparison.outputChanged ? copy.lab.changed : copy.lab.unchanged}
        </span>
      </header>
      <div className="comparison-metrics">
        <MetricDelta
          label={copy.lab.duration}
          value={formatSignedDuration(comparison.metricDelta.durationMs)}
        />
        <MetricDelta
          label={copy.lab.events}
          value={formatSignedNumber(comparison.metricDelta.eventCount)}
        />
        <MetricDelta
          label={copy.lab.tokens}
          value={formatSignedNumber(
            comparison.metricDelta.inputTokens +
              comparison.metricDelta.outputTokens,
          )}
        />
        <MetricDelta
          label={copy.lab.tools}
          value={formatSignedNumber(comparison.metricDelta.toolCallCount)}
        />
        <MetricDelta
          label={copy.lab.contextEnvelopes}
          value={formatSignedNumber(
            comparison.metricDelta.modelContextEnvelopeCount,
          )}
        />
        <MetricDelta
          label={copy.lab.embeddedContextEnvelopes}
          value={formatSignedNumber(
            comparison.metricDelta.embeddedModelContextEnvelopeCount,
          )}
        />
        <MetricDelta
          label={copy.lab.contextBindings}
          value={formatSignedNumber(
            comparison.metricDelta.modelContextBoundResponseCount,
          )}
        />
        <MetricDelta
          label={copy.lab.contextMisses}
          value={formatSignedNumber(
            comparison.metricDelta.modelContextUnboundResponseCount,
          )}
        />
        <MetricDelta
          label={copy.lab.cost}
          value={formatSignedCost(comparison.metricDelta.costUsd)}
        />
      </div>
      <RunHarnessComparison harness={comparison.harness} />
      <div
        className={`configuration-drift ${contextCoverageClassName(comparison.contextCoverageDelta.status)}`}
      >
        <div className="configuration-drift-heading">
          <span>{copy.lab.contextCoverage}</span>
          <strong>
            {contextCoverageStatusLabel(comparison.contextCoverageDelta.status)}
          </strong>
        </div>
        <div className="configuration-hashes">
          <code>
            {copy.lab.left}{" "}
            {formatPercent(comparison.contextCoverageDelta.left.coverageRate)}
          </code>
          <code>
            {copy.lab.right}{" "}
            {formatPercent(comparison.contextCoverageDelta.right.coverageRate)}
          </code>
          <code>
            {copy.lab.contextCoverageDelta}{" "}
            {formatSignedPercent(
              comparison.contextCoverageDelta.coverageRateDelta,
            )}
          </code>
          <code>
            {copy.lab.embeddedContextEnvelopes}{" "}
            {formatSignedNumber(
              comparison.contextCoverageDelta.embeddedEnvelopeDelta,
            )}
          </code>
        </div>
        {comparison.contextCoverageDelta.diagnostics.length > 0 ? (
          <>
            <p>{copy.lab.contextCoverageDiagnostics}</p>
            <ul>
              {comparison.contextCoverageDelta.diagnostics.map((diagnostic) => (
                <li key={diagnostic}>
                  <code>{diagnostic}</code>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>{copy.lab.contextCoverageHealthy}</p>
        )}
      </div>
      {traceSummaryBoundaryDelta ? (
        <div
          className={`configuration-drift ${traceSummaryCoverageClassName(traceSummaryBoundaryDelta.status)}`}
        >
          <div className="configuration-drift-heading">
            <span>{copy.lab.traceSummaryCoverage}</span>
            <strong>
              {traceSummaryCoverageStatusLabel(
                traceSummaryBoundaryDelta.status,
              )}
            </strong>
          </div>
          <div className="configuration-hashes">
            <code>
              {copy.lab.left} {copy.lab.traceSummaryGeneric}{" "}
              {traceSummaryBoundaryDelta.left.generic}
            </code>
            <code>
              {copy.lab.right} {copy.lab.traceSummaryGeneric}{" "}
              {traceSummaryBoundaryDelta.right.generic}
            </code>
            <code>
              {copy.lab.traceSummaryGenericDelta}{" "}
              {formatSignedNumber(traceSummaryBoundaryDelta.genericDelta)}
            </code>
            <code>
              {copy.lab.traceSummaryDedicatedDelta}{" "}
              {formatSignedNumber(traceSummaryBoundaryDelta.dedicatedDelta)}
            </code>
            {traceSummaryReceipt ? (
              <code title={traceSummaryReceipt.contentSha256}>
                {copy.lab.traceSummaryReceipt}{" "}
                {traceSummaryReceipt.contentSha256.slice(0, 12)}
              </code>
            ) : null}
            {traceSummaryReceiptVerification ? (
              <code
                className={`receipt-verification-pill status-${traceSummaryReceiptVerification.status}`}
                title={
                  traceSummaryReceiptVerification.observedContentSha256 ??
                  traceSummaryReceiptVerification.declaredContentSha256
                }
              >
                {copy.lab.traceSummaryVerification}{" "}
                {traceSummaryReceiptVerification.status === "valid"
                  ? copy.lab.traceSummaryVerified
                  : copy.lab.traceSummaryInvalid}
              </code>
            ) : null}
          </div>
          {traceSummaryBoundaryDelta.diagnostics.length > 0 ? (
            <>
              <p>{copy.lab.traceSummaryDiagnostics}</p>
              <ul>
                {traceSummaryBoundaryDelta.diagnostics.map((diagnostic) => (
                  <li key={diagnostic}>
                    <code>{diagnostic}</code>
                  </li>
                ))}
                {traceSummaryBoundaryDelta.genericEventTypes.map((type) => (
                  <li key={type}>
                    <code>{type}</code>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>{copy.lab.traceSummaryHealthy}</p>
          )}
        </div>
      ) : null}
      <div
        className={`configuration-drift ${
          comparison.configurationDelta.status === "unavailable"
            ? "is-unavailable"
            : comparison.configurationDelta.changedFields.length > 0
              ? "is-changed"
              : "is-unchanged"
        }`}
      >
        <div className="configuration-drift-heading">
          <span>{copy.lab.configuration}</span>
          <strong>
            {comparison.configurationDelta.status === "unavailable"
              ? copy.lab.configurationUnavailableShort
              : comparison.configurationDelta.changedFields.length > 0
                ? copy.lab.configurationChanged
                : copy.lab.configurationUnchanged}
          </strong>
        </div>
        {comparison.configurationDelta.status === "unavailable" ? (
          <p>{copy.lab.configurationUnavailable}</p>
        ) : (
          <>
            {comparison.configurationDelta.changedFields.length > 0 ? (
              <ul>
                {comparison.configurationDelta.changedFields.map((field) => (
                  <li key={field}>{runConfigurationFieldCopy[field]}</li>
                ))}
              </ul>
            ) : (
              <p>{copy.lab.configurationUnchanged}</p>
            )}
            <div className="configuration-hashes">
              <code>
                {copy.lab.left}{" "}
                {comparison.configurationDelta.leftSha256?.slice(0, 12)}
              </code>
              <code>
                {copy.lab.right}{" "}
                {comparison.configurationDelta.rightSha256?.slice(0, 12)}
              </code>
            </div>
          </>
        )}
      </div>
      <div className="event-delta">
        <span>{copy.lab.eventDelta}</span>
        {eventDeltas.length > 0 ? (
          <ul>
            {eventDeltas.map(([type, delta]) => (
              <li key={type}>
                <code>{type}</code>
                <strong>{formatSignedNumber(delta)}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p>{copy.lab.noDelta}</p>
        )}
      </div>
    </section>
  );
}
