import { ContextAgentProfileForm } from "./ContextAgentProfileForm";
import { contextCopy } from "./context-copy";
import { ContextPackageManagement } from "./ContextPackageManagement";
import { ContextRunModelCard } from "./ContextRunModelCard";
import type { ContextPanelProps as ContextPanelInput } from "./context-panel-types";
import { ContextWorkspaceEvidence } from "./ContextWorkspaceEvidence";
import { useContextPanelController } from "./use-context-panel-controller";

import "./context-panel-shell.css";
import "./context-profile-policies.css";
import "./context-profile-variables.css";
import "./context-model-route.css";
import "./context-workspace-evidence.css";

export type ContextPanelProps = ContextPanelInput;

export default function ContextPanel(props: ContextPanelProps) {
  const controller = useContextPanelController(props);
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
      <ContextRunModelCard controller={controller} />
      <ContextAgentProfileForm controller={controller} />
      <ContextPackageManagement controller={controller} />
      <ContextWorkspaceEvidence controller={controller} />
    </section>
  );
}
