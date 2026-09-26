import { readFile } from "node:fs/promises";

/** Check both the inspected file size and the bytes actually read. */
export async function readPlanArtifactFile(
  inspected: { target: string; info: { size: number } },
  maxBytes: number,
  limitMessage: string,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Artifact file limit must be a positive safe integer");
  }
  if (inspected.info.size > maxBytes) throw new RangeError(limitMessage);
  const contents = await readFile(inspected.target);
  if (contents.byteLength > maxBytes) throw new RangeError(limitMessage);
  return contents;
}
