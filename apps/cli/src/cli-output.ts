import { once } from "node:events";
import type { Writable } from "node:stream";

export async function writeLine(stream: Writable, text: string): Promise<void> {
  if (stream.write(`${text}\n`)) return;
  await once(stream, "drain");
}
