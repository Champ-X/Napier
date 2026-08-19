import type {
  InboundChannel,
  InboundChannelAdapterDescriptor,
  InboundChannelAdapterPreview,
  InboundDeadLetterExportVerification,
  InboundDeadLetterRetryApplyResult,
  InboundDeadLetterRetryHistory,
  InboundDeadLetterRetryHistoryVerification,
  InboundDeadLetterRetryPreview,
  InboundDelivery,
  InboundDeliveryQualification,
  InboundRetryPolicy,
  UpdateInboundSignaturePolicyRequest,
} from "@napier/contracts";

import type { DeadLetterExportSummary } from "./use-automation-dead-letter-artifacts";

export interface AutomationChannelCardProps {
  channel: InboundChannel;
  adapterDescriptor: InboundChannelAdapterDescriptor | undefined;
  deliveries: InboundDelivery[] | undefined;
  busyId: string | undefined;
  rotatePending: boolean;
  retryConfirmId: string | undefined;
  onToggle: () => void;
  onRequestRotate: () => void;
  onCancelRotate: () => void;
  onRotate: () => void;
  onLoad: () => void;
  onPreview: (body: string, headersText: string) => Promise<boolean>;
  onRequestRetry: (deliveryId: string) => void;
  onCancelRetry: () => void;
  onRetry: (deliveryId: string) => void;
  onQualifyDelivery: (deliveryId: string) => void;
  onUpdatePolicy: (policy: InboundRetryPolicy) => Promise<boolean>;
  onUpdateSignaturePolicy: (
    policy: UpdateInboundSignaturePolicyRequest["signaturePolicy"],
  ) => Promise<boolean>;
  onExportDeadLetters: () => void;
  onVerifyDeadLetters: (file: File) => void;
  onDownloadDeadLetterRetryHistory: () => void;
  onVerifyDeadLetterRetryHistoryFile: (file: File) => void;
  onRequestDeadLetterRetry: () => void;
  onCancelDeadLetterRetry: () => void;
  onApplyDeadLetterRetry: () => void;
  adapterPreview: InboundChannelAdapterPreview | undefined;
  deadLetterExport: DeadLetterExportSummary | undefined;
  deadLetterVerification: InboundDeadLetterExportVerification | undefined;
  deadLetterRetryPreview: InboundDeadLetterRetryPreview | undefined;
  deadLetterRetryResult: InboundDeadLetterRetryApplyResult | undefined;
  deadLetterRetryHistory: InboundDeadLetterRetryHistory | undefined;
  deadLetterRetryHistoryVerification:
    | InboundDeadLetterRetryHistoryVerification
    | undefined;
  deadLetterRetryConfirming: boolean;
  onVerifyDeadLetterRetryHistory: () => void;
  deliveryQualifications: Record<string, InboundDeliveryQualification>;
}
