import { LedgerNavigation } from "./LedgerNavigation";
import type { useWorkspaceShell } from "./use-workspace-shell";
import type { useWorkspaceLayout } from "./use-workspace-layout";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

export function AppLedgerNavigation({
  vm,
  shell,
  layout,
}: {
  vm: ReturnType<typeof useWorkspaceViewModel>;
  shell: ReturnType<typeof useWorkspaceShell>;
  layout: ReturnType<typeof useWorkspaceLayout>;
}) {
  if (!vm.bootstrap) return null;
  return (
    <LedgerNavigation
      bootstrap={vm.bootstrap}
      selectedThreadId={vm.selectedThreadId}
      busyThreadId={vm.threadLifecycleBusyId}
      newThreadBusy={vm.isCreatingThread}
      onNewThread={vm.newThread}
      onSelect={vm.selectThread}
      onTrash={vm.trashThread}
      onWorkspaceSwitch={vm.switchWorkspaceRoot}
      onOpenDeveloperWorkbench={shell.openDeveloperWorkbench}
      onOpenSettings={shell.openSettings}
      layout={layout}
    />
  );
}
