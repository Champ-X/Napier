import { useCallback } from "react";

import type {
  AutomaticRecoveryAttempt,
  AutomationSchedule,
  InboundChannel,
} from "@napier/contracts";
import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";

import { getAutomationBootstrap } from "./automation-api";
import { useAutomationChannelComposerController } from "./use-automation-channel-composer-controller";
import { useAutomationChannelRuntimeController } from "./use-automation-channel-runtime-controller";
import { useAutomationDeadLetterArtifacts } from "./use-automation-dead-letter-artifacts";
import { useAutomationDeadLetterHistory } from "./use-automation-dead-letter-history";
import { useAutomationOperation } from "./use-automation-operation";
import { useAutomationRecoveryRefresh } from "./use-automation-recovery-refresh";
import { useAutomationScheduleController } from "./use-automation-schedule-controller";

export interface AutomationPanelControllerOptions {
  threadId: string;
  schedules: AutomationSchedule[];
  channels: InboundChannel[];
  recoveryAttempts: AutomaticRecoveryAttempt[];
  recoveryPending: boolean;
  onBootstrapUpdated: (bootstrap: LiveReadyBootstrapResponse) => void;
}

export function useAutomationPanelController({
  threadId,
  schedules,
  channels,
  recoveryAttempts,
  recoveryPending,
  onBootstrapUpdated,
}: AutomationPanelControllerOptions) {
  const threadSchedules = schedules.filter(
    (schedule) => schedule.threadId === threadId,
  );
  const threadChannels = channels.filter(
    (channel) => channel.threadId === threadId,
  );
  const operation = useAutomationOperation();
  const refresh = useCallback(async (): Promise<void> => {
    onBootstrapUpdated(await getAutomationBootstrap(threadId));
  }, [onBootstrapUpdated, threadId]);
  const schedule = useAutomationScheduleController({
    threadId,
    operation,
    refresh,
  });
  const composer = useAutomationChannelComposerController({
    threadId,
    operation,
    refresh,
  });
  const runtime = useAutomationChannelRuntimeController({
    operation,
    refresh,
    onCreatedChannel: composer.showCreatedChannel,
  });
  const history = useAutomationDeadLetterHistory({
    channels: threadChannels,
    operation,
  });
  const artifacts = useAutomationDeadLetterArtifacts({
    operation,
    refresh,
    updateDeliveries: runtime.updateDeliveries,
    onHistory: history.setHistory,
    onHistoryChanged: history.clearVerification,
  });
  useAutomationRecoveryRefresh({
    attempts: recoveryAttempts,
    pending: recoveryPending,
    refresh,
  });
  return {
    threadSchedules,
    threadChannels,
    operation,
    schedule,
    composer,
    runtime,
    history,
    artifacts,
  };
}
