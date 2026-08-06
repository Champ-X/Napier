import type { RunEvent } from "@napier/contracts";
import {
  type BrowserInteractionConfirmation,
  parseBrowserInteractionConfirmation,
} from "@napier/contracts/browser-interaction-confirmation";
import type { BrowserInteractionConfirmationManager } from "@napier/runtime/browser-interaction-confirmations";

export type TerminalBrowserInteractionDecision = "approve" | "reject";
export type TerminalBrowserInteractionSubmission =
  | "not_pending"
  | "invalid"
  | "settling"
  | "submitted"
  | "failed";

export class TerminalBrowserInteractionConfirmationController {
  private confirmation: BrowserInteractionConfirmation | undefined;
  private deciding = false;

  constructor(
    private readonly confirmations: BrowserInteractionConfirmationManager,
  ) {}

  hasPending(): boolean {
    return this.confirmation?.status === "pending";
  }

  applyEvent(event: RunEvent): BrowserInteractionConfirmation | undefined {
    const confirmation = browserInteractionConfirmationEvent(event);
    if (!confirmation) return undefined;
    if (confirmation.status === "pending") {
      this.confirmation = confirmation;
      return confirmation;
    }
    if (this.confirmation?.id === confirmation.id) {
      this.confirmation = undefined;
      this.deciding = false;
    }
    return confirmation;
  }

  async submit(input: string): Promise<TerminalBrowserInteractionSubmission> {
    const confirmation = this.confirmation;
    if (!confirmation || confirmation.status !== "pending") {
      return "not_pending";
    }
    const decision = parseTerminalBrowserInteractionDecision(input);
    if (!decision) return "invalid";
    if (this.deciding) return "settling";
    this.deciding = true;
    try {
      await this.confirmations.decide(
        {
          threadId: confirmation.threadId,
          runId: confirmation.runId,
        },
        confirmation.id,
        {
          decision,
          expectedRequestSha256: confirmation.requestSha256,
        },
      );
      return "submitted";
    } catch {
      this.deciding = false;
      return "failed";
    }
  }
}

export function parseTerminalBrowserInteractionDecision(
  input: string,
): TerminalBrowserInteractionDecision | undefined {
  const normalized = input.trim().toLowerCase();
  return normalized === "approve" || normalized === "reject"
    ? normalized
    : undefined;
}

export function browserInteractionConfirmationEvent(
  event: RunEvent,
): BrowserInteractionConfirmation | undefined {
  if (
    !event.type.startsWith("browser.interaction_confirmation.") ||
    event.type === "browser.interaction_confirmation."
  ) {
    return undefined;
  }
  const confirmation = parseBrowserInteractionConfirmation(event.payload);
  if (
    !confirmation ||
    confirmation.threadId !== event.threadId ||
    confirmation.runId !== event.runId ||
    event.type !== `browser.interaction_confirmation.${confirmation.status}`
  ) {
    return undefined;
  }
  return confirmation;
}

export function terminalBrowserInteractionConfirmationLines(
  confirmation: BrowserInteractionConfirmation,
): string[] {
  const preview = confirmation.preview;
  return [
    `[confirm] Browser ${confirmation.action} paused before execution`,
    `[confirm] request ${shortHash(confirmation.requestSha256)} · arguments ${shortHash(confirmation.argumentsSha256)}`,
    ...(preview.targetSha256
      ? [
          `[confirm] target ${preview.targetKind ?? "unknown"} ${shortHash(preview.targetSha256)}`,
        ]
      : []),
    ...(preview.textSha256
      ? [
          `[confirm] text ${String(preview.textBytes ?? 0)}B ${shortHash(preview.textSha256)}`,
        ]
      : []),
    ...(preview.valueSetSha256
      ? [
          `[confirm] values ${String(preview.valueCount ?? 0)} ${shortHash(preview.valueSetSha256)}`,
        ]
      : []),
    ...(preview.pathSha256
      ? [`[confirm] workspace path ${shortHash(preview.pathSha256)}`]
      : []),
    ...(preview.sourceImageSha256
      ? [`[confirm] source image ${shortHash(preview.sourceImageSha256)}`]
      : []),
    `[confirm] cross-origin ${preview.crossOriginAuthorized ? "authorized" : "no"} · expires ${confirmation.expiresAt}`,
    "[confirm] Type approve or reject; Ctrl-C cancels the Run.",
  ];
}

function shortHash(value: string): string {
  return value.slice(0, 12);
}
