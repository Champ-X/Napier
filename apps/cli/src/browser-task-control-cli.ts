import type { Readable } from "node:stream";

import type {
  BrowserUseLocalBackend,
  BrowserUseLocalControlObservation,
} from "@napier/runtime";

export function subscribeBrowserTaskControls(input: {
  stdin?: Readable;
  backend: Pick<BrowserUseLocalBackend, "pause" | "resume" | "takeover">;
  stop(): void;
  observe(observation: BrowserUseLocalControlObservation): Promise<void>;
  invalid(command: string): Promise<void>;
  failed(error: unknown): Promise<void>;
}): (() => void) | undefined {
  if (!input.stdin) return undefined;
  const restoreFlowing = input.stdin.readableFlowing === true;
  let buffer = "";
  let chain = Promise.resolve();
  const receive = (chunk: Buffer | string): void => {
    buffer += chunk.toString();
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const command = buffer.slice(0, newline).trim().toLowerCase();
      buffer = buffer.slice(newline + 1);
      if (!command) continue;
      chain = chain
        .then(() => handleBrowserTaskCommand(input, command))
        .catch((error: unknown) => input.failed(error));
    }
  };
  input.stdin.on("data", receive);
  return () => {
    input.stdin?.off("data", receive);
    if (!restoreFlowing) {
      input.stdin?.pause();
      if (input.stdin === process.stdin) input.stdin.destroy();
    }
  };
}

async function handleBrowserTaskCommand(
  input: Parameters<typeof subscribeBrowserTaskControls>[0],
  command: string,
): Promise<void> {
  if (command === "stop") {
    input.stop();
    return;
  }
  if (command === "pause") {
    await input.observe(input.backend.pause());
    return;
  }
  if (command === "resume") {
    await input.observe(input.backend.resume());
    return;
  }
  if (command === "takeover" || command === "take over") {
    await input.observe(input.backend.takeover());
    return;
  }
  await input.invalid(command);
}
