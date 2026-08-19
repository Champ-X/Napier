import { RefreshCw, ShieldCheck } from "lucide-react";

import type { AutomaticRecoveryMode } from "@napier/contracts";

import { contextCopy } from "./context-copy";
import { ContextNumberField } from "./ContextNumberField";
import type { ContextPanelController } from "./use-context-panel-controller";

export interface ContextRecoveryPolicyFieldsetProps {
  controller: ContextPanelController;
}

export function ContextRecoveryPolicyFieldset({
  controller,
}: ContextRecoveryPolicyFieldsetProps) {
  const {
    agentRecoveryBackoffSeconds,
    agentRecoveryMaxAttempts,
    agentRecoveryMode,
    configurationBusy,
    setAgentRecoveryBackoffSeconds,
    setAgentRecoveryMaxAttempts,
    setAgentRecoveryMode,
  } = controller;
  return (
    <fieldset
      className={`context-recovery-policy mode-${agentRecoveryMode}`}
      disabled={configurationBusy}
    >
      <legend>{contextCopy.recoveryPolicy}</legend>
      <header>
        <RefreshCw size={13} aria-hidden="true" />
        <div>
          <strong>{contextCopy.recoveryTitle}</strong>
          <span>{contextCopy.recoveryKicker}</span>
        </div>
      </header>
      <div className="context-recovery-grid">
        <label className="context-field">
          <span>{contextCopy.recoveryMode}</span>
          <select
            value={agentRecoveryMode}
            onChange={(event) =>
              setAgentRecoveryMode(event.target.value as AutomaticRecoveryMode)
            }
          >
            <option value="manual">{contextCopy.recoveryModes.manual}</option>
            <option value="safe_read_only">
              {contextCopy.recoveryModes.safe_read_only}
            </option>
          </select>
        </label>
        <ContextNumberField
          label={contextCopy.recoveryAttempts}
          value={agentRecoveryMaxAttempts}
          min={1}
          max={3}
          onChange={setAgentRecoveryMaxAttempts}
        />
        <ContextNumberField
          label={contextCopy.recoveryBackoff}
          value={agentRecoveryBackoffSeconds}
          min={1}
          max={3_600}
          onChange={setAgentRecoveryBackoffSeconds}
        />
      </div>
      <p>
        <ShieldCheck size={11} aria-hidden="true" />
        {agentRecoveryMode === "safe_read_only"
          ? contextCopy.recoverySafeBody
          : contextCopy.recoveryManualBody}
      </p>
    </fieldset>
  );
}
