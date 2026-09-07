import {
  Activity,
  ArrowDown,
  ArrowUp,
  Coins,
  Layers,
  Timer,
  Wrench,
} from "lucide-react";
import { useMemo } from "react";

import { getLocale } from "./locale";
import { traceTrajectoryCopy } from "./trace-trajectory-copy";
import { traceTrajectoryInsights } from "./trace-trajectory-insights";
import type { TraceTrajectoryModel } from "./trace-trajectory-model";
import { formatTraceDuration } from "./TraceTrajectoryLedger";

export function TraceTrajectorySummary({
  model,
  running,
}: {
  model: TraceTrajectoryModel;
  running: boolean;
}) {
  const insights = useMemo(
    () => traceTrajectoryInsights(model.events),
    [model.events],
  );
  const text = traceTrajectoryCopy.insights;
  const usage = insights.usage;
  const coverage = text.usageCoverage
    .replace("{measured}", formatNumber(insights.measuredResponses))
    .replace("{total}", formatNumber(insights.responses));
  return (
    <header className="trace-trajectory-summary-strip">
      <div className="trace-summary-identity">
        <Activity size={18} aria-hidden="true" />
        <div>
          <h3 id="trajectory-title">{text.title}</h3>
          <span
            className={`trace-trajectory-state ${running ? "is-live" : ""}`}
          >
            <i aria-hidden="true" />
            {running ? text.running : text.recorded}
            <small>
              · {formatNumber(model.eventCount)} {traceTrajectoryCopy.events}
            </small>
          </span>
        </div>
      </div>
      <dl
        className="trace-trajectory-stats"
        aria-label={traceTrajectoryCopy.metricSummary}
      >
        <div>
          <dt>
            <Timer size={13} aria-hidden="true" />
            {text.elapsed}
          </dt>
          <dd>{formatTraceDuration(model.durationMs)}</dd>
        </div>
        <div>
          <dt>
            <Layers size={13} aria-hidden="true" />
            {traceTrajectoryCopy.turn}
          </dt>
          <dd>{formatNumber(model.turnCount)}</dd>
        </div>
        <div>
          <dt>
            <Wrench size={13} aria-hidden="true" />
            {text.toolCalls}
          </dt>
          <dd>{formatNumber(insights.toolCalls)}</dd>
        </div>
        <div className="trace-summary-token-stat" title={coverage}>
          <dt>
            {text.tokens}
            {insights.measuredResponses < insights.responses ? (
              <span> · {text.partial}</span>
            ) : null}
          </dt>
          <dd>
            {formatNumber(usage.totalTokens)}
            <span className="trace-summary-token-split">
              <span title={traceTrajectoryCopy.detail.fields.inputTokens}>
                <ArrowUp size={11} aria-hidden="true" />
                {formatNumber(usage.inputTokens)}
              </span>
              <span title={traceTrajectoryCopy.detail.fields.outputTokens}>
                <ArrowDown size={11} aria-hidden="true" />
                {formatNumber(usage.outputTokens)}
              </span>
            </span>
          </dd>
        </div>
        {usage.costUsd !== undefined ? (
          <div className="trace-summary-cost">
            <dt>
              <Coins size={13} aria-hidden="true" />
              {text.cost}
            </dt>
            <dd>
              {new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: usage.costUsd < 0.01 ? 6 : 4,
              }).format(usage.costUsd)}
            </dd>
          </div>
        ) : null}
      </dl>
    </header>
  );
}

function formatNumber(value: number | undefined): string {
  return value === undefined
    ? "—"
    : new Intl.NumberFormat(getLocale() === "zh" ? "zh-CN" : "en").format(
        value,
      );
}
