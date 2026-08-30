export interface ConversationToolDisplay {
  input?: string;
  output?: string;
  error?: string;
  inputRedacted?: boolean;
  outputRedacted?: boolean;
}

export interface LocalConversationToolDisplay extends ConversationToolDisplay {
  sourceRunId: string;
  callId: string;
  toolName: string;
}

const MAX_DISPLAY_CHARS = 2 * 1024 * 1024;

export function conversationToolDisplay(
  payload: Record<string, unknown>,
): ConversationToolDisplay | undefined {
  const current = payload["displaySchemaVersion"] === 1;
  const input = current ? displayText(payload["displayInput"]) : undefined;
  const output = current ? displayText(payload["displayOutput"]) : undefined;
  const error = current ? displayText(payload["displayError"]) : undefined;
  const display = {
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(error ? { error } : {}),
    ...(payload["inputRedacted"] === true && !input
      ? { inputRedacted: true }
      : {}),
    ...((payload["outputRedacted"] === true ||
      typeof payload["outputTextSha256"] === "string") &&
    !output &&
    !error
      ? { outputRedacted: true }
      : {}),
  };
  return Object.keys(display).length > 0 ? display : undefined;
}

export function mergeConversationToolDisplay(
  prior: ConversationToolDisplay | undefined,
  current: ConversationToolDisplay | undefined,
): ConversationToolDisplay | undefined {
  const input = current?.input ?? prior?.input;
  const output = current?.output ?? prior?.output;
  const error = current?.error ?? prior?.error;
  const display = {
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(error ? { error } : {}),
    ...(current?.inputRedacted || prior?.inputRedacted
      ? { inputRedacted: true }
      : {}),
    ...(current?.outputRedacted || prior?.outputRedacted
      ? { outputRedacted: true }
      : {}),
  };
  return Object.keys(display).length > 0 ? display : undefined;
}

export function projectLocalToolDisplays(
  events: import("@napier/contracts").RunEvent[],
  displays: readonly LocalConversationToolDisplay[],
): import("@napier/contracts").RunEvent[] {
  if (displays.length === 0) return events;
  const byCall = new Map(
    displays.map((display) => [
      `${display.sourceRunId}\0${display.callId}`,
      display,
    ]),
  );
  return events.map((event) => {
    if (
      !event.type.startsWith("tool.") ||
      !event.payload ||
      typeof event.payload !== "object" ||
      Array.isArray(event.payload)
    ) return event;
    const payload = event.payload as Record<string, import("@napier/contracts").JsonValue>;
    const callId = payload["callId"];
    if (typeof callId !== "string") return event;
    const display = byCall.get(`${event.runId}\0${callId}`);
    if (!display || display.toolName !== payload["toolName"]) return event;
    return {
      ...event,
      payload: {
        ...payload,
        displaySchemaVersion: 1,
        ...(display.input ? { displayInput: display.input } : {}),
        ...(display.output ? { displayOutput: display.output } : {}),
        ...(display.error ? { displayError: display.error } : {}),
      },
    };
  });
}

function displayText(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_DISPLAY_CHARS
    ? value
    : undefined;
}
