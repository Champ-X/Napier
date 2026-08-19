import { contextCopy } from "./context-copy";
import { ContextNumberField } from "./ContextNumberField";
import type { ContextPanelController } from "./use-context-panel-controller";

export interface ContextBudgetFieldsetsProps {
  controller: ContextPanelController;
}

export function ContextBudgetFieldsets({
  controller,
}: ContextBudgetFieldsetsProps) {
  const {
    agentMaxConcurrent,
    agentMaxTotal,
    agentMaxTurns,
    agentRunMaxCostUsd,
    agentRunMaxTotalTokens,
    agentRunMaxTurns,
    agentRunTimeoutSeconds,
    agentSubagents,
    agentTimeoutSeconds,
    configurationBusy,
    setAgentMaxConcurrent,
    setAgentMaxTotal,
    setAgentMaxTurns,
    setAgentRunMaxCostUsd,
    setAgentRunMaxTotalTokens,
    setAgentRunMaxTurns,
    setAgentRunTimeoutSeconds,
    setAgentTimeoutSeconds,
  } = controller;
  return (
    <>
      <fieldset className="context-budget-grid" disabled={configurationBusy}>
        <legend>{contextCopy.runBudget}</legend>
        <ContextNumberField
          label={contextCopy.runMaxTurns}
          value={agentRunMaxTurns}
          min={1}
          max={128}
          onChange={setAgentRunMaxTurns}
        />
        <ContextNumberField
          label={contextCopy.runMaxTokens}
          value={agentRunMaxTotalTokens}
          min={1_000}
          max={10_000_000}
          onChange={setAgentRunMaxTotalTokens}
        />
        <ContextNumberField
          label={contextCopy.runMaxCost}
          value={agentRunMaxCostUsd}
          min={0.01}
          max={1_000}
          step={0.01}
          onChange={setAgentRunMaxCostUsd}
        />
        <ContextNumberField
          label={contextCopy.runTimeout}
          value={agentRunTimeoutSeconds}
          min={10}
          max={3_600}
          onChange={setAgentRunTimeoutSeconds}
        />
      </fieldset>
      <fieldset
        className="context-budget-grid"
        disabled={configurationBusy || agentSubagents.length === 0}
      >
        <legend>{contextCopy.delegationBudget}</legend>
        <ContextNumberField
          label={contextCopy.maxConcurrent}
          value={agentMaxConcurrent}
          min={1}
          max={8}
          onChange={setAgentMaxConcurrent}
        />
        <ContextNumberField
          label={contextCopy.maxTotal}
          value={agentMaxTotal}
          min={1}
          max={24}
          onChange={setAgentMaxTotal}
        />
        <ContextNumberField
          label={contextCopy.maxTurns}
          value={agentMaxTurns}
          min={1}
          max={32}
          onChange={setAgentMaxTurns}
        />
        <ContextNumberField
          label={contextCopy.timeout}
          value={agentTimeoutSeconds}
          min={1}
          max={900}
          onChange={setAgentTimeoutSeconds}
        />
      </fieldset>
    </>
  );
}
