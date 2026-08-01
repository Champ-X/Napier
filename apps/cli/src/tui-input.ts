import { StringDecoder } from "node:string_decoder";

import { MAX_INTERACTIVE_INPUT_BYTES } from "./interactive-command-model.js";
import { terminalSafeText } from "./terminal-safe-text.js";

const BRACKETED_PASTE_START = "\u001b[200~";
const BRACKETED_PASTE_END = "\u001b[201~";
const MAX_HISTORY_ENTRIES = 100;
const INPUT_COMMAND_CHARACTER =
  /[\u0001\u0003-\u0005\u0008\u000a\u000d\u001b\u007f]/u;

const KEY_SEQUENCES = new Map<string, TuiInputKey>([
  ["\u001b[A", "history_previous"],
  ["\u001b[B", "history_next"],
  ["\u001b[C", "right"],
  ["\u001b[D", "left"],
  ["\u001b[H", "home"],
  ["\u001b[F", "end"],
  ["\u001b[1~", "home"],
  ["\u001b[4~", "end"],
  ["\u001b[3~", "delete"],
  ["\u001b[5~", "page_up"],
  ["\u001b[6~", "page_down"],
  [BRACKETED_PASTE_START, "paste_start"],
]);
const KEY_SEQUENCE_VALUES = [...KEY_SEQUENCES.keys()];

type TuiInputKey =
  | "history_previous"
  | "history_next"
  | "right"
  | "left"
  | "home"
  | "end"
  | "delete"
  | "page_up"
  | "page_down"
  | "paste_start";

export type TuiInputAction =
  | { kind: "changed" }
  | { kind: "submit"; value: string }
  | { kind: "interrupt" }
  | { kind: "exit" }
  | { kind: "scroll"; direction: "up" | "down" }
  | { kind: "overflow" };

export interface TuiInputSnapshot {
  text: string;
  cursor: number;
  byteLength: number;
  pasting: boolean;
}

export class TuiInputController {
  private readonly decoder = new StringDecoder("utf8");
  private readonly history: string[] = [];
  private pending = "";
  private value: string[] = [];
  private valueByteLength = 0;
  private cursor = 0;
  private historyIndex: number | undefined;
  private draftBeforeHistory = "";
  private pasting = false;

  feed(chunk: Buffer | string): TuiInputAction[] {
    this.pending +=
      typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    const actions: TuiInputAction[] = [];
    let changed = false;
    let overflow = false;
    while (this.pending) {
      if (this.pasting) {
        const end = this.pending.indexOf(BRACKETED_PASTE_END);
        if (end >= 0) {
          const inserted = this.pending.slice(0, end);
          ({ changed, overflow } = mergeInsertResult(
            this.insert(inserted),
            changed,
            overflow,
          ));
          this.pending = this.pending.slice(end + BRACKETED_PASTE_END.length);
          this.pasting = false;
          continue;
        }
        const retained = partialSuffixLength(this.pending, BRACKETED_PASTE_END);
        const inserted = this.pending.slice(
          0,
          retained > 0 ? -retained : undefined,
        );
        ({ changed, overflow } = mergeInsertResult(
          this.insert(inserted),
          changed,
          overflow,
        ));
        this.pending = retained > 0 ? this.pending.slice(-retained) : "";
        break;
      }

      if (this.pending.startsWith("\u001b")) {
        const matched = KEY_SEQUENCE_VALUES.find((sequence) =>
          this.pending.startsWith(sequence),
        );
        if (matched) {
          this.pending = this.pending.slice(matched.length);
          const key = KEY_SEQUENCES.get(matched)!;
          if (key === "paste_start") {
            this.pasting = true;
          } else if (key === "page_up" || key === "page_down") {
            actions.push({
              kind: "scroll",
              direction: key === "page_up" ? "up" : "down",
            });
          } else {
            changed = this.applyKey(key) || changed;
          }
          continue;
        }
        if (
          KEY_SEQUENCE_VALUES.some((sequence) =>
            sequence.startsWith(this.pending),
          )
        ) {
          break;
        }
        this.pending = this.pending.slice(1);
        continue;
      }

      const commandIndex = this.pending.search(INPUT_COMMAND_CHARACTER);
      if (commandIndex !== 0) {
        const end = commandIndex < 0 ? this.pending.length : commandIndex;
        ({ changed, overflow } = mergeInsertResult(
          this.insert(this.pending.slice(0, end)),
          changed,
          overflow,
        ));
        this.pending = this.pending.slice(end);
        continue;
      }

      const character = this.pending[0]!;
      this.pending = this.pending.slice(character.length);
      if (character === "\u0003") {
        actions.push({ kind: "interrupt" });
        continue;
      }
      if (character === "\u0004") {
        if (this.value.length === 0) actions.push({ kind: "exit" });
        continue;
      }
      if (character === "\r" || character === "\n") {
        const submitted = this.submit();
        if (submitted !== undefined) {
          actions.push({ kind: "submit", value: submitted });
          changed = true;
        }
        continue;
      }
      if (character === "\u007f" || character === "\u0008") {
        changed = this.backspace() || changed;
        continue;
      }
      if (character === "\u0001") {
        changed = this.applyKey("home") || changed;
        continue;
      }
      if (character === "\u0005") {
        changed = this.applyKey("end") || changed;
        continue;
      }
      ({ changed, overflow } = mergeInsertResult(
        this.insert(character),
        changed,
        overflow,
      ));
    }
    if (overflow) actions.push({ kind: "overflow" });
    if (changed) actions.push({ kind: "changed" });
    return actions;
  }

