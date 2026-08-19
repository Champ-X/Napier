import { Sparkles } from "lucide-react";

import { contextCopy } from "./context-copy";
import type { ContextPanelController } from "./use-context-panel-controller";

export interface ContextRunModelCardProps {
  controller: ContextPanelController;
}

export function ContextRunModelCard({ controller }: ContextRunModelCardProps) {
  const { modelGroups, onModel, selectedModel, selectedModelKey } = controller;
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
      <label className="context-field">
        <span>{contextCopy.chooseModel}</span>
        <select
          value={selectedModelKey}
          onChange={(event) => onModel(event.target.value)}
        >
          {modelGroups.map((group) => (
            <optgroup key={group.provider} label={group.label}>
              {group.options.map((option) => (
                <option
                  key={option.key}
                  value={option.key}
                  disabled={!option.configured}
                >
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
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
