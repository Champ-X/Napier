import { AgentRevisionHistory } from "./AgentRevisionHistory";
import { SkillContentDesk } from "./SkillContentDesk";
import type { ContextPanelController } from "./use-context-panel-controller";

export interface ContextPackageManagementProps {
  controller: ContextPanelController;
}

export function ContextPackageManagement({
  controller,
}: ContextPackageManagementProps) {
  const {
    agent,
    agentRevisions,
    configurationBusy,
    confirmRollback,
    historyLoading,
    loadSkillContentFile,
    previewSkillContentDraft,
    applySkillContentDraft,
    rollbackTarget,
    setRollbackTarget,
    setSkillContentInstallConfirmed,
    setSkillContentReplacementConfirmed,
    skillContentBusy,
    skillContentInstallConfirmed,
    skillContentReceipt,
    skillContentReplacementConfirmed,
    skillContentText,
    updateSkillContentText,
  } = controller;
  return (
    <>
      <AgentRevisionHistory
        current={agent}
        revisions={agentRevisions}
        loading={historyLoading}
        busy={configurationBusy}
        rollbackTarget={rollbackTarget}
        onReviewRollback={setRollbackTarget}
        onCancelRollback={() => setRollbackTarget(undefined)}
        onConfirmRollback={() => void confirmRollback()}
      />
      <SkillContentDesk
        content={skillContentText}
        busy={skillContentBusy}
        receipt={skillContentReceipt}
        installConfirmed={skillContentInstallConfirmed}
        replacementConfirmed={skillContentReplacementConfirmed}
        onContent={updateSkillContentText}
        onLoadFile={(file) => void loadSkillContentFile(file)}
        onPreview={() => void previewSkillContentDraft()}
        onApply={() => void applySkillContentDraft()}
        onInstallConfirmed={setSkillContentInstallConfirmed}
        onReplacementConfirmed={setSkillContentReplacementConfirmed}
      />
    </>
  );
}
