import type { RunEvent } from "@napier/contracts";

import { getLocale } from "./locale";

export interface ConversationProgressNote {
  id: string;
  runId: string;
  seq: number;
  text: string;
  fallback?: boolean;
  model?: string;
  createdAt: string;
}

const MAX_PROGRESS_TEXT = 4_000;

/** Project only the explicit user-visible progress contract. Debug model
 * receipts and reasoning never cross into the conversation surface. */
export function conversationProgressNotes(
  events: readonly RunEvent[],
): ConversationProgressNote[] {
  const ordered = [...events].sort((left, right) => left.seq - right.seq);
  const sourceResponses = new Map(
    ordered
      .filter((event) => event.type === "model.response")
      .map((event) => [event.id, event] as const),
  );
  const notes: ConversationProgressNote[] = [];
  const lastFallbackByRun = new Map<string, string>();
  for (const event of ordered) {
    if (event.type !== "run.progress.message") continue;
    if (!validProgressSource(event, sourceResponses)) continue;
    const note = explicitProgressNote(event);
    if (!note) continue;
    if (note.fallback && lastFallbackByRun.get(note.runId) === note.text) {
      continue;
    }
    if (note.fallback) lastFallbackByRun.set(note.runId, note.text);
    else lastFallbackByRun.delete(note.runId);
    notes.push(note);
  }
  return notes;
}

function explicitProgressNote(
  event: RunEvent,
): ConversationProgressNote | undefined {
  if (event.visibility !== "user" || !record(event.payload)) return undefined;
  const sourceEventId = event.payload["sourceEventId"];
  const toolNames = event.payload["toolNames"];
  const rawText = event.payload["text"];
  const model = event.payload["model"];
  if (
    typeof sourceEventId !== "string" ||
    !sourceEventId.trim() ||
    !Array.isArray(toolNames) ||
    toolNames.length === 0 ||
    !toolNames.every(
      (toolName) => typeof toolName === "string" && toolName.trim(),
    ) ||
    typeof model !== "string" ||
    !model.trim() ||
    (event.payload["contentRedacted"] === true && rawText !== undefined) ||
    (event.payload["contentRedacted"] !== undefined &&
      event.payload["contentRedacted"] !== true) ||
    (rawText !== undefined && typeof rawText !== "string")
  ) {
    return undefined;
  }
  const explicitText = typeof rawText === "string" ? rawText.trim() : "";
  const fallback = !explicitText;
  const text = fallback
    ? fallbackProgressText(toolNames as string[])
    : explicitText.slice(0, MAX_PROGRESS_TEXT);
  return {
    id: event.id,
    runId: event.runId,
    seq: event.seq,
    text,
    fallback,
    model,
    createdAt: event.createdAt,
  };
}

function validProgressSource(
  progress: RunEvent,
  sourceResponses: ReadonlyMap<string, RunEvent>,
): boolean {
  if (!record(progress.payload)) return false;
  const sourceId = progress.payload["sourceEventId"];
  if (typeof sourceId !== "string") return false;
  const source = sourceResponses.get(sourceId);
  if (
    !source ||
    source.runId !== progress.runId ||
    source.seq >= progress.seq ||
    !record(source.payload) ||
    source.payload["model"] !== progress.payload["model"]
  ) {
    return false;
  }
  const calls = source.payload["toolCalls"];
  const names = progress.payload["toolNames"];
  if (!Array.isArray(calls) || !Array.isArray(names) || calls.length === 0) {
    return false;
  }
  const sourceNames = calls.flatMap((call) => {
    if (!record(call)) return [];
    const name = call["name"];
    return typeof name === "string" && name.trim() ? [name] : [];
  });
  return (
    sourceNames.length === calls.length &&
    sourceNames.length === names.length &&
    sourceNames.every((name, index) => name === names[index])
  );
}

function fallbackProgressText(toolNames: string[]): string {
  const names = toolNames.join(" ").toLocaleLowerCase();
  const zh = getLocale() === "zh";
  if (/research|search|fetch|source|web/u.test(names)) {
    return zh
      ? "正在检索并核对相关来源。"
      : "Searching and cross-checking relevant sources.";
  }
  if (/browser|page|screenshot/u.test(names)) {
    return zh
      ? "正在检查页面状态与交互结果。"
      : "Checking the page state and interaction results.";
  }
  if (/patch|write|edit|replace|create_file/u.test(names)) {
    return zh
      ? "正在修改内容并检查结果。"
      : "Applying changes and checking the result.";
  }
  if (/run|exec|command|test|verify|build|lint/u.test(names)) {
    return zh
      ? "正在运行检查并核对结果。"
      : "Running checks and verifying the result.";
  }
  if (/delegate|subagent|spawn/u.test(names)) {
    return zh
      ? "正在协调子任务并汇总结果。"
      : "Coordinating subtasks and consolidating results.";
  }
  if (/read|list|inspect|lookup|get_/u.test(names)) {
    return zh
      ? "正在读取并梳理相关信息。"
      : "Reading and organizing the relevant information.";
  }
  return zh ? "正在继续执行下一步。" : "Continuing with the next step.";
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
