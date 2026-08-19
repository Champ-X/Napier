import { useState } from "react";

import type {
  InboundChannel,
  InboundChannelAdapterDescriptor,
  InboundRetryPolicy,
  UpdateInboundSignaturePolicyRequest,
} from "@napier/contracts";

import {
  adapterSampleBody,
  adapterSampleHeadersText,
} from "./automation-panel-helpers";

interface AutomationChannelEditorState {
  mode: "preview" | "policy" | "signature" | undefined;
  previewBody: string;
  previewHeadersText: string;
  policyMaxAttempts: number;
  policyRetrySeconds: number;
  signatureRequired: boolean;
  signatureToleranceSeconds: number;
}

export interface AutomationChannelCardEditorController extends AutomationChannelEditorState {
  update: <K extends keyof AutomationChannelEditorState>(
    key: K,
    value: AutomationChannelEditorState[K],
  ) => void;
  beginPreview: () => void;
  beginPolicy: () => void;
  beginSignature: () => void;
  close: () => void;
  savePreview: () => Promise<void>;
  savePolicy: () => Promise<void>;
  saveSignature: () => Promise<void>;
}

export interface UseAutomationChannelCardEditorOptions {
  channel: InboundChannel;
  adapter: InboundChannelAdapterDescriptor | undefined;
  onPreview: (body: string, headersText: string) => Promise<boolean>;
  onUpdatePolicy: (policy: InboundRetryPolicy) => Promise<boolean>;
  onUpdateSignaturePolicy: (
    policy: UpdateInboundSignaturePolicyRequest["signaturePolicy"],
  ) => Promise<boolean>;
}

export function useAutomationChannelCardEditor({
  channel,
  adapter,
  onPreview,
  onUpdatePolicy,
  onUpdateSignaturePolicy,
}: UseAutomationChannelCardEditorOptions): AutomationChannelCardEditorController {
  const [state, setState] = useState(() =>
    initialEditorState(channel, adapter),
  );
  const update = <K extends keyof AutomationChannelEditorState>(
    key: K,
    value: AutomationChannelEditorState[K],
  ): void => setState((current) => ({ ...current, [key]: value }));
  const open = (mode: NonNullable<AutomationChannelEditorState["mode"]>) => {
    setState({ ...initialEditorState(channel, adapter), mode });
  };
  const close = (): void => update("mode", undefined);
  const savePreview = async (): Promise<void> => {
    if (await onPreview(state.previewBody, state.previewHeadersText)) close();
  };
  const savePolicy = async (): Promise<void> => {
    const policy = {
      maxAttempts: state.policyMaxAttempts,
      baseDelayMs: Math.round(state.policyRetrySeconds * 1_000),
    };
    if (await onUpdatePolicy(policy)) close();
  };
  const saveSignature = async (): Promise<void> => {
    const policy = {
      required: state.signatureRequired,
      toleranceSeconds: state.signatureToleranceSeconds,
    };
    if (await onUpdateSignaturePolicy(policy)) close();
  };
  return {
    ...state,
    update,
    beginPreview: () => open("preview"),
    beginPolicy: () => open("policy"),
    beginSignature: () => open("signature"),
    close,
    savePreview,
    savePolicy,
    saveSignature,
  };
}

function initialEditorState(
  channel: InboundChannel,
  adapter: InboundChannelAdapterDescriptor | undefined,
): AutomationChannelEditorState {
  return {
    mode: undefined,
    previewBody: adapterSampleBody(adapter),
    previewHeadersText: adapterSampleHeadersText(adapter),
    policyMaxAttempts: channel.retryPolicy.maxAttempts,
    policyRetrySeconds: channel.retryPolicy.baseDelayMs / 1_000,
    signatureRequired: channel.signaturePolicy.required,
    signatureToleranceSeconds: channel.signaturePolicy.toleranceSeconds,
  };
}
