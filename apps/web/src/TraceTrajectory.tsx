import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ChevronDown, Search, X } from "lucide-react";

import type { RunEvent, RunRecord } from "@napier/contracts";

import {
  createTraceTrajectoryModel,
  traceTrajectoryMatches,
  traceTrajectoryPosition,
  type TraceTrajectoryEvent,
  type TraceTrajectoryLane,
  type TraceTrajectoryMetric,
  type TraceTrajectoryModel,
  type TraceTrajectoryRun,
} from "./trace-trajectory-model";
import "./trace-trajectory.css";

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
  const [query, setQuery] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const matchingEventIds = useMemo(
    () =>
      new Set(
        model.events
          .filter((event) => traceTrajectoryMatches(event, query))
          .map((event) => event.event.id),
      ),
    [model, query],
  );
  const selectedEvent = selectedEventId
    ? model.events.find((event) => event.event.id === selectedEventId)
    : undefined;

  useEffect(() => {
    if (!selectedEventId) return;
    document
      .getElementById(`trace-event-${selectedEventId}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [query, selectedEventId]);

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
    if (
      query &&
      !matchingEventIds.has(eventId) &&
      !segmentLabel.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    ) {
      setQuery("");
    }
    setSelectedEventId(eventId);
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

  const matchingCount = matchingEventIds.size;
  return (
    <section className="trace-trajectory" aria-labelledby="trajectory-title">
      <header className="trace-trajectory-header">
        <div>
          <span>Execution cartography / {model.runs.length} runs</span>
          <h3 id="trajectory-title">Trajectory</h3>
          <p>A privacy-bounded map of input, reasoning, and tool movement.</p>
        </div>
        <span className={`trace-trajectory-state ${running ? "is-live" : ""}`}>
          <i aria-hidden="true" />
          {running ? "Plotting" : "Recorded"}
        </span>
      </header>

      <dl className="trace-trajectory-stats">
        <Stat label="Elapsed" value={formatDuration(model.durationMs)} />
        <Stat label="Turns" value={String(model.turnCount)} />
        <Stat label="Calls" value={String(model.callCount)} />
        <Stat label="Events" value={String(model.eventCount)} />
      </dl>

      <div className="trace-trajectory-controls">
        <div className="trace-metric-tabs" aria-label="Trajectory metric">
          {METRICS.map((item) => (
            <button
              type="button"
              className={metric === item.id ? "is-active" : ""}
              aria-pressed={metric === item.id}
              key={item.id}
              onClick={() => setMetric(item.id)}
            >
              <span>{item.label}</span>
              <small>{item.unit}</small>
            </button>
          ))}
        </div>
        <label className="trace-trajectory-search">
          <Search size={12} aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            placeholder="Find event or tool"
            aria-label="Find an event in this trajectory"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear trajectory search"
              onClick={() => setQuery("")}
            >
              <X size={11} aria-hidden="true" />
            </button>
          ) : (
            <kbd>/</kbd>
          )}
        </label>
      </div>

      <div className="trace-overview">
        <header>
          <span>Signal layers</span>
          <strong>{METRICS.find((item) => item.id === metric)?.unit}</strong>
        </header>
        <div className="trace-overview-axis" aria-hidden="true">
          <span />
          {axisLabels(model, metric).map((label, index) => (
            <small key={`${label}:${String(index)}`}>{label}</small>
          ))}
        </div>
        <div className="trace-overview-lanes">
          {LANES.map((lane) => (
            <div
              className={`trace-overview-lane lane-${lane.id}`}
              key={lane.id}
            >
              <span className="trace-lane-label">
                <i>{lane.index}</i>
                {lane.label}
              </span>
              <div className="trace-lane-track">
                {model.segments
                  .filter((segment) => segment.lane === lane.id)
                  .map((segment) => {
                    const position = traceTrajectoryPosition(
                      segment,
                      model,
                      metric,
                    );
                    const segmentMatches =
                      !query ||
                      matchingEventIds.has(segment.eventId) ||
                      segment.label
                        .toLocaleLowerCase()
                        .includes(query.toLocaleLowerCase());
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
                          left: `${String(position.left)}%`,
                          width: `${String(position.width)}%`,
                        }}
                        title={`${segment.label} · ${segment.status}`}
                        aria-label={`${segment.label}, ${segment.status}`}
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
          ))}
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

      <div className="trace-run-index">
        <header>
          <div>
            <span>Run / Turn index</span>
            <strong>Ordered event ledger</strong>
          </div>
          <output aria-live="polite">
            {query
              ? `${String(matchingCount)} / ${String(model.eventCount)} matches`
              : `${String(model.eventCount)} events`}
          </output>
        </header>
        {model.runs.map((run) => (
          <TrajectoryRunSection
            key={run.id}
            run={run}
            query={query}
            selectedEventId={selectedEventId}
            matchingEventIds={matchingEventIds}
            latest={run.ordinal === model.runs.length}
            onSelect={setSelectedEventId}
          />
        ))}
        {query && matchingCount === 0 ? (
          <p className="trace-search-empty">
            No privacy-bounded event summary matches “{query}”.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function TrajectoryRunSection({
  run,
  query,
  selectedEventId,
  matchingEventIds,
  latest,
  onSelect,
}: {
  run: TraceTrajectoryRun;
  query: string;
  selectedEventId: string | undefined;
  matchingEventIds: Set<string>;
  latest: boolean;
  onSelect: (eventId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(
    !latest && run.status !== "running",
  );
  const matchingTurns = run.turns
    .map((turn) => ({
      ...turn,
      events: query
        ? turn.events.filter((event) => matchingEventIds.has(event.event.id))
        : turn.events,
    }))
    .filter((turn) => turn.events.length > 0);
  if (query && matchingTurns.length === 0) return null;
  const open = query ? true : !collapsed;
  return (
    <article className={`trace-run status-${run.status}`}>
      <button
        type="button"
        className="trace-run-heading"
        aria-expanded={open}
        onClick={() => setCollapsed((value) => !value)}
      >
        <span className="trace-run-ordinal">
          {String(run.ordinal).padStart(2, "0")}
        </span>
        <span>
          <strong>Run {String(run.ordinal)}</strong>
          <small>{shortRunId(run.id)}</small>
        </span>
        <span className="trace-run-meta">
          <small>{formatDuration(run.durationMs)}</small>
          <i>{run.status}</i>
        </span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div className="trace-run-turns">
          {matchingTurns.map((turn) => (
            <section className="trace-turn" key={turn.index}>
              <header>
                <span>{turn.label}</span>
                <small>{turn.events.length} events</small>
              </header>
              <ol>
                {turn.events.map((event) => (
                  <TrajectoryEventRow
                    key={event.event.id}
                    event={event}
                    selected={event.event.id === selectedEventId}
                    onSelect={onSelect}
                  />
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function TrajectoryEventRow({
  event,
  selected,
  onSelect,
}: {
  event: TraceTrajectoryEvent;
  selected: boolean;
  onSelect: (eventId: string) => void;
}) {
  return (
    <li
      id={`trace-event-${event.event.id}`}
      className={[`lane-${event.lane}`, selected ? "is-selected" : ""].join(
        " ",
      )}
    >
      <button type="button" onClick={() => onSelect(event.event.id)}>
        <span className="trace-event-sequence">
          <i />#{padSequence(event.event.seq)}
        </span>
        <span className="trace-event-copy">
          <span>
            <strong>{event.label}</strong>
            <time dateTime={event.event.createdAt}>
              {formatTimestamp(event.event.createdAt)}
            </time>
          </span>
          <small>{event.summary}</small>
        </span>
        <span className="trace-event-badges">
          <i>{event.role}</i>
          {event.callOrdinal ? <i>C{event.callOrdinal}</i> : null}
          <i className={`source-${event.summarySource}`}>
            {event.summarySource}
          </i>
        </span>
      </button>
    </li>
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
      formatDuration(model.durationMs * ratio),
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

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}m ${String(Math.round(seconds % 60))}s`;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function padSequence(sequence: number): string {
  return String(sequence).padStart(3, "0");
}

function shortRunId(runId: string): string {
  return runId.length > 17 ? `${runId.slice(0, 8)}…${runId.slice(-6)}` : runId;
}
