import type { Writable } from "node:stream";

export async function writeText(stream: Writable, text: string): Promise<void> {
  if (stream.destroyed || stream.writableEnded) {
    throw new Error("CLI output is no longer writable");
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown, keepErrorListener = false): void => {
      if (settled) return;
      settled = true;
      if (!keepErrorListener) stream.removeListener("error", onError);
      stream.removeListener("close", onClose);
      if (error !== undefined && error !== null) reject(error);
      else resolve();
    };
    const onError = (error: Error): void => finish(error);
    const onClose = (): void =>
      finish(new Error("CLI output closed before the write completed"));
    stream.once("error", onError);
    stream.once("close", onClose);
    try {
      stream.write(text, (error) => {
        // Node emits "error" after invoking a failed write callback. Keep the
        // one-shot listener installed so that event cannot become unhandled.
        finish(error, error !== undefined && error !== null);
      });
    } catch (error) {
      finish(error);
    }
  });
}

export async function writeLine(stream: Writable, text: string): Promise<void> {
  await writeText(stream, `${text}\n`);
}
