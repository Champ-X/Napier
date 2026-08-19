import { useCallback, useState } from "react";

import type {
  CreatedInboundChannel,
  InboundChannel,
  InboundChannelAdapterPreview,
  InboundDelivery,
  InboundDeliveryQualification,
  InboundRetryPolicy,
  UpdateInboundSignaturePolicyRequest,
} from "@napier/contracts";

import {
  createChannelDeliveryActions,
  createChannelLifecycleActions,
  createChannelPolicyActions,
} from "./automation-channel-runtime-actions";
import { useActiveChannelDeliveryPolling } from "./use-active-channel-delivery-polling";
import type { AutomationOperationController } from "./use-automation-operation";

export interface AutomationChannelRuntimeController {
  deliveries: Record<string, InboundDelivery[]>;
  updateDeliveries: (channelId: string, value: InboundDelivery[]) => void;
  adapterPreviews: Record<string, InboundChannelAdapterPreview>;
  deliveryQualifications: Record<string, InboundDeliveryQualification>;
  rotateConfirmId: string | undefined;
  setRotateConfirmId: (value: string | undefined) => void;
  retryConfirmId: string | undefined;
  setRetryConfirmId: (value: string | undefined) => void;
  toggle: (channel: InboundChannel) => Promise<void>;
  rotate: (channel: InboundChannel) => Promise<void>;
  load: (channelId: string) => Promise<void>;
  preview: (
    channelId: string,
    body: string,
    headers: string,
  ) => Promise<boolean>;
  retry: (channelId: string, deliveryId: string) => Promise<void>;
  qualify: (channelId: string, deliveryId: string) => Promise<void>;
  saveRetryPolicy: (
    channelId: string,
    policy: InboundRetryPolicy,
  ) => Promise<boolean>;
  saveSignaturePolicy: (
    channelId: string,
    policy: UpdateInboundSignaturePolicyRequest["signaturePolicy"],
  ) => Promise<boolean>;
}

export interface UseAutomationChannelRuntimeOptions {
  operation: AutomationOperationController;
  refresh: () => Promise<void>;
  onCreatedChannel: (value: CreatedInboundChannel) => void;
}

export function useAutomationChannelRuntimeController({
  operation,
  refresh,
  onCreatedChannel,
}: UseAutomationChannelRuntimeOptions): AutomationChannelRuntimeController {
  const [deliveries, setDeliveries] = useState<
    Record<string, InboundDelivery[]>
  >({});
  const [adapterPreviews, setAdapterPreviews] = useState<
    Record<string, InboundChannelAdapterPreview>
  >({});
  const [deliveryQualifications, setDeliveryQualifications] = useState<
    Record<string, InboundDeliveryQualification>
  >({});
  const [rotateConfirmId, setRotateConfirmId] = useState<string>();
  const [retryConfirmId, setRetryConfirmId] = useState<string>();
  const updateDeliveries = useCallback(
    (channelId: string, value: InboundDelivery[]) => {
      setDeliveries((current) => ({ ...current, [channelId]: value }));
    },
    [],
  );
  useActiveChannelDeliveryPolling(deliveries, updateDeliveries);
  const lifecycle = createChannelLifecycleActions({
    operation,
    refresh,
    onCreatedChannel,
    onRotateSettled: () => setRotateConfirmId(undefined),
    onDeliveries: updateDeliveries,
  });
  const delivery = createChannelDeliveryActions({
    operation,
    onDeliveries: updateDeliveries,
    onPreview: (channelId, value) =>
      setAdapterPreviews((current) => ({ ...current, [channelId]: value })),
    onQualification: (deliveryId, value) =>
      setDeliveryQualifications((current) => ({
        ...current,
        [deliveryId]: value,
      })),
    onRetrySettled: () => setRetryConfirmId(undefined),
  });
  return {
    deliveries,
    updateDeliveries,
    adapterPreviews,
    deliveryQualifications,
    rotateConfirmId,
    setRotateConfirmId,
    retryConfirmId,
    setRetryConfirmId,
    ...lifecycle,
    ...delivery,
    ...createChannelPolicyActions({ operation, refresh }),
  };
}
