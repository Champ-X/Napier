import { Cable } from "lucide-react";

import { copy } from "./copy";
import type { ModelAdapterView } from "./model-adapter-view";

export interface ModelAdapterLedgerProps {
  adapters: ModelAdapterView[];
}

// Intrinsic minmax() grids and fluid clamp() headings are owned by the shared
// trace feature stylesheet so every diagnostic ledger keeps identical geometry.
export function ModelAdapterLedger({ adapters }: ModelAdapterLedgerProps) {
  return (
    <section
      className="tool-loop-guard-ledger model-context-envelope-ledger"
      aria-labelledby="model-adapter-title"
    >
      <header>
        <div>
          <span>{copy.trace.modelAdapter.eyebrow}</span>
          <h3 id="model-adapter-title">{copy.trace.modelAdapter.title}</h3>
        </div>
        <span>{String(adapters.length).padStart(2, "0")}</span>
      </header>
      {adapters.length === 0 ? (
        <p>{copy.trace.modelAdapter.empty}</p>
      ) : (
        <ol>
          {adapters.slice().reverse().map((adapter) => (
            <li
              className="tool-loop-guard-card model-context-envelope-card"
              key={`${adapter.eventSeq}:${adapter.contentSha256}`}
            >
              <header>
                <span>
                  <Cable size={12} aria-hidden="true" />
                  {adapter.family} · v{adapter.adapterVersion}
                </span>
                <code>#{String(adapter.eventSeq).padStart(3, "0")}</code>
              </header>
              <dl>
                <div>
                  <dt>{copy.trace.modelAdapter.api}</dt>
                  <dd>{adapter.modelApi}</dd>
                </div>
                <div>
                  <dt>{copy.trace.modelAdapter.cache}</dt>
                  <dd>{adapter.cacheRetention}</dd>
                </div>
                <div>
                  <dt>{copy.trace.modelAdapter.source}</dt>
                  <dd>{adapter.cacheRetentionSource}</dd>
                </div>
                <div>
                  <dt>{copy.trace.modelAdapter.streamCap}</dt>
                  <dd>{adapter.streamOptionMaxTokens ?? copy.trace.modelAdapter.legacy}</dd>
                </div>
                <div>
                  <dt>{copy.trace.modelAdapter.modelCap}</dt>
                  <dd>{adapter.modelMaxTokens ?? copy.trace.modelAdapter.legacy}</dd>
                </div>
              </dl>
              {adapter.streamOptionMaxTokensSource ? (
                <p>
                  <span>{copy.trace.modelAdapter.tokenSource}</span>
                  <code>{adapter.streamOptionMaxTokensSource}</code>
                </p>
              ) : null}
              <p>
                <span>{copy.trace.modelAdapter.adapter}</span>
                <code>{adapter.adapterId}</code>
              </p>
              <footer>
                <span>{copy.trace.modelAdapter.receipt}</span>
                <code title={adapter.contentSha256}>{adapter.contentSha256.slice(0, 12)}</code>
              </footer>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
