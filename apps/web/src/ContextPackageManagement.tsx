import { AgentRevisionHistory } from "./AgentRevisionHistory";
import { PromptPackageDesk } from "./PromptPackageDesk";
import { SkillContentDesk } from "./SkillContentDesk";
import { SkillPackageDesk } from "./SkillPackageDesk";
import type { ContextPanelController } from "./use-context-panel-controller";

export interface ContextPackageManagementProps {
  controller: ContextPanelController;
}

export function ContextPackageManagement({
  controller,
}: ContextPackageManagementProps) {
  const {
    activeSkillPackageInstallation,
    agent,
    agentRevisions,
    agentSkills,
    canSignPromptPackage,
    canSignSkillPackage,
    configurationBusy,
    confirmRollback,
    downloadPromptPackage,
    downloadSkillPackage,
    historyLoading,
    inspectPromptPackageFile,
    inspectSkillPackageFile,
    loadSkillContentFile,
    previewSkillContentDraft,
    applySkillContentDraft,
    promptPackageBusy,
    promptPackageReceipt,
    promptPublisher,
    promptSigningAnchors,
    promptTrustAnchorId,
    rollbackTarget,
    setPromptPublisher,
    setPromptTrustAnchorId,
    setRollbackTarget,
    setSkillContentInstallConfirmed,
    setSkillContentReplacementConfirmed,
    setSkillPublisher,
    setSkillPublisherChangeConfirmed,
    setSkillReplacementConfirmed,
    setSkillSetChangeConfirmed,
    setSkillTrustAnchorId,
    skillContentBusy,
    skillContentInstallConfirmed,
    skillContentReceipt,
    skillContentReplacementConfirmed,
    skillContentText,
    skillPackageBusy,
    skillPackageReceipt,
    skillPublisher,
    skillPublisherChangeConfirmed,
    skillReplacementConfirmed,
    skillSetChangeConfirmed,
    skillSigningAnchors,
    skillTrustAnchorId,
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
      <SkillPackageDesk
        enabledSkills={agentSkills}
        anchors={skillSigningAnchors}
        activeInstallation={activeSkillPackageInstallation}
        publisher={skillPublisher}
        selectedAnchorId={skillTrustAnchorId}
        busy={skillPackageBusy}
        canSign={canSignSkillPackage}
        replacementConfirmed={skillReplacementConfirmed}
        publisherChangeConfirmed={skillPublisherChangeConfirmed}
        skillSetChangeConfirmed={skillSetChangeConfirmed}
        receipt={skillPackageReceipt}
        onPublisher={setSkillPublisher}
        onAnchor={setSkillTrustAnchorId}
        onReplacementConfirmed={setSkillReplacementConfirmed}
        onPublisherChangeConfirmed={setSkillPublisherChangeConfirmed}
        onSkillSetChangeConfirmed={setSkillSetChangeConfirmed}
        onSign={() => void downloadSkillPackage()}
        onInspectFile={(file, action) =>
          void inspectSkillPackageFile(file, action)
        }
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
      <PromptPackageDesk
        agent={agent}
        anchors={promptSigningAnchors}
        publisher={promptPublisher}
        selectedAnchorId={promptTrustAnchorId}
        busy={promptPackageBusy}
        canSign={canSignPromptPackage}
        receipt={promptPackageReceipt}
        onPublisher={setPromptPublisher}
        onAnchor={setPromptTrustAnchorId}
        onSign={() => void downloadPromptPackage()}
        onInspectFile={(file, action) =>
          void inspectPromptPackageFile(file, action)
        }
      />
    </>
  );
}
