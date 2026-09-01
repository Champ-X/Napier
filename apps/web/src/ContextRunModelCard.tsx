import { Sparkles } from "lucide-react";

import { contextCopy } from "./context-copy";
import { ModelPicker } from "./ModelPicker";
import type { ContextPanelController } from "./use-context-panel-controller";

export interface ContextRunModelCardProps {
  controller: ContextPanelController;
}

export function ContextRunModelCard({ controller }: ContextRunModelCardProps) {
  const {
    agent,
    models,
    onBootstrapUpdated,
    onModel,
    recentModelKeys,
    selectedModel,
    selectedModelKey,
    threadId,
  } = controller;
  return (
    <section
      className="context-runtime-card"
      aria-labelledby="runtime-model-title"
    >
      <header>
        <div className="context-section-glyph" aria-hidden="true">
          <Sparkles size={14} />
        </div>
        <div>
          <span>{contextCopy.nextRun}</span>
          <h3 id="runtime-model-title">{contextCopy.runModel}</h3>
        </div>
      </header>
      <div className="context-field">
        <span>{contextCopy.chooseModel}</span>
        <ModelPicker
          models={models}
          value={selectedModelKey}
          label={contextCopy.chooseModel}
          recommendedModelKeys={[`${agent.model.provider}/${agent.model.id}`]}
          recentModelKeys={recentModelKeys}
          setup={{ threadId, onBootstrapUpdated }}
          onChange={onModel}
        />
      </div>
      {!selectedModel.configured ? (
        <p
          className="context-model-warning"
          id="context-model-unavailable"
          role="status"
        >
          {contextCopy.modelUnavailableHint}
        </p>
      ) : null}
      <p>{contextCopy.runModelHint}</p>
    </section>
  );
}
