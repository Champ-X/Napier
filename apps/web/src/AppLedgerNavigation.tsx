import { LedgerNavigation } from "./LedgerNavigation";
import type { useWorkspaceShell } from "./use-workspace-shell";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

export function AppLedgerNavigation({
  vm,
  shell,
}: {
  vm: ReturnType<typeof useWorkspaceViewModel>;
  shell: ReturnType<typeof useWorkspaceShell>;
}) {
  if (!vm.bootstrap) return null;
  return (
    <LedgerNavigation
      bootstrap={vm.bootstrap}
      selectedThreadId={vm.selectedThreadId}
      busyThreadId={vm.threadLifecycleBusyId}
      trashedThread={vm.trashedThreadReceipt}
      onNewThread={() => void vm.newThread()}
      onSelect={(threadId) => void vm.selectThread(threadId)}
      onTrash={(threadId) => void vm.trashThread(threadId)}
      onRestore={() => void vm.restoreTrashedThread()}
      onWorkspaceSwitch={vm.switchWorkspaceRoot}
      onOpenSettings={shell.openSettings}
      onOpenWorkspaceSettings={shell.openWorkspaceSettings}
    />
  );
}
