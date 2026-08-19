import { AutomationAdapterPreviewReceipt } from "./AutomationAdapterPreviewReceipt";
import { AutomationChannelEditors } from "./AutomationChannelEditors";
import { AutomationChannelSummary } from "./AutomationChannelSummary";
import { AutomationDeadLetterExportEvidence } from "./AutomationDeadLetterExportEvidence";
import { AutomationDeadLetterHistoryEvidence } from "./AutomationDeadLetterHistoryEvidence";
import { AutomationDeadLetterRetryEvidence } from "./AutomationDeadLetterRetryEvidence";
import { AutomationDeliveryList } from "./AutomationDeliveryList";
import type { AutomationChannelCardProps as CardProps } from "./automation-channel-card-types";
import { useAutomationChannelCardEditor } from "./use-automation-channel-card-editor";

export type AutomationChannelCardProps = CardProps;

export function AutomationChannelCard(props: AutomationChannelCardProps) {
  const { channel, adapterDescriptor, busyId } = props;
  const editor = useAutomationChannelCardEditor({
    channel,
    adapter: adapterDescriptor,
    onPreview: props.onPreview,
    onUpdatePolicy: props.onUpdatePolicy,
    onUpdateSignaturePolicy: props.onUpdateSignaturePolicy,
  });
  return (
    <article className="channel-card">
      <AutomationChannelSummary
        channel={channel}
        adapter={adapterDescriptor}
        busyId={busyId}
        rotatePending={props.rotatePending}
        editor={editor}
        onToggle={props.onToggle}
        onRequestRotate={props.onRequestRotate}
        onCancelRotate={props.onCancelRotate}
        onRotate={props.onRotate}
        onLoad={props.onLoad}
        onExportDeadLetters={props.onExportDeadLetters}
        onVerifyDeadLetters={props.onVerifyDeadLetters}
      />
      <AutomationChannelEditors
        adapter={adapterDescriptor}
        busyId={busyId}
        channelId={channel.id}
        controller={editor}
      />
      <AutomationAdapterPreviewReceipt preview={props.adapterPreview} />
      <AutomationDeadLetterExportEvidence
        exported={props.deadLetterExport}
        verification={props.deadLetterVerification}
      />
      <AutomationDeadLetterRetryEvidence
        preview={props.deadLetterRetryPreview}
        result={props.deadLetterRetryResult}
        confirming={props.deadLetterRetryConfirming}
        applying={busyId === `apply-dead-letters:${channel.id}`}
        onRequest={props.onRequestDeadLetterRetry}
        onCancel={props.onCancelDeadLetterRetry}
        onApply={props.onApplyDeadLetterRetry}
      />
      <AutomationDeadLetterHistoryEvidence
        history={props.deadLetterRetryHistory}
        verification={props.deadLetterRetryHistoryVerification}
        downloading={busyId === `download-retry-history:${channel.id}`}
        verifying={busyId === `verify-retry-history:${channel.id}`}
        onDownload={props.onDownloadDeadLetterRetryHistory}
        onVerifyFile={props.onVerifyDeadLetterRetryHistoryFile}
        onVerify={props.onVerifyDeadLetterRetryHistory}
      />
      <AutomationDeliveryList
        deliveries={props.deliveries}
        qualifications={props.deliveryQualifications}
        busyId={busyId}
        retryConfirmId={props.retryConfirmId}
        onQualify={props.onQualifyDelivery}
        onRequestRetry={props.onRequestRetry}
        onCancelRetry={props.onCancelRetry}
        onRetry={props.onRetry}
      />
    </article>
  );
}
