import type {
  AutomationSchedule,
  CreateAutomationScheduleRequest,
  CreatedInboundChannel,
  CreateInboundChannelRequest,
  ApplyInboundDeadLetterRetryRequest,
  InboundChannel,
  InboundChannelAdapterPreview,
  InboundDeadLetterExport,
  InboundDeadLetterExportVerification,
  InboundDeadLetterRetryApplyResult,
  InboundDeadLetterRetryHistory,
  InboundDeadLetterRetryHistoryVerification,
  InboundDeadLetterRetryPreview,
  InboundDelivery,
  InboundDeliveryQualification,
  PreviewInboundDeadLetterRetryRequest,
  PreviewInboundChannelAdapterRequest,
  SetInboundChannelStatusRequest,
  UpdateAutomationScheduleRequest,
  UpdateInboundRetryPolicyRequest,
  UpdateInboundSignaturePolicyRequest,
  VerifyInboundDeadLetterExportRequest,
  VerifyInboundDeadLetterRetryHistoryRequest,
} from "@napier/contracts";
import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";

import { requestJson } from "./api-client";

export function getAutomationBootstrap(
  threadId: string,
): Promise<LiveReadyBootstrapResponse> {
  return requestJson(`/api/bootstrap?thread=${encodeURIComponent(threadId)}`);
}

export function createSchedule(
  request: CreateAutomationScheduleRequest,
): Promise<AutomationSchedule> {
  return requestJson("/api/schedules", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function updateSchedule(
  scheduleId: string,
  request: UpdateAutomationScheduleRequest,
): Promise<AutomationSchedule> {
  return requestJson(`/api/schedules/${encodeURIComponent(scheduleId)}`, {
    method: "PUT",
    body: JSON.stringify(request),
  });
}

export function createInboundChannel(
  request: CreateInboundChannelRequest,
): Promise<CreatedInboundChannel> {
  return requestJson("/api/channels", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function setInboundChannelStatus(
  channelId: string,
  request: SetInboundChannelStatusRequest,
): Promise<InboundChannel> {
  return requestJson(`/api/channels/${encodeURIComponent(channelId)}/status`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function rotateInboundChannelToken(
  channelId: string,
): Promise<CreatedInboundChannel> {
  return requestJson(`/api/channels/${encodeURIComponent(channelId)}/token`, {
    method: "POST",
  });
}

export function previewInboundChannelAdapter(
  channelId: string,
  request: PreviewInboundChannelAdapterRequest,
): Promise<InboundChannelAdapterPreview> {
  return requestJson(
    `/api/channels/${encodeURIComponent(channelId)}/adapter-preview`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}

export function updateInboundRetryPolicy(
  channelId: string,
  request: UpdateInboundRetryPolicyRequest,
): Promise<InboundChannel> {
  return requestJson(
    `/api/channels/${encodeURIComponent(channelId)}/retry-policy`,
    {
      method: "PUT",
      body: JSON.stringify(request),
    },
  );
}

export function updateInboundSignaturePolicy(
  channelId: string,
  request: UpdateInboundSignaturePolicyRequest,
): Promise<InboundChannel> {
  return requestJson(
    `/api/channels/${encodeURIComponent(channelId)}/signature-policy`,
    {
      method: "PUT",
      body: JSON.stringify(request),
    },
  );
}

export function getInboundDeliveries(
  channelId: string,
): Promise<InboundDelivery[]> {
  return requestJson(
    `/api/channels/${encodeURIComponent(channelId)}/deliveries`,
  );
}

export function getInboundDeliveryQualification(
  channelId: string,
  deliveryId: string,
): Promise<InboundDeliveryQualification> {
  return requestJson(
    `/api/channels/${encodeURIComponent(channelId)}/deliveries/${encodeURIComponent(deliveryId)}/qualification`,
  );
}

export function retryInboundDelivery(
  channelId: string,
  deliveryId: string,
): Promise<InboundDelivery> {
  return requestJson(
    `/api/channels/${encodeURIComponent(channelId)}/deliveries/${encodeURIComponent(deliveryId)}/retry`,
    { method: "POST" },
  );
}

export function exportInboundDeadLetters(
  channelId: string,
): Promise<InboundDeadLetterExport> {
  return requestJson(
    `/api/channels/${encodeURIComponent(channelId)}/dead-letters/export`,
    { method: "POST" },
  );
}

export function verifyInboundDeadLetterExport(
  channelId: string,
  request: VerifyInboundDeadLetterExportRequest,
): Promise<InboundDeadLetterExportVerification> {
  return requestJson(
    `/api/channels/${encodeURIComponent(channelId)}/dead-letters/verify`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}

export function previewInboundDeadLetterRetry(
  channelId: string,
  request: PreviewInboundDeadLetterRetryRequest,
): Promise<InboundDeadLetterRetryPreview> {
  return requestJson(
    `/api/channels/${encodeURIComponent(channelId)}/dead-letters/retry-preview`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}

export function applyInboundDeadLetterRetry(
  channelId: string,
  request: ApplyInboundDeadLetterRetryRequest,
): Promise<InboundDeadLetterRetryApplyResult> {
  return requestJson(
    `/api/channels/${encodeURIComponent(channelId)}/dead-letters/retry-apply`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}

export function getInboundDeadLetterRetryHistory(
  channelId: string,
): Promise<InboundDeadLetterRetryHistory> {
  return requestJson(
    `/api/channels/${encodeURIComponent(channelId)}/dead-letters/retry-history`,
  );
}

export function verifyInboundDeadLetterRetryHistory(
  channelId: string,
  request: VerifyInboundDeadLetterRetryHistoryRequest,
): Promise<InboundDeadLetterRetryHistoryVerification> {
  return requestJson(
    `/api/channels/${encodeURIComponent(channelId)}/dead-letters/retry-history/verify`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
}
