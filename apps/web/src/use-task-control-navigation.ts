import type { RunEvent } from "@napier/contracts";
import { useCallback } from "react";

import { browserLiveViewExpected } from "./browser-live-view-state";
import { motionScrollBehavior } from "./reduced-motion";
import type { InspectorTab } from "./use-workspace-view-model";

export function useTaskControlNavigation({
  activeRunId,
  events,
  onSelectInspector,
}: {
  activeRunId: string | undefined;
  events: readonly RunEvent[];
  onSelectInspector(tab: InspectorTab): void;
}) {
  const browserControlsAvailable = Boolean(
    activeRunId && browserLiveViewExpected(events, activeRunId),
  );
  const openInspector = useCallback(
    (tab: InspectorTab) => {
      onSelectInspector(tab);
    },
    [onSelectInspector],
  );
  const openBrowserControls = useCallback(() => {
    const target = document.querySelector<HTMLElement>(".browser-live-view");
    if (target) {
      target.scrollIntoView({ behavior: motionScrollBehavior(), block: "center" });
      target.focus({ preventScroll: true });
      return;
    }
    openInspector("browser");
  }, [openInspector]);
  const openArtifact = useCallback(
    (path: string) => {
      const openArtifactCard = (target: HTMLElement) => {
        target.scrollIntoView({
          behavior: motionScrollBehavior(),
          block: "center",
        });
        target.focus({ preventScroll: true });
        target
          .querySelector<HTMLButtonElement>(
            '[data-artifact-action="open"]',
          )
          ?.click();
      };
      const target = [
        ...document.querySelectorAll<HTMLElement>(
          ".conversation-artifact:not(.task-artifact-card)[data-artifact-path]",
        ),
      ].find((candidate) => candidate.dataset["artifactPath"] === path);
      if (target) {
        openArtifactCard(target);
        return;
      }
      openInspector("files");
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const taskArtifact = [
            ...document.querySelectorAll<HTMLElement>(
              ".task-artifact-card[data-artifact-path]",
            ),
          ].find((candidate) => candidate.dataset["artifactPath"] === path);
          if (taskArtifact) openArtifactCard(taskArtifact);
        }),
      );
    },
    [openInspector],
  );

  return {
    browserControlsAvailable,
    openInspector,
    openArtifact,
    openBrowserControls,
  };
}
