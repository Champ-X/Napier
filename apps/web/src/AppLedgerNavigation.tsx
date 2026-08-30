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
      onNewThread={() => void vm.newThread()}
      onSelect={(threadId) => void vm.selectThread(threadId)}
      onTrash={(threadId) => void vm.trashThread(threadId)}
      onWorkspaceSwitch={vm.switchWorkspaceRoot}
      onOpenDeveloperWorkbench={shell.openDeveloperWorkbench}
      onOpenSettings={shell.openSettings}
      onOpenWorkspaceSettings={shell.openWorkspaceSettings}
      layout={layout}
    />
  );
}
