import { ShieldCheck } from "lucide-react";

import type { ModelAdvisorMode } from "@napier/contracts";

import { AGENT_MODEL_ADVISOR_RULES } from "./context-agent-defaults";
import { contextCopy } from "./context-copy";
import { ContextNumberField } from "./ContextNumberField";
import { ContextOptionGroup } from "./ContextOptionGroup";
import type { ContextPanelController } from "./use-context-panel-controller";

export interface ContextModelAdvisorFieldsetProps {
  controller: ContextPanelController;
}

export function ContextModelAdvisorFieldset({
  controller,
}: ContextModelAdvisorFieldsetProps) {
  const {
    advisorReviewModelAvailable,
    agentAdvisorCorrectionAttempts,
    agentAdvisorMode,
    agentAdvisorReviewModelKey,
    agentAdvisorRules,
    configurationBusy,
    modelGroups,
    selectedModelKey,
    setAgentAdvisorCorrectionAttempts,
    setAgentAdvisorMode,
    setAgentAdvisorReviewModelKey,
    setAgentAdvisorRules,
  } = controller;
  return (
    <fieldset className="context-budget-grid" disabled={configurationBusy}>
      <legend>{contextCopy.modelAdvisor}</legend>
      <label className="context-field">
        <span>{contextCopy.modelAdvisorMode}</span>
        <select
          value={agentAdvisorMode}
          onChange={(event) =>
            setAgentAdvisorMode(event.target.value as ModelAdvisorMode)
          }
        >
          <option value="observe">
            {contextCopy.modelAdvisorModes.observe}
          </option>
          <option value="enforce">
            {contextCopy.modelAdvisorModes.enforce}
          </option>
          <option value="off">{contextCopy.modelAdvisorModes.off}</option>
        </select>
      </label>
      <ContextOptionGroup
        legend={contextCopy.modelAdvisorRules}
        options={AGENT_MODEL_ADVISOR_RULES.map((rule) => ({
          value: rule,
          label: contextCopy.modelAdvisorRuleLabels[rule],
          detail: rule,
        }))}
        selected={agentAdvisorRules}
        disabled={configurationBusy || agentAdvisorMode === "off"}
        onChange={setAgentAdvisorRules}
      />
      <ContextNumberField
        label={contextCopy.modelAdvisorCorrectionAttempts}
        value={agentAdvisorCorrectionAttempts}
        min={0}
        max={3}
        onChange={setAgentAdvisorCorrectionAttempts}
      />
      <label className="context-field">
        <span>{contextCopy.modelAdvisorReviewModel}</span>
        <select
          value={agentAdvisorReviewModelKey}
          disabled={configurationBusy || agentAdvisorMode === "off"}
          onChange={(event) =>
            setAgentAdvisorReviewModelKey(event.target.value)
          }
        >
          <option value="">
            {contextCopy.modelAdvisorReviewModelDisabled}
          </option>
          {modelGroups
            .filter((group) => group.provider !== "napier")
            .map((group) => (
              <optgroup key={group.provider} label={group.label}>
                {group.options.map((option) => (
                  <option
                    key={option.key}
                    value={option.key}
                    disabled={
                      !option.configured || option.key === selectedModelKey
                    }
                  >
                    {option.label}
                    {option.configured && option.key === selectedModelKey
                      ? ` · ${contextCopy.modelAdvisorReviewModelPrimary}`
                      : ""}
                  </option>
                ))}
              </optgroup>
            ))}
        </select>
      </label>
      {!advisorReviewModelAvailable ? (
        <p
          className="context-model-warning"
          id="context-advisor-review-model-unavailable"
          role="status"
        >
          {contextCopy.modelAdvisorReviewModelUnavailableHint}
        </p>
      ) : null}
      <p className="guardrail-note">
        <ShieldCheck size={11} aria-hidden="true" />
        {contextCopy.modelAdvisorBody}
      </p>
    </fieldset>
  );
}
