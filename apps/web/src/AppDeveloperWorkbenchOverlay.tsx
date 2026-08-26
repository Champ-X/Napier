import { DeveloperWorkbenchSurface } from "./DeveloperWorkbenchSurface";
import type { useWorkspaceShell } from "./use-workspace-shell";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

export function AppDeveloperWorkbenchOverlay({
  vm,
  shell,
  activeAgent,
}: {
  vm: ReturnType<typeof useWorkspaceViewModel>;
  shell: ReturnType<typeof useWorkspaceShell>;
  activeAgent: Parameters<typeof DeveloperWorkbenchSurface>[0]["activeAgent"];
}) {
  if (!shell.developerWorkbenchOpen) return null;
  return (
    <DeveloperWorkbenchSurface
      vm={vm}
      activeAgent={activeAgent}
      section={shell.developerWorkbenchSection}
      onSection={shell.setDeveloperWorkbenchSection}
      onClose={shell.closeDeveloperWorkbench}
      onConversation={() => {
        shell.closeDeveloperWorkbench();
        shell.setWorkspaceView("conversation");
      }}
    />
  );
}
