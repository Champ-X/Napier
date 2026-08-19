import { Scissors } from "lucide-react";

import { copy } from "./copy";
import type { ToolResultContextPruningView } from "./tool-result-context-pruning-view";

export interface ToolResultContextPruningLedgerProps {
  pruning: ToolResultContextPruningView[];
}

export function ToolResultContextPruningLedger({
  pruning,
}: ToolResultContextPruningLedgerProps) {
  const labels = copy.trace.contextPruning;
  return (
    <section
      className="tool-loop-guard-ledger model-context-envelope-ledger"
      aria-labelledby="tool-result-context-pruning-title"
    >
      <header>
        <div>
          <span>{labels.eyebrow}</span>
          <h3 id="tool-result-context-pruning-title">{labels.title}</h3>
        </div>
        <span>{String(pruning.length).padStart(2, "0")}</span>
      </header>
      {pruning.length === 0 ? (
        <p>{labels.empty}</p>
      ) : (
        <ol>
          {pruning.slice().reverse().map((receipt) => (
            <li
              className="tool-loop-guard-card model-context-envelope-card"
              key={`${receipt.eventSeq}:${receipt.contentSha256}`}
            >
              <header>
                <span>
                  <Scissors size={12} aria-hidden="true" />
                  {labels.attempt} {receipt.attempt}
                </span>
                <code>#{String(receipt.eventSeq).padStart(3, "0")}</code>
              </header>
              <dl>
                <div><dt>{labels.results}</dt><dd>{receipt.toolResultCount}</dd></div>
                <div><dt>{labels.replaced}</dt><dd>{receipt.replacementCount}</dd></div>
                <div><dt>{labels.saved}</dt><dd>{formatBytes(receipt.savedToolResultTextBytes)}</dd></div>
                <div><dt>{labels.active}</dt><dd>{formatBytes(receipt.activeToolResultTextBytes)}</dd></div>
                <div><dt>{labels.superseded}</dt><dd>{receipt.supersededResultCount}</dd></div>
                <div><dt>{labels.repeated}</dt><dd>{receipt.repeatedErrorCount}</dd></div>
                <div><dt>{labels.large}</dt><dd>{receipt.largeResultCount}</dd></div>
                <div><dt>{labels.emptyResults}</dt><dd>{receipt.emptyResultCount}</dd></div>
              </dl>
              <p>
                <span>{labels.context}</span>
                <code title={receipt.activeToolResultSetSha256}>
                  {receipt.originalToolResultTextBytes} B → {receipt.activeToolResultTextBytes} B · {receipt.activeToolResultSetSha256.slice(0, 12)}
                </code>
              </p>
              <footer>
                <span>{labels.receipt}</span>
                <code title={receipt.contentSha256}>{receipt.contentSha256.slice(0, 12)}</code>
              </footer>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${bytes} B`;
}
