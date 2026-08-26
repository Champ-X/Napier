import { copy } from "./copy";
import { ContextPackagePublishing } from "./ContextPackagePublishing";
import type { ContextPanelProps } from "./context-panel-types";
import { useContextPanelController } from "./use-context-panel-controller";

export interface AgentPackagePublishingSurfaceProps extends ContextPanelProps {}

export function AgentPackagePublishingSurface(
  props: AgentPackagePublishingSurfaceProps,
) {
  const controller = useContextPanelController(props);
  return (
    <section
      className="developer-publishing-section"
      aria-labelledby="agent-publishing-title"
    >
      <header>
        <span>{copy.developerWorkbench.agentPublishingEyebrow}</span>
        <h2 id="agent-publishing-title">
          {copy.developerWorkbench.agentPublishingTitle}
        </h2>
        <p>{copy.developerWorkbench.agentPublishingBody}</p>
      </header>
      {controller.error ? (
        <div className="context-error" role="alert">
          {controller.error}
        </div>
      ) : null}
      <ContextPackagePublishing controller={controller} />
    </section>
  );
}
