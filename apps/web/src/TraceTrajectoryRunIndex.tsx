import { getLocale } from "./locale";
import type { TraceTrajectoryModel } from "./trace-trajectory-model";
import {
  traceTrajectoryCopy,
  type TraceTrajectoryViewMode,
} from "./trace-trajectory-copy";
import { TraceTrajectoryRunSection } from "./TraceTrajectoryLedger";

export interface TraceTrajectoryRunIndexProps {
  model: TraceTrajectoryModel;
  viewMode: TraceTrajectoryViewMode;
  visibleEventIds: Set<string>;
  selectedEventId: string | undefined;
  query: string;
  onSelect(eventId: string): void;
}

export function TraceTrajectoryRunIndex({
  model,
  viewMode,
  visibleEventIds,
  selectedEventId,
  query,
  onSelect,
}: TraceTrajectoryRunIndexProps) {
  const copy = traceTrajectoryCopy;
  const visibleCount = visibleEventIds.size;
  const visibleRuns = model.runs.filter((run) =>
    run.turns.some((turn) =>
      turn.events.some((event) => visibleEventIds.has(event.event.id)),
    ),
  );
  return (
    <div className="trace-run-index">
      <header className="trace-ledger-columns">
        <span>{copy.audit.role}</span>
        <strong>
          {viewMode === "key" ? copy.whatAgentDid : copy.everyRecordedEvent}
        </strong>
        <output aria-live="polite">
          {query
            ? `${formatNumber(visibleCount)} ${copy.matches}`
            : `${formatNumber(visibleCount)} / ${formatNumber(model.eventCount)} ${copy.filtered}`}
        </output>
      </header>
      {visibleRuns.map((run, index) => (
        <TraceTrajectoryRunSection
          key={run.id}
          run={run}
          selectedEventId={selectedEventId}
          visibleEventIds={visibleEventIds}
          forceOpen={Boolean(query)}
          latest={index === visibleRuns.length - 1}
          onSelect={onSelect}
        />
      ))}
      {visibleCount === 0 ? (
        <p className="trace-search-empty">
          {query
            ? `${copy.noSearchMatchPrefix}“${query}”${copy.noSearchMatchSuffix}`
            : copy.noSelectedLanes}
        </p>
      ) : null}
    </div>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(getLocale() === "zh" ? "zh-CN" : "en").format(
    value,
  );
}
