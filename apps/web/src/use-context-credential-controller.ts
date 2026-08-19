import { useEffect, useState } from "react";

import type { CredentialReferenceSource } from "@napier/contracts";

import {
  checkCredentialReference,
  createCredentialReference,
  createMacOsKeychainCredential,
  setCredentialReferenceStatus,
} from "./context-api";
import { toErrorMessage } from "./context-panel-helpers";
import {
  applyCredentialProviderDraft,
  credentialReferenceDraft,
} from "./credential-reference-view-model";
import type { CredentialDraft } from "./credential-register-types";

export interface ContextCredentialControllerInput {
  providers: string[];
  threadId: string;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onError: (message: string | undefined) => void;
  onRefresh: () => Promise<void>;
}

export function useContextCredentialController({
  providers,
  threadId,
  busy,
  onBusy,
  onError,
  onRefresh,
}: ContextCredentialControllerInput) {
  const initialDraft = credentialReferenceDraft(providers[0] ?? "openai");
  const [credentialProvider, setCredentialProvider] = useState(
    initialDraft.providerId,
  );
  const [credentialLabel, setCredentialLabel] = useState(initialDraft.label);
  const [credentialSourceType, setCredentialSourceType] =
    useState<CredentialReferenceSource["type"]>("environment");
  const [credentialEnvVariable, setCredentialEnvVariable] = useState(
    initialDraft.environmentVariable,
  );
  const [credentialKeychainService, setCredentialKeychainService] = useState(
    initialDraft.keychainService,
  );
  const [credentialKeychainAccount, setCredentialKeychainAccount] = useState(
    initialDraft.keychainAccount,
  );
  const [credentialKeychainSecret, setCredentialKeychainSecret] = useState("");
  const [credentialKeychainReplace, setCredentialKeychainReplace] =
    useState(false);
  const [credentialBusyId, setCredentialBusyId] = useState<string>();

  const selectCredentialProvider = (providerId: string): void => {
    const draft = applyCredentialProviderDraft({
      previousProviderId: credentialProvider,
      nextProviderId: providerId,
      label: credentialLabel,
      environmentVariable: credentialEnvVariable,
      keychainService: credentialKeychainService,
      keychainAccount: credentialKeychainAccount,
    });
    setCredentialProvider(draft.providerId);
    setCredentialLabel(draft.label);
    setCredentialEnvVariable(draft.environmentVariable);
    setCredentialKeychainService(draft.keychainService);
    setCredentialKeychainAccount(draft.keychainAccount);
  };

  useEffect(() => {
    if (providers.length > 0 && !providers.includes(credentialProvider)) {
      selectCredentialProvider(providers[0]!);
    }
  }, [credentialProvider, providers]);

  const addCredential = async (): Promise<void> => {
    if (busy) return;
    onBusy(true);
    onError(undefined);
    try {
      if (
        credentialSourceType === "macos_keychain" &&
        credentialKeychainSecret.trim().length > 0
      ) {
        await createMacOsKeychainCredential({
          providerId: credentialProvider,
          label: credentialLabel.trim(),
          service: credentialKeychainService.trim(),
          account: credentialKeychainAccount.trim(),
          secret: credentialKeychainSecret,
          replaceExisting: credentialKeychainReplace,
          threadId,
        });
      } else {
        await createCredentialReference({
          providerId: credentialProvider,
          label: credentialLabel.trim(),
          source:
            credentialSourceType === "environment"
              ? { type: "environment", variable: credentialEnvVariable.trim() }
              : {
                  type: "macos_keychain",
                  service: credentialKeychainService.trim(),
                  account: credentialKeychainAccount.trim(),
                },
          threadId,
        });
      }
      const draft = credentialReferenceDraft(credentialProvider);
      setCredentialLabel(draft.label);
      setCredentialEnvVariable(draft.environmentVariable);
      setCredentialKeychainService(draft.keychainService);
      setCredentialKeychainAccount(draft.keychainAccount);
      setCredentialKeychainSecret("");
      setCredentialKeychainReplace(false);
      await onRefresh();
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      onBusy(false);
    }
  };

  const checkCredential = async (referenceId: string): Promise<void> => {
    setCredentialBusyId(referenceId);
    onError(undefined);
    try {
      await checkCredentialReference(referenceId, threadId);
      await onRefresh();
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setCredentialBusyId(undefined);
    }
  };

  const toggleCredential = async (
    referenceId: string,
    enabled: boolean,
  ): Promise<void> => {
    setCredentialBusyId(referenceId);
    onError(undefined);
    try {
      await setCredentialReferenceStatus(referenceId, {
        status: enabled ? "active" : "disabled",
        threadId,
      });
      await onRefresh();
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setCredentialBusyId(undefined);
    }
  };

  const credentialDraft: CredentialDraft = {
    providerId: credentialProvider,
    sourceType: credentialSourceType,
    label: credentialLabel,
    environmentVariable: credentialEnvVariable,
    keychainService: credentialKeychainService,
    keychainAccount: credentialKeychainAccount,
    keychainSecret: credentialKeychainSecret,
    replaceExisting: credentialKeychainReplace,
  };
  const updateCredentialDraft = (patch: Partial<CredentialDraft>): void => {
    if (patch.sourceType !== undefined)
      setCredentialSourceType(patch.sourceType);
    if (patch.label !== undefined) setCredentialLabel(patch.label);
    if (patch.environmentVariable !== undefined)
      setCredentialEnvVariable(patch.environmentVariable);
    if (patch.keychainService !== undefined)
      setCredentialKeychainService(patch.keychainService);
    if (patch.keychainAccount !== undefined)
      setCredentialKeychainAccount(patch.keychainAccount);
    if (patch.keychainSecret !== undefined)
      setCredentialKeychainSecret(patch.keychainSecret);
    if (patch.replaceExisting !== undefined)
      setCredentialKeychainReplace(patch.replaceExisting);
  };
  const canAddCredential =
    credentialLabel.trim().length > 0 &&
    (credentialSourceType === "environment"
      ? credentialEnvVariable.trim().length > 1
      : credentialKeychainService.trim().length > 0 &&
        credentialKeychainAccount.trim().length > 0 &&
        (credentialKeychainSecret.trim().length === 0 ||
          credentialKeychainSecret.trim().length >= 8));

  return {
    credentialBusyId,
    credentialDraft,
    canAddCredential,
    selectCredentialProvider,
    updateCredentialDraft,
    addCredential,
    checkCredential,
    toggleCredential,
  };
}
