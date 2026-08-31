import { useState } from "react";
import { BookOpen, Boxes, Gauge, ShieldCheck } from "lucide-react";

import { ContextAgentProfileForm } from "./ContextAgentProfileForm";
import { contextCopy } from "./context-copy";
import { ContextPackageManagement } from "./ContextPackageManagement";
import { ContextRunModelCard } from "./ContextRunModelCard";
import type { ContextPanelProps as ContextPanelInput } from "./context-panel-types";
import { ContextWorkspaceEvidence } from "./ContextWorkspaceEvidence";
import { contextSurfaceCopy as t } from "./context-surface-copy";
import { useContextPanelController } from "./use-context-panel-controller";

import "./context-panel-shell.css";
import "./context-profile-policies.css";
import "./context-profile-variables.css";
import "./context-model-route.css";
import "./context-workspace-evidence.css";

export type ContextPanelProps = ContextPanelInput;

export default function ContextPanel(props: ContextPanelProps) {
  const controller = useContextPanelController(props);
  const [section, setSection] = useState<
    "runtime" | "profile" | "packages" | "evidence"
  >("runtime");
  const sections = [
    { id: "runtime" as const, icon: Gauge, ...t.sections.runtime },
    { id: "profile" as const, icon: BookOpen, ...t.sections.profile },
    { id: "packages" as const, icon: Boxes, ...t.sections.packages },
    { id: "evidence" as const, icon: ShieldCheck, ...t.sections.evidence },
  ];
  return (
    <section
      className="panel-section context-workbench"
      aria-labelledby="context-title"
    >
      <div className="panel-heading">
        <div>
          <span>{contextCopy.eyebrow}</span>
          <h2 id="context-title">{contextCopy.title}</h2>
        </div>
        <span className="context-version">
          {contextCopy.revision} {props.agent.revision}
        </span>
      </div>
      {controller.error ? (
        <div className="context-error" role="alert">
          {controller.error}
        </div>
      ) : null}
      <nav
        className="context-workbench-navigation"
        role="tablist"
        aria-label={t.sectionsLabel}
      >
        {sections.map((entry) => {
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
              <Icon size={15} aria-hidden="true" />
              <span>
                <strong>{entry.label}</strong>
                <small>{entry.description}</small>
              </span>
            </button>
          );
        })}
      </nav>
      <div className="context-workbench-section" role="tabpanel">
        {section === "runtime" ? (
          <ContextRunModelCard controller={controller} />
        ) : null}
        {section === "profile" ? (
          <ContextAgentProfileForm controller={controller} />
        ) : null}
        {section === "packages" ? (
          <ContextPackageManagement controller={controller} />
        ) : null}
        {section === "evidence" ? (
          <ContextWorkspaceEvidence controller={controller} />
        ) : null}
      </div>
    </section>
  );
}
