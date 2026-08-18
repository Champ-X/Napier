import { createHash } from "node:crypto";

export function assertWorkspacePatchRangeSha256(
  selected: string,
  edit: { startLine: number; endLine: number; rangeSha256: string },
  label: string,
): void {
  const observedSha256 = createHash("sha256").update(selected).digest("hex");
  if (observedSha256 === edit.rangeSha256) return;
  throw new Error(
    `${label} rangeSha256 precondition failed; selected lines ${String(edit.startLine)}-${String(edit.endLine)} hash to ${observedSha256}. Use the exact range digest from fresh read metadata; a whole-file digest can differ when the file has a trailing newline.`,
  );
}
