import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Activity, ChevronDown, Search, X } from "lucide-react";

import type { RunEvent, RunRecord } from "@napier/contracts";

import {
  createTraceTrajectoryModel,
  traceTrajectoryIsKeyEvent,
  traceTrajectoryMatches,
  type TraceTrajectoryLane,
  type TraceTrajectoryMetric,
  type TraceTrajectoryModel,
} from "./trace-trajectory-model";
import {
  formatTraceDuration,
  TraceTrajectoryRunSection,
} from "./TraceTrajectoryLedger";
import { layoutTraceTrajectoryLane } from "./trace-trajectory-layout";
import "./trace-trajectory.css";

type TraceTrajectoryViewMode = "key" | "all";

const METRICS: Array<{
  id: TraceTrajectoryMetric;
  label: string;
  unit: string;
}> = [
  { id: "duration", label: "Duration", unit: "elapsed time" },
  { id: "turns", label: "Turns", unit: "reasoning cycles" },
  { id: "calls", label: "Calls", unit: "model + tool calls" },
];

const LANES: Array<{
  id: TraceTrajectoryLane;
  label: string;
  index: string;
}> = [
  { id: "input", label: "Input", index: "I" },
  { id: "model", label: "Model", index: "M" },
  { id: "tools", label: "Tools", index: "T" },
];

