import { Cable, ShieldCheck } from "lucide-react";

import type { RunEvent } from "@napier/contracts";

import {
  compiledPromptPackageViews,
  type CompiledPromptPackageView,
} from "./compiled-prompt-package-view";
import type { ModelAdapterView } from "./model-adapter-view";
import { modelAdapterViews } from "./model-adapter-view";
import { modelContextEnvelopeCopy } from "./model-context-envelope-copy";
import type { ModelContextEnvelopeView } from "./model-context-envelope-view";
import { modelContextEnvelopeViews } from "./model-context-envelope-view";

const adapterCopy = {
  eyebrow: "MODEL ADAPTER",
  title: "Provider request policies",
  empty: "No Model Adapter selection has been recorded for this Thread.",
  api: "API",
  cache: "Cache",
  maxTokens: "Stream cap",
  modelCap: "Model cap",
  source: "Source",
  receipt: "Receipt",
} as const;

const promptPackageCopy = {
  eyebrow: "PROMPT PACKAGE",
  title: "Compiled context layers",
  empty: "No compiled Prompt package has been recorded for this Thread.",
  promptBytes: "Prompt bytes",
  estimatedTokens: "Est. tokens",
  tools: "Tools",
  segments: "Segments",
  adapter: "Adapter",
  core: "Core",
  partition: "Partition",
  receipt: "Receipt",
} as const;

const layerLabels: Record<
  CompiledPromptPackageView["layers"][number]["id"],
  string
> = {
  invariant_core: "Invariant Core",
  effective_capabilities: "Effective Capabilities",
  task_skill_overlay: "Task / Skill Overlay",
  workspace_context: "Workspace Context",
  model_adapter: "Model Adapter",
};

export function ModelPromptTraceLedgers({
  events,
}: {
  events: readonly RunEvent[];
}) {
  return (
    <>
      <CompiledPromptPackageLedger
        packages={compiledPromptPackageViews(events)}
      />
      <ModelAdapterLedger adapters={modelAdapterViews(events)} />
      <ModelContextEnvelopeLedger
        envelopes={modelContextEnvelopeViews(events)}
      />
    </>
  );
}

export function CompiledPromptPackageLedger({
  packages,
}: {
  packages: CompiledPromptPackageView[];
}) {
  return (
    <section
      className="tool-loop-guard-ledger model-context-envelope-ledger"
      aria-labelledby="compiled-prompt-package-title"
    >
      <header>
        <div>
          <span>{promptPackageCopy.eyebrow}</span>
          <h3 id="compiled-prompt-package-title">{promptPackageCopy.title}</h3>
        </div>
        <span>{String(packages.length).padStart(2, "0")}</span>
      </header>
      {packages.length === 0 ? (
        <p>{promptPackageCopy.empty}</p>
      ) : (
        <ol>
          {packages
            .slice()
            .reverse()
            .map((promptPackage) => (
              <li
                className="tool-loop-guard-card model-context-envelope-card"
                key={`${promptPackage.eventSeq}:${promptPackage.contentSha256}`}
              >
                <header>
                  <span>
                    <ShieldCheck size={11} aria-hidden="true" />
                    Turn {promptPackage.turnIndex} · lossless
                  </span>
                  <code>
                    #{String(promptPackage.eventSeq).padStart(3, "0")}
                  </code>
                </header>
                <dl>
                  <div>
                    <dt>{promptPackageCopy.promptBytes}</dt>
                    <dd>{promptPackage.systemPromptBytes}</dd>
                  </div>
                  <div>
                    <dt>{promptPackageCopy.estimatedTokens}</dt>
                    <dd>{promptPackage.estimatedTokens}</dd>
                  </div>
                  <div>
                    <dt>{promptPackageCopy.tools}</dt>
                    <dd>{promptPackage.toolCount}</dd>
                  </div>
                  <div>
                    <dt>{promptPackageCopy.segments}</dt>
                    <dd>{promptPackage.segmentCount}</dd>
                  </div>
                </dl>
                {promptPackage.layers.map((layer) => (
                  <p key={layer.id}>
                    <span>{layerLabels[layer.id]}</span>
                    <code title={layer.contentSha256}>
                      {layer.bytes} B · ~{layer.estimatedTokens} tok ·{" "}
                      {layer.contentSha256.slice(0, 12)}
                    </code>
                  </p>
                ))}
                <p>
                  <span>{promptPackageCopy.adapter}</span>
                  <code>{promptPackage.adapterId}</code>
                </p>
                <p>
                  <span>{promptPackageCopy.core}</span>
                  <code
                    title={
                      promptPackage.invariantCore.status === "bound"
                        ? promptPackage.invariantCore.contentSha256
                        : undefined
                    }
                  >
                    {promptPackage.invariantCore.status === "bound"
                      ? `${promptPackage.invariantCore.version} · ${promptPackage.invariantCore.bytes} B · ${promptPackage.invariantCore.contentSha256.slice(0, 12)}`
                      : promptPackage.invariantCore.status.replaceAll("_", " ")}
                  </code>
                </p>
                <p>
                  <span>{promptPackageCopy.partition}</span>
                  <code title={promptPackage.partitionSha256}>
                    {promptPackage.partitionSha256.slice(0, 12)}
                  </code>
                </p>
                <footer>
                  <span>{promptPackageCopy.receipt}</span>
                  <code title={promptPackage.contentSha256}>
                    {promptPackage.contentSha256.slice(0, 12)}
                  </code>
                </footer>
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}

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
                  <div>
                    <dt>{adapterCopy.maxTokens}</dt>
                    <dd>
                      {adapter.streamOptionMaxTokens ?? "legacy unavailable"}
                    </dd>
                  </div>
                  <div>
                    <dt>{adapterCopy.modelCap}</dt>
                    <dd>{adapter.modelMaxTokens ?? "legacy unavailable"}</dd>
                  </div>
                </dl>
                {adapter.streamOptionMaxTokensSource ? (
                  <p>
                    <span>Token source</span>
                    <code>{adapter.streamOptionMaxTokensSource}</code>
                  </p>
                ) : null}
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
