import { AgentCapabilityContractCard } from "./AgentCapabilityContractCard";
import { AgentCapabilityPresetControl } from "./AgentCapabilityPresetControl";
import { contextCopy } from "./context-copy";
import { ContextOptionGroup } from "./ContextOptionGroup";
import type { ContextPanelController } from "./use-context-panel-controller";

export interface ContextCapabilityFieldsProps {
  controller: ContextPanelController;
}

export function ContextCapabilityFields({
  controller,
}: ContextCapabilityFieldsProps) {
  const {
    agent,
    agentSkills,
    agentSubagents,
    agentToolPolicy,
    agentTools,
    configurationBusy,
    refreshWorkspace,
    setAgentSkills,
    setAgentSubagents,
    setAgentToolPolicy,
    setAgentTools,
    skills,
    subagentOptions,
    toolOptions,
  } = controller;
  return (
    <>
      <AgentCapabilityPresetControl
        profile={{
          toolPolicy: agentToolPolicy,
          enabledTools: agentTools,
          enabledSkills: agentSkills,
          enabledSubagents: agentSubagents,
        }}
        disabled={configurationBusy}
        onPolicyChange={setAgentToolPolicy}
        onChange={(update) => {
          setAgentToolPolicy(update.toolPolicy);
          setAgentTools(update.enabledTools);
          setAgentSkills(update.enabledSkills);
          setAgentSubagents(update.enabledSubagents ?? []);
        }}
      />
      <AgentCapabilityContractCard
        agentId={agent.id}
        agentRevision={agent.revision}
        disabled={configurationBusy}
        onRestored={refreshWorkspace}
      />
      <ContextOptionGroup
        legend={contextCopy.tools}
        options={toolOptions.map((tool) => ({
          value: tool,
          label: contextCopy.toolLabels[tool],
          detail: tool,
        }))}
        selected={agentTools}
        disabled={configurationBusy}
        onChange={setAgentTools}
      />
      <ContextOptionGroup
        legend={contextCopy.skills}
        options={skills.map((skill) => ({
          value: skill.name,
          label: skill.name,
          detail: `${contextCopy.skillSources[skill.source]} · ${skill.description}`,
          enabled: skill.enabled,
        }))}
        selected={agentSkills}
        disabled={configurationBusy}
        onChange={setAgentSkills}
      />
      <ContextOptionGroup
        legend={contextCopy.subagents}
        options={subagentOptions.map((role) => ({
          value: role,
          label: contextCopy.subagentLabels[role],
          detail: role,
        }))}
        selected={agentSubagents}
        disabled={configurationBusy}
        onChange={setAgentSubagents}
      />
    </>
  );
}
