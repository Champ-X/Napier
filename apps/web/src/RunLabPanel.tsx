import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Activity,
  BookOpen,
  Download,
  Scale,
  ShieldCheck,
  Upload,
} from "lucide-react";

import type {
  ModelSummary,
  RunComparison,
  RunEvaluationRecord,
  RunRecord,
} from "@napier/contracts";

import { copy } from "./copy";
import { runConfigurationFieldCopy } from "./run-configuration-copy";
import type { WebThreadDetail } from "./api";
import type {
  FixtureTransferReceipt,
  RunReplayVerificationReceipt,
} from "./use-workspace-view-model";
import { importProvenanceReceiptView } from "./use-workspace-view-model";
import {
  traceSummaryCoverageDeltaReceipt,
  traceSummaryCoverageDeltaView,
  verifyTraceSummaryCoverageDeltaReceipt,
  type TraceSummaryCoverageDeltaReceipt,
  type TraceSummaryCoverageReceiptVerification,
} from "./trace-event-summary-view";

const LazyEvaluationSuitePanel = lazy(() => import("./EvaluationSuitePanel"));

export default function RunLabPanel({
  detail,
  runs,
  evaluations,
  comparison,
  leftRunId,
  rightRunId,
  selectedModelKey,
  models,
  busyAction,
  fixtureReceipt,
  replayVerificationReceipt,
  onLeftRun,
  onRightRun,
  onCompare,
  onEvaluate,
  onExport,
  onVerifyReplay,
  onExportFixture,
  onVerifyFixture,
  onImportFixture,
  onRefresh,
}: {
  detail: WebThreadDetail | undefined;
  runs: RunRecord[];
  evaluations: RunEvaluationRecord[];
  comparison: RunComparison | undefined;
  leftRunId: string;
  rightRunId: string;
  selectedModelKey: string;
  models: ModelSummary[];
  busyAction: string | undefined;
  fixtureReceipt: FixtureTransferReceipt | undefined;
  replayVerificationReceipt: RunReplayVerificationReceipt | undefined;
  onLeftRun: (runId: string) => void;
  onRightRun: (runId: string) => void;
  onCompare: () => void;
  onEvaluate: () => void;
  onExport: (runId: string) => void;
  onVerifyReplay: (file: File) => void;
  onExportFixture: () => void;
  onVerifyFixture: (file: File) => void;
  onImportFixture: (file: File) => void;
  onRefresh: () => Promise<void>;
}) {
  const canCompare =
    runs.length >= 2 &&
    Boolean(leftRunId) &&
    Boolean(rightRunId) &&
    leftRunId !== rightRunId;
  const latestEvaluation = evaluations
    .slice()
    .reverse()
    .find(
      (evaluation) =>
        evaluation.leftRunId === leftRunId &&
        evaluation.rightRunId === rightRunId,
    );
  const eventDeltas = comparison
    ? Object.entries(comparison.eventTypeDelta)
        .filter(([, delta]) => delta !== 0)
        .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
        .slice(0, 8)
    : [];
  const traceSummaryCoverageDelta = comparison
    ? traceSummaryCoverageDeltaView(
        comparison.left.events,
        comparison.right.events,
      )
    : undefined;
  const traceSummaryBoundaryDelta = comparison?.traceSummaryBoundaryDelta;
  const [traceSummaryReceipt, setTraceSummaryReceipt] =
    useState<TraceSummaryCoverageDeltaReceipt>();
  const [traceSummaryReceiptVerification, setTraceSummaryReceiptVerification] =
    useState<TraceSummaryCoverageReceiptVerification>();

  useEffect(() => {
    let active = true;
    setTraceSummaryReceipt(undefined);
    setTraceSummaryReceiptVerification(undefined);
    if (!traceSummaryCoverageDelta) {
      return () => {
        active = false;
      };
    }
    void traceSummaryCoverageDeltaReceipt(traceSummaryCoverageDelta).then(
      async (receipt) => {
        const verification =
          await verifyTraceSummaryCoverageDeltaReceipt(receipt);
        if (!active) return;
        setTraceSummaryReceipt(receipt);
        setTraceSummaryReceiptVerification(verification);
      },
    );
    return () => {
      active = false;
    };
  }, [
    traceSummaryCoverageDelta?.status,
    traceSummaryCoverageDelta?.left.total,
    traceSummaryCoverageDelta?.left.bounded,
    traceSummaryCoverageDelta?.left.fixed,
    traceSummaryCoverageDelta?.left.category,
    traceSummaryCoverageDelta?.left.generic,
    traceSummaryCoverageDelta?.left.genericEventTypes.join("\n"),
    traceSummaryCoverageDelta?.right.total,
    traceSummaryCoverageDelta?.right.bounded,
    traceSummaryCoverageDelta?.right.fixed,
    traceSummaryCoverageDelta?.right.category,
    traceSummaryCoverageDelta?.right.generic,
    traceSummaryCoverageDelta?.right.genericEventTypes.join("\n"),
    traceSummaryCoverageDelta?.boundedDelta,
    traceSummaryCoverageDelta?.fixedDelta,
    traceSummaryCoverageDelta?.categoryDelta,
    traceSummaryCoverageDelta?.genericDelta,
    traceSummaryCoverageDelta?.diagnostics.join("\n"),
    traceSummaryCoverageDelta?.genericEventTypes.join("\n"),
  ]);

  return (
    <section className="panel-section run-lab" aria-labelledby="run-lab-title">
      <div className="panel-heading">
        <div>
          <span>{copy.lab.eyebrow}</span>
          <h2 id="run-lab-title">{copy.lab.title}</h2>
        </div>
        <span className="lab-count">
          {runs.length} {copy.lab.count}
        </span>
      </div>

      {detail ? (
        <FixtureLedgerCard
          detail={detail}
          busyAction={busyAction}
          receipt={fixtureReceipt}
          onExport={onExportFixture}
          onVerify={onVerifyFixture}
          onImport={onImportFixture}
        />
      ) : null}

      <RunReplayVerifier
        busyAction={busyAction}
        receipt={replayVerificationReceipt}
        onVerify={onVerifyReplay}
      />

      {runs.length < 2 ? (
        <p className="empty-panel">{copy.lab.empty}</p>
      ) : (
        <>
          <div className="run-pair">
            <RunPicker
              side={copy.lab.left}
              label={copy.lab.baseline}
              runs={runs}
              value={leftRunId}
              busy={Boolean(busyAction)}
              onChange={onLeftRun}
              onExport={onExport}
            />
            <RunPicker
              side={copy.lab.right}
              label={copy.lab.candidate}
              runs={runs}
              value={rightRunId}
              busy={Boolean(busyAction)}
              onChange={onRightRun}
              onExport={onExport}
            />
          </div>
          <div className="lab-actions">
            <button
              type="button"
              disabled={!canCompare || Boolean(busyAction)}
              onClick={onCompare}
            >
              <Activity size={12} aria-hidden="true" />
              {busyAction === "compare" ? copy.lab.comparing : copy.lab.compare}
            </button>
            <button
              className="lab-evaluate"
              type="button"
              disabled={!canCompare || Boolean(busyAction)}
              onClick={onEvaluate}
            >
              <Scale size={12} aria-hidden="true" />
              {busyAction === "evaluate"
                ? copy.lab.evaluating
                : copy.lab.evaluate}
            </button>
          </div>

          {selectedModelKey === "napier/demo" ? (
            <p className="lab-demo-note">{copy.lab.demoNotice}</p>
          ) : null}
        </>
      )}

      {comparison ? (
        <section
          className="comparison-sheet"
          aria-labelledby="comparison-title"
        >
          <header>
            <div>
              <span>{copy.lab.metricDelta}</span>
              <h3 id="comparison-title">
                {shortId(comparison.left.run.id)} {"->"}{" "}
                {shortId(comparison.right.run.id)}
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
          <div
            className={`configuration-drift ${contextCoverageClassName(
              comparison.contextCoverageDelta.status,
            )}`}
          >
            <div className="configuration-drift-heading">
              <span>{copy.lab.contextCoverage}</span>
              <strong>
                {contextCoverageStatusLabel(
                  comparison.contextCoverageDelta.status,
                )}
              </strong>
            </div>
            <div className="configuration-hashes">
              <code>
                {copy.lab.left}{" "}
                {formatPercent(
                  comparison.contextCoverageDelta.left.coverageRate,
                )}
              </code>
              <code>
                {copy.lab.right}{" "}
                {formatPercent(
                  comparison.contextCoverageDelta.right.coverageRate,
                )}
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
                  {comparison.contextCoverageDelta.diagnostics.map(
                    (diagnostic) => (
                      <li key={diagnostic}>
                        <code>{diagnostic}</code>
                      </li>
                    ),
                  )}
                </ul>
              </>
            ) : (
              <p>{copy.lab.contextCoverageHealthy}</p>
            )}
          </div>
          {traceSummaryBoundaryDelta ? (
            <div
              className={`configuration-drift ${traceSummaryCoverageClassName(
                traceSummaryBoundaryDelta.status,
              )}`}
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
                    {comparison.configurationDelta.changedFields.map(
                      (field) => (
                        <li key={field}>{runConfigurationFieldCopy[field]}</li>
                      ),
                    )}
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
      ) : null}

      {runs.length >= 2 ? (
        <section
          className="evaluation-sheet"
          aria-labelledby="evaluation-title"
        >
          <header>
            <div>
              <span>{copy.lab.verdict}</span>
              <h3 id="evaluation-title">
                {latestEvaluation
                  ? copy.lab.verdicts[latestEvaluation.verdict]
                  : copy.lab.noVerdict}
              </h3>
            </div>
            {latestEvaluation ? (
              <span
                className={`verdict-stamp verdict-${latestEvaluation.verdict}`}
              >
                {copy.lab.verdicts[latestEvaluation.verdict]}
              </span>
            ) : null}
          </header>
          {latestEvaluation ? (
            <>
              <p className="evaluation-reason">{latestEvaluation.reason}</p>
              {latestEvaluation.evidence ? (
                <div className="evaluation-evidence">
                  <span>{copy.lab.evidence}</span>
                  <p>{latestEvaluation.evidence}</p>
                </div>
              ) : null}
              {latestEvaluation.scores.length > 0 ? (
                <table className="rubric-table">
                  <caption>{copy.lab.rubric}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{latestEvaluation.rubric.name}</th>
                      <th scope="col">{copy.lab.left}</th>
                      <th scope="col">{copy.lab.right}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestEvaluation.rubric.criteria.map((criterion) => {
                      const score = latestEvaluation.scores.find(
                        (candidate) => candidate.criterionId === criterion.id,
                      );
                      return (
                        <tr key={criterion.id} title={score?.reason}>
                          <th scope="row">{criterion.name}</th>
                          <td>{score?.leftScore ?? "-"}</td>
                          <td>{score?.rightScore ?? "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : null}
              <div className="evaluation-hashes">
                <span>{copy.lab.hashes}</span>
                <code>
                  {copy.lab.left}{" "}
                  {latestEvaluation.leftSnapshotSha256.slice(0, 12)}
                </code>
                <code>
                  {copy.lab.right}{" "}
                  {latestEvaluation.rightSnapshotSha256.slice(0, 12)}
                </code>
                {latestEvaluation.comparisonGovernance ? (
                  <>
                    <code>
                      {copy.lab.governance}{" "}
                      {latestEvaluation.comparisonGovernance.contentSha256.slice(
                        0,
                        12,
                      )}
                    </code>
                    <code>
                      {copy.lab.contextCoverage}{" "}
                      {contextCoverageStatusLabel(
                        latestEvaluation.comparisonGovernance
                          .contextCoverageStatus,
                      )}
                    </code>
                    <code>
                      {copy.lab.contextCoverageDiagnostics}{" "}
                      {latestEvaluation.comparisonGovernance.contextCoverageDiagnosticsSha256.slice(
                        0,
                        12,
                      )}
                    </code>
                    {latestEvaluation.comparisonGovernance
                      .traceSummaryBoundaryStatus ? (
                      <code>
                        {copy.lab.traceSummaryCoverage}{" "}
                        {traceSummaryCoverageStatusLabel(
                          latestEvaluation.comparisonGovernance
                            .traceSummaryBoundaryStatus,
                        )}
                      </code>
                    ) : null}
                    {latestEvaluation.comparisonGovernance
                      .traceSummaryBoundaryDiagnosticsSha256 ? (
                      <code>
                        {copy.lab.traceSummaryDiagnostics}{" "}
                        {latestEvaluation.comparisonGovernance.traceSummaryBoundaryDiagnosticsSha256.slice(
                          0,
                          12,
                        )}
                      </code>
                    ) : null}
                    {latestEvaluation.comparisonGovernance
                      .traceSummaryBoundaryDeltaSha256 ? (
                      <code>
                        {copy.lab.traceSummaryDelta}{" "}
                        {latestEvaluation.comparisonGovernance.traceSummaryBoundaryDeltaSha256.slice(
                          0,
                          12,
                        )}
                      </code>
                    ) : null}
                  </>
                ) : null}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {detail && runs.length >= 2 ? (
        <Suspense
          fallback={
            <div className="context-loading" role="status">
              {copy.lab.suite.title}
            </div>
          }
        >
          <LazyEvaluationSuitePanel
            threadId={detail.thread.id}
            runs={runs}
            evaluations={detail.evaluations}
            adjudications={detail.evaluationAdjudications}
            reviewerBallots={detail.evaluationReviewerBallots}
            consensusResolutions={detail.evaluationConsensusResolutions}
            suites={detail.evaluationSuites}
            executions={detail.evaluationSuiteExecutions}
            selectedModelKey={selectedModelKey}
            models={models}
            onRefresh={onRefresh}
          />
        </Suspense>
      ) : null}

      <p className="guardrail-note">
        <ShieldCheck size={13} aria-hidden="true" />
        {copy.lab.safety}
      </p>
    </section>
  );
}

function RunReplayVerifier({
  busyAction,
  receipt,
  onVerify,
}: {
  busyAction: string | undefined;
  receipt: RunReplayVerificationReceipt | undefined;
  onVerify: (file: File) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = Boolean(busyAction);
  return (
    <section
      className="fixture-docket replay-verifier-card"
      aria-labelledby="run-replay-verify-title"
    >
      <header>
        <div>
          <span>{copy.lab.replay.eyebrow}</span>
          <h3 id="run-replay-verify-title">{copy.lab.replay.title}</h3>
        </div>
        <BookOpen size={15} aria-hidden="true" />
      </header>
      <p>{copy.lab.replay.body}</p>
      <div className="fixture-actions replay-actions">
        <button
          className="fixture-verify"
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={12} aria-hidden="true" />
          {busyAction === "run-replay-verify"
            ? copy.lab.replay.verifying
            : copy.lab.replay.verify}
        </button>
        <input
          ref={fileInput}
          className="fixture-file-input"
          type="file"
          accept="application/json,.json"
          tabIndex={-1}
          aria-label={copy.lab.replay.verify}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onVerify(file);
          }}
        />
      </div>
      {receipt ? (
        <output
          className={`fixture-receipt status-${receipt.status}`}
          aria-live="polite"
        >
          <span>
            {receipt.status === "valid"
              ? copy.lab.replay.verified
              : copy.lab.replay.invalid}
          </span>
          {receipt.contentSha256 ? (
            <code>{receipt.contentSha256.slice(0, 12)}</code>
          ) : null}
          <small>
            {receipt.eventCount.toLocaleString()} {copy.lab.fixture.events} ·{" "}
            {receipt.subagentCount.toLocaleString()} {copy.lab.replay.subagents}
          </small>
          <small>
            {receipt.modelContextEnvelopeCount.toLocaleString()}{" "}
            {copy.lab.fixture.contextEnvelopes} ·{" "}
            {receipt.embeddedModelContextEnvelopeCount.toLocaleString()}{" "}
            {copy.lab.fixture.embeddedEnvelopes}
          </small>
          <small className="fixture-diagnostics">
            {receipt.diagnostics.length > 0
              ? receipt.diagnostics.join(", ")
              : copy.lab.fixture.noDiagnostics}
          </small>
        </output>
      ) : null}
    </section>
  );
}

function FixtureLedgerCard({
  detail,
  busyAction,
  receipt,
  onExport,
  onVerify,
  onImport,
}: {
  detail: WebThreadDetail;
  busyAction: string | undefined;
  receipt: FixtureTransferReceipt | undefined;
  onExport: () => void;
  onVerify: (file: File) => void;
  onImport: (file: File) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const verifyInput = useRef<HTMLInputElement>(null);
  const busy = Boolean(busyAction);
  const provenance = detail.thread.importProvenance;
  const importReceipt = importProvenanceReceiptView(detail);

  return (
    <section className="fixture-docket" aria-labelledby="fixture-docket-title">
      <header>
        <div>
          <span>{copy.lab.fixture.eyebrow}</span>
          <h3 id="fixture-docket-title">{copy.lab.fixture.title}</h3>
        </div>
        <ShieldCheck size={15} aria-hidden="true" />
      </header>
      <p>{copy.lab.fixture.body}</p>
      <dl className="fixture-register">
        <div>
          <dt>{copy.lab.fixture.events}</dt>
          <dd>{detail.events.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>{copy.lab.fixture.runs}</dt>
          <dd>{detail.runs.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>{copy.lab.fixture.plans}</dt>
          <dd>{detail.plans.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>{copy.lab.fixture.evaluations}</dt>
          <dd>{detail.evaluations.length.toLocaleString()}</dd>
        </div>
      </dl>
      {provenance ? (
        <div className="fixture-origin">
          <span>{copy.lab.fixture.importedSource}</span>
          <code title={provenance.sourceContentSha256}>
            {provenance.sourceContentSha256.slice(0, 12)}
          </code>
          <small>
            {provenance.sourceEventCount.toLocaleString()}{" "}
            {copy.lab.fixture.sourceEvents} ·{" "}
            {(
              provenance.localImportedThroughSeq ??
              provenance.sourceEventCount
            ).toLocaleString()}{" "}
            {copy.lab.fixture.localImportedCutoff}
          </small>
          <small>
            {(provenance.sourceModelContextEnvelopeCount ?? 0).toLocaleString()}{" "}
            {copy.lab.fixture.contextEnvelopes} ·{" "}
            {(
              provenance.sourceEmbeddedModelContextEnvelopeCount ?? 0
            ).toLocaleString()}{" "}
            {copy.lab.fixture.embeddedEnvelopes}
          </small>
          {importReceipt ? (
            <small>
              {copy.lab.fixture.importReceipt}{" "}
              {importReceipt.seq.toLocaleString()} ·{" "}
              <code title={importReceipt.payloadSha256}>
                {importReceipt.payloadSha256.slice(0, 12)}
              </code>
            </small>
          ) : null}
        </div>
      ) : null}
      <div className="fixture-actions">
        <button type="button" disabled={busy} onClick={onExport}>
          <Download size={12} aria-hidden="true" />
          {busyAction === "fixture-export"
            ? copy.lab.fixture.exporting
            : copy.lab.fixture.export}
        </button>
        <button
          className="fixture-verify"
          type="button"
          disabled={busy}
          onClick={() => verifyInput.current?.click()}
        >
          <ShieldCheck size={12} aria-hidden="true" />
          {busyAction === "fixture-verify"
            ? copy.lab.fixture.verifying
            : copy.lab.fixture.verify}
        </button>
        <button
          className="fixture-import"
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={12} aria-hidden="true" />
          {busyAction === "fixture-import"
            ? copy.lab.fixture.importing
            : copy.lab.fixture.import}
        </button>
        <input
          ref={fileInput}
          className="fixture-file-input"
          type="file"
          accept="application/json,.json"
          tabIndex={-1}
          aria-label={copy.lab.fixture.import}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onImport(file);
          }}
        />
        <input
          ref={verifyInput}
          className="fixture-file-input"
          type="file"
          accept="application/json,.json"
          tabIndex={-1}
          aria-label={copy.lab.fixture.verify}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onVerify(file);
          }}
        />
      </div>
      <p className="fixture-safety">
        <ShieldCheck size={11} aria-hidden="true" />
        {copy.lab.fixture.safety}
      </p>
      {receipt ? (
        <output
          className={`fixture-receipt ${
            receipt.action === "verified" ? `status-${receipt.status}` : ""
          }`}
          aria-live="polite"
        >
          <span>
            {receipt.action === "verified"
              ? receipt.status === "valid"
                ? copy.lab.fixture.receipts.verified
                : copy.lab.fixture.receipts.invalid
              : copy.lab.fixture.receipts[receipt.action]}
          </span>
          {receipt.contentSha256 ? (
            <code>{receipt.contentSha256.slice(0, 12)}</code>
          ) : null}
          <small>
            {receipt.eventCount.toLocaleString()} {copy.lab.fixture.events} ·{" "}
            {receipt.runCount.toLocaleString()} {copy.lab.fixture.runs} ·{" "}
            {receipt.planCount.toLocaleString()} {copy.lab.fixture.plans} ·{" "}
            {receipt.evaluationCount.toLocaleString()}{" "}
            {copy.lab.fixture.evaluations}
          </small>
          <small>
            {receipt.modelContextEnvelopeCount.toLocaleString()}{" "}
            {copy.lab.fixture.contextEnvelopes} ·{" "}
            {receipt.embeddedModelContextEnvelopeCount.toLocaleString()}{" "}
            {copy.lab.fixture.embeddedEnvelopes}
          </small>
          {receipt.action === "verified" ? (
            <small className="fixture-diagnostics">
              {receipt.diagnostics.length > 0
                ? receipt.diagnostics.join(", ")
                : copy.lab.fixture.noDiagnostics}
            </small>
          ) : null}
        </output>
      ) : null}
    </section>
  );
}

function RunPicker({
  side,
  label,
  runs,
  value,
  busy,
  onChange,
  onExport,
}: {
  side: string;
  label: string;
  runs: RunRecord[];
  value: string;
  busy: boolean;
  onChange: (runId: string) => void;
  onExport: (runId: string) => void;
}) {
  return (
    <label className="run-picker">
      <span className="run-side" aria-hidden="true">
        {side}
      </span>
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{copy.lab.selectRun}</option>
        {runs.map((run, index) => (
          <option key={run.id} value={run.id}>
            {String(index + 1).padStart(2, "0")} ·{" "}
            {settledRunStatusLabel(run.status)} · {shortId(run.id)}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!value || busy}
        aria-label={`${copy.lab.export}: ${value}`}
        onClick={(event) => {
          event.preventDefault();
          onExport(value);
        }}
      >
        <Download size={11} aria-hidden="true" />
        {copy.lab.export}
      </button>
    </label>
  );
}

function MetricDelta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function settledRunStatusLabel(status: RunRecord["status"]): string {
  if (status === "completed") return copy.lab.statuses.completed;
  if (status === "failed") return copy.lab.statuses.failed;
  if (status === "cancelled") return copy.lab.statuses.cancelled;
  if (status === "interrupted") return copy.lab.statuses.interrupted;
  return status;
}

function formatSignedNumber(value: number): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : ""}${value.toLocaleString()}`;
}

function formatSignedDuration(value: number): string {
  const absolute = Math.abs(value);
  const amount =
    absolute >= 1_000 ? `${(absolute / 1_000).toFixed(1)}s` : `${absolute}ms`;
  if (value === 0) return amount;
  return `${value > 0 ? "+" : "-"}${amount}`;
}

function formatSignedCost(value: number): string {
  if (value === 0) return "$0";
  return `${value > 0 ? "+" : "-"}$${Math.abs(value).toFixed(4)}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: number): string {
  if (value === 0) return formatPercent(value);
  return `${value > 0 ? "+" : "-"}${formatPercent(Math.abs(value))}`;
}

function contextCoverageStatusLabel(
  status: RunComparison["contextCoverageDelta"]["status"],
): string {
  if (status === "clean") return copy.lab.contextCoverageClean;
  if (status === "partial") return copy.lab.contextCoveragePartial;
  if (status === "missing") return copy.lab.contextCoverageMissing;
  return copy.lab.contextCoverageRegressed;
}

function contextCoverageClassName(
  status: RunComparison["contextCoverageDelta"]["status"],
): string {
  if (status === "clean") return "is-unchanged";
  if (status === "partial") return "is-unavailable";
  return "is-changed";
}

function traceSummaryCoverageStatusLabel(
  status: RunComparison["traceSummaryBoundaryDelta"]["status"],
): string {
  if (status === "clean") return copy.lab.traceSummaryClean;
  if (status === "generic_present") return copy.lab.traceSummaryGenericPresent;
  return copy.lab.traceSummaryRegressed;
}

function traceSummaryCoverageClassName(
  status: RunComparison["traceSummaryBoundaryDelta"]["status"],
): string {
  if (status === "clean") return "is-unchanged";
  if (status === "generic_present") return "is-unavailable";
  return "is-changed";
}

function shortId(value: string): string {
  return value.length > 15
    ? `${value.slice(0, 7)}...${value.slice(-5)}`
    : value;
}
