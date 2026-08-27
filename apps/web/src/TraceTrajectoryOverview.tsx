import type { RefObject } from "react";
import { ChevronDown } from "lucide-react";

import { getLocale } from "./locale";
import {
  layoutTraceTrajectoryLane,
  sampleTraceTrajectorySegments,
} from "./trace-trajectory-layout";
import type {
  TraceTrajectoryEvent,
  TraceTrajectoryMetric,
  TraceTrajectoryModel,
} from "./trace-trajectory-model";
import {
  TRACE_TRAJECTORY_LANES,
  TRACE_TRAJECTORY_METRICS,
  traceTrajectoryCopy,
} from "./trace-trajectory-copy";
import { formatTraceDuration } from "./TraceTrajectoryLedger";

export interface TraceTrajectoryOverviewProps {
  model: TraceTrajectoryModel;
  metric: TraceTrajectoryMetric;
  visibleEventIds: Set<string>;
  selectedEvent: TraceTrajectoryEvent | undefined;
  selectedEventId: string | undefined;
  overviewTrackRef: RefObject<HTMLDivElement | null>;
  overviewTrackWidth: number;
  onMetric(metric: TraceTrajectoryMetric): void;
  onSelect(eventId: string, segmentLabel: string): void;
}

export function TraceTrajectoryOverview({
  model,
  metric,
  visibleEventIds,
  selectedEvent,
  selectedEventId,
  overviewTrackRef,
  overviewTrackWidth,
  onMetric,
  onSelect,
}: TraceTrajectoryOverviewProps) {
  const copy = traceTrajectoryCopy;
  return (
    <details className="trace-overview-disclosure" open>
      <summary>
        <span>{copy.timelineMap}</span>
        <small>{copy.metricSummary}</small>
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      <div className="trace-overview">
        <OverviewHeader metric={metric} onMetric={onMetric} />
        <div className="trace-overview-axis" aria-hidden="true">
          <span />
          {axisLabels(model, metric).map((label, index) => (
            <small key={`${label}:${String(index)}`}>{label}</small>
          ))}
        </div>
        <div className="trace-overview-lanes">
          {TRACE_TRAJECTORY_LANES.map((lane) => (
            <TrajectoryLane
              key={lane.id}
              lane={lane}
              model={model}
              metric={metric}
              visibleEventIds={visibleEventIds}
              selectedEventId={selectedEventId}
              overviewTrackRef={overviewTrackRef}
              overviewTrackWidth={overviewTrackWidth}
              onSelect={onSelect}
            />
          ))}
        </div>
        <footer>
          {TRACE_TRAJECTORY_LANES.map((lane) => (
            <span key={lane.id}>
              <i className={`legend-${lane.id}`} /> {lane.label}
            </span>
          ))}
          {selectedEvent ? (
            <strong>
              {copy.focused} #{padSequence(selectedEvent.event.seq)}
            </strong>
          ) : null}
        </footer>
      </div>
    </details>
  );
}

function OverviewHeader({
  metric,
  onMetric,
}: Pick<TraceTrajectoryOverviewProps, "metric" | "onMetric">) {
  const copy = traceTrajectoryCopy;
  return (
    <header>
      <div>
        <span>{copy.signalLayers}</span>
        <strong>
          {TRACE_TRAJECTORY_METRICS.find((item) => item.id === metric)?.unit}
        </strong>
      </div>
      <div className="trace-metric-tabs" aria-label={copy.metricLabel}>
        {TRACE_TRAJECTORY_METRICS.map((item) => (
          <button
            type="button"
            className={metric === item.id ? "is-active" : ""}
            aria-pressed={metric === item.id}
            key={item.id}
            onClick={() => onMetric(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </header>
  );
}

interface TrajectoryLaneProps {
  lane: (typeof TRACE_TRAJECTORY_LANES)[number];
  model: TraceTrajectoryModel;
  metric: TraceTrajectoryMetric;
  visibleEventIds: Set<string>;
  selectedEventId: string | undefined;
  overviewTrackRef: RefObject<HTMLDivElement | null>;
  overviewTrackWidth: number;
  onSelect(eventId: string, segmentLabel: string): void;
}

function TrajectoryLane({
  lane,
  model,
  metric,
  visibleEventIds,
  selectedEventId,
  overviewTrackRef,
  overviewTrackWidth,
  onSelect,
}: TrajectoryLaneProps) {
  const copy = traceTrajectoryCopy;
  const laneEventIds = new Set(
    (model.index.byLane.get(lane.id) ?? []).map((event) => event.event.id),
  );
  const laneSegments = model.segments.filter((segment) =>
    laneEventIds.has(segment.eventId),
  );
  const layout = layoutTraceTrajectoryLane(
    sampleTraceTrajectorySegments(laneSegments, selectedEventId),
    model,
    metric,
    overviewTrackWidth,
  );
  return (
    <div className={`trace-overview-lane lane-${lane.id}`}>
      <span className="trace-lane-label">
        <i>{lane.index}</i>
        {lane.label}
        {layout.rowCount > 1 ? (
          <small
            title={`${formatNumber(layout.rowCount)} ${copy.concurrentTracks}`}
          >
            ×{formatNumber(layout.rowCount)}
          </small>
        ) : null}
      </span>
      <div
        className="trace-lane-track"
        ref={lane.id === "input" ? overviewTrackRef : undefined}
        style={{
          minHeight: `${String(Math.max(27, 10 + layout.rowCount * 8))}px`,
        }}
      >
        {layout.items.map(({ segment, left, width, row }) => {
          const concurrency =
            layout.rowCount > 1
              ? ` · ${copy.track} ${formatNumber(row + 1)}/${formatNumber(layout.rowCount)}`
              : "";
          return (
            <button
              type="button"
              className={segmentClassName(
                segment.status,
                selectedEventId === segment.eventId,
                visibleEventIds.has(segment.eventId),
              )}
              style={{
                left: `${String(left)}%`,
                top: `${String(5 + row * 8)}px`,
                width: `${String(width)}%`,
              }}
              title={`${segment.label} · ${copy.statuses[segment.status]}${concurrency}`}
              aria-label={`${segment.label}, ${copy.statuses[segment.status]}${concurrency}`}
              key={segment.id}
              onClick={() => onSelect(segment.eventId, segment.label)}
            >
              <span>{segment.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function segmentClassName(
  status: string,
  selected: boolean,
  matches: boolean,
): string {
  return [
    "trace-segment",
    `status-${status}`,
    selected ? "is-selected" : "",
    matches ? "" : "is-muted",
  ]
    .filter(Boolean)
    .join(" ");
}

export function axisLabels(
  model: TraceTrajectoryModel,
  metric: TraceTrajectoryMetric,
): string[] {
  if (metric === "duration") {
    return [0, 0.25, 0.5, 0.75, 1].map((ratio) =>
      formatTraceDuration(model.durationMs * ratio),
    );
  }
  const maximum = Math.max(
    1,
    metric === "turns" ? model.turnCount : model.callCount,
  );
  return [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const index = Math.round(maximum * ratio);
    if (metric === "turns") {
      return index === 0
        ? traceTrajectoryCopy.setup
        : `${traceTrajectoryCopy.turn} ${formatNumber(index)}`;
    }
    return `${traceTrajectoryCopy.audit.call} ${formatNumber(Math.max(1, index))}`;
  });
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(getLocale() === "zh" ? "zh-CN" : "en").format(
    value,
  );
}

function padSequence(sequence: number): string {
  return String(sequence).padStart(3, "0");
}
