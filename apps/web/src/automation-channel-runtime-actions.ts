import type {
  CreatedInboundChannel,
  InboundChannel,
  InboundChannelAdapterPreview,
  InboundDelivery,
  InboundDeliveryQualification,
  InboundRetryPolicy,
  PreviewInboundChannelAdapterRequest,
  UpdateInboundSignaturePolicyRequest,
} from "@napier/contracts";

import {
  getInboundDeliveries,
  getInboundDeliveryQualification,
  previewInboundChannelAdapter,
  retryInboundDelivery,
  rotateInboundChannelToken,
  setInboundChannelStatus,
  updateInboundRetryPolicy,
  updateInboundSignaturePolicy,
} from "./automation-api";
import { parsePreviewHeaders } from "./automation-panel-helpers";
import type { AutomationOperationController } from "./use-automation-operation";

interface RuntimeActionBase {
  operation: AutomationOperationController;
  refresh: () => Promise<void>;
}

interface LifecycleActionOptions extends RuntimeActionBase {
  onCreatedChannel: (value: CreatedInboundChannel) => void;
  onRotateSettled: () => void;
  onDeliveries: (channelId: string, value: InboundDelivery[]) => void;
}

export function createChannelLifecycleActions({
  operation,
  refresh,
  onCreatedChannel,
  onRotateSettled,
  onDeliveries,
}: LifecycleActionOptions) {
  const toggle = async (channel: InboundChannel): Promise<void> => {
    await operation.run(channel.id, async () => {
      await setInboundChannelStatus(channel.id, {
        status: channel.status === "active" ? "disabled" : "active",
      });
      await refresh();
    });
  };
  const rotate = async (channel: InboundChannel): Promise<void> => {
    const result = await operation.run(`rotate:${channel.id}`, async () => {
      const value = await rotateInboundChannelToken(channel.id);
      await refresh();
      return value;
    });
    if (result.ok && result.value) {
      onCreatedChannel(result.value);
      onRotateSettled();
    }
  };
  const load = async (channelId: string): Promise<void> => {
    const result = await operation.run(`deliveries:${channelId}`, () =>
      getInboundDeliveries(channelId),
    );
    if (result.ok && result.value) onDeliveries(channelId, result.value);
  };
  return { toggle, rotate, load };
}

interface DeliveryActionOptions {
  operation: AutomationOperationController;
  onDeliveries: (channelId: string, value: InboundDelivery[]) => void;
  onPreview: (channelId: string, value: InboundChannelAdapterPreview) => void;
  onQualification: (
    deliveryId: string,
    value: InboundDeliveryQualification,
  ) => void;
  onRetrySettled: () => void;
}

export function createChannelDeliveryActions({
  operation,
  onDeliveries,
  onPreview,
  onQualification,
  onRetrySettled,
}: DeliveryActionOptions) {
  const preview = async (
    channelId: string,
    body: string,
    headersText: string,
  ): Promise<boolean> => {
    const result = await operation.run(`preview:${channelId}`, () => {
      const request: PreviewInboundChannelAdapterRequest = {
        body,
        ...parsePreviewHeaders(headersText),
      };
      return previewInboundChannelAdapter(channelId, request);
    });
    if (result.ok && result.value) onPreview(channelId, result.value);
    return result.ok;
  };
  const retry = async (
    channelId: string,
    deliveryId: string,
  ): Promise<void> => {
    const result = await operation.run(`retry:${deliveryId}`, async () => {
      await retryInboundDelivery(channelId, deliveryId);
      return getInboundDeliveries(channelId);
    });
    if (result.ok && result.value) {
      onRetrySettled();
      onDeliveries(channelId, result.value);
    }
  };
  const qualify = async (
    channelId: string,
    deliveryId: string,
  ): Promise<void> => {
    const result = await operation.run(`qualify:${deliveryId}`, () =>
      getInboundDeliveryQualification(channelId, deliveryId),
    );
    if (result.ok && result.value) onQualification(deliveryId, result.value);
  };
  return { preview, retry, qualify };
}

export function createChannelPolicyActions({
  operation,
  refresh,
}: RuntimeActionBase) {
  const saveRetryPolicy = async (
    channelId: string,
    retryPolicy: InboundRetryPolicy,
  ): Promise<boolean> => {
    const result = await operation.run(`policy:${channelId}`, async () => {
      await updateInboundRetryPolicy(channelId, { retryPolicy });
      await refresh();
    });
    return result.ok;
  };
  const saveSignaturePolicy = async (
    channelId: string,
    signaturePolicy: UpdateInboundSignaturePolicyRequest["signaturePolicy"],
  ): Promise<boolean> => {
    const result = await operation.run(
      `signature-policy:${channelId}`,
      async () => {
        await updateInboundSignaturePolicy(channelId, { signaturePolicy });
        await refresh();
      },
    );
    return result.ok;
  };
  return { saveRetryPolicy, saveSignaturePolicy };
}
