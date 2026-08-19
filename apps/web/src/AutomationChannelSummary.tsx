import {
  Check,
  Download,
  Inbox,
  KeyRound,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

import type {
  InboundChannel,
  InboundChannelAdapterDescriptor,
} from "@napier/contracts";

import { automationCopy as copy } from "./automation-copy";
import { formatAutomationDuration } from "./automation-panel-helpers";
import type { AutomationChannelCardEditorController } from "./use-automation-channel-card-editor";

export interface AutomationChannelSummaryProps {
  channel: InboundChannel;
  adapter: InboundChannelAdapterDescriptor | undefined;
  busyId: string | undefined;
  rotatePending: boolean;
  editor: AutomationChannelCardEditorController;
  onToggle: () => void;
  onRequestRotate: () => void;
  onCancelRotate: () => void;
  onRotate: () => void;
  onLoad: () => void;
  onExportDeadLetters: () => void;
  onVerifyDeadLetters: (file: File) => void;
}

export function AutomationChannelSummary({
  channel,
  adapter,
  busyId,
  rotatePending,
  editor,
  onToggle,
  onRequestRotate,
  onCancelRotate,
  onRotate,
  onLoad,
  onExportDeadLetters,
  onVerifyDeadLetters,
}: AutomationChannelSummaryProps) {
  return (
    <>
      <header>
        <div>
          <span>{copy.webhook}</span>
          <strong>{channel.name}</strong>
        </div>
        <span className={`automation-state state-${channel.status}`}>
          {channel.status === "active" ? copy.active : copy.paused}
        </span>
      </header>
      <code>/api/channels/{channel.id}/inbound</code>
      <p>
        {copy.fingerprint}: {channel.tokenFingerprint}
      </p>
      <ChannelPolicySummary channel={channel} adapter={adapter} />
      <ChannelActionFooter
        channel={channel}
        busyId={busyId}
        editor={editor}
        onToggle={onToggle}
        onRequestRotate={onRequestRotate}
        onLoad={onLoad}
        onExportDeadLetters={onExportDeadLetters}
        onVerifyDeadLetters={onVerifyDeadLetters}
      />
      {rotatePending ? (
        <ChannelRotateConfirmation
          channelId={channel.id}
          rotating={busyId === `rotate:${channel.id}`}
          onCancel={onCancelRotate}
          onRotate={onRotate}
        />
      ) : null}
    </>
  );
}

function ChannelPolicySummary({
  channel,
  adapter,
}: Pick<AutomationChannelSummaryProps, "channel" | "adapter">) {
  return (
    <>
      <p className="channel-policy-summary">
        {copy.channelAdapter}: {adapter?.label ?? channel.adapter}
      </p>
      {adapter ? (
        <>
          <p className="channel-policy-summary">{adapter.description}</p>
          <p className="channel-policy-summary">
            {copy.idempotencySource}: {adapter.idempotencySource}
          </p>
        </>
      ) : null}
      <p className="channel-policy-summary">
        {copy.policyTemplate}:{" "}
        {copy.policyTemplateLabels[channel.policyTemplate]}
      </p>
      <p className="channel-policy-summary">
        {copy.retryPolicy}: {channel.retryPolicy.maxAttempts}{" "}
        {copy.policyAttempts} ·{" "}
        {formatAutomationDuration(channel.retryPolicy.baseDelayMs)}{" "}
        {copy.policyBase}
      </p>
      <p className="channel-policy-summary">
        {copy.signaturePolicy}:{" "}
        {channel.signaturePolicy.required
          ? `${copy.signatureRequired} · ${channel.signaturePolicy.toleranceSeconds}s`
          : copy.signatureOptional}
      </p>
    </>
  );
}

interface ChannelActionFooterProps extends Pick<
  AutomationChannelSummaryProps,
  | "channel"
  | "busyId"
  | "editor"
  | "onToggle"
  | "onRequestRotate"
  | "onLoad"
  | "onExportDeadLetters"
  | "onVerifyDeadLetters"
> {}

function ChannelActionFooter({
  channel,
  busyId,
  editor,
  onToggle,
  onRequestRotate,
  onLoad,
  onExportDeadLetters,
  onVerifyDeadLetters,
}: ChannelActionFooterProps) {
  const operation = (name: string) => busyId === `${name}:${channel.id}`;
  return (
    <footer>
      <button
        type="button"
        disabled={busyId === channel.id}
        aria-busy={busyId === channel.id}
        onClick={onToggle}
      >
        {channel.status === "active" ? copy.disable : copy.enable}
      </button>
      <button
        type="button"
        disabled={operation("rotate")}
        onClick={onRequestRotate}
      >
        <KeyRound size={10} aria-hidden="true" /> {copy.rotateToken}
      </button>
      <button
        type="button"
        disabled={operation("policy")}
        onClick={editor.beginPolicy}
      >
        <SlidersHorizontal size={10} aria-hidden="true" /> {copy.editPolicy}
      </button>
      <button
        type="button"
        disabled={operation("signature-policy")}
        onClick={editor.beginSignature}
      >
        <ShieldCheck size={10} aria-hidden="true" /> {copy.editSignaturePolicy}
      </button>
      <button
        type="button"
        disabled={operation("preview")}
        onClick={editor.beginPreview}
      >
        <Check size={10} aria-hidden="true" /> {copy.previewAdapter}
      </button>
      <button
        type="button"
        disabled={operation("deliveries")}
        aria-busy={operation("deliveries")}
        onClick={onLoad}
      >
        <Inbox size={10} aria-hidden="true" /> {copy.loadDeliveries}
      </button>
      <DeadLetterFileAction
        busy={operation("verify-dead-letters")}
        onVerify={onVerifyDeadLetters}
      />
      <button
        type="button"
        disabled={operation("dead-letters")}
        aria-busy={operation("dead-letters")}
        onClick={onExportDeadLetters}
      >
        <Download size={10} aria-hidden="true" />
        {operation("dead-letters") ? copy.exporting : copy.exportDeadLetters}
      </button>
    </footer>
  );
}

function DeadLetterFileAction({
  busy,
  onVerify,
}: {
  busy: boolean;
  onVerify: (file: File) => void;
}) {
  return (
    <label
      className="channel-file-action"
      aria-disabled={busy}
      aria-busy={busy}
    >
      <ShieldCheck size={10} aria-hidden="true" />
      {busy ? copy.verifyingDeadLetterExport : copy.verifyDeadLetterExport}
      <input
        type="file"
        accept="application/json,.json"
        disabled={busy}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onVerify(file);
        }}
      />
    </label>
  );
}

interface ChannelRotateConfirmationProps {
  channelId: string;
  rotating: boolean;
  onCancel: () => void;
  onRotate: () => void;
}

function ChannelRotateConfirmation({
  channelId,
  rotating,
  onCancel,
  onRotate,
}: ChannelRotateConfirmationProps) {
  return (
    <div
      className="channel-rotate-confirm"
      role="group"
      aria-labelledby={`rotate-title-${channelId}`}
    >
      <strong id={`rotate-title-${channelId}`}>{copy.rotateTitle}</strong>
      <p>{copy.rotateBody}</p>
      <div>
        <button type="button" disabled={rotating} onClick={onCancel}>
          {copy.cancel}
        </button>
        <button
          className="danger"
          type="button"
          disabled={rotating}
          aria-busy={rotating}
          onClick={onRotate}
        >
          {rotating ? copy.rotating : copy.rotateNow}
        </button>
      </div>
    </div>
  );
}
