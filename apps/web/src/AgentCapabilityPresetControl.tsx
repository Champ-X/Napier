import {
  AGENT_CAPABILITY_PRESETS,
  agentCapabilityPresetUpdate,
  agentCapabilityStatus,
  type AgentCapabilityPresetId,
} from "@napier/contracts/agent-capabilities";
import type { AgentProfile, ToolPolicyMode } from "@napier/contracts";

import { agentCapabilityDetailText } from "./agent-capability-view-model";
import { contextCopy as copy } from "./context-copy";
import "./agent-capability-preset.css";

export function AgentCapabilityPresetControl({
  profile,
  disabled,
  onPolicyChange,
  onChange,
}: {
  profile: Pick<
    AgentProfile,
    "toolPolicy" | "enabledTools" | "enabledSkills" | "enabledSubagents"
  >;
  disabled: boolean;
  onPolicyChange: (policy: ToolPolicyMode) => void;
  onChange: (update: ReturnType<typeof agentCapabilityPresetUpdate>) => void;
}) {
  const status = agentCapabilityStatus(profile);
  return (
    <section className="agent-capability-preset">
      <header>
        <div>
          <strong>{copy.capabilityPreset}</strong>
          <span>{copy.capabilityPresetKicker}</span>
        </div>
        <code>{status.label}</code>
      </header>
      <label className="context-field">
        <span>{copy.capabilityPresetSelect}</span>
        <select
          value={status.presetId === "custom" ? "custom" : status.presetId}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value === "custom") return;
            onChange(
              agentCapabilityPresetUpdate(
                event.target.value as AgentCapabilityPresetId,
              ),
            );
          }}
        >
          <option value="custom">{copy.capabilityPresetCustom}</option>
          {AGENT_CAPABILITY_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      <p>{agentCapabilityDetailText(profile)}</p>
      <small>{copy.capabilityPresetBody}</small>
      <label className="context-field">
        <span>{copy.policy}</span>
        <select
          value={profile.toolPolicy}
          disabled={disabled}
          onChange={(event) =>
            onPolicyChange(event.target.value as ToolPolicyMode)
          }
        >
          {(["observe", "workspace", "unrestricted"] as const).map((policy) => (
            <option key={policy} value={policy}>
              {copy.policies[policy]}
            </option>
          ))}
        </select>
        <small>{copy.policyHint}</small>
      </label>
    </section>
  );
}
