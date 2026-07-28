import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  BookOpen,
  Box,
  Cable,
  Clock,
  Command,
  Download,
  Layers,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Target,
  Upload,
} from "lucide-react";

import type {
  AgentMilestone,
  ModelRef,
  RunEvent,
  RunRecord,
  SubagentOutcomeEvidenceVerification,
  SubagentOutcomeReview,
  SubagentTask,
} from "@napier/contracts";

import {
  latestAgentMilestoneEventSeq,
  listAgentMilestones,
} from "./agent-milestone-api";
import { agentMilestoneCopy } from "./agent-milestone-copy";
import { copy } from "./copy";
import { modelContextEnvelopeCopy } from "./model-context-envelope-copy";
import {
  modelContextEnvelopeViews,
  type ModelContextEnvelopeView,
} from "./model-context-envelope-view";
import { modelAdvisorReviewCopy } from "./model-advisor-review-copy";
import {
  independentModelAdvisorReviewViews,
  type IndependentModelAdvisorReviewView,
} from "./model-advisor-review-view";
import { toolLoopGuardCopy } from "./tool-loop-guard-copy";
import {
  toolLoopGuardTriggerViews,
  type ToolLoopGuardTriggerView,
} from "./tool-loop-guard-view";
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
  onExport: (runId?: string) => void;
  onVerify: (file: File) => void;
}) {
  const [exportRunId, setExportRunId] = useState("");
  const [milestones, setMilestones] = useState<AgentMilestone[]>();
  const [milestonesUnavailable, setMilestonesUnavailable] = useState(false);
  const threadId = runs[0]?.threadId ?? events[0]?.threadId;
  const milestoneEventSeq = latestAgentMilestoneEventSeq(events);
  const advisorReviews = independentModelAdvisorReviewViews(events);
  const contextEnvelopes = modelContextEnvelopeViews(events);
  const loopGuardTriggers = toolLoopGuardTriggerViews(events);

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
      <section className="otel-export-card" aria-labelledby="otel-export-title">
        <header>
          <div>
            <span>{copy.trace.otel.eyebrow}</span>
            <h3 id="otel-export-title">{copy.trace.otel.title}</h3>
          </div>
          <Activity size={14} aria-hidden="true" />
        </header>
        <p>{copy.trace.otel.body}</p>
        <div className="otel-export-controls">
          <label>
            <span>{copy.trace.otel.scope}</span>
            <select
              value={exportRunId}
              disabled={exportBusy}
              onChange={(event) => setExportRunId(event.target.value)}
            >
              <option value="">{copy.trace.otel.threadScope}</option>
              {runs
                .slice()
                .reverse()
                .map((run, index) => (
                  <option key={run.id} value={run.id}>
                    {copy.trace.otel.runScope}{" "}
                    {String(runs.length - index).padStart(2, "0")} /{" "}
                    {run.status}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            disabled={exportBusy}
            onClick={() => onExport(exportRunId || undefined)}
          >
            <Download size={11} aria-hidden="true" />
            {exportBusy ? copy.trace.otel.exporting : copy.trace.otel.export}
          </button>
          <label className="otel-file-action" aria-disabled={verifyBusy}>
            <Upload size={11} aria-hidden="true" />
            {verifyBusy ? copy.trace.otel.verifying : copy.trace.otel.verify}
            <input
              type="file"
              accept="application/json,.json"
              disabled={verifyBusy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) onVerify(file);
              }}
            />
          </label>
        </div>
        {exportReceipt ? (
          <output className="otel-export-receipt" aria-live="polite">
            <span>
              <strong>{copy.trace.otel.exported}</strong>
              <small>
                {exportReceipt.scope === "thread"
                  ? copy.trace.otel.threadScope
                  : copy.trace.otel.runScope}
              </small>
            </span>
            <span>
              <small>{copy.trace.otel.spans}</small>
              <strong>{exportReceipt.spanCount}</strong>
            </span>
            <span>
              <small>{copy.trace.otel.events}</small>
              <strong>{exportReceipt.eventCount}</strong>
            </span>
            <code title={exportReceipt.contentSha256}>
              {exportReceipt.contentSha256.slice(0, 12)}
            </code>
          </output>
        ) : null}
        {verificationReceipt ? (
          <output
            className={`otel-export-receipt status-${verificationReceipt.status}`}
            aria-live="polite"
          >
            <span>
              <strong>
                {verificationReceipt.status === "valid"
                  ? copy.trace.otel.verified
                  : copy.trace.otel.invalid}
              </strong>
              <small>
                {verificationReceipt.diagnostics.length > 0
                  ? verificationReceipt.diagnostics.join(", ")
                  : copy.trace.otel.noDiagnostics}
              </small>
            </span>
            <span>
              <small>{copy.trace.otel.spans}</small>
              <strong>{verificationReceipt.spanCount}</strong>
            </span>
            <span>
              <small>{copy.trace.otel.events}</small>
              <strong>{verificationReceipt.eventCount}</strong>
            </span>
            {verificationReceipt.contentSha256 ? (
              <code title={verificationReceipt.contentSha256}>
                {verificationReceipt.contentSha256.slice(0, 12)}
              </code>
            ) : null}
          </output>
        ) : null}
        <p className="otel-export-safety">
          <ShieldCheck size={10} aria-hidden="true" />
          {copy.trace.otel.safety}
        </p>
      </section>
      <AgentMilestoneLedger
        milestones={milestones}
        unavailable={milestonesUnavailable}
      />
      <ModelContextEnvelopeLedger envelopes={contextEnvelopes} />
      <IndependentAdvisorLedger reviews={advisorReviews} />
      <ToolLoopGuardLedger triggers={loopGuardTriggers} />
      <DelegationLedger tasks={subagents} reviewerModel={reviewerModel} />
      {events.length === 0 ? (
        <p className="empty-panel">{copy.trace.empty}</p>
      ) : null}
      <ol className="trace-list">
        {events.map((event) => (
          <li key={event.id}>
            <div className={`trace-icon category-${event.category}`}>
              {eventIcon(event.category)}
            </div>
            <div className="trace-copy">
              <div>
                <strong>{eventLabel(event.type)}</strong>
                <span>#{String(event.seq).padStart(3, "0")}</span>
              </div>
              <p>{eventSummary(event)}</p>
              <time dateTime={event.createdAt}>
                {formatTime(event.createdAt)}
              </time>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ModelContextEnvelopeLedger({
  envelopes,
}: {
  envelopes: ModelContextEnvelopeView[];
}) {
  return (
    <section
      className="tool-loop-guard-ledger model-context-envelope-ledger"
      aria-labelledby="model-context-envelope-title"
    >
      <header>
        <div>
          <span>{modelContextEnvelopeCopy.eyebrow}</span>
          <h3 id="model-context-envelope-title">
            {modelContextEnvelopeCopy.title}
          </h3>
        </div>
        <span>{String(envelopes.length).padStart(2, "0")}</span>
      </header>
      {envelopes.length === 0 ? (
        <p>{modelContextEnvelopeCopy.empty}</p>
      ) : (
        <ol>
          {envelopes
            .slice()
            .reverse()
            .map((envelope) => (
              <li
                className="tool-loop-guard-card model-context-envelope-card"
                key={`${envelope.eventSeq}:${envelope.contentSha256}`}
              >
                <header>
                  <span>
                    <ShieldCheck size={11} aria-hidden="true" />
                    {modelContextEnvelopeCopy.turn} {envelope.turnIndex}
                  </span>
                  <code>#{String(envelope.eventSeq).padStart(3, "0")}</code>
                </header>
                <dl>
                  <div>
                    <dt>{modelContextEnvelopeCopy.messages}</dt>
                    <dd>{envelope.messageCount}</dd>
                  </div>
                  <div>
                    <dt>{modelContextEnvelopeCopy.users}</dt>
                    <dd>{envelope.userMessageCount}</dd>
                  </div>
                  <div>
                    <dt>{modelContextEnvelopeCopy.assistants}</dt>
                    <dd>{envelope.assistantMessageCount}</dd>
                  </div>
                  <div>
                    <dt>{modelContextEnvelopeCopy.tools}</dt>
                    <dd>{envelope.toolResultMessageCount}</dd>
                  </div>
                </dl>
                <dl>
                  <div>
                    <dt>{modelContextEnvelopeCopy.other}</dt>
                    <dd>{envelope.otherMessageCount}</dd>
                  </div>
                  <div>
                    <dt>{modelContextEnvelopeCopy.promptBytes}</dt>
                    <dd>{envelope.systemPromptBytes}</dd>
                  </div>
                  <div>
                    <dt>{modelContextEnvelopeCopy.toolCount}</dt>
                    <dd>{envelope.toolCount}</dd>
                  </div>
                </dl>
                <p>
                  <span>{modelContextEnvelopeCopy.prompt}</span>
                  <code title={envelope.systemPromptSha256}>
                    {envelope.systemPromptSha256.slice(0, 12)}
                  </code>
                </p>
                <p>
                  <span>{modelContextEnvelopeCopy.messageSet}</span>
                  <code title={envelope.messageSetSha256}>
                    {envelope.messageSetSha256.slice(0, 12)}
                  </code>
                </p>
                <p>
                  <span>{modelContextEnvelopeCopy.toolNames}</span>
                  <code title={envelope.toolNameSetSha256}>
                    {envelope.toolNameSetSha256.slice(0, 12)}
                  </code>
                </p>
                <p>
                  <span>{modelContextEnvelopeCopy.toolDefinitions}</span>
                  <code title={envelope.toolDefinitionSetSha256}>
                    {envelope.toolDefinitionSetSha256.slice(0, 12)}
                  </code>
                </p>
                {envelope.responseSeq !== undefined ? (
                  <p>
                    <span>{modelContextEnvelopeCopy.response}</span>
                    <code>
                      #{String(envelope.responseSeq).padStart(3, "0")} ·{" "}
                      {envelope.responseModel} · {modelContextEnvelopeCopy.stop}{" "}
                      {envelope.responseStopReason}
                    </code>
                  </p>
                ) : (
                  <p>
                    <span>{modelContextEnvelopeCopy.response}</span>
                    <code>{modelContextEnvelopeCopy.responseMissing}</code>
                  </p>
                )}
                <footer>
                  <span>{modelContextEnvelopeCopy.receipt}</span>
                  <code title={envelope.contentSha256}>
                    {envelope.contentSha256.slice(0, 12)}
                  </code>
                </footer>
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}

function ToolLoopGuardLedger({
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

function IndependentAdvisorLedger({
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

function AgentMilestoneLedger({
  milestones,
  unavailable,
}: {
  milestones: AgentMilestone[] | undefined;
  unavailable: boolean;
}) {
  return (
    <section
      className="agent-milestone-ledger"
      aria-labelledby="agent-milestone-title"
      aria-busy={milestones === undefined}
    >
      <header>
        <div>
          <span>{agentMilestoneCopy.eyebrow}</span>
          <h3 id="agent-milestone-title">{agentMilestoneCopy.title}</h3>
        </div>
        <span>{String(milestones?.length ?? 0).padStart(2, "0")}</span>
      </header>
      {milestones === undefined ? (
        <p>{agentMilestoneCopy.loading}</p>
      ) : unavailable ? (
        <p role="status">{agentMilestoneCopy.unavailable}</p>
      ) : milestones.length === 0 ? (
        <p>{agentMilestoneCopy.empty}</p>
      ) : (
        <ol>
          {milestones
            .slice()
            .reverse()
            .map((milestone) => (
              <li className="agent-milestone-card" key={milestone.id}>
                <header>
                  <span>{agentMilestoneCopy.phases[milestone.phase]}</span>
                  <code>#{String(milestone.sequence).padStart(2, "0")}</code>
                </header>
                <strong>{milestone.title}</strong>
                <p>{milestone.summary}</p>
                <dl>
                  <div>
                    <dt>{agentMilestoneCopy.completed}</dt>
                    <dd>{milestone.completedItems.length}</dd>
                  </div>
                  <div>
                    <dt>{agentMilestoneCopy.open}</dt>
                    <dd>{milestone.openLoops.length}</dd>
                  </div>
                  <div>
                    <dt>{agentMilestoneCopy.evidence}</dt>
                    <dd>{milestone.evidence.eventCount}</dd>
                  </div>
                </dl>
                {milestone.openLoops.length > 0 ? (
                  <ul>
                    {milestone.openLoops.map((openLoop) => (
                      <li key={openLoop}>{openLoop}</li>
                    ))}
                  </ul>
                ) : null}
                <footer>
                  <time dateTime={milestone.recordedAt}>
                    {formatTime(milestone.recordedAt)}
                  </time>
                  <code title={milestone.contentSha256}>
                    {milestone.contentSha256.slice(0, 12)}
                  </code>
                </footer>
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}

function DelegationLedger({
  tasks,
  reviewerModel,
}: {
  tasks: SubagentTask[];
  reviewerModel: ModelRef | undefined;
}) {
  if (tasks.length === 0) return null;
  return (
    <section className="delegation-ledger" aria-labelledby="delegation-title">
      <header className="delegation-heading">
        <div>
          <span>{copy.delegation.eyebrow}</span>
          <h3 id="delegation-title">{copy.delegation.title}</h3>
        </div>
        <span>{String(tasks.length).padStart(2, "0")}</span>
      </header>
      <div className="delegation-list">
        {tasks
          .slice()
          .reverse()
          .map((task) => (
            <DelegationCard
              key={`${task.id}:${reviewerModel?.provider ?? ""}/${reviewerModel?.id ?? ""}`}
              task={task}
              reviewerModel={reviewerModel}
            />
          ))}
      </div>
    </section>
  );
}

function DelegationCard({
  task,
  reviewerModel,
}: {
  task: SubagentTask;
  reviewerModel: ModelRef | undefined;
}) {
  const [verification, setVerification] =
    useState<SubagentOutcomeEvidenceVerification>();
  const [verifying, setVerifying] = useState(false);
  const [verificationFailed, setVerificationFailed] = useState(false);
  const [review, setReview] = useState<SubagentOutcomeReview>();
  const [reviewing, setReviewing] = useState(false);
  const [reviewFailed, setReviewFailed] = useState(false);
  const outcomeSha256 = task.outcome?.contentSha256;
  const reviewerModelKey = reviewerModel
    ? `${reviewerModel.provider}/${reviewerModel.id}`
    : "";
  const workerModelKey = `${task.model.provider}/${task.model.id}`;
  const reviewerIsIndependent =
    Boolean(reviewerModel) && reviewerModelKey !== workerModelKey;

  useEffect(() => {
    setVerification(undefined);
    setVerificationFailed(false);
    setReview(undefined);
    setReviewFailed(false);
  }, [outcomeSha256, reviewerModelKey]);

  const summary =
    task.error ?? task.outcome?.summary ?? task.result ?? task.prompt;
  const summaryLabel = task.error
    ? copy.delegation.error
    : task.outcome
      ? copy.delegation.outcome
      : task.result
        ? copy.delegation.result
        : copy.delegation.prompt;

  async function verifyEvidence(): Promise<void> {
    if (!task.outcome || verifying) return;
    setVerifying(true);
    setVerificationFailed(false);
    try {
      const api = await import("./subagent-api");
      setVerification(
        await api.verifySubagentOutcomeEvidence(task.threadId, task.id),
      );
    } catch {
      setVerification(undefined);
      setVerificationFailed(true);
    } finally {
      setVerifying(false);
    }
  }

  async function reviewOutcome(): Promise<void> {
    if (
      !task.outcome ||
      !reviewerModel ||
      !reviewerIsIndependent ||
      reviewing
    ) {
      return;
    }
    setReviewing(true);
    setReviewFailed(false);
    try {
      const api = await import("./subagent-api");
      setReview(
        await api.reviewSubagentOutcome(task.threadId, task.id, reviewerModel),
      );
    } catch {
      setReview(undefined);
      setReviewFailed(true);
    } finally {
      setReviewing(false);
    }
  }

  return (
    <article className={`delegation-card delegation-${task.status}`}>
      <header>
        <span className="delegation-role">
          <Layers size={11} aria-hidden="true" />
          {task.role}
        </span>
        <span className="delegation-state">
          {delegationStatusLabel(task.status)}
        </span>
      </header>
      <h4>{task.description}</h4>
      <div className="delegation-result">
        <span>{summaryLabel}</span>
        <p>{summary}</p>
      </div>
      {task.outcome ? (
        <div className="delegation-evidence-check">
          <div className="delegation-evidence-actions">
            <button
              type="button"
              disabled={verifying}
              onClick={() => void verifyEvidence()}
            >
              <ShieldCheck size={10} aria-hidden="true" />
              {verifying
                ? copy.delegation.verifyingEvidence
                : copy.delegation.verifyEvidence}
            </button>
            <button
              type="button"
              disabled={reviewing || !reviewerIsIndependent}
              title={
                reviewerIsIndependent
                  ? reviewerModelKey
                  : copy.delegation.independentReviewerRequired
              }
              onClick={() => void reviewOutcome()}
            >
              <Sparkles size={10} aria-hidden="true" />
              {reviewing
                ? copy.delegation.reviewingOutcome
                : copy.delegation.reviewOutcome}
            </button>
          </div>
          {!reviewerIsIndependent ? (
            <p className="delegation-evidence-hint">
              {copy.delegation.independentReviewerRequired}
            </p>
          ) : null}
          {verification ? (
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
          ) : null}
          {verificationFailed ? (
            <p className="delegation-evidence-error" role="status">
              {copy.delegation.verifyFailed}
            </p>
          ) : null}
          {review ? (
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
          ) : null}
          {reviewFailed ? (
            <p className="delegation-evidence-error" role="status">
              {copy.delegation.reviewFailed}
            </p>
          ) : null}
        </div>
      ) : null}
      <footer>
        <dl>
          <div>
            <dt>{copy.delegation.turns}</dt>
            <dd>{task.turnCount}</dd>
          </div>
          <div>
            <dt>{copy.delegation.steps}</dt>
            <dd>{task.stepCount}</dd>
          </div>
          {task.outcome ? (
            <>
              <div>
                <dt>{copy.delegation.items}</dt>
                <dd>{task.outcome.itemCount}</dd>
              </div>
              <div>
                <dt>{copy.delegation.evidence}</dt>
                <dd>{task.outcome.evidenceCount ?? 0}</dd>
              </div>
              <div>
                <dt>{copy.delegation.unknowns}</dt>
                <dd>{task.outcome.unknownCount}</dd>
              </div>
            </>
          ) : null}
        </dl>
        <code title={task.outcome?.contentSha256}>
          {task.model.provider}/{task.model.id}
          {task.outcome
            ? ` · ${copy.delegation.receipt} ${task.outcome.contentSha256.slice(0, 10)}`
            : ""}
        </code>
      </footer>
    </article>
  );
}

function eventIcon(category: RunEvent["category"]): ReactNode {
  if (category === "message") return <BookOpen size={13} />;
  if (category === "tool") return <Command size={13} />;
  if (category === "subagent") return <Layers size={13} />;
  if (category === "extension") return <Cable size={13} />;
  if (category === "goal") return <Target size={13} />;
  if (category === "model") return <Sparkles size={13} />;
  if (category === "artifact") return <Box size={13} />;
  if (category === "lifecycle") return <Clock size={13} />;
  return <Activity size={13} />;
}

function eventLabel(type: string): string {
  return type
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function eventSummary(event: RunEvent): string {
  if (
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    return event.category;
  }
  if (event.type === "trace.otlp.exported") {
    const scope = event.payload["scope"];
    const spanCount = event.payload["spanCount"];
    if (typeof scope === "string" && typeof spanCount === "number") {
      return `${scope} / ${spanCount} spans`;
    }
  }
  for (const key of [
    "text",
    "message",
    "reason",
    "objective",
    "model",
    "source",
    "description",
    "result",
    "summary",
    "error",
    "toolName",
    "name",
    "trustStatus",
    "status",
  ]) {
    const value = event.payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.replace(/\s+/g, " ").trim().slice(0, 100);
    }
  }
  return event.category;
}

function delegationStatusLabel(status: SubagentTask["status"]): string {
  return copy.delegation.statuses[status];
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
