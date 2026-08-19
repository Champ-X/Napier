import { ShieldCheck } from "lucide-react";

import { advancedSurfaceCopy } from "./advanced-surface-copy";
import { copy } from "./copy";
import type { ModelContextEnvelopeView } from "./model-context-envelope-view";

export interface ModelContextEnvelopeLedgerProps {
  envelopes: ModelContextEnvelopeView[];
}

// Intrinsic minmax() grids and fluid clamp() headings are owned by the shared
// trace feature stylesheet so every diagnostic ledger keeps identical geometry.
export function ModelContextEnvelopeLedger({
  envelopes,
}: ModelContextEnvelopeLedgerProps) {
  const labels = copy.trace.contextEnvelope;
  return (
    <section
      className="tool-loop-guard-ledger model-context-envelope-ledger"
      aria-labelledby="model-context-envelope-title"
    >
      <header>
        <div>
          <span>{labels.eyebrow}</span>
          <h3 id="model-context-envelope-title">{labels.title}</h3>
        </div>
        <span>{String(envelopes.length).padStart(2, "0")}</span>
      </header>
      {envelopes.length === 0 ? (
        <p>{labels.empty}</p>
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
                    <ShieldCheck size={12} aria-hidden="true" />
                    {labels.turn} {envelope.turnIndex}
                  </span>
                  <code>#{String(envelope.eventSeq).padStart(3, "0")}</code>
                </header>
                <dl>
                  <div>
                    <dt>{labels.messages}</dt>
                    <dd>{envelope.messageCount}</dd>
                  </div>
                  <div>
                    <dt>{labels.users}</dt>
                    <dd>{envelope.userMessageCount}</dd>
                  </div>
                  <div>
                    <dt>{labels.assistants}</dt>
                    <dd>{envelope.assistantMessageCount}</dd>
                  </div>
                  <div>
                    <dt>{labels.toolResults}</dt>
                    <dd>{envelope.toolResultMessageCount}</dd>
                  </div>
                  <div>
                    <dt>{labels.other}</dt>
                    <dd>{envelope.otherMessageCount}</dd>
                  </div>
                  <div>
                    <dt>{labels.promptBytes}</dt>
                    <dd>{envelope.systemPromptBytes}</dd>
                  </div>
                  <div>
                    <dt>{labels.toolCount}</dt>
                    <dd>{envelope.toolCount}</dd>
                  </div>
                  {envelope.toolDefinitionBytes !== undefined ? (
                    <div>
                      <dt>{labels.toolSchemaBytes}</dt>
                      <dd>{envelope.toolDefinitionBytes}</dd>
                    </div>
                  ) : null}
                  {envelope.toolDefinitionEstimatedTokens !== undefined ? (
                    <div>
                      <dt>{labels.toolSchemaTokens}</dt>
                      <dd>
                        ~{envelope.toolDefinitionEstimatedTokens}{" "}
                        {advancedSurfaceCopy.smallLabels.tokenAbbreviation}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <HashLine
                  label={labels.prompt}
                  value={envelope.systemPromptSha256}
                />
                <HashLine
                  label={labels.messageSet}
                  value={envelope.messageSetSha256}
                />
                <HashLine
                  label={labels.toolNames}
                  value={envelope.toolNameSetSha256}
                />
                <HashLine
                  label={labels.toolDefinitions}
                  value={envelope.toolDefinitionSetSha256}
                />
                <p>
                  <span>{labels.response}</span>
                  <code>
                    {envelope.responseSeq !== undefined
                      ? `#${String(envelope.responseSeq).padStart(3, "0")} · ${envelope.responseModel} · ${labels.stop} ${envelope.responseStopReason}`
                      : labels.responseMissing}
                  </code>
                </p>
                <footer>
                  <span>{labels.receipt}</span>
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

interface HashLineProps {
  label: string;
  value: string;
}

function HashLine({ label, value }: HashLineProps) {
  return (
    <p>
      <span>{label}</span>
      <code title={value}>{value.slice(0, 12)}</code>
    </p>
  );
}