  snapshot(): TuiInputSnapshot {
    const text = this.value.join("");
    return {
      text,
      cursor: this.cursor,
      byteLength: this.valueByteLength,
      pasting: this.pasting,
    };
  }

  clear(): void {
    this.value = [];
    this.valueByteLength = 0;
    this.cursor = 0;
    this.historyIndex = undefined;
    this.draftBeforeHistory = "";
  }

  private insert(input: string): { changed: boolean; overflow: boolean } {
    if (!input) return { changed: false, overflow: false };
    const safe = terminalSafeText(input);
    const insertedByteLength = Buffer.byteLength(safe, "utf8");
    if (
      this.valueByteLength + insertedByteLength >
      MAX_INTERACTIVE_INPUT_BYTES
    ) {
      return { changed: false, overflow: true };
    }
    const inserted = [...safe];
    this.value.splice(this.cursor, 0, ...inserted);
    this.valueByteLength += insertedByteLength;
    this.cursor += inserted.length;
    this.historyIndex = undefined;
    return { changed: inserted.length > 0, overflow: false };
  }

  private submit(): string | undefined {
    const submitted = this.value.join("");
    this.clear();
    if (!submitted.trim()) return undefined;
    if (this.history.at(-1) !== submitted) {
      this.history.push(submitted);
      if (this.history.length > MAX_HISTORY_ENTRIES) this.history.shift();
    }
    return submitted;
  }

  private backspace(): boolean {
    if (this.cursor === 0) return false;
    this.valueByteLength -= Buffer.byteLength(
      this.value[this.cursor - 1]!,
      "utf8",
    );
    this.value.splice(this.cursor - 1, 1);
    this.cursor -= 1;
    this.historyIndex = undefined;
    return true;
  }

  private applyKey(
    key: Exclude<TuiInputKey, "paste_start" | "page_up" | "page_down">,
  ): boolean {
    if (key === "left") {
      if (this.cursor === 0) return false;
      this.cursor -= 1;
      return true;
    }
    if (key === "right") {
      if (this.cursor === this.value.length) return false;
      this.cursor += 1;
      return true;
    }
    if (key === "home") {
      if (this.cursor === 0) return false;
      this.cursor = 0;
      return true;
    }
    if (key === "end") {
      if (this.cursor === this.value.length) return false;
      this.cursor = this.value.length;
      return true;
    }
    if (key === "delete") {
      if (this.cursor >= this.value.length) return false;
      this.valueByteLength -= Buffer.byteLength(
        this.value[this.cursor]!,
        "utf8",
      );
      this.value.splice(this.cursor, 1);
      this.historyIndex = undefined;
      return true;
    }
    return this.navigateHistory(key === "history_previous" ? -1 : 1);
  }

  private navigateHistory(direction: -1 | 1): boolean {
    if (this.history.length === 0) return false;
    if (direction === -1) {
      if (this.historyIndex === undefined) {
        this.draftBeforeHistory = this.value.join("");
        this.historyIndex = this.history.length - 1;
      } else if (this.historyIndex > 0) {
        this.historyIndex -= 1;
      } else {
        return false;
      }
    } else {
      if (this.historyIndex === undefined) return false;
      if (this.historyIndex < this.history.length - 1) {
        this.historyIndex += 1;
      } else {
        this.historyIndex = undefined;
        this.replace(this.draftBeforeHistory);
        return true;
      }
    }
    this.replace(this.history[this.historyIndex]!);
    return true;
  }

  private replace(value: string): void {
    this.value = [...value];
    this.valueByteLength = Buffer.byteLength(value, "utf8");
    this.cursor = this.value.length;
  }
}

function mergeInsertResult(
  input: { changed: boolean; overflow: boolean },
  changed: boolean,
  overflow: boolean,
): { changed: boolean; overflow: boolean } {
  return {
    changed: changed || input.changed,
    overflow: overflow || input.overflow,
  };
}

function partialSuffixLength(value: string, target: string): number {
  const maximum = Math.min(value.length, target.length - 1);
  for (let length = maximum; length > 0; length -= 1) {
    if (target.startsWith(value.slice(-length))) return length;
  }
  return 0;
}
