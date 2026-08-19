import { useEffect, useState } from "react";

import type {
  ExtensionPublisherTrustAnchor,
  InstallSkillPackageResult,
  SignedSkillPackageEnvelope,
  SkillPackageInstallation,
} from "@napier/contracts";

import {
  installSkillPackage,
  qualifySkillPackage,
  signSkillPackage,
  verifySkillPackage,
} from "./context-api";
import { contextCopy } from "./context-copy";
import {
  MAX_SKILL_PACKAGE_FILE_BYTES,
  downloadJson,
  readJsonFile,
  sameStringSet,
  toErrorMessage,
} from "./context-panel-helpers";
import type { SkillPackageReceipt } from "./package-management-types";

export interface ContextSkillPackageControllerInput {
  anchors: ExtensionPublisherTrustAnchor[];
  activeInstallation?: SkillPackageInstallation;
  enabledSkills: string[];
  threadId: string;
  onError: (message: string | undefined) => void;
  onRefresh: () => Promise<void>;
}

export function useContextSkillPackageController({
  anchors,
  activeInstallation,
  enabledSkills,
  threadId,
  onError,
  onRefresh,
}: ContextSkillPackageControllerInput) {
  const [skillPublisher, setSkillPublisher] = useState<string>(
    contextCopy.skillPackageDefaultPublisher,
  );
  const [skillTrustAnchorId, setSkillTrustAnchorId] = useState(
    anchors[0]?.id ?? "",
  );
  const [skillPackageBusy, setSkillPackageBusy] = useState(false);
  const [skillPackageReceipt, setSkillPackageReceipt] =
    useState<SkillPackageReceipt>();
  const [skillReplacementConfirmed, setSkillReplacementConfirmed] =
    useState(false);
  const [skillPublisherChangeConfirmed, setSkillPublisherChangeConfirmed] =
    useState(false);
  const [skillSetChangeConfirmed, setSkillSetChangeConfirmed] = useState(false);

  useEffect(() => {
    if (
      anchors.length > 0 &&
      !anchors.some((anchor) => anchor.id === skillTrustAnchorId)
    ) {
      setSkillTrustAnchorId(anchors[0]!.id);
    }
    if (anchors.length === 0 && skillTrustAnchorId) {
      setSkillTrustAnchorId("");
    }
  }, [anchors, skillTrustAnchorId]);

  const downloadSkillPackage = async (): Promise<void> => {
    if (skillPackageBusy || !skillTrustAnchorId || enabledSkills.length === 0)
      return;
    setSkillPackageBusy(true);
    onError(undefined);
    try {
      const envelope = await signSkillPackage({
        threadId,
        trustAnchorId: skillTrustAnchorId,
        publisher: skillPublisher.trim(),
        skillNames: enabledSkills,
      });
      downloadJson(
        envelope,
        `napier-skills-${envelope.contentSha256.slice(0, 12)}.json`,
      );
      setSkillPackageReceipt({
        action: "signed",
        status: "signed",
        reason: contextCopy.skillPackageSigned,
        envelopeSha256: envelope.contentSha256,
        manifestSha256: envelope.manifest.contentSha256,
        skillCatalogSha256: envelope.manifest.skillCatalogSha256,
        keyId: envelope.signature.keyId,
        skillCount: envelope.manifest.skills.length,
      });
      await onRefresh();
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setSkillPackageBusy(false);
    }
  };

  const inspectSkillPackageFile = async (
    file: File,
    action: "verify" | "qualify" | "install",
  ): Promise<void> => {
    if (skillPackageBusy) return;
    if (file.size > MAX_SKILL_PACKAGE_FILE_BYTES) {
      onError(contextCopy.skillPackageTooLarge);
      return;
    }
    setSkillPackageBusy(true);
    onError(undefined);
    try {
      const envelope = (await readJsonFile(file)) as SignedSkillPackageEnvelope;
      if (action === "verify") {
        const verification = await verifySkillPackage({ envelope });
        setSkillPackageReceipt({
          action: "verified",
          status: verification.status,
          reason: verification.reason,
          ...(verification.envelopeSha256
            ? { envelopeSha256: verification.envelopeSha256 }
            : {}),
          ...(verification.manifestSha256
            ? { manifestSha256: verification.manifestSha256 }
            : {}),
          ...(verification.keyId ? { keyId: verification.keyId } : {}),
          skillCount: verification.skillCount,
        });
        return;
      }
      if (action === "qualify") {
        const qualification = await qualifySkillPackage({ threadId, envelope });
        setSkillPackageReceipt({
          action: "qualified",
          status: qualification.status,
          reason: qualification.reason,
          ...(qualification.envelopeSha256
            ? { envelopeSha256: qualification.envelopeSha256 }
            : {}),
          ...(qualification.manifestSha256
            ? { manifestSha256: qualification.manifestSha256 }
            : {}),
          ...(qualification.skillCatalogSha256
            ? { skillCatalogSha256: qualification.skillCatalogSha256 }
            : {}),
          ...(qualification.observedSkillCatalogSha256
            ? {
                observedSkillCatalogSha256:
                  qualification.observedSkillCatalogSha256,
              }
            : {}),
          ...(qualification.keyId ? { keyId: qualification.keyId } : {}),
          skillCount: qualification.skillCount,
        });
        await onRefresh();
        return;
      }
      await installPackage(envelope);
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setSkillPackageBusy(false);
    }
  };

  const installPackage = async (
    envelope: SignedSkillPackageEnvelope,
  ): Promise<void> => {
    const replacingActive =
      activeInstallation !== undefined &&
      activeInstallation.envelopeSha256 !== envelope.contentSha256;
    const publisherChanged =
      replacingActive &&
      activeInstallation !== undefined &&
      (activeInstallation.publisher !== envelope.manifest.publisher ||
        activeInstallation.keyId !== envelope.signature.keyId);
    const skillSetChanged =
      replacingActive &&
      activeInstallation !== undefined &&
      !sameStringSet(
        activeInstallation.loadedSkillNames,
        envelope.manifest.loadedSkillNames,
      );
    if (replacingActive && !skillReplacementConfirmed) {
      onError(contextCopy.skillPackageReplacementRequired);
      return;
    }
    if (publisherChanged && !skillPublisherChangeConfirmed) {
      onError(contextCopy.skillPackagePublisherChangeRequired);
      return;
    }
    if (skillSetChanged && !skillSetChangeConfirmed) {
      onError(contextCopy.skillPackageSkillSetChangeRequired);
      return;
    }
    const result: InstallSkillPackageResult = await installSkillPackage({
      threadId,
      envelope,
      ...(replacingActive && activeInstallation
        ? {
            replaceInstallationId: activeInstallation.id,
            confirmReplacement: true,
            ...(publisherChanged ? { confirmPublisherChange: true } : {}),
            ...(skillSetChanged ? { confirmSkillSetChange: true } : {}),
          }
        : {}),
    });
    setSkillPackageReceipt({
      action: "installed",
      status: result.created ? "installed" : "matched",
      reason: result.created
        ? contextCopy.skillPackageInstalled
        : contextCopy.skillPackageMatched,
      envelopeSha256: result.installation.envelopeSha256,
      manifestSha256: result.installation.manifestSha256,
      skillCatalogSha256: result.installation.skillCatalogSha256,
      keyId: result.installation.keyId,
      skillCount: result.installation.loadedSkillNames.length,
      installationId: result.installation.id,
      ...(result.replacedInstallation
        ? { replacedInstallationId: result.replacedInstallation.id }
        : {}),
    });
    setSkillReplacementConfirmed(false);
    setSkillPublisherChangeConfirmed(false);
    setSkillSetChangeConfirmed(false);
    await onRefresh();
  };

  const canSignSkillPackage =
    skillPublisher.trim().length > 0 &&
    skillTrustAnchorId.length > 0 &&
    enabledSkills.length > 0;
  return {
    skillPublisher,
    setSkillPublisher,
    skillTrustAnchorId,
    setSkillTrustAnchorId,
    skillPackageBusy,
    skillPackageReceipt,
    skillReplacementConfirmed,
    setSkillReplacementConfirmed,
    skillPublisherChangeConfirmed,
    setSkillPublisherChangeConfirmed,
    skillSetChangeConfirmed,
    setSkillSetChangeConfirmed,
    downloadSkillPackage,
    inspectSkillPackageFile,
    canSignSkillPackage,
  };
}
