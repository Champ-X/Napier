import { RotateCcw, ShieldCheck } from "lucide-react";

import { contextCopy } from "./context-copy";
import { parseToolLoopGuardExemptTools } from "./context-panel-helpers";
import { ContextNumberField } from "./ContextNumberField";
import type { ContextPanelController } from "./use-context-panel-controller";

export interface ContextToolLoopGuardFieldsetProps {
  controller: ContextPanelController;
}

export function ContextToolLoopGuardFieldset({
  controller,
}: ContextToolLoopGuardFieldsetProps) {
  const {
    agentToolLoopGuardEnabled,
    agentToolLoopGuardExemptTools,
    agentToolLoopGuardThreshold,
    configurationBusy,
    setAgentToolLoopGuardEnabled,
    setAgentToolLoopGuardExemptTools,
    setAgentToolLoopGuardThreshold,
  } = controller;
  const exemptToolsValid =
    parseToolLoopGuardExemptTools(agentToolLoopGuardExemptTools) !== undefined;
  return (
    <fieldset
      className={`context-tool-loop-guard ${
        agentToolLoopGuardEnabled ? "is-enabled" : "is-disabled"
      }`}
      disabled={configurationBusy}
    >
      <legend>{contextCopy.toolLoopGuard}</legend>
      <header>
        <RotateCcw size={13} aria-hidden="true" />
        <div>
          <strong>{contextCopy.toolLoopGuardTitle}</strong>
          <span>{contextCopy.toolLoopGuardKicker}</span>
        </div>
        <label className="context-loop-toggle">
          <input
            type="checkbox"
            checked={agentToolLoopGuardEnabled}
            onChange={(event) =>
              setAgentToolLoopGuardEnabled(event.target.checked)
            }
          />
          <span>
            {agentToolLoopGuardEnabled
              ? contextCopy.toolLoopGuardEnabled
              : contextCopy.toolLoopGuardDisabled}
          </span>
        </label>
      </header>
      <div className="context-loop-grid">
        <ContextNumberField
          label={contextCopy.toolLoopGuardThreshold}
          value={agentToolLoopGuardThreshold}
          min={2}
          max={8}
          onChange={setAgentToolLoopGuardThreshold}
        />
        <label className="context-field">
          <span>{contextCopy.toolLoopGuardExemptTools}</span>
          <input
            value={agentToolLoopGuardExemptTools}
            maxLength={4_159}
            aria-invalid={!exemptToolsValid}
            placeholder={contextCopy.toolLoopGuardExemptPlaceholder}
            onChange={(event) =>
              setAgentToolLoopGuardExemptTools(event.target.value)
            }
          />
        </label>
      </div>
      <p>
        <ShieldCheck size={11} aria-hidden="true" />
        {contextCopy.toolLoopGuardBody}
      </p>
      {!exemptToolsValid ? (
        <p className="context-loop-error" role="alert">
          {contextCopy.toolLoopGuardInvalid}
        </p>
      ) : null}
    </fieldset>
  );
}
