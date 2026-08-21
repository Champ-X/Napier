import { Activity } from "lucide-react";

import type { RunEvent, RunRecord } from "@napier/contracts";
import { copy } from "./copy";
import { getLocale } from "./locale";
import { traceTrajectoryCopy } from "./trace-trajectory-copy";
import { TraceTrajectoryControls } from "./TraceTrajectoryControls";
import { TraceTrajectoryEventDetail } from "./TraceTrajectoryEventDetail";
import { formatTraceDuration } from "./TraceTrajectoryLedger";
import { TraceTrajectoryOverview } from "./TraceTrajectoryOverview";
import { TraceTrajectoryRunIndex } from "./TraceTrajectoryRunIndex";
import { useTraceTrajectoryController } from "./use-trace-trajectory-controller";
import "./trace-trajectory.css";

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
  const state = useTraceTrajectoryController(events, runs);
  if (state.model.events.length === 0) return <EmptyTrajectory />;
  return (
    <section className="trace-trajectory" aria-labelledby="trajectory-title">
      <div className="trace-trajectory-masthead">
        <TrajectoryHeader
          runCount={state.model.runs.length}
          running={running}
        />
        <dl className="trace-trajectory-stats">
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
        viewMode={state.viewMode}
        keyEventCount={state.keyEventCount}
        query={state.query}
        searchInputRef={state.searchInputRef}
        onToggleLane={state.toggleLane}
        onViewMode={state.setViewMode}
        onQuery={state.setQuery}
      />
      <TraceTrajectoryOverview
        model={state.model}
        metric={state.metric}
        visibleEventIds={state.visibleEventIds}
        selectedEvent={state.selectedEvent}
        selectedEventId={state.selectedEventId}
        overviewTrackRef={state.overviewTrackRef}
        overviewTrackWidth={state.overviewTrackWidth}
        onMetric={state.setMetric}
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
        {state.selectedEvent ? (
          <TraceTrajectoryEventDetail
            event={state.selectedEvent}
            onClose={() => state.setSelectedEventId(undefined)}
          />
        ) : null}
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

function TrajectoryHeader({
  runCount,
  running,
}: {
  runCount: number;
  running: boolean;
}) {
  return (
    <header className="trace-trajectory-header">
      <div>
        <span>
          {traceTrajectoryCopy.executionMap} / {formatNumber(runCount)}{" "}
          {traceTrajectoryCopy.runs}
        </span>
        <h3 id="trajectory-title">{copy.trace.title}</h3>
        <p>{copy.trace.body}</p>
      </div>
      <span className={`trace-trajectory-state ${running ? "is-live" : ""}`}>
        <i aria-hidden="true" />
        {running ? copy.trace.plotting : copy.trace.recorded}
      </span>
    </header>
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
