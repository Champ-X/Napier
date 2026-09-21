import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { validateModelHarnessExperimentProfile } from "@napier/runtime/harness-eval-support";

const MAX_PROFILE_BYTES = 64 * 1_024;

export async function loadCliHarnessProfile(
  file: string | undefined,
  cwd: string,
  signal: AbortSignal,
) {
  if (file === undefined) return undefined;
  signal.throwIfAborted();
  const handle = await open(
    path.resolve(cwd, file),
    constants.O_RDONLY | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_PROFILE_BYTES)
      throw new Error(
        "--harness-profile-file must be a regular JSON file of at most 65536 bytes",
      );
    // Bound the read even if the file grows after stat; validate these exact bytes once.
    const bytes = Buffer.alloc(MAX_PROFILE_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      signal.throwIfAborted();
      const read = await handle.read(
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    signal.throwIfAborted();
    if (length > MAX_PROFILE_BYTES)
      throw new Error("--harness-profile-file exceeds 65536 bytes");
    return validateModelHarnessExperimentProfile(
      JSON.parse(bytes.subarray(0, length).toString("utf8")),
    );
  } finally {
    await handle.close();
  }
}
