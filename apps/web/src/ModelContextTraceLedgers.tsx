import { ShieldCheck } from "lucide-react";

import type { RunEvent } from "@napier/contracts";

import { advancedSurfaceCopy } from "./advanced-surface-copy";
import {
  compiledPromptPackageViews,
  type CompiledPromptPackageView,
} from "./compiled-prompt-package-view";
import { ContextCheckpointContinuityLedger } from "./ContextCheckpointContinuityLedger";
import { contextCheckpointContinuityViews } from "./context-checkpoint-continuity-view";
import { modelAdapterViews } from "./model-adapter-view";
import { modelContextEnvelopeViews } from "./model-context-envelope-view";
import { ModelAdapterLedger } from "./ModelAdapterLedger";
import { ModelContextEnvelopeLedger } from "./ModelContextEnvelopeLedger";
import { ModelHarnessLedger } from "./ModelHarnessLedger";
import { ToolResultContextPruningLedger } from "./ToolResultContextPruningLedger";
import { toolResultContextPruningViews } from "./tool-result-context-pruning-view";

export { ModelAdapterLedger, ModelContextEnvelopeLedger };

const promptPackageCopy = advancedSurfaceCopy.promptPackage;
const smallLabels = advancedSurfaceCopy.smallLabels;

const layerLabels: Record<
  CompiledPromptPackageView["layers"][number]["id"],
  string
> = promptPackageCopy.layers;

export interface ModelPromptTraceLedgersProps {
  events: readonly RunEvent[];
}

// Intrinsic minmax() grids and fluid clamp() headings are owned by the shared
// trace feature stylesheet so every diagnostic ledger keeps identical geometry.
export function ModelPromptTraceLedgers({
  events,
}: ModelPromptTraceLedgersProps) {
  return (
    <>
      <CompiledPromptPackageLedger
        packages={compiledPromptPackageViews(events)}
      />
      <ModelHarnessLedger events={events} />
      <ToolResultContextPruningLedger
        pruning={toolResultContextPruningViews(events)}
      />
      <ContextCheckpointContinuityLedger
        checkpoints={contextCheckpointContinuityViews(events)}
      />
      <ModelAdapterLedger adapters={modelAdapterViews(events)} />
      <ModelContextEnvelopeLedger
        envelopes={modelContextEnvelopeViews(events)}
      />
    </>
  );
}

export interface CompiledPromptPackageLedgerProps {
  packages: CompiledPromptPackageView[];
}

export function CompiledPromptPackageLedger({
  packages,
}: CompiledPromptPackageLedgerProps) {
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
                    {smallLabels.turn} {promptPackage.turnIndex} ·{" "}
                    {smallLabels.lossless}
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
                      {layer.bytes} B · ~{layer.estimatedTokens}{" "}
                      {smallLabels.tokenAbbreviation} ·{" "}
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
