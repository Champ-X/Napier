import { Cable, ShieldCheck } from "lucide-react";

import type { ModelAdapterView } from "./model-adapter-view";
import { modelContextEnvelopeCopy } from "./model-context-envelope-copy";
import type { ModelContextEnvelopeView } from "./model-context-envelope-view";

const adapterCopy = {
  eyebrow: "MODEL ADAPTER",
  title: "Provider request policies",
  empty: "No Model Adapter selection has been recorded for this Thread.",
  api: "API",
  cache: "Cache",
  source: "Source",
  receipt: "Receipt",
} as const;

export function ModelAdapterLedger({
  adapters,
}: {
  adapters: ModelAdapterView[];
}) {
  return (
    <section
      className="tool-loop-guard-ledger model-context-envelope-ledger"
      aria-labelledby="model-adapter-title"
    >
      <header>
        <div>
          <span>{adapterCopy.eyebrow}</span>
          <h3 id="model-adapter-title">{adapterCopy.title}</h3>
        </div>
        <span>{String(adapters.length).padStart(2, "0")}</span>
      </header>
      {adapters.length === 0 ? (
        <p>{adapterCopy.empty}</p>
      ) : (
        <ol>
          {adapters
            .slice()
            .reverse()
            .map((adapter) => (
              <li
                className="tool-loop-guard-card model-context-envelope-card"
                key={`${adapter.eventSeq}:${adapter.contentSha256}`}
              >
                <header>
                  <span>
                    <Cable size={11} aria-hidden="true" />
                    {adapter.family} · v{adapter.adapterVersion}
                  </span>
                  <code>#{String(adapter.eventSeq).padStart(3, "0")}</code>
                </header>
                <dl>
                  <div>
                    <dt>{adapterCopy.api}</dt>
                    <dd>{adapter.modelApi}</dd>
                  </div>
                  <div>
                    <dt>{adapterCopy.cache}</dt>
                    <dd>{adapter.cacheRetention}</dd>
                  </div>
                  <div>
                    <dt>{adapterCopy.source}</dt>
                    <dd>{adapter.cacheRetentionSource}</dd>
                  </div>
                </dl>
                <p>
                  <span>Adapter</span>
                  <code>{adapter.adapterId}</code>
                </p>
                <footer>
                  <span>{adapterCopy.receipt}</span>
                  <code title={adapter.contentSha256}>
                    {adapter.contentSha256.slice(0, 12)}
                  </code>
                </footer>
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}

export function ModelContextEnvelopeLedger({
  envelopes,
}: {
  envelopes: ModelContextEnvelopeView[];
}) {
  return (
    <section
      className="tool-loop-guard-ledger model-context-envelope-ledger"
      aria-labelledby="model-context-envelope-title"
    >
      <header>
        <div>
          <span>{modelContextEnvelopeCopy.eyebrow}</span>
          <h3 id="model-context-envelope-title">
            {modelContextEnvelopeCopy.title}
          </h3>
        </div>
        <span>{String(envelopes.length).padStart(2, "0")}</span>
      </header>
      {envelopes.length === 0 ? (
        <p>{modelContextEnvelopeCopy.empty}</p>
      ) : (
        <ol>
          {envelopes
            .slice()
            .reverse()
            .map((envelope) => (
              <li
                className="tool-loop-guard-card model-context-envelope-card"
                key={`${envelope.eventSeq}:${envelope.contentSha256}`}
              >
                <header>
                  <span>
                    <ShieldCheck size={11} aria-hidden="true" />
                    {modelContextEnvelopeCopy.turn} {envelope.turnIndex}
                  </span>
                  <code>#{String(envelope.eventSeq).padStart(3, "0")}</code>
                </header>
                <dl>
                  <div>
                    <dt>{modelContextEnvelopeCopy.messages}</dt>
                    <dd>{envelope.messageCount}</dd>
                  </div>
                  <div>
                    <dt>{modelContextEnvelopeCopy.users}</dt>
                    <dd>{envelope.userMessageCount}</dd>
                  </div>
                  <div>
                    <dt>{modelContextEnvelopeCopy.assistants}</dt>
                    <dd>{envelope.assistantMessageCount}</dd>
                  </div>
                  <div>
                    <dt>{modelContextEnvelopeCopy.tools}</dt>
                    <dd>{envelope.toolResultMessageCount}</dd>
                  </div>
                </dl>
                <dl>
                  <div>
                    <dt>{modelContextEnvelopeCopy.other}</dt>
                    <dd>{envelope.otherMessageCount}</dd>
                  </div>
                  <div>
                    <dt>{modelContextEnvelopeCopy.promptBytes}</dt>
                    <dd>{envelope.systemPromptBytes}</dd>
                  </div>
                  <div>
                    <dt>{modelContextEnvelopeCopy.toolCount}</dt>
                    <dd>{envelope.toolCount}</dd>
                  </div>
                </dl>
                <p>
                  <span>{modelContextEnvelopeCopy.prompt}</span>
                  <code title={envelope.systemPromptSha256}>
                    {envelope.systemPromptSha256.slice(0, 12)}
                  </code>
                </p>
                <p>
                  <span>{modelContextEnvelopeCopy.messageSet}</span>
                  <code title={envelope.messageSetSha256}>
                    {envelope.messageSetSha256.slice(0, 12)}
                  </code>
                </p>
                <p>
                  <span>{modelContextEnvelopeCopy.toolNames}</span>
                  <code title={envelope.toolNameSetSha256}>
                    {envelope.toolNameSetSha256.slice(0, 12)}
                  </code>
                </p>
                <p>
                  <span>{modelContextEnvelopeCopy.toolDefinitions}</span>
                  <code title={envelope.toolDefinitionSetSha256}>
                    {envelope.toolDefinitionSetSha256.slice(0, 12)}
                  </code>
                </p>
                {envelope.responseSeq !== undefined ? (
                  <p>
                    <span>{modelContextEnvelopeCopy.response}</span>
                    <code>
                      #{String(envelope.responseSeq).padStart(3, "0")} ·{" "}
                      {envelope.responseModel} · {modelContextEnvelopeCopy.stop}{" "}
                      {envelope.responseStopReason}
                    </code>
                  </p>
                ) : (
                  <p>
                    <span>{modelContextEnvelopeCopy.response}</span>
                    <code>{modelContextEnvelopeCopy.responseMissing}</code>
                  </p>
                )}
                <footer>
                  <span>{modelContextEnvelopeCopy.receipt}</span>
                  <code title={envelope.contentSha256}>
                    {envelope.contentSha256.slice(0, 12)}
                  </code>
                </footer>
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}
