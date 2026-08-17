import type { ConsoleMessage, Page } from "playwright-core";

import {
  MAX_BROWSER_CONSOLE_ENTRIES,
  type BrowserConsoleObservation,
} from "./browser-session-model.js";
import { canonicalJson, sha256 } from "./ed25519.js";

interface ConsoleEntry {
  type: "error" | "warning";
  text: string;
}

export class BrowserConsoleRecorder {
  private readonly entries: ConsoleEntry[] = [];
  private truncated = false;

  attach(page: Page): void {
    page.on("console", (message) => this.recordConsole(message));
    page.on("pageerror", (error) => this.record("error", error.message));
  }

  observation(): BrowserConsoleObservation {
    const entries = this.entries.map((entry) => ({ ...entry }));
    const errors = entries.filter((entry) => entry.type === "error").length;
    const warnings = entries.length - errors;
    return {
      entryCount: entries.length,
      errorCount: errors,
      warningCount: warnings,
      entriesSha256: sha256(canonicalJson(entries)),
      truncated: this.truncated,
      output: formatConsole(entries, this.truncated),
    };
  }

  private recordConsole(message: ConsoleMessage): void {
    const type = message.type();
    if (type === "error" || type === "warning") {
      this.record(type, message.text());
    }
  }

  private record(type: ConsoleEntry["type"], textInput: string): void {
    const text = sanitize(textInput);
    if (!text) return;
    if (this.entries.length >= MAX_BROWSER_CONSOLE_ENTRIES) {
      this.truncated = true;
      return;
    }
    this.entries.push({ type, text });
  }
}

function sanitize(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 1_000);
}

function formatConsole(entries: ConsoleEntry[], truncated: boolean): string {
  if (entries.length === 0) {
    return "Browser CONSOLE checked. No warnings or errors were recorded.";
  }
  const errors = entries.filter((entry) => entry.type === "error").length;
  const warnings = entries.length - errors;
  return [
    `Browser CONSOLE checked. Errors: ${String(errors)}. Warnings: ${String(warnings)}.`,
    `Privacy-bounded console entry set SHA-256: ${sha256(canonicalJson(entries))}.`,
    ...(truncated ? ["Console output was truncated."] : []),
  ].join("\n");
}
