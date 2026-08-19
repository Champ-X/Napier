import { ShieldCheck, Webhook } from "lucide-react";

import type {
  InboundChannel,
  InboundChannelAdapterDescriptor,
} from "@napier/contracts";

import { AutomationChannelCard } from "./AutomationChannelCard";
import { AutomationChannelComposer } from "./AutomationChannelComposer";
import { AutomationChannelTokenCard } from "./AutomationChannelTokenCard";
import { automationCopy as copy } from "./automation-copy";
import type { AutomationChannelComposerController } from "./use-automation-channel-composer-controller";
import type { AutomationChannelRuntimeController } from "./use-automation-channel-runtime-controller";
import type { AutomationDeadLetterArtifactController } from "./use-automation-dead-letter-artifacts";
import type { AutomationDeadLetterHistoryController } from "./use-automation-dead-letter-history";

export interface AutomationChannelSectionProps {
  channels: InboundChannel[];
  adapters: InboundChannelAdapterDescriptor[];
  busyId: string | undefined;
  composer: AutomationChannelComposerController;
  runtime: AutomationChannelRuntimeController;
  artifacts: AutomationDeadLetterArtifactController;
  history: AutomationDeadLetterHistoryController;
}

export function AutomationChannelSection({
  channels,
  adapters,
  busyId,
  composer,
  runtime,
  artifacts,
  history,
}: AutomationChannelSectionProps) {
  const adapterById = new Map(
    adapters.map((adapter) => [adapter.id, adapter] as const),
  );
  return (
    <section className="automation-register" aria-labelledby="channels-title">
      <header className="automation-section-heading">
        <span className="automation-glyph channel" aria-hidden="true">
          <Webhook size={14} />
        </span>
        <div>
          <span>{copy.channelEyebrow}</span>
          <h3 id="channels-title">{copy.channels}</h3>
        </div>
      </header>
      <AutomationChannelComposer
        adapters={adapters}
        busyId={busyId}
        controller={composer}
      />
      <AutomationChannelTokenCard controller={composer} />
      {channels.length === 0 ? (
        <p className="empty-panel">{copy.noChannels}</p>
      ) : (
        <div className="automation-card-list">
          {channels.map((channel) => (
            <ChannelCardBridge
              key={channel.id}
              channel={channel}
              adapter={adapterById.get(channel.adapter)}
              busyId={busyId}
              runtime={runtime}
              artifacts={artifacts}
              history={history}
            />
          ))}
        </div>
      )}
      <p className="automation-safety">
        <ShieldCheck size={12} aria-hidden="true" />
        {copy.channelSafety}
      </p>
    </section>
  );
}

interface ChannelCardBridgeProps {
  channel: InboundChannel;
  adapter: InboundChannelAdapterDescriptor | undefined;
  busyId: string | undefined;
  runtime: AutomationChannelRuntimeController;
  artifacts: AutomationDeadLetterArtifactController;
  history: AutomationDeadLetterHistoryController;
}

function ChannelCardBridge({
  channel,
  adapter,
  busyId,
  runtime,
  artifacts,
  history,
}: ChannelCardBridgeProps) {
  return (
    <AutomationChannelCard
      channel={channel}
      adapterDescriptor={adapter}
      deliveries={runtime.deliveries[channel.id]}
      busyId={busyId}
      rotatePending={runtime.rotateConfirmId === channel.id}
      retryConfirmId={runtime.retryConfirmId}
      onToggle={() => void runtime.toggle(channel)}
      onRequestRotate={() => runtime.setRotateConfirmId(channel.id)}
      onCancelRotate={() => runtime.setRotateConfirmId(undefined)}
      onRotate={() => void runtime.rotate(channel)}
      onLoad={() => void runtime.load(channel.id)}
      onPreview={(body, headers) => runtime.preview(channel.id, body, headers)}
      onRequestRetry={runtime.setRetryConfirmId}
      onCancelRetry={() => runtime.setRetryConfirmId(undefined)}
      onRetry={(deliveryId) => void runtime.retry(channel.id, deliveryId)}
      onQualifyDelivery={(deliveryId) =>
        void runtime.qualify(channel.id, deliveryId)
      }
      onUpdatePolicy={(policy) => runtime.saveRetryPolicy(channel.id, policy)}
      onUpdateSignaturePolicy={(policy) =>
        runtime.saveSignaturePolicy(channel.id, policy)
      }
      onExportDeadLetters={() => void artifacts.download(channel.id)}
      onVerifyDeadLetters={(file) =>
        void artifacts.verifyFile(channel.id, file)
      }
      onDownloadDeadLetterRetryHistory={() => void history.download(channel.id)}
      onVerifyDeadLetterRetryHistoryFile={(file) =>
        void history.verifyFile(channel.id, file)
      }
      onRequestDeadLetterRetry={() => artifacts.setConfirmId(channel.id)}
      onCancelDeadLetterRetry={() => artifacts.setConfirmId(undefined)}
      onApplyDeadLetterRetry={() => void artifacts.apply(channel.id)}
      adapterPreview={runtime.adapterPreviews[channel.id]}
      deadLetterExport={artifacts.exports[channel.id]}
      deadLetterVerification={artifacts.verifications[channel.id]}
      deadLetterRetryPreview={artifacts.previews[channel.id]}
      deadLetterRetryResult={artifacts.results[channel.id]}
      deadLetterRetryHistory={history.histories[channel.id]}
      deadLetterRetryHistoryVerification={history.verifications[channel.id]}
      deadLetterRetryConfirming={artifacts.confirmId === channel.id}
      onVerifyDeadLetterRetryHistory={() => void history.verify(channel.id)}
      deliveryQualifications={runtime.deliveryQualifications}
    />
  );
}
