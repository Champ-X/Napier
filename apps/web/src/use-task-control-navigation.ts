import type { RunEvent } from "@napier/contracts";
import { useCallback } from "react";

import { browserLiveViewExpected } from "./browser-live-view-state";
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
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus({ preventScroll: true });
      return;
    }
    openInspector("browser");
  }, [openInspector]);
  const openArtifact = useCallback(
    (path: string) => {
      const target = [
        ...document.querySelectorAll<HTMLElement>(
          ".conversation-artifact:not(.task-artifact-card)[data-artifact-path]",
        ),
      ].find((candidate) => candidate.dataset["artifactPath"] === path);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.focus({ preventScroll: true });
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
          taskArtifact?.scrollIntoView({ behavior: "smooth", block: "center" });
          taskArtifact?.focus({ preventScroll: true });
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
