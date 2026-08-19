import { useMemo, useState } from "react";

import type {
  CreatedInboundChannel,
  InboundChannelAdapter,
  InboundChannelPolicyTemplateId,
} from "@napier/contracts";

import {
  copyAutomationChannelToken,
  createAutomationChannel,
} from "./automation-channel-composer-actions";
import { CHANNEL_POLICY_TEMPLATES } from "./automation-panel-helpers";
import type { AutomationOperationController } from "./use-automation-operation";

export interface AutomationChannelComposerController {
  channelName: string;
  setChannelName: (value: string) => void;
  channelAdapter: InboundChannelAdapter;
  setChannelAdapter: (value: InboundChannelAdapter) => void;
  policyTemplate: InboundChannelPolicyTemplateId;
  selectPolicyTemplate: (value: InboundChannelPolicyTemplateId) => void;
  maxAttempts: number;
  setMaxAttempts: (value: number) => void;
  retrySeconds: number;
  setRetrySeconds: (value: number) => void;
  signatureRequired: boolean;
  setSignatureRequired: (value: boolean) => void;
  createdChannel: CreatedInboundChannel | undefined;
  endpoint: string;
  tokenCopied: boolean;
  canCreate: boolean;
  add: () => Promise<void>;
  copyToken: () => Promise<void>;
  dismissToken: () => void;
  showCreatedChannel: (value: CreatedInboundChannel) => void;
}

export interface UseAutomationChannelComposerOptions {
  threadId: string;
  operation: AutomationOperationController;
  refresh: () => Promise<void>;
}

function useChannelComposerState() {
  const [channelName, setChannelName] = useState("");
  const [channelAdapter, setChannelAdapter] =
    useState<InboundChannelAdapter>("napier_json");
  const [policyTemplate, setPolicyTemplate] =
    useState<InboundChannelPolicyTemplateId>("signed_standard");
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [retrySeconds, setRetrySeconds] = useState(5);
  const [signatureRequired, setSignatureRequired] = useState(true);
  const [createdChannel, setCreatedChannel] = useState<CreatedInboundChannel>();
  const [tokenCopied, setTokenCopied] = useState(false);
  const endpoint = useMemo(
    () =>
      createdChannel
        ? `${window.location.origin}/api/channels/${createdChannel.channel.id}/inbound`
        : "",
    [createdChannel],
  );
  return {
    channelName,
    setChannelName,
    channelAdapter,
    setChannelAdapter,
    policyTemplate,
    setPolicyTemplate,
    maxAttempts,
    setMaxAttempts,
    retrySeconds,
    setRetrySeconds,
    signatureRequired,
    setSignatureRequired,
    createdChannel,
    setCreatedChannel,
    tokenCopied,
    setTokenCopied,
    endpoint,
  };
}

export function useAutomationChannelComposerController({
  threadId,
  operation,
  refresh,
}: UseAutomationChannelComposerOptions): AutomationChannelComposerController {
  const state = useChannelComposerState();
  const canCreate = validChannelDraft(state);
  const selectPolicyTemplate = (
    value: InboundChannelPolicyTemplateId,
  ): void => {
    state.setPolicyTemplate(value);
    if (value === "custom") return;
    const template = CHANNEL_POLICY_TEMPLATES[value];
    state.setMaxAttempts(template.maxAttempts);
    state.setRetrySeconds(template.retrySeconds);
    state.setSignatureRequired(template.signatureRequired);
  };
  const add = async (): Promise<void> => {
    if (!canCreate || operation.busyId) return;
    state.setTokenCopied(false);
    const created = await createAutomationChannel({
      threadId,
      name: state.channelName,
      adapter: state.channelAdapter,
      policyTemplate: state.policyTemplate,
      maxAttempts: state.maxAttempts,
      retrySeconds: state.retrySeconds,
      signatureRequired: state.signatureRequired,
      operation,
      refresh,
    });
    if (created) {
      state.setCreatedChannel(created);
      state.setChannelName("");
    }
  };
  const showCreatedChannel = (value: CreatedInboundChannel): void => {
    state.setTokenCopied(false);
    state.setCreatedChannel(value);
  };
  return {
    ...state,
    selectPolicyTemplate,
    canCreate,
    add,
    copyToken: async () =>
      state.setTokenCopied(
        await copyAutomationChannelToken(state.createdChannel),
      ),
    dismissToken: () => state.setCreatedChannel(undefined),
    showCreatedChannel,
  };
}

function validChannelDraft(state: ReturnType<typeof useChannelComposerState>) {
  return (
    state.channelName.trim().length > 0 &&
    Number.isInteger(state.maxAttempts) &&
    state.maxAttempts >= 1 &&
    state.maxAttempts <= 10 &&
    Number.isFinite(state.retrySeconds) &&
    state.retrySeconds >= 0.25 &&
    state.retrySeconds <= 60
  );
}
