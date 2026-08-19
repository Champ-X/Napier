import type {
  AutomaticRecoveryAssessment,
  AutomaticRecoveryAttempt,
  AutomationSchedule,
  InboundChannel,
  InboundChannelAdapterDescriptor,
} from "@napier/contracts";
import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";

import { AutomationChannelSection } from "./AutomationChannelSection";
import { AutomationRecoverySection } from "./AutomationRecoverySection";
import { AutomationScheduleSection } from "./AutomationScheduleSection";
import { automationCopy as copy } from "./automation-copy";
import { useAutomationPanelController } from "./use-automation-panel-controller";
import "./automation-panel-interactions.css";

export interface AutomationPanelProps {
  threadId: string;
  schedules: AutomationSchedule[];
  channels: InboundChannel[];
  inboundChannelAdapters: InboundChannelAdapterDescriptor[];
  recoveryAssessments: AutomaticRecoveryAssessment[];
  recoveryAttempts: AutomaticRecoveryAttempt[];
  recoveryPending: boolean;
  onBootstrapUpdated: (bootstrap: LiveReadyBootstrapResponse) => void;
}

export default function AutomationPanel(props: AutomationPanelProps) {
  const controller = useAutomationPanelController(props);
  const count =
    controller.threadSchedules.length +
    controller.threadChannels.length +
    props.recoveryAttempts.length;
  return (
    <section
      className="panel-section automation-panel"
      aria-labelledby="automation-title"
    >
      <div className="panel-heading">
        <div>
          <span>{copy.eyebrow}</span>
          <h2 id="automation-title">{copy.title}</h2>
        </div>
        <span className="automation-count">{count}</span>
      </div>
      {controller.operation.error ? (
        <div className="automation-error" role="alert">
          {controller.operation.error}
        </div>
      ) : null}
      <AutomationRecoverySection
        assessments={props.recoveryAssessments}
        attempts={props.recoveryAttempts}
      />
      <AutomationScheduleSection
        schedules={controller.threadSchedules}
        busyId={controller.operation.busyId}
        controller={controller.schedule}
      />
      <AutomationChannelSection
        channels={controller.threadChannels}
        adapters={props.inboundChannelAdapters}
        busyId={controller.operation.busyId}
        composer={controller.composer}
        runtime={controller.runtime}
        artifacts={controller.artifacts}
        history={controller.history}
      />
    </section>
  );
}
