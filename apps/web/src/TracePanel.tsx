import { useEffect, useState } from "react";

import type {
  AgentMilestone,
  ModelRef,
  RunEvent,
  RunRecord,
  SubagentTask,
} from "@napier/contracts";

import {
  latestAgentMilestoneEventSeq,
  listAgentMilestones,
} from "./agent-milestone-api";
import { copy } from "./copy";
import { ModelPromptTraceLedgers } from "./ModelContextTraceLedgers";
import { independentModelAdvisorReviewViews } from "./model-advisor-review-view";
import { toolLoopGuardTriggerViews } from "./tool-loop-guard-view";
import {
  traceSummaryCoverageReceipt,
  traceSummaryCoverageView,
  verifyTraceSummaryCoverageReceipt,
  type TraceSummaryCoverageReceipt,
  type TraceSummaryCoverageReceiptVerification,
} from "./trace-event-summary-view";
import {
  AgentMilestoneLedger,
  DelegationLedger,
} from "./TraceDelegationLedgers";
import { TraceOtelExportCard } from "./TraceOtelExportCard";
import {
  IndependentAdvisorLedger,
  ToolLoopGuardLedger,
  TraceSummaryCoverageCard,
} from "./TraceQualityLedgers";
import { TraceTrajectory } from "./TraceTrajectory";
import type {
  OpenTelemetryTraceReceipt,
  OpenTelemetryTraceVerificationReceipt,
} from "./use-workspace-view-model";

export default function TracePanel({
  events,
  subagents,
  runs,
  running,
  exportBusy,
  exportReceipt,
  verifyBusy,
  verificationReceipt,
  reviewerModel,
  reviewerModelConfigured,
  onExport,
  onVerify,
}: {
  events: RunEvent[];
  subagents: SubagentTask[];
  runs: RunRecord[];
  running: boolean;
  exportBusy: boolean;
  exportReceipt: OpenTelemetryTraceReceipt | undefined;
  verifyBusy: boolean;
  verificationReceipt: OpenTelemetryTraceVerificationReceipt | undefined;
  reviewerModel: ModelRef | undefined;
  reviewerModelConfigured: boolean;
  onExport: (runId?: string) => void;
  onVerify: (file: File) => void;
}) {
  const [exportRunId, setExportRunId] = useState("");
  const [milestones, setMilestones] = useState<AgentMilestone[]>();
  const [milestonesUnavailable, setMilestonesUnavailable] = useState(false);
  const threadId = runs[0]?.threadId ?? events[0]?.threadId;
  const milestoneEventSeq = latestAgentMilestoneEventSeq(events);
  const advisorReviews = independentModelAdvisorReviewViews(events);
  const loopGuardTriggers = toolLoopGuardTriggerViews(events);
  const summaryCoverage = traceSummaryCoverageView(events);
  const summaryCoverageGenericTypesKey =
    summaryCoverage.genericEventTypes.join("\n");
  const [summaryCoverageReceipt, setSummaryCoverageReceipt] =
    useState<TraceSummaryCoverageReceipt>();
  const [summaryCoverageVerification, setSummaryCoverageVerification] =
    useState<TraceSummaryCoverageReceiptVerification>();

  useEffect(() => {
    if (exportRunId && !runs.some((run) => run.id === exportRunId)) {
      setExportRunId("");
    }
  }, [exportRunId, runs]);

  useEffect(() => {
    let active = true;
    if (!threadId) {
      setMilestones([]);
      setMilestonesUnavailable(false);
      return () => {
        active = false;
      };
    }
    setMilestones(undefined);
    setMilestonesUnavailable(false);
    void listAgentMilestones(threadId)
      .then((next) => {
        if (active) setMilestones(next);
      })
      .catch(() => {
        if (!active) return;
        setMilestones([]);
        setMilestonesUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, [threadId, milestoneEventSeq]);

  useEffect(() => {
    let active = true;
    setSummaryCoverageReceipt(undefined);
    setSummaryCoverageVerification(undefined);
    if (summaryCoverage.total === 0) {
      return () => {
        active = false;
      };
    }
    void traceSummaryCoverageReceipt(summaryCoverage).then(async (receipt) => {
      const verification = await verifyTraceSummaryCoverageReceipt(receipt);
      if (!active) return;
      setSummaryCoverageReceipt(receipt);
      setSummaryCoverageVerification(verification);
    });
    return () => {
      active = false;
    };
  }, [
    summaryCoverage.total,
    summaryCoverage.bounded,
    summaryCoverage.fixed,
    summaryCoverage.category,
    summaryCoverage.generic,
    summaryCoverageGenericTypesKey,
  ]);

  return (
    <section className="panel-section" aria-labelledby="trace-title">
      <div className="panel-heading">
        <div>
          <span>{copy.trace.sequence}</span>
          <h2 id="trace-title">{copy.trace.title}</h2>
        </div>
        <span className={`live-index ${running ? "is-live" : ""}`}>
          {running ? "LIVE" : "REC"}
        </span>
      </div>
      <TraceTrajectory events={events} runs={runs} running={running} />
      <TraceOtelExportCard
        runs={runs}
        exportRunId={exportRunId}
        exportBusy={exportBusy}
        exportReceipt={exportReceipt}
        verifyBusy={verifyBusy}
        verificationReceipt={verificationReceipt}
        onExportRunId={setExportRunId}
        onExport={onExport}
        onVerify={onVerify}
      />
      <TraceSummaryCoverageCard
        coverage={summaryCoverage}
        receipt={summaryCoverageReceipt}
        verification={summaryCoverageVerification}
      />
      <AgentMilestoneLedger
        milestones={milestones}
        unavailable={milestonesUnavailable}
      />
      <ModelPromptTraceLedgers events={events} />
      <IndependentAdvisorLedger reviews={advisorReviews} />
      <ToolLoopGuardLedger triggers={loopGuardTriggers} />
      <DelegationLedger
        tasks={subagents}
        reviewerModel={reviewerModel}
        reviewerModelConfigured={reviewerModelConfigured}
      />
    </section>
  );
}
