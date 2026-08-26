import { PromptPackageDesk } from "./PromptPackageDesk";
import { SkillPackageDesk } from "./SkillPackageDesk";
import type { ContextPanelController } from "./use-context-panel-controller";

export interface ContextPackagePublishingProps {
  controller: ContextPanelController;
}

export function ContextPackagePublishing({
  controller,
}: ContextPackagePublishingProps) {
  const {
    activeSkillPackageInstallation,
    agent,
    agentSkills,
    canSignPromptPackage,
    canSignSkillPackage,
    downloadPromptPackage,
    downloadSkillPackage,
    inspectPromptPackageFile,
    inspectSkillPackageFile,
    promptPackageBusy,
    promptPackageReceipt,
    promptPublisher,
    promptSigningAnchors,
    promptTrustAnchorId,
    setPromptPublisher,
    setPromptTrustAnchorId,
    setSkillPublisher,
    setSkillPublisherChangeConfirmed,
    setSkillReplacementConfirmed,
    setSkillSetChangeConfirmed,
    setSkillTrustAnchorId,
    skillPackageBusy,
    skillPackageReceipt,
    skillPublisher,
    skillPublisherChangeConfirmed,
    skillReplacementConfirmed,
    skillSetChangeConfirmed,
    skillSigningAnchors,
    skillTrustAnchorId,
  } = controller;
  return (
    <>
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
