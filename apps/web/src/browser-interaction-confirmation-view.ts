import type { RunEvent } from "@napier/contracts";
import {
  type BrowserInteractionConfirmation,
  parseBrowserInteractionConfirmation,
} from "@napier/contracts/browser-interaction-confirmation";

export { parseBrowserInteractionConfirmation };

export function openBrowserInteractionConfirmation(
  events: readonly RunEvent[],
): BrowserInteractionConfirmation | undefined {
  const settled = new Set<string>();
  for (const event of events.slice().reverse()) {
    if (!event.type.startsWith("browser.interaction_confirmation.")) continue;
    const confirmation = parseBrowserInteractionConfirmation(event.payload);
    if (
      !confirmation ||
      confirmation.threadId !== event.threadId ||
      confirmation.runId !== event.runId ||
      event.type !== `browser.interaction_confirmation.${confirmation.status}`
    ) {
      continue;
    }
    if (confirmation.status !== "pending") {
      settled.add(confirmation.id);
      continue;
    }
    if (!settled.has(confirmation.id)) return confirmation;
  }
  return undefined;
}
