import { Check, KeyRound } from "lucide-react";

import { automationCopy as copy } from "./automation-copy";
import type { AutomationChannelComposerController } from "./use-automation-channel-composer-controller";

export interface AutomationChannelTokenCardProps {
  controller: AutomationChannelComposerController;
}

export function AutomationChannelTokenCard({
  controller,
}: AutomationChannelTokenCardProps) {
  if (!controller.createdChannel) return null;
  return (
    <aside className="channel-token" aria-labelledby="channel-token-title">
      <header>
        <KeyRound size={14} aria-hidden="true" />
        <strong id="channel-token-title">{copy.tokenTitle}</strong>
      </header>
      <p>{copy.tokenBody}</p>
      <label>
        <span>{copy.endpoint}</span>
        <code>{controller.endpoint}</code>
      </label>
      <label>
        <span>{copy.bearerToken}</span>
        <output>{controller.createdChannel.token}</output>
      </label>
      <footer>
        <button type="button" onClick={() => void controller.copyToken()}>
          {controller.tokenCopied ? (
            <Check size={10} aria-hidden="true" />
          ) : (
            <KeyRound size={10} aria-hidden="true" />
          )}
          {controller.tokenCopied ? copy.copied : copy.copyToken}
        </button>
        <button type="button" onClick={controller.dismissToken}>
          {copy.dismiss}
        </button>
      </footer>
    </aside>
  );
}