export function TraceTrajectory({
  events,
  runs,
  running,
}: {
  events: RunEvent[];
  runs: RunRecord[];
  running: boolean;
}) {
  const model = useMemo(
    () => createTraceTrajectoryModel(events, runs),
    [events, runs],
  );
  const [metric, setMetric] = useState<TraceTrajectoryMetric>("duration");
  const [viewMode, setViewMode] = useState<TraceTrajectoryViewMode>("key");
  const [activeLanes, setActiveLanes] = useState<TraceTrajectoryLane[]>(
    LANES.map((lane) => lane.id),
  );
  const [query, setQuery] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const overviewTrackRef = useRef<HTMLDivElement>(null);
  const [overviewTrackWidth, setOverviewTrackWidth] = useState(0);
  useLayoutEffect(() => {
    const track = overviewTrackRef.current;
    if (!track) return;
    const updateWidth = () => {
      const width = Math.round(track.getBoundingClientRect().width);
      setOverviewTrackWidth((current) => (current === width ? current : width));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);
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
          traceTrajectoryMatches(event, query),
      ),
    [activeLanes, model, query, viewMode],
  );
  const visibleEventIds = useMemo(
    () => new Set(visibleEvents.map((event) => event.event.id)),
    [visibleEvents],
  );
  const selectedEvent = selectedEventId
    ? model.events.find((event) => event.event.id === selectedEventId)
    : undefined;

  useEffect(() => {
    if (!selectedEventId) return;
    document
      .getElementById(`trace-event-${selectedEventId}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedEventId, visibleEventIds]);

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
      searchInputRef.current?.focus();
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  function selectOverviewEvent(eventId: string, segmentLabel: string): void {
    const event = model.events.find(
      (candidate) => candidate.event.id === eventId,
    );
    if (event && !traceTrajectoryIsKeyEvent(event)) setViewMode("all");
    if (event && !activeLanes.includes(event.lane)) {
      setActiveLanes((current) => [...current, event.lane]);
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

  function toggleLane(lane: TraceTrajectoryLane): void {
    setActiveLanes((current) => {
      if (current.length === LANES.length) return [lane];
      if (current.length === 1 && current[0] === lane) {
        return LANES.map((item) => item.id);
      }
      return current.includes(lane)
        ? current.filter((item) => item !== lane)
        : [...current, lane];
    });
  }

  if (model.events.length === 0) {
    return (
      <section className="trace-trajectory trace-trajectory-empty">
        <Activity size={18} aria-hidden="true" />
        <div>
          <span>Execution cartography</span>
          <h3>No trajectory recorded</h3>
          <p>Run activity will be plotted here as the ledger advances.</p>
        </div>
      </section>
    );
  }

  const visibleCount = visibleEventIds.size;
  return (
    <section className="trace-trajectory" aria-labelledby="trajectory-title">
      <header className="trace-trajectory-header">
        <div>
          <span>Execution map / {model.runs.length} runs</span>
          <h3 id="trajectory-title">Trajectory</h3>
          <p>
            Readable actions first, with the complete privacy-bounded audit one
            switch away.
          </p>
        </div>
        <span className={`trace-trajectory-state ${running ? "is-live" : ""}`}>
          <i aria-hidden="true" />
          {running ? "Plotting" : "Recorded"}
        </span>
      </header>

      <dl className="trace-trajectory-stats">
        <Stat label="Elapsed" value={formatTraceDuration(model.durationMs)} />
        <Stat label="Turns" value={String(model.turnCount)} />
        <Stat label="Calls" value={String(model.callCount)} />
        <Stat label="Key actions" value={String(keyEventCount)} />
      </dl>

      <div className="trace-command-bar">
        <div className="trace-lane-tabs" aria-label="Visible action lanes">
          {LANES.map((lane) => {
            const active = activeLanes.includes(lane.id);
            const laneCount = model.events.filter(
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
                onClick={() => toggleLane(lane.id)}
              >
                <i>{lane.index}</i>
                <span>{lane.label}</span>
                <small>{laneCount}</small>
              </button>
            );
          })}
        </div>
        <div className="trace-view-tabs" aria-label="Event detail level">
          <button
            type="button"
            className={viewMode === "key" ? "is-active" : ""}
            aria-pressed={viewMode === "key"}
            onClick={() => setViewMode("key")}
          >
            Key <span>{keyEventCount}</span>
          </button>
          <button
            type="button"
            className={viewMode === "all" ? "is-active" : ""}
            aria-pressed={viewMode === "all"}
            onClick={() => setViewMode("all")}
          >
            All <span>{model.eventCount}</span>
          </button>
        </div>
        <label className="trace-trajectory-search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            placeholder="Find action or tool"
            aria-label="Find an event in this trajectory"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear trajectory search"
              onClick={() => setQuery("")}
            >
              <X size={13} aria-hidden="true" />
            </button>
          ) : (
            <kbd>/</kbd>
          )}
        </label>
      </div>

      <details className="trace-overview-disclosure" open>
        <summary>
          <span>Timeline map</span>
          <small>Duration · turns · calls</small>
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <div className="trace-overview">
          <header>
            <div>
              <span>Signal layers</span>
              <strong>
                {METRICS.find((item) => item.id === metric)?.unit}
              </strong>
            </div>
            <div className="trace-metric-tabs" aria-label="Trajectory metric">
              {METRICS.map((item) => (
                <button
                  type="button"
                  className={metric === item.id ? "is-active" : ""}
                  aria-pressed={metric === item.id}
                  key={item.id}
                  onClick={() => setMetric(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </header>
          <div className="trace-overview-axis" aria-hidden="true">
            <span />
            {axisLabels(model, metric).map((label, index) => (
              <small key={`${label}:${String(index)}`}>{label}</small>
            ))}
          </div>
          <div className="trace-overview-lanes">
            {LANES.map((lane) => {
              const layout = layoutTraceTrajectoryLane(
                model.segments.filter((segment) => segment.lane === lane.id),
                model,
                metric,
                overviewTrackWidth,
              );
              return (
                <div
                  className={`trace-overview-lane lane-${lane.id}`}
                  key={lane.id}
                >
                  <span className="trace-lane-label">
                    <i>{lane.index}</i>
                    {lane.label}
                    {layout.rowCount > 1 ? (
                      <small
                        title={`${String(layout.rowCount)} concurrent tracks`}
                      >
                        ×{String(layout.rowCount)}
                      </small>
                    ) : null}
                  </span>
                  <div
                    className="trace-lane-track"
                    ref={lane.id === "input" ? overviewTrackRef : undefined}
                    style={{
                      minHeight: `${String(
                        Math.max(27, 10 + layout.rowCount * 8),
                      )}px`,
                    }}
                  >
                    {layout.items.map(({ segment, left, width, row }) => {
                      const segmentMatches = visibleEventIds.has(
                        segment.eventId,
                      );
                      const concurrency =
                        layout.rowCount > 1
                          ? ` · track ${String(row + 1)}/${String(layout.rowCount)}`
                          : "";
                      return (
                        <button
                          type="button"
                          className={[
                            "trace-segment",
                            `status-${segment.status}`,
                            selectedEventId === segment.eventId
                              ? "is-selected"
                              : "",
                            segmentMatches ? "" : "is-muted",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          style={{
                            left: `${String(left)}%`,
                            top: `${String(5 + row * 8)}px`,
                            width: `${String(width)}%`,
                          }}
                          title={`${segment.label} · ${segment.status}${concurrency}`}
                          aria-label={`${segment.label}, ${segment.status}${concurrency}`}
                          key={segment.id}
                          onClick={() =>
                            selectOverviewEvent(segment.eventId, segment.label)
                          }
                        >
                          <span>{segment.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <footer>
            <span>
              <i className="legend-input" /> Input
            </span>
            <span>
              <i className="legend-model" /> Model
            </span>
            <span>
              <i className="legend-tools" /> Tools
            </span>
            {selectedEvent ? (
              <strong>Focused #{padSequence(selectedEvent.event.seq)}</strong>
            ) : null}
          </footer>
        </div>
      </details>

      <div className="trace-run-index">
        <header>
          <div>
            <span>
              {viewMode === "key" ? "Key action trail" : "Full audit trail"}
            </span>
            <strong>
              {viewMode === "key"
                ? "What the agent did"
                : "Every recorded event"}
            </strong>
          </div>
          <output aria-live="polite">
            {query
              ? `${String(visibleCount)} matches`
              : `${String(visibleCount)} / ${String(model.eventCount)} filtered`}
          </output>
        </header>
        {model.runs.map((run) => (
          <TraceTrajectoryRunSection
            key={run.id}
            run={run}
            selectedEventId={selectedEventId}
            visibleEventIds={visibleEventIds}
            forceOpen={Boolean(query)}
            latest={run.ordinal === model.runs.length}
            onSelect={(eventId) =>
              setSelectedEventId((current) =>
                current === eventId ? undefined : eventId,
              )
            }
          />
        ))}
        {visibleCount === 0 ? (
          <p className="trace-search-empty">
            {query
              ? `No visible action matches “${query}”.`
              : "No actions remain in the selected lanes."}
          </p>
        ) : null}
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

function axisLabels(
  model: TraceTrajectoryModel,
  metric: TraceTrajectoryMetric,
): string[] {
  if (metric === "duration") {
    return [0, 0.25, 0.5, 0.75, 1].map((ratio) =>
      formatTraceDuration(model.durationMs * ratio),
    );
  }
  if (metric === "turns") {
    const maximum = Math.max(1, model.turnCount);
    return [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
      const index = Math.round(maximum * ratio);
      return index === 0 ? "Setup" : `T${String(index)}`;
    });
  }
  const maximum = Math.max(1, model.callCount);
  return [0, 0.25, 0.5, 0.75, 1].map(
    (ratio) => `C${String(Math.max(1, Math.round(maximum * ratio)))}`,
  );
}

function padSequence(sequence: number): string {
  return String(sequence).padStart(3, "0");
}
