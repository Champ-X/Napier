import { lazy, Suspense, useEffect, useState } from "react";
import { Activity, Scale, ShieldCheck } from "lucide-react";

import type {
  ModelSummary,
  RunComparison,
  RunEvaluationRecord,
  RunRecord,
} from "@napier/contracts";

import { copy } from "./copy";
import type { WebThreadDetail } from "./api";
import type {
  FixtureTransferReceipt,
  RunReplayVerificationReceipt,
} from "./use-workspace-view-model";
import { selectedModelAvailability } from "./model-selection-view-model";
import { RunComparisonSheet } from "./RunComparisonSheet";
import { RunEvaluationSheet } from "./RunEvaluationSheet";
import { RunPicker } from "./RunLabComparisonControls";
import { RunLabExperimentDesks } from "./RunLabExperimentDesks";
import { FixtureLedgerCard, RunReplayVerifier } from "./RunLabFixtureCards";
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
  running,
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
  onOpenThread,
  onRefresh,
  onUseTaskPrompt,
}: {
  detail: WebThreadDetail | undefined;
  runs: RunRecord[];
  evaluations: RunEvaluationRecord[];
  comparison: RunComparison | undefined;
  leftRunId: string;
  rightRunId: string;
  selectedModelKey: string;
  models: ModelSummary[];
  running: boolean;
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
  onOpenThread: (threadId: string) => void | Promise<void>;
  onRefresh: () => Promise<void>;
  onUseTaskPrompt(prompt: string): void;
}) {
  const canCompare =
    runs.length >= 2 &&
    Boolean(leftRunId) &&
    Boolean(rightRunId) &&
    leftRunId !== rightRunId;
  const selectedModel = selectedModelAvailability(models, selectedModelKey);
  const canEvaluate = canCompare && selectedModel.configured;
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

      {detail ? (
        <RunLabExperimentDesks
          detail={detail}
          running={running}
          selectedModelKey={selectedModelKey}
          selectedModelConfigured={selectedModel.configured}
          onOpenThread={onOpenThread}
        />
      ) : null}

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
              disabled={!canEvaluate || Boolean(busyAction)}
              onClick={onEvaluate}
            >
              <Scale size={12} aria-hidden="true" />
              {busyAction === "evaluate"
                ? copy.lab.evaluating
                : copy.lab.evaluate}
            </button>
          </div>

          {!selectedModel.configured ? (
            <p className="lab-demo-note">{copy.modelUnavailableHint}</p>
          ) : selectedModelKey === "napier/demo" ? (
            <p className="lab-demo-note">{copy.lab.demoNotice}</p>
          ) : null}
        </>
      )}

      {comparison ? (
        <RunComparisonSheet
          comparison={comparison}
          eventDeltas={eventDeltas}
          traceSummaryBoundaryDelta={traceSummaryBoundaryDelta}
          traceSummaryReceipt={traceSummaryReceipt}
          traceSummaryReceiptVerification={traceSummaryReceiptVerification}
        />
      ) : null}

      {runs.length >= 2 ? (
        <RunEvaluationSheet evaluation={latestEvaluation} />
      ) : null}

      {detail ? (
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
            onUseTaskPrompt={onUseTaskPrompt}
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
