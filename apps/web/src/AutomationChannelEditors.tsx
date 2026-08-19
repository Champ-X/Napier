import type { InboundChannelAdapterDescriptor } from "@napier/contracts";

import { automationCopy as copy } from "./automation-copy";
import type { AutomationChannelCardEditorController } from "./use-automation-channel-card-editor";

export interface AutomationChannelEditorsProps {
  adapter: InboundChannelAdapterDescriptor | undefined;
  busyId: string | undefined;
  channelId: string;
  controller: AutomationChannelCardEditorController;
}

export function AutomationChannelEditors({
  adapter,
  busyId,
  channelId,
  controller,
}: AutomationChannelEditorsProps) {
  if (controller.mode === "preview") {
    return (
      <AdapterPreviewEditor
        adapter={adapter}
        busy={busyId === `preview:${channelId}`}
        controller={controller}
      />
    );
  }
  if (controller.mode === "policy") {
    return (
      <RetryPolicyEditor
        busy={busyId === `policy:${channelId}`}
        controller={controller}
      />
    );
  }
  if (controller.mode === "signature") {
    return (
      <SignaturePolicyEditor
        busy={busyId === `signature-policy:${channelId}`}
        controller={controller}
      />
    );
  }
  return null;
}

interface EditorProps {
  busy: boolean;
  controller: AutomationChannelCardEditorController;
}

function AdapterPreviewEditor({
  adapter,
  busy,
  controller,
}: EditorProps & { adapter: InboundChannelAdapterDescriptor | undefined }) {
  return (
    <form
      className="channel-policy-editor channel-adapter-preview"
      onSubmit={(event) => {
        event.preventDefault();
        void controller.savePreview();
      }}
    >
      <strong>{copy.previewTitle}</strong>
      <p>{copy.previewBody}</p>
      {adapter ? <p>{adapter.securityNote}</p> : null}
      <label className="automation-field">
        <span>{copy.previewHeaders}</span>
        <textarea
          spellCheck={false}
          value={controller.previewHeadersText}
          onChange={(event) =>
            controller.update("previewHeadersText", event.target.value)
          }
        />
      </label>
      <label className="automation-field">
        <span>{copy.previewPayload}</span>
        <textarea
          required
          spellCheck={false}
          value={controller.previewBody}
          onChange={(event) =>
            controller.update("previewBody", event.target.value)
          }
        />
      </label>
      <EditorActions
        busy={busy}
        valid={controller.previewBody.trim().length > 0}
        busyLabel={copy.previewing}
        submitLabel={copy.previewNow}
        onCancel={controller.close}
      />
    </form>
  );
}

function RetryPolicyEditor({ busy, controller }: EditorProps) {
  const valid =
    Number.isInteger(controller.policyMaxAttempts) &&
    controller.policyMaxAttempts >= 1 &&
    controller.policyMaxAttempts <= 10 &&
    Number.isFinite(controller.policyRetrySeconds) &&
    controller.policyRetrySeconds >= 0.25 &&
    controller.policyRetrySeconds <= 60;
  return (
    <form
      className="channel-policy-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void controller.savePolicy();
      }}
    >
      <strong>{copy.policyTitle}</strong>
      <p>{copy.policyBody}</p>
      <div className="automation-field-grid">
        <NumberField
          label={copy.maxAttempts}
          min={1}
          max={10}
          value={controller.policyMaxAttempts}
          onChange={(value) => controller.update("policyMaxAttempts", value)}
        />
        <NumberField
          label={copy.retryBaseSeconds}
          min={0.25}
          max={60}
          step={0.25}
          value={controller.policyRetrySeconds}
          onChange={(value) => controller.update("policyRetrySeconds", value)}
        />
      </div>
      <EditorActions
        busy={busy}
        valid={valid}
        busyLabel={copy.savingPolicy}
        submitLabel={copy.savePolicy}
        onCancel={controller.close}
      />
    </form>
  );
}

function SignaturePolicyEditor({ busy, controller }: EditorProps) {
  const valid =
    Number.isInteger(controller.signatureToleranceSeconds) &&
    controller.signatureToleranceSeconds >= 30 &&
    controller.signatureToleranceSeconds <= 900;
  return (
    <form
      className="channel-policy-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void controller.saveSignature();
      }}
    >
      <strong>{copy.signaturePolicyTitle}</strong>
      <p>{copy.signaturePolicyBody}</p>
      <label className="automation-check-field">
        <input
          type="checkbox"
          checked={controller.signatureRequired}
          onChange={(event) =>
            controller.update("signatureRequired", event.currentTarget.checked)
          }
        />
        <span>{copy.requireSignature}</span>
      </label>
      <NumberField
        label={copy.signatureToleranceSeconds}
        min={30}
        max={900}
        step={1}
        value={controller.signatureToleranceSeconds}
        onChange={(value) =>
          controller.update("signatureToleranceSeconds", value)
        }
      />
      <EditorActions
        busy={busy}
        valid={valid}
        busyLabel={copy.savingPolicy}
        submitLabel={copy.savePolicy}
        onCancel={controller.close}
      />
    </form>
  );
}

interface NumberFieldProps {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}

function NumberField({ label, onChange, ...props }: NumberFieldProps) {
  return (
    <label className="automation-field">
      <span>{label}</span>
      <input
        type="number"
        {...props}
        onChange={(event) => {
          if (Number.isFinite(event.target.valueAsNumber)) {
            onChange(event.target.valueAsNumber);
          }
        }}
      />
    </label>
  );
}

interface EditorActionsProps {
  busy: boolean;
  valid: boolean;
  busyLabel: string;
  submitLabel: string;
  onCancel: () => void;
}

function EditorActions({
  busy,
  valid,
  busyLabel,
  submitLabel,
  onCancel,
}: EditorActionsProps) {
  return (
    <div>
      <button type="button" disabled={busy} onClick={onCancel}>
        {copy.cancel}
      </button>
      <button type="submit" disabled={busy || !valid} aria-busy={busy}>
        {busy ? busyLabel : submitLabel}
      </button>
    </div>
  );
}
