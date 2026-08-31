import { useState } from "react";
import { BookOpen, HeartPulse, Route, Save, ShieldCheck } from "lucide-react";

import { ContextAgentIdentityFields } from "./ContextAgentIdentityFields";
import { ContextBudgetFieldsets } from "./ContextBudgetFieldsets";
import { ContextCapabilityFields } from "./ContextCapabilityFields";
import { contextCopy } from "./context-copy";
import { contextSurfaceCopy as t } from "./context-surface-copy";
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
  const [section, setSection] = useState<
    "identity" | "capability" | "resilience"
  >("identity");
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
      <nav
        className="context-profile-navigation"
        role="tablist"
        aria-label={t.profileSectionsLabel}
      >
        {(
          [
            {
              id: "identity" as const,
              icon: Route,
              ...t.profileSections.identity,
            },
            {
              id: "capability" as const,
              icon: ShieldCheck,
              ...t.profileSections.capability,
            },
            {
              id: "resilience" as const,
              icon: HeartPulse,
              ...t.profileSections.resilience,
            },
          ] as const
        ).map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={section === entry.id}
              className={section === entry.id ? "is-active" : ""}
              key={entry.id}
              onClick={() => setSection(entry.id)}
            >
              <Icon size={14} aria-hidden="true" />
              <span>
                <strong>{entry.label}</strong>
                <small>{entry.description}</small>
              </span>
            </button>
          );
        })}
      </nav>
      <div className="context-profile-section" role="tabpanel">
        {section === "identity" ? (
          <>
            <ContextAgentIdentityFields controller={controller} />
            <ContextModelRouteFieldset controller={controller} />
            <ContextPromptVariablesFieldset controller={controller} />
          </>
        ) : null}
        {section === "capability" ? (
          <ContextCapabilityFields controller={controller} />
        ) : null}
        {section === "resilience" ? (
          <>
            <ContextRecoveryPolicyFieldset controller={controller} />
            <ContextModelAdvisorFieldset controller={controller} />
            <ContextToolLoopGuardFieldset controller={controller} />
            <ContextBudgetFieldsets controller={controller} />
          </>
        ) : null}
      </div>
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
