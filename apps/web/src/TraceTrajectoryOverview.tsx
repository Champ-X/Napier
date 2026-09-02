import {
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { RotateCcw } from "lucide-react";

import { getLocale } from "./locale";
import {
  layoutTraceTrajectoryLane,
  sampleTraceTrajectorySegments,
} from "./trace-trajectory-layout";
import type {
  TraceTrajectoryMetric,
  TraceTrajectoryModel,
  TraceTrajectoryRange,
} from "./trace-trajectory-model";
import {
  TRACE_TRAJECTORY_LANES,
  traceTrajectoryCopy,
} from "./trace-trajectory-copy";
import { formatTraceDuration } from "./TraceTrajectoryLedger";

export interface TraceTrajectoryOverviewProps {
  model: TraceTrajectoryModel;
  metric: TraceTrajectoryMetric;
  visibleEventIds: Set<string>;
  selectedEventId: string | undefined;
  overviewTrackRef: RefObject<HTMLDivElement | null>;
  overviewTrackWidth: number;
  range: TraceTrajectoryRange | undefined;
  onRange(range: TraceTrajectoryRange | undefined): void;
  onSelect(eventId: string, segmentLabel: string): void;
}

export function TraceTrajectoryOverview({
  model,
  metric,
  visibleEventIds,
  selectedEventId,
  overviewTrackRef,
  overviewTrackWidth,
  range,
  onRange,
  onSelect,
}: TraceTrajectoryOverviewProps) {
  const copy = traceTrajectoryCopy;
  return (
    <section className="trace-overview" aria-label={copy.timelineMap}>
      <div className="trace-overview-axis" aria-hidden="true">
        <span>{copy.timelineMap}</span>
        {axisLabels(model, metric).map((label, index) => (
          <small key={`${label}:${String(index)}`}>{label}</small>
        ))}
      </div>
      <TraceTimeline
        model={model}
        metric={metric}
        visibleEventIds={visibleEventIds}
        selectedEventId={selectedEventId}
        overviewTrackRef={overviewTrackRef}
        overviewTrackWidth={overviewTrackWidth}
        range={range}
        onRange={onRange}
        onSelect={onSelect}
      />
      <footer className="trace-overview-caption">
        <span>
          {range ? rangeLabel(model, metric, range, true) : copy.rangeHelp}
        </span>
        {range ? (
          <button
            type="button"
            aria-label={copy.rangeReset}
            title={copy.rangeReset}
            onClick={() => onRange(undefined)}
          >
            <RotateCcw size={12} aria-hidden="true" />
            {copy.rangeReset}
          </button>
        ) : null}
      </footer>
    </section>
  );
}

function TraceTimeline({
  model,
  metric,
  visibleEventIds,
  selectedEventId,
  overviewTrackRef,
  overviewTrackWidth,
  range,
  onRange,
  onSelect,
}: TraceTrajectoryOverviewProps) {
  const originRef = useRef<number | undefined>(undefined);
  const activeRange = range ?? { start: 0, end: 1 };
  const label = rangeLabel(model, metric, activeRange, Boolean(range));

  const ratioAt = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = overviewTrackRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return 0;
    return Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    );
  };
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest(".trace-segment")
    ) {
      return;
    }
    const origin = ratioAt(event);
    originRef.current = origin;
    event.currentTarget.setPointerCapture(event.pointerId);
    onRange({ start: origin, end: origin });
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (
      originRef.current === undefined ||
      !event.currentTarget.hasPointerCapture(event.pointerId)
    )
      return;
    const current = ratioAt(event);
    onRange({ start: originRef.current, end: current });
  };
  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (originRef.current === undefined) return;
    const current = ratioAt(event);
    const origin = originRef.current;
    originRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onRange(
      Math.abs(current - origin) < 0.012
        ? {
            start: Math.max(0, current - 0.04),
            end: Math.min(1, current + 0.04),
          }
        : { start: origin, end: current },
    );
  };
  const moveRange = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -0.02 : 0.02;
    if (!range) {
      onRange(
        event.key === "ArrowLeft"
          ? { start: 0.8, end: 1 }
          : { start: 0, end: 0.2 },
      );
      return;
    }
    if (event.shiftKey) {
      onRange({
        start: activeRange.start,
        end: Math.max(
          activeRange.start + 0.02,
          Math.min(1, activeRange.end + delta),
        ),
      });
      return;
    }
    const width = activeRange.end - activeRange.start;
    const start = Math.max(0, Math.min(1 - width, activeRange.start + delta));
    onRange({ start, end: start + width });
  };

  return (
    <div
      className={`trace-overview-lanes${range ? " has-range" : ""}`}
      role="group"
      tabIndex={0}
      aria-label={`${traceTrajectoryCopy.rangeHelp}. ${label}`}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={finishDrag}
      onPointerCancel={() => {
        originRef.current = undefined;
      }}
      onKeyDown={moveRange}
    >
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
      {range ? (
        <span className="trace-range-overlay-track" aria-hidden="true">
          <span
            className="trace-range-overlay"
            style={{
              left: `${String(activeRange.start * 100)}%`,
              width: `${String((activeRange.end - activeRange.start) * 100)}%`,
            }}
          >
            <i />
            <output>{label}</output>
            <i />
          </span>
        </span>
      ) : null}
    </div>
  );
}

function rangeLabel(
  model: TraceTrajectoryModel,
  metric: TraceTrajectoryMetric,
  range: TraceTrajectoryRange,
  active: boolean,
): string {
  if (!active) return traceTrajectoryCopy.rangeAll;
  if (metric === "duration") {
    return `${formatTraceDuration(model.durationMs * range.start)} - ${formatTraceDuration(model.durationMs * range.end)}`;
  }
  const maximum = Math.max(
    1,
    metric === "turns" ? model.turnCount : model.callCount,
  );
  const start = Math.max(1, Math.round(maximum * range.start));
  const end = Math.max(start, Math.round(maximum * range.end));
  return `${metric === "turns" ? traceTrajectoryCopy.turn : traceTrajectoryCopy.audit.call} ${formatNumber(start)} - ${formatNumber(end)}`;
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
                top: `${String(4 + (row % 2) * 5)}px`,
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
