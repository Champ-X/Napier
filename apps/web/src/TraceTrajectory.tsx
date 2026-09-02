import { Activity } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { RunEvent, RunRecord } from "@napier/contracts";
import { ContextInspector } from "./ContextInspector";
import { projectLocalModelDisplays } from "./conversation-model-display-view-model";
import { projectLocalToolDisplays } from "./conversation-tool-display-view-model";
import { copy } from "./copy";
import { getLocale } from "./locale";
import { getLocalModelDisplays } from "./local-model-display-api";
import { getLocalToolDisplays } from "./local-tool-display-api";
import { traceTrajectoryCopy } from "./trace-trajectory-copy";
import type { TraceTrajectoryModel } from "./trace-trajectory-model";
import { TraceTrajectoryControls } from "./TraceTrajectoryControls";
import { TraceTrajectoryEventDetail } from "./TraceTrajectoryEventDetail";
import { formatTraceDuration } from "./TraceTrajectoryLedger";
import { TraceTrajectoryOverview } from "./TraceTrajectoryOverview";
import { TraceTrajectoryRunIndex } from "./TraceTrajectoryRunIndex";
import { useTraceTrajectoryController } from "./use-trace-trajectory-controller";
import { useTraceTrajectoryModel } from "./use-trace-trajectory-model";
import "./trace-trajectory.css";
import "./trace-trajectory-compact.css";

export interface TraceTrajectoryProps {
  events: RunEvent[];
  runs: RunRecord[];
  running: boolean;
}

export function TraceTrajectory({
  events,
  runs,
  running,
}: TraceTrajectoryProps) {
  const [toolDisplays, setToolDisplays] = useState<
    Awaited<ReturnType<typeof getLocalToolDisplays>>
  >([]);
  const [modelDisplays, setModelDisplays] = useState<
    Awaited<ReturnType<typeof getLocalModelDisplays>>
  >([]);
  const threadId = runs[0]?.threadId ?? events[0]?.threadId;
  const toolEventVersion = events.filter((event) =>
    event.type.startsWith("tool."),
  ).length;
  const modelEventVersion = events.filter(
    (event) =>
      event.type === "model.response" ||
      event.type === "context.conversation_surface",
  ).length;
  useEffect(() => {
    if (!threadId) {
      setToolDisplays([]);
      return;
    }
    let current = true;
    void getLocalToolDisplays(threadId)
      .then((records) => {
        if (current) setToolDisplays(records);
      })
      .catch(() => {
        if (current) setToolDisplays([]);
      });
    return () => {
      current = false;
    };
  }, [threadId, toolEventVersion]);
  useEffect(() => {
    if (!threadId) {
      setModelDisplays([]);
      return;
    }
    let current = true;
    void getLocalModelDisplays(threadId)
      .then((records) => {
        if (current) setModelDisplays(records);
      })
      .catch(() => {
        if (current) setModelDisplays([]);
      });
    return () => {
      current = false;
    };
  }, [modelEventVersion, threadId]);
  const displayEvents = useMemo(
    () =>
      projectLocalModelDisplays(
        projectLocalToolDisplays(events, toolDisplays),
        modelDisplays,
      ),
    [events, modelDisplays, toolDisplays],
  );
  const projection = useTraceTrajectoryModel(displayEvents, runs);
  if (projection.pending || !projection.model) {
    return <ProjectingTrajectory eventCount={displayEvents.length} />;
  }
  return <ProjectedTrajectory model={projection.model} running={running} />;
}

function ProjectedTrajectory({
  model,
  running,
}: {
  model: TraceTrajectoryModel;
  running: boolean;
}) {
  const state = useTraceTrajectoryController(model);
  if (state.model.events.length === 0) return <EmptyTrajectory />;
  return (
    <section className="trace-trajectory" aria-labelledby="trajectory-title">
      <div className="trace-trajectory-summary-strip">
        <span className={`trace-trajectory-state ${running ? "is-live" : ""}`}>
          <i aria-hidden="true" />
          {running ? copy.trace.plotting : copy.trace.recorded}
        </span>
        <h3 id="trajectory-title">{copy.trace.title}</h3>
        <dl
          className="trace-trajectory-stats"
          aria-label={traceTrajectoryCopy.metricSummary}
        >
          <Stat
            label={copy.trace.elapsed}
            value={formatTraceDuration(state.model.durationMs)}
          />
          <Stat
            label={copy.trace.turns}
            value={formatNumber(state.model.turnCount)}
          />
          <Stat
            label={copy.trace.calls}
            value={formatNumber(state.model.callCount)}
          />
          <Stat
            label={copy.trace.keyActions}
            value={formatNumber(state.keyEventCount)}
          />
        </dl>
      </div>
      <TraceTrajectoryControls
        events={state.model.events}
        activeLanes={state.activeLanes}
        metric={state.metric}
        viewMode={state.viewMode}
        keyEventCount={state.keyEventCount}
        query={state.query}
        searchInputRef={state.searchInputRef}
        onToggleLane={state.toggleLane}
        onMetric={state.setMetric}
        onViewMode={state.setViewMode}
        onQuery={state.setQuery}
      />
      <TraceTrajectoryOverview
        model={state.model}
        metric={state.metric}
        visibleEventIds={state.visibleEventIds}
        selectedEventId={state.selectedEventId}
        overviewTrackRef={state.overviewTrackRef}
        overviewTrackWidth={state.overviewTrackWidth}
        range={state.range}
        onRange={state.setRange}
        onSelect={state.selectOverviewEvent}
      />
      <div
        className={`trace-event-workspace ${state.selectedEvent ? "has-detail" : ""}`}
      >
        <TraceTrajectoryRunIndex
          model={state.model}
          viewMode={state.viewMode}
          visibleEventIds={state.visibleEventIds}
          selectedEventId={state.selectedEventId}
          query={state.query}
          onSelect={(eventId) =>
            state.setSelectedEventId((current) =>
              current === eventId ? undefined : eventId,
            )
          }
        />
        <ContextInspector
          object={
            state.selectedEvent
              ? {
                  id: state.selectedEvent.event.id,
                  type: "event",
                  title: state.selectedEvent.label,
                  content: (
                    <TraceTrajectoryEventDetail
                      event={state.selectedEvent}
                      events={state.model.events}
                      onSelectEvent={state.setSelectedEventId}
                      embedded
                    />
                  ),
                }
              : undefined
          }
          onClose={() => state.setSelectedEventId(undefined)}
        />
      </div>
    </section>
  );
}

function ProjectingTrajectory({ eventCount }: { eventCount: number }) {
  return (
    <section
      className="trace-trajectory trace-trajectory-empty trace-trajectory-projecting"
      aria-busy="true"
      aria-live="polite"
      role="status"
    >
      <Activity size={18} aria-hidden="true" />
      <div>
        <span>{traceTrajectoryCopy.executionMap}</span>
        <h3>{traceTrajectoryCopy.projecting}</h3>
        <p>
          {traceTrajectoryCopy.projectingEvents.replace(
            "{count}",
            formatNumber(eventCount),
          )}
        </p>
      </div>
    </section>
  );
}

function EmptyTrajectory() {
  return (
    <section className="trace-trajectory trace-trajectory-empty">
      <Activity size={18} aria-hidden="true" />
      <div>
        <span>{copy.trace.mapEyebrow}</span>
        <h3>{copy.trace.emptyTitle}</h3>
        <p>{copy.trace.empty}</p>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(getLocale() === "zh" ? "zh-CN" : "en").format(
    value,
  );
}
