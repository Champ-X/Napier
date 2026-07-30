export const MAX_DAP_HEADER_BYTES = 512;
export const MAX_DAP_MESSAGE_BYTES = 24 * 1024;
export const MAX_DAP_PROTOCOL_BYTES = 30 * 1024;

export interface DapRequest {
  seq: number;
  type: "request";
  command: string;
  arguments?: Record<string, unknown>;
}

export interface DapResponse {
  seq: number;
  type: "response";
  request_seq: number;
  success: boolean;
  command: string;
  message?: string;
  body?: Record<string, unknown>;
}

export interface DapEvent {
  seq: number;
  type: "event";
  event: string;
  body?: Record<string, unknown>;
}

export type DapMessage = DapResponse | DapEvent;

export function encodeDapRequest(request: DapRequest): string {
  if (
    !Number.isSafeInteger(request.seq) ||
    request.seq < 1 ||
    request.type !== "request" ||
    !protocolName(request.command) ||
    (request.arguments !== undefined && !record(request.arguments))
  ) {
    throw new Error("DAP request is invalid");
  }
  const body = JSON.stringify(request);
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > MAX_DAP_MESSAGE_BYTES) {
    throw new Error("DAP request exceeds its message limit");
  }
  return `Content-Length: ${bytes}\r\n\r\n${body}`;
}

export class DapMessageDecoder {
  private buffer = Buffer.alloc(0);
  private totalBytes = 0;

  push(text: string): DapMessage[] {
    const chunk = Buffer.from(text, "utf8");
    this.totalBytes += chunk.byteLength;
    if (this.totalBytes > MAX_DAP_PROTOCOL_BYTES) {
      throw new Error("DAP protocol output exceeded its total limit");
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.byteLength > MAX_DAP_MESSAGE_BYTES + MAX_DAP_HEADER_BYTES) {
      throw new Error("DAP protocol buffer exceeded its limit");
    }
    const messages: DapMessage[] = [];
    while (this.buffer.byteLength > 0) {
      const boundary = this.buffer.indexOf("\r\n\r\n");
      if (boundary < 0) {
        if (this.buffer.byteLength > MAX_DAP_HEADER_BYTES) {
          throw new Error("DAP protocol header exceeded its limit");
        }
        break;
      }
      if (boundary > MAX_DAP_HEADER_BYTES) {
        throw new Error("DAP protocol header exceeded its limit");
      }
      const header = this.buffer.subarray(0, boundary).toString("ascii");
      const match = /^Content-Length: ([1-9]\d*)$/u.exec(header);
      if (!match) throw new Error("DAP protocol header is invalid");
      const bodyBytes = Number(match[1]);
      if (
        !Number.isSafeInteger(bodyBytes) ||
        bodyBytes < 1 ||
        bodyBytes > MAX_DAP_MESSAGE_BYTES
      ) {
        throw new Error("DAP protocol message length is invalid");
      }
      const messageEnd = boundary + 4 + bodyBytes;
      if (this.buffer.byteLength < messageEnd) break;
      const body = this.buffer
        .subarray(boundary + 4, messageEnd)
        .toString("utf8");
      if (Buffer.byteLength(body, "utf8") !== bodyBytes) {
        throw new Error("DAP protocol message encoding is invalid");
      }
      messages.push(parseDapMessage(body));
      this.buffer = this.buffer.subarray(messageEnd);
    }
    return messages;
  }
}

function parseDapMessage(body: string): DapMessage {
  let value: unknown;
  try {
    value = JSON.parse(body) as unknown;
  } catch {
    throw new Error("DAP protocol message is not valid JSON");
  }
  if (!record(value) || !positiveInteger(value["seq"])) {
    throw new Error("DAP protocol message identity is invalid");
  }
  if (value["type"] === "response") {
    if (
      !onlyKeys(value, [
        "seq",
        "type",
        "request_seq",
        "success",
        "command",
        "message",
        "body",
      ]) ||
      !positiveInteger(value["request_seq"]) ||
      typeof value["success"] !== "boolean" ||
      !protocolName(value["command"]) ||
      (value["message"] !== undefined &&
        (!visibleText(value["message"]) || value["message"].length > 500)) ||
      (value["body"] !== undefined && !record(value["body"]))
    ) {
      throw new Error("DAP response is invalid");
    }
    return structuredClone(value) as unknown as DapResponse;
  }
  if (
    value["type"] !== "event" ||
    !onlyKeys(value, ["seq", "type", "event", "body"]) ||
    !protocolName(value["event"]) ||
    (value["body"] !== undefined && !record(value["body"]))
  ) {
    throw new Error("DAP event is invalid");
  }
  return structuredClone(value) as unknown as DapEvent;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function protocolName(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(value)
  );
}

function visibleText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  );
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
