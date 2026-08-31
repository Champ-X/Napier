import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  traceTrajectoryIsKeyEvent,
  traceTrajectoryEventInRange,
  traceTrajectoryMatches,
  type TraceTrajectoryLane,
  type TraceTrajectoryMetric,
  type TraceTrajectoryModel,
  type TraceTrajectoryRange,
} from "./trace-trajectory-model";
import {
  TRACE_TRAJECTORY_LANES,
  type TraceTrajectoryViewMode,
} from "./trace-trajectory-copy";
import { motionScrollBehavior } from "./reduced-motion";

export function useTraceTrajectoryController(model: TraceTrajectoryModel) {
  const [metric, setMetric] = useState<TraceTrajectoryMetric>("duration");
  const [viewMode, setViewMode] = useState<TraceTrajectoryViewMode>("key");
  const [activeLanes, setActiveLanes] = useState<TraceTrajectoryLane[]>(
    TRACE_TRAJECTORY_LANES.map((lane) => lane.id),
  );
  const [query, setQuery] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string>();
  const [range, setRangeState] = useState<TraceTrajectoryRange>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const overviewTrackRef = useRef<HTMLDivElement>(null);
  const [overviewTrackWidth, setOverviewTrackWidth] = useState(0);
  const keyEventCount = useMemo(
    () => model.events.filter(traceTrajectoryIsKeyEvent).length,
    [model],
  );
  const visibleEvents = useMemo(
    () =>
      model.events.filter(
        (event) =>
          activeLanes.includes(event.lane) &&
          (viewMode === "all" || traceTrajectoryIsKeyEvent(event)) &&
          traceTrajectoryEventInRange(event, model, metric, range) &&
          traceTrajectoryMatches(event, query),
      ),
    [activeLanes, metric, model, query, range, viewMode],
  );
  const visibleEventIds = useMemo(
    () => new Set(visibleEvents.map((event) => event.event.id)),
    [visibleEvents],
  );
  const selectedEvent = selectedEventId
    ? model.index.byId.get(selectedEventId)
    : undefined;

  useOverviewTrackWidth(overviewTrackRef, setOverviewTrackWidth);
  useSelectedEventScroll(selectedEventId, visibleEventIds);
  useTrajectorySearchShortcut(searchInputRef);

  function selectOverviewEvent(eventId: string, segmentLabel: string): void {
    const event = model.index.byId.get(eventId);
    if (event && !traceTrajectoryIsKeyEvent(event)) setViewMode("all");
    if (event && !activeLanes.includes(event.lane)) {
      setActiveLanes((current) => [...current, event.lane]);
    }
    if (event && !traceTrajectoryEventInRange(event, model, metric, range)) {
      setRangeState(undefined);
    }
    if (
      query &&
      event &&
      !traceTrajectoryMatches(event, query) &&
      !segmentLabel.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    ) {
      setQuery("");
    }
    setSelectedEventId(eventId);
  }

  function setRange(next: TraceTrajectoryRange | undefined): void {
    if (!next) {
      setRangeState(undefined);
      return;
    }
    const start = Math.max(0, Math.min(next.start, next.end, 1));
    const end = Math.max(start, Math.min(Math.max(next.start, next.end), 1));
    setRangeState(end - start >= 0.995 ? undefined : { start, end });
    const selected = selectedEventId
      ? model.index.byId.get(selectedEventId)
      : undefined;
    if (
      selected &&
      !traceTrajectoryEventInRange(selected, model, metric, { start, end })
    ) {
      setSelectedEventId(undefined);
    }
  }

  function toggleLane(lane: TraceTrajectoryLane): void {
    setActiveLanes((current) => {
      if (current.length === TRACE_TRAJECTORY_LANES.length) return [lane];
      if (current.length === 1 && current[0] === lane) {
        return TRACE_TRAJECTORY_LANES.map((item) => item.id);
      }
      return current.includes(lane)
        ? current.filter((item) => item !== lane)
        : [...current, lane];
    });
  }

  return {
    model,
    metric,
    setMetric,
    viewMode,
    setViewMode,
    activeLanes,
    query,
    setQuery,
    selectedEventId,
    setSelectedEventId,
    selectedEvent,
    searchInputRef,
    overviewTrackRef,
    overviewTrackWidth,
    range,
    setRange,
    keyEventCount,
    visibleEventIds,
    selectOverviewEvent,
    toggleLane,
  };
}

function useOverviewTrackWidth(
  trackRef: React.RefObject<HTMLDivElement | null>,
  setWidth: React.Dispatch<React.SetStateAction<number>>,
): void {
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const updateWidth = () => {
      const width = Math.round(track.getBoundingClientRect().width);
      setWidth((current) => (current === width ? current : width));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(track);
    return () => observer.disconnect();
  }, [setWidth, trackRef]);
}

function useSelectedEventScroll(
  selectedEventId: string | undefined,
  visibleEventIds: Set<string>,
): void {
  useEffect(() => {
    if (!selectedEventId) return;
    const node = document.getElementById(`trace-event-${selectedEventId}`);
    if (!node) return;
    // Honor reduced-motion: never drive a JS smooth scroll (design §9.4).
    node.scrollIntoView({
      block: "nearest",
      behavior: motionScrollBehavior(),
    });
  }, [selectedEventId, visibleEventIds]);
}

function useTrajectorySearchShortcut(
  inputRef: React.RefObject<HTMLInputElement | null>,
): void {
  useEffect(() => {
    function focusSearch(event: KeyboardEvent): void {
      const target = event.target;
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [inputRef]);
}
