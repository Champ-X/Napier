import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import type { RunEvent } from "@napier/contracts";
import type { BrowserInteractionConfirmationManager } from "@napier/runtime/browser-interaction-confirmations";

import { InteractiveLineQueue } from "./interactive-line-queue.js";
import { writeLine, writeText } from "./cli-output.js";
import {
  TerminalBrowserInteractionConfirmationController,
  terminalBrowserInteractionConfirmationLines,
} from "./terminal-browser-confirmation.js";

export class OneShotBrowserInteractionConfirmation {
  private readonly controller: TerminalBrowserInteractionConfirmationController;
  private readonly inputQueue = new InteractiveLineQueue();
  private readonly readline: ReturnType<typeof createInterface>;
  private decision: Promise<void> | undefined;
  private closed = false;

  constructor(
    input: Readable,
    private readonly stderr: Writable,
    confirmations: BrowserInteractionConfirmationManager,
    private readonly abort: () => void,
  ) {
    this.controller = new TerminalBrowserInteractionConfirmationController(
      confirmations,
    );
    const terminal = streamIsTty(stderr);
    this.readline = createInterface({
      input,
      ...(terminal ? { output: stderr } : {}),
      terminal,
      crlfDelay: Number.POSITIVE_INFINITY,
      historySize: 0,
    });
    this.readline.on("line", (line) => {
      if (this.controller.hasPending()) this.inputQueue.push(line);
    });
    this.readline.once("close", () => {
      this.closed = true;
      this.inputQueue.close();
      if (this.controller.hasPending()) this.abort();
    });
  }

  async handleEvent(event: RunEvent): Promise<void> {
    try {
      const confirmation = this.controller.applyEvent(event);
      if (!confirmation) return;
      if (confirmation.status !== "pending") {
        await writeLine(
          this.stderr,
          `[confirm] Browser ${confirmation.action} ${confirmation.status}`,
        );
        return;
      }
      for (const line of terminalBrowserInteractionConfirmationLines(
        confirmation,
      )) {
        await writeLine(this.stderr, line);
      }
      await this.prompt();
      this.decision ??= this.decide().finally(() => {
        this.decision = undefined;
      });
    } catch {
      this.abort();
    }
  }

  async close(): Promise<void> {
    if (!this.closed) this.readline.close();
    this.inputQueue.close();
    if (this.controller.hasPending()) this.abort();
    await this.decision?.catch(() => undefined);
  }

  private async decide(): Promise<void> {
    while (true) {
      const input = await this.inputQueue.next();
      if (input.done) {
        this.abort();
        return;
      }
      const result = await this.controller.submit(input.value);
      if (result === "submitted" || result === "not_pending") return;
      if (result === "invalid") {
        await writeLine(
          this.stderr,
          "[confirm] Type approve or reject; Ctrl-C cancels the Run.",
        );
        await this.prompt();
        continue;
      }
      if (result === "settling") {
        await writeLine(this.stderr, "[confirm] Decision is already settling.");
        return;
      }
      await writeLine(
        this.stderr,
        "[confirm] Decision failed closed; cancelling the Run.",
      );
      this.abort();
      return;
    }
  }

  private async prompt(): Promise<void> {
    if (streamIsTty(this.stderr)) {
      this.readline.setPrompt("confirm> ");
      this.readline.prompt();
      return;
    }
    await writeText(this.stderr, "confirm> ");
  }
}

export function oneShotBrowserConfirmationAvailable(
  input: Readable | undefined,
  jsonl: boolean,
): input is Readable {
  return !jsonl && input !== undefined && streamIsTty(input);
}

function streamIsTty(stream: Readable | Writable): boolean {
  return (stream as Readable & { isTTY?: boolean }).isTTY === true;
}
