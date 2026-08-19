import { Plus } from "lucide-react";

import type {
  InboundChannelAdapter,
  InboundChannelAdapterDescriptor,
  InboundChannelPolicyTemplateId,
} from "@napier/contracts";

import { automationCopy as copy } from "./automation-copy";
import { CHANNEL_POLICY_TEMPLATE_IDS } from "./automation-panel-helpers";
import type { AutomationChannelComposerController } from "./use-automation-channel-composer-controller";

export interface AutomationChannelComposerProps {
  adapters: InboundChannelAdapterDescriptor[];
  busyId: string | undefined;
  controller: AutomationChannelComposerController;
}

export function AutomationChannelComposer({
  adapters,
  busyId,
  controller,
}: AutomationChannelComposerProps) {
  return (
    <form
      className="automation-compose channel-compose"
      onSubmit={(event) => {
        event.preventDefault();
        void controller.add();
      }}
    >
      <ChannelIdentityFields adapters={adapters} controller={controller} />
      <ChannelRetryFields controller={controller} />
      <label className="automation-check-field">
        <input
          type="checkbox"
          checked={controller.signatureRequired}
          onChange={(event) => {
            controller.selectPolicyTemplate("custom");
            controller.setSignatureRequired(event.target.checked);
          }}
        />
        <span>{copy.requireSignature}</span>
      </label>
      <button
        className="automation-primary"
        type="submit"
        disabled={!controller.canCreate || Boolean(busyId)}
        aria-busy={busyId === "new-channel"}
      >
        <Plus size={12} aria-hidden="true" />
        {copy.createChannel}
      </button>
    </form>
  );
}

function ChannelIdentityFields({
  adapters,
  controller,
}: Pick<AutomationChannelComposerProps, "adapters" | "controller">) {
  return (
    <>
      <label className="automation-field">
        <span>{copy.channelName}</span>
        <input
          required
          maxLength={100}
          value={controller.channelName}
          placeholder={copy.channelNamePlaceholder}
          onChange={(event) => controller.setChannelName(event.target.value)}
        />
      </label>
      <label className="automation-field">
        <span>{copy.channelAdapter}</span>
        <select
          value={controller.channelAdapter}
          onChange={(event) =>
            controller.setChannelAdapter(
              event.currentTarget.value as InboundChannelAdapter,
            )
          }
        >
          {adapters.map((adapter) => (
            <option key={adapter.id} value={adapter.id}>
              {adapter.label}
            </option>
          ))}
        </select>
      </label>
      <label className="automation-field">
        <span>{copy.policyTemplate}</span>
        <select
          value={controller.policyTemplate}
          onChange={(event) =>
            controller.selectPolicyTemplate(
              event.currentTarget.value as InboundChannelPolicyTemplateId,
            )
          }
        >
          {CHANNEL_POLICY_TEMPLATE_IDS.map((templateId) => (
            <option key={templateId} value={templateId}>
              {copy.policyTemplateLabels[templateId]}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function ChannelRetryFields({
  controller,
}: Pick<AutomationChannelComposerProps, "controller">) {
  const update = (value: number, setter: (next: number) => void): void => {
    if (!Number.isFinite(value)) return;
    controller.selectPolicyTemplate("custom");
    setter(value);
  };
  return (
    <div className="automation-field-grid">
      <label className="automation-field">
        <span>{copy.maxAttempts}</span>
        <input
          type="number"
          min={1}
          max={10}
          value={controller.maxAttempts}
          onChange={(event) =>
            update(event.target.valueAsNumber, controller.setMaxAttempts)
          }
        />
      </label>
      <label className="automation-field">
        <span>{copy.retryBaseSeconds}</span>
        <input
          type="number"
          min={0.25}
          max={60}
          step={0.25}
          value={controller.retrySeconds}
          onChange={(event) =>
            update(event.target.valueAsNumber, controller.setRetrySeconds)
          }
        />
      </label>
    </div>
  );
}
