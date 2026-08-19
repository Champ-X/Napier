import { Plus, Sparkles } from "lucide-react";

import { contextCopy } from "./context-copy";
import { validPromptVariables } from "./context-panel-helpers";
import { ContextPromptVariableRow } from "./ContextPromptVariableRow";
import type { ContextPanelController } from "./use-context-panel-controller";

export interface ContextPromptVariablesFieldsetProps {
  controller: ContextPanelController;
}

export function ContextPromptVariablesFieldset({
  controller,
}: ContextPromptVariablesFieldsetProps) {
  const {
    addPromptVariable,
    agentPromptVariables,
    configurationBusy,
    insertPromptVariable,
    removePromptVariable,
    replacePromptVariable,
  } = controller;
  return (
    <fieldset className="context-prompt-variables" disabled={configurationBusy}>
      <legend>{contextCopy.promptVariables}</legend>
      <header>
        <div>
          <Sparkles size={13} aria-hidden="true" />
          <span>
            <strong>{contextCopy.promptVariablesTitle}</strong>
            <small>{contextCopy.promptVariablesKicker}</small>
          </span>
        </div>
        <button
          type="button"
          className="prompt-variable-add"
          disabled={agentPromptVariables.length >= 32}
          onClick={addPromptVariable}
        >
          <Plus size={11} aria-hidden="true" />
          {contextCopy.promptVariableAdd}
        </button>
      </header>
      <p>{contextCopy.promptVariablesBody}</p>
      {agentPromptVariables.length === 0 ? (
        <div className="prompt-variable-empty">
          {contextCopy.promptVariablesEmpty}
        </div>
      ) : (
        <div className="prompt-variable-list" role="list">
          {agentPromptVariables.map((definition, index) => (
            <ContextPromptVariableRow
              key={`${definition.name}:${index}`}
              definition={definition}
              definitions={agentPromptVariables}
              index={index}
              onInsert={insertPromptVariable}
              onRemove={removePromptVariable}
              onReplace={replacePromptVariable}
            />
          ))}
        </div>
      )}
      {!validPromptVariables(agentPromptVariables) ? (
        <p className="prompt-variable-error" role="alert">
          {contextCopy.promptVariablesInvalid}
        </p>
      ) : null}
    </fieldset>
  );
}
