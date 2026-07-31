import { once } from "node:events";
import type { Writable } from "node:stream";

export async function writeText(stream: Writable, text: string): Promise<void> {
  if (stream.write(text)) return;
  await once(stream, "drain");
}

export async function writeLine(stream: Writable, text: string): Promise<void> {
  await writeText(stream, `${text}\n`);
}
