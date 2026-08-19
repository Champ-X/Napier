import { BrainCircuit } from "lucide-react";

import type { RunEvent } from "@napier/contracts";
import { copy } from "./copy";
import { modelHarnessViews, type ModelHarnessIntent } from "./model-harness-view";

export interface ModelHarnessLedgerProps {
  events: readonly RunEvent[];
}

// Intrinsic minmax() grids and fluid clamp() headings are owned by the shared
// trace feature stylesheet so every diagnostic ledger keeps identical geometry.
export function ModelHarnessLedger({ events }: ModelHarnessLedgerProps) {
  const harnesses = modelHarnessViews(events);
  return (
    <section
      className="tool-loop-guard-ledger model-context-envelope-ledger"
      aria-labelledby="model-harness-title"
    >
      <header>
        <div>
          <span>{copy.trace.harness.eyebrow}</span>
          <h3 id="model-harness-title">{copy.trace.harness.title}</h3>
        </div>
        <span>{String(harnesses.length).padStart(2, "0")}</span>
      </header>
      {harnesses.length === 0 ? (
        <p>{copy.trace.harness.empty}</p>
      ) : (
        <ol>
          {harnesses.slice().reverse().map((harness) => (
            <li
              className="tool-loop-guard-card model-context-envelope-card"
              key={`${harness.eventSeq}:${harness.contentSha256}`}
            >
              <header>
                <span>
                  <BrainCircuit size={12} aria-hidden="true" />
                  {harness.family} · {harness.toolSurface}
                </span>
                <code>#{String(harness.eventSeq).padStart(3, "0")}</code>
              </header>
              <dl>
                <div>
                  <dt>{copy.trace.harness.profile}</dt>
                  <dd>{harness.promptDialect}</dd>
                </div>
                <div>
                  <dt>{copy.trace.harness.intent}</dt>
                  <dd>{harness.intents.map(intentLabel).join(" + ")}</dd>
                </div>
                <div>
                  <dt>{copy.trace.harness.tools}</dt>
                  <dd>{harness.activeToolCount} / {harness.configuredToolCount}</dd>
                </div>
                <div>
                  <dt>{copy.trace.harness.saved}</dt>
                  <dd>{formatBytes(harness.savedToolDefinitionBytes)}</dd>
                </div>
                <div>
                  <dt>{copy.trace.harness.retries}</dt>
                  <dd>{harness.maxRetries} · {harness.maxRetriesSource}</dd>
                </div>
              </dl>
              <p>
                <span>{copy.trace.harness.model}</span>
                <code>{harness.provider}/{harness.model}</code>
              </p>
              <p>
                <span>{copy.trace.harness.omitted}</span>
                <code>{harness.omittedToolNames.join(", ") || copy.trace.harness.none}</code>
              </p>
              <footer>
                <span>{copy.trace.harness.receipt}</span>
                <code title={harness.contentSha256}>{harness.contentSha256.slice(0, 12)}</code>
              </footer>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function intentLabel(intent: ModelHarnessIntent): string {
  return copy.trace.harness.intents[intent];
}

function formatBytes(value: number): string {
  return value < 1_024 ? `${value} B` : `${(value / 1_024).toFixed(1)} KiB`;
}
