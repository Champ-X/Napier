import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import {
  openWebComparisonAttemptFileName,
  verifyOpenWebComparisonAttemptReceipt,
} from "./open-web-comparison-attempt.mjs";

const MAX_ATTEMPT_BYTES = 256 * 1024;

export async function loadOpenWebComparisonAttemptReceipt(attemptPath) {
  const absolutePath = path.resolve(attemptPath);
  const info = await lstat(absolutePath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size < 2 ||
    info.size > MAX_ATTEMPT_BYTES
  ) {
    throw new Error("Open-web comparison attempt artifact file is invalid");
  }
  const attempt = JSON.parse(await readFile(absolutePath, "utf8"));
  const verification = verifyOpenWebComparisonAttemptReceipt(attempt);
  if (!verification.valid) {
    throw new Error(
      `Open-web comparison attempt receipt is invalid: ${verification.diagnostics.join(
        ",",
      )}`,
    );
  }
  if (
    path.basename(absolutePath) !== openWebComparisonAttemptFileName(attempt)
  ) {
    throw new Error("Open-web comparison attempt filename is invalid");
  }
  return attempt;
}
