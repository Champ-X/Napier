import {
  traceTrajectoryPosition,
  type TraceTrajectoryMetric,
  type TraceTrajectoryModel,
  type TraceTrajectorySegment,
} from "./trace-trajectory-model";

export interface TraceTrajectoryLayoutItem {
  segment: TraceTrajectorySegment;
  left: number;
  width: number;
  row: number;
}

export interface TraceTrajectoryLaneLayout {
  items: TraceTrajectoryLayoutItem[];
  rowCount: number;
}

const MINIMUM_SEGMENT_WIDTH_PX = 3;
const FALLBACK_TRACK_WIDTH_PX = 800;
export const TRACE_OVERVIEW_SEGMENT_BUDGET = 600;

export function sampleTraceTrajectorySegments(
  segments: readonly TraceTrajectorySegment[],
  requiredEventId?: string,
  maximum = TRACE_OVERVIEW_SEGMENT_BUDGET,
): TraceTrajectorySegment[] {
  const limit = Math.max(1, Math.floor(maximum));
  if (segments.length <= limit) return [...segments];
  const required = requiredEventId
    ? segments.find((segment) => segment.eventId === requiredEventId)
    : undefined;
  if (limit === 1) return [required ?? segments.at(-1)!];
  const slots = Math.max(2, limit - (required ? 1 : 0));
  const sampled = new Map<string, TraceTrajectorySegment>();
  for (let index = 0; index < slots; index += 1) {
    const sourceIndex = Math.round(
      (index / Math.max(1, slots - 1)) * (segments.length - 1),
    );
    const segment = segments[sourceIndex];
    if (segment) sampled.set(segment.id, segment);
  }
  if (required) sampled.set(required.id, required);
  return [...sampled.values()].sort((left, right) => left.seq - right.seq);
}

export function layoutTraceTrajectoryLane(
  segments: TraceTrajectorySegment[],
  model: TraceTrajectoryModel,
  metric: TraceTrajectoryMetric,
  measuredTrackWidth: number,
): TraceTrajectoryLaneLayout {
  const trackWidth =
    measuredTrackWidth > 0 ? measuredTrackWidth : FALLBACK_TRACK_WIDTH_PX;
  const positioned = segments
    .map((segment) => {
      const position = traceTrajectoryPosition(segment, model, metric);
      const widthPx = Math.min(
        trackWidth,
        Math.max(MINIMUM_SEGMENT_WIDTH_PX, (position.width / 100) * trackWidth),
      );
      const requestedLeftPx = (position.left / 100) * trackWidth;
      const leftPx = Math.min(
        Math.max(0, requestedLeftPx),
        trackWidth - widthPx,
      );
      return { segment, leftPx, widthPx };
    })
    .sort(
      (left, right) =>
        left.leftPx - right.leftPx || left.segment.seq - right.segment.seq,
    );
  const rowEnds: number[] = [];
  const items = positioned.map(({ segment, leftPx, widthPx }) => {
    const availableRow = rowEnds.findIndex((endPx) => leftPx >= endPx);
    const row = availableRow === -1 ? rowEnds.length : availableRow;
    rowEnds[row] = leftPx + widthPx;
    return {
      segment,
      left: (leftPx / trackWidth) * 100,
      width: (widthPx / trackWidth) * 100,
      row,
    };
  });
  return { items, rowCount: Math.max(1, rowEnds.length) };
}
