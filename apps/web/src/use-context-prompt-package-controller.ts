import { useEffect, useState } from "react";

import type {
  AgentProfile,
  ExtensionPublisherTrustAnchor,
  SignedPromptPackageEnvelope,
} from "@napier/contracts";

import {
  qualifyPromptPackage,
  signPromptPackage,
  verifyPromptPackage,
} from "./context-api";
import { contextCopy } from "./context-copy";
import {
  MAX_PROMPT_PACKAGE_FILE_BYTES,
  downloadJson,
  readJsonFile,
  toErrorMessage,
} from "./context-panel-helpers";
import type { PromptPackageReceipt } from "./package-management-types";

export interface ContextPromptPackageControllerInput {
  agent: AgentProfile;
  anchors: ExtensionPublisherTrustAnchor[];
  threadId: string;
  onError: (message: string | undefined) => void;
  onRefresh: () => Promise<void>;
}

export function useContextPromptPackageController({
  agent,
  anchors,
  threadId,
  onError,
  onRefresh,
}: ContextPromptPackageControllerInput) {
  const [promptPublisher, setPromptPublisher] = useState<string>(
    contextCopy.promptPackageDefaultPublisher,
  );
  const [promptTrustAnchorId, setPromptTrustAnchorId] = useState(
    anchors[0]?.id ?? "",
  );
  const [promptPackageBusy, setPromptPackageBusy] = useState(false);
  const [promptPackageReceipt, setPromptPackageReceipt] =
    useState<PromptPackageReceipt>();

  useEffect(() => {
    if (
      anchors.length > 0 &&
      !anchors.some((anchor) => anchor.id === promptTrustAnchorId)
    ) {
      setPromptTrustAnchorId(anchors[0]!.id);
    }
    if (anchors.length === 0 && promptTrustAnchorId) {
      setPromptTrustAnchorId("");
    }
  }, [anchors, promptTrustAnchorId]);

  const downloadPromptPackage = async (): Promise<void> => {
    if (promptPackageBusy || !promptTrustAnchorId) return;
    setPromptPackageBusy(true);
    onError(undefined);
    try {
      const envelope = await signPromptPackage({
        threadId,
        trustAnchorId: promptTrustAnchorId,
        publisher: promptPublisher.trim(),
        agentId: agent.id,
      });
      downloadJson(
        envelope,
        `napier-prompt-${agent.id}-${envelope.contentSha256.slice(0, 12)}.json`,
      );
      setPromptPackageReceipt({
        action: "signed",
        status: "signed",
        reason: contextCopy.promptPackageSigned,
        envelopeSha256: envelope.contentSha256,
        manifestSha256: envelope.manifest.contentSha256,
        systemPromptSha256: envelope.manifest.systemPromptSha256,
        keyId: envelope.signature.keyId,
        agentRevision: envelope.manifest.agentRevision,
      });
      await onRefresh();
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setPromptPackageBusy(false);
    }
  };

  const inspectPromptPackageFile = async (
    file: File,
    action: "verify" | "qualify",
  ): Promise<void> => {
    if (promptPackageBusy) return;
    if (file.size > MAX_PROMPT_PACKAGE_FILE_BYTES) {
      onError(contextCopy.promptPackageTooLarge);
      return;
    }
    setPromptPackageBusy(true);
    onError(undefined);
    try {
      const envelope = (await readJsonFile(
        file,
      )) as SignedPromptPackageEnvelope;
      if (action === "verify") {
        const verification = await verifyPromptPackage({ envelope });
        setPromptPackageReceipt({
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
        });
        return;
      }
      const qualification = await qualifyPromptPackage({
        threadId,
        agentId: agent.id,
        envelope,
      });
      setPromptPackageReceipt({
        action: "qualified",
        status: qualification.status,
        reason: qualification.reason,
        ...(qualification.envelopeSha256
          ? { envelopeSha256: qualification.envelopeSha256 }
          : {}),
        ...(qualification.manifestSha256
          ? { manifestSha256: qualification.manifestSha256 }
          : {}),
        ...(qualification.systemPromptSha256
          ? { systemPromptSha256: qualification.systemPromptSha256 }
          : {}),
        ...(qualification.observedSystemPromptSha256
          ? {
              observedSystemPromptSha256:
                qualification.observedSystemPromptSha256,
            }
          : {}),
        ...(qualification.keyId ? { keyId: qualification.keyId } : {}),
        ...(qualification.observedAgentRevision
          ? { observedAgentRevision: qualification.observedAgentRevision }
          : {}),
      });
      await onRefresh();
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setPromptPackageBusy(false);
    }
  };

  return {
    promptPublisher,
    setPromptPublisher,
    promptTrustAnchorId,
    setPromptTrustAnchorId,
    promptPackageBusy,
    promptPackageReceipt,
    downloadPromptPackage,
    inspectPromptPackageFile,
    canSignPromptPackage:
      promptPublisher.trim().length > 0 && promptTrustAnchorId.length > 0,
  };
}
