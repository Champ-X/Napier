import type { RefObject } from "react";
import { Search, X } from "lucide-react";

import { getLocale } from "./locale";
import {
  traceTrajectoryIsKeyEvent,
  type TraceTrajectoryEvent,
  type TraceTrajectoryLane,
} from "./trace-trajectory-model";
import {
  TRACE_TRAJECTORY_LANES,
  traceTrajectoryCopy,
  type TraceTrajectoryViewMode,
} from "./trace-trajectory-copy";

export interface TraceTrajectoryControlsProps {
  events: TraceTrajectoryEvent[];
  activeLanes: TraceTrajectoryLane[];
  viewMode: TraceTrajectoryViewMode;
  keyEventCount: number;
  query: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onToggleLane(lane: TraceTrajectoryLane): void;
  onViewMode(viewMode: TraceTrajectoryViewMode): void;
  onQuery(query: string): void;
}

export function TraceTrajectoryControls({
  events,
  activeLanes,
  viewMode,
  keyEventCount,
  query,
  searchInputRef,
  onToggleLane,
  onViewMode,
  onQuery,
}: TraceTrajectoryControlsProps) {
  const copy = traceTrajectoryCopy;
  return (
    <div className="trace-command-bar">
      <div className="trace-lane-tabs" aria-label={copy.visibleLanes}>
        {TRACE_TRAJECTORY_LANES.map((lane) => {
          const active = activeLanes.includes(lane.id);
          const laneCount = events.filter(
            (event) =>
              event.lane === lane.id &&
              (viewMode === "all" || traceTrajectoryIsKeyEvent(event)),
          ).length;
          return (
            <button
              type="button"
              className={[`lane-${lane.id}`, active ? "is-active" : ""]
                .filter(Boolean)
                .join(" ")}
              aria-pressed={active}
              key={lane.id}
              onClick={() => onToggleLane(lane.id)}
            >
              <i>{lane.index}</i>
              <span>{lane.label}</span>
              <small>{formatNumber(laneCount)}</small>
            </button>
          );
        })}
      </div>
      <div className="trace-view-tabs" aria-label={copy.eventDetailLevel}>
        <button
          type="button"
          className={viewMode === "key" ? "is-active" : ""}
          aria-pressed={viewMode === "key"}
          onClick={() => onViewMode("key")}
        >
          {copy.key} <span>{formatNumber(keyEventCount)}</span>
        </button>
        <button
          type="button"
          className={viewMode === "all" ? "is-active" : ""}
          aria-pressed={viewMode === "all"}
          onClick={() => onViewMode("all")}
        >
          {copy.all} <span>{formatNumber(events.length)}</span>
        </button>
      </div>
      <label className="trace-trajectory-search">
        <Search size={14} aria-hidden="true" />
        <input
          ref={searchInputRef}
          type="search"
          value={query}
          placeholder={copy.searchPlaceholder}
          aria-label={copy.searchLabel}
          onChange={(event) => onQuery(event.currentTarget.value)}
        />
        {query ? (
          <button
            type="button"
            aria-label={copy.clearSearch}
            onClick={() => onQuery("")}
          >
            <X size={13} aria-hidden="true" />
          </button>
        ) : (
          <kbd>/</kbd>
        )}
      </label>
    </div>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(getLocale() === "zh" ? "zh-CN" : "en").format(
    value,
  );
}
