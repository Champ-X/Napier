import { BookOpen, Save, ShieldCheck } from "lucide-react";

import { ContextAgentIdentityFields } from "./ContextAgentIdentityFields";
import { ContextBudgetFieldsets } from "./ContextBudgetFieldsets";
import { ContextCapabilityFields } from "./ContextCapabilityFields";
import { contextCopy } from "./context-copy";
import { ContextModelAdvisorFieldset } from "./ContextModelAdvisorFieldset";
import { ContextModelRouteFieldset } from "./ContextModelRouteFieldset";
import { ContextPromptVariablesFieldset } from "./ContextPromptVariablesFieldset";
import { ContextRecoveryPolicyFieldset } from "./ContextRecoveryPolicyFieldset";
import { ContextToolLoopGuardFieldset } from "./ContextToolLoopGuardFieldset";
import type { ContextPanelController } from "./use-context-panel-controller";

export interface ContextAgentProfileFormProps {
  controller: ContextPanelController;
}

export function ContextAgentProfileForm({
  controller,
}: ContextAgentProfileFormProps) {
  const {
    canSaveAgent,
    configurationBusy,
    profileSaveDescriptionIds,
    saveAgent,
  } = controller;
  return (
    <form
      className="agent-config-sheet"
      aria-describedby="agent-config-note"
      onSubmit={(event) => {
        event.preventDefault();
        void saveAgent();
      }}
    >
      <header className="context-section-heading">
        <div className="context-section-glyph" aria-hidden="true">
          <BookOpen size={14} />
        </div>
        <div>
          <span>{contextCopy.profileEyebrow}</span>
          <h3>{contextCopy.profile}</h3>
        </div>
      </header>
      <ContextAgentIdentityFields controller={controller} />
      <ContextModelRouteFieldset controller={controller} />
      <ContextPromptVariablesFieldset controller={controller} />
      <ContextCapabilityFields controller={controller} />
      <ContextRecoveryPolicyFieldset controller={controller} />
      <ContextModelAdvisorFieldset controller={controller} />
      <ContextToolLoopGuardFieldset controller={controller} />
      <ContextBudgetFieldsets controller={controller} />
      <button
        className="primary-wide context-save"
        type="submit"
        disabled={configurationBusy || !canSaveAgent}
        aria-busy={configurationBusy}
        aria-describedby={profileSaveDescriptionIds || undefined}
      >
        <Save size={13} aria-hidden="true" />
        {configurationBusy ? contextCopy.saving : contextCopy.saveProfile}
      </button>
      <p className="context-form-note" id="agent-config-note">
        <ShieldCheck size={12} aria-hidden="true" />
        {contextCopy.profileSafety}
      </p>
    </form>
  );
}
