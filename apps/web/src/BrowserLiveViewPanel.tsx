import type { RunEvent } from "@napier/contracts";
import type { BrowserInteractionAction } from "@napier/contracts/browser-interaction-confirmation";

import { browserLiveActivity } from "./browser-live-activity";
import { BrowserLiveViewSurface } from "./BrowserLiveViewSurface";
import { useBrowserLiveViewController } from "./use-browser-live-view-controller";

export interface BrowserLiveViewPanelProps {
  threadId: string;
  runId: string;
  events: readonly RunEvent[];
  confirmationAction?: BrowserInteractionAction;
}

export function BrowserLiveViewPanel({
  threadId,
  runId,
  events,
  confirmationAction,
}: BrowserLiveViewPanelProps) {
  const controller = useBrowserLiveViewController(threadId, runId);
  if (!controller.imageUrl || !controller.receipt || !controller.pauseState) {
    return null;
  }
  const paused = controller.pauseState.status === "paused";
  const activity = browserLiveActivity(events, runId, {
    pauseStatus: controller.pauseState.status,
    takeoverOpen: paused && controller.takeoverOpen,
    ...(controller.controlTransition
      ? { controlTransition: controller.controlTransition }
      : {}),
    ...(confirmationAction ? { confirmationAction } : {}),
    ...(controller.operatorAction
      ? { operatorAction: controller.operatorAction }
      : {}),
  });
  return (
    <BrowserLiveViewSurface
      threadId={threadId}
      runId={runId}
      imageUrl={controller.imageUrl}
      receipt={controller.receipt}
      paused={paused}
      takeoverOpen={controller.takeoverOpen}
      refreshing={controller.refreshing}
      controlBusy={controller.controlBusy}
      controlFailed={controller.controlFailed}
      activity={activity}
      onTogglePause={controller.togglePause}
      onOpenTakeover={controller.openTakeover}
      onRefresh={controller.manualRefresh}
      onOperatorAction={controller.setOperatorAction}
      onReturnToAgent={controller.returnToAgent}
    />
  );
}
