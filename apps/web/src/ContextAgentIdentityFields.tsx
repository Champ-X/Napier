import type { AgentProfile } from "@napier/contracts";

import { contextCopy } from "./context-copy";
import type { ContextPanelController } from "./use-context-panel-controller";

export interface ContextAgentIdentityFieldsProps {
  controller: ContextPanelController;
}

export function ContextAgentIdentityFields({
  controller,
}: ContextAgentIdentityFieldsProps) {
  const {
    agentDescription,
    agentName,
    agentSystemPrompt,
    agentThinkingLevel,
    configurationBusy,
    setAgentDescription,
    setAgentName,
    setAgentSystemPrompt,
    setAgentThinkingLevel,
  } = controller;
  return (
    <>
      <div className="context-field-grid">
        <label className="context-field">
          <span>{contextCopy.name}</span>
          <input
            required
            maxLength={80}
            value={agentName}
            disabled={configurationBusy}
            onChange={(event) => setAgentName(event.target.value)}
          />
        </label>
        <label className="context-field">
          <span>{contextCopy.thinking}</span>
          <select
            value={agentThinkingLevel}
            disabled={configurationBusy}
            onChange={(event) =>
              setAgentThinkingLevel(
                event.target.value as AgentProfile["thinkingLevel"],
              )
            }
          >
            {(["off", "minimal", "low", "medium", "high"] as const).map(
              (level) => (
                <option key={level} value={level}>
                  {contextCopy.thinkingLevels[level]}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      <label className="context-field">
        <span>{contextCopy.description}</span>
        <input
          required
          maxLength={500}
          value={agentDescription}
          disabled={configurationBusy}
          onChange={(event) => setAgentDescription(event.target.value)}
        />
      </label>
      <label className="context-field">
        <span>{contextCopy.systemPrompt}</span>
        <textarea
          required
          rows={7}
          maxLength={12_000}
          value={agentSystemPrompt}
          disabled={configurationBusy}
          onChange={(event) => setAgentSystemPrompt(event.target.value)}
        />
        <small>{contextCopy.systemPromptHint}</small>
      </label>
    </>
  );
}
