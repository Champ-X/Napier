import { NapierStreamFrameParseError, sha256Text } from "./api-error";

export interface ParsedSseJsonRecord {
  value: unknown;
  dataSha256: string;
  lineCount: number;
  eventType?: string;
  id?: string;
  dataBytes: number;
}

export interface ReadSseJsonRecordsOptions {
  maxTotalBytes?: number;
  maxRecordBytes?: number;
}

export async function* readSseJsonRecords(
  path: string,
  body: ReadableStream<Uint8Array>,
  options: ReadSseJsonRecordsOptions = {},
): AsyncGenerator<ParsedSseJsonRecord> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const maxTotalBytes = options.maxTotalBytes;
  const maxRecordBytes = options.maxRecordBytes;
  let totalBytes = 0;
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (maxTotalBytes !== undefined && totalBytes > maxTotalBytes) {
      throw new Error(`SSE response exceeds its byte limit for ${path}`);
    }
    buffer += decoder.decode(value, { stream: true });
    const records = buffer.split(/\r?\n\r?\n/u);
    buffer = records.pop() ?? "";
    for (const record of records) {
      assertRecordBytes(path, record, maxRecordBytes);
      const parsed = await parseSseJsonRecord(path, record);
      if (parsed) yield parsed;
    }
    assertRecordBytes(path, buffer, maxRecordBytes);
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    assertRecordBytes(path, buffer, maxRecordBytes);
    const parsed = await parseSseJsonRecord(path, buffer);
    if (parsed) yield parsed;
  }
}

export async function parseSseJsonRecord(
  path: string,
  record: string,
): Promise<ParsedSseJsonRecord | undefined> {
  const lines = record.split(/\r?\n/u);
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return undefined;

  const dataSha256 = await sha256Text(data);
  const lineCount = data.split(/\r?\n/u).length;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new NapierStreamFrameParseError(path, {
      frameSha256: dataSha256,
      lineCount,
    });
  }

  const eventType = lines
    .filter((line) => line.startsWith("event:"))
    .map((line) => line.slice(6).trimStart())
    .at(-1);
  const id = lines
    .filter((line) => line.startsWith("id:"))
    .map((line) => line.slice(3).trimStart())
    .at(-1);
  return {
    value,
    dataSha256,
    lineCount,
    ...(eventType ? { eventType } : {}),
    ...(id ? { id } : {}),
    dataBytes: new TextEncoder().encode(data).byteLength,
  };
}

function assertRecordBytes(
  path: string,
  record: string,
  maximum: number | undefined,
): void {
  if (
    maximum !== undefined &&
    new TextEncoder().encode(record).byteLength > maximum
  ) {
    throw new Error(`SSE record exceeds its byte limit for ${path}`);
  }
}
