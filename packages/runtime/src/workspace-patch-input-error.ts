import type { WorkspacePatchInput } from "./workspace-patch-model.js";

const contracts: Record<WorkspacePatchInput["operation"], string> = {
  create:
    "create requires path, expectedSha256=null and root content; createParentDirectories is optional. Do not supply edits.",
  replace:
    "replace requires path, expectedSha256 and edits:[{oldText,newText}]. oldText must be exact previously read text. Root content and createParentDirectories are not accepted; content is only for create.",
  hashline_replace:
    "hashline_replace requires path, expectedSha256 and edits:[{anchorSha256,newText,line?}]. Do not supply root content, createParentDirectories, oldText or range fields.",
  hashrange_replace:
    "hashrange_replace requires path, expectedSha256 and edits:[{startLine,endLine,rangeSha256,newText}]. Do not supply root content, createParentDirectories, oldText or single-line anchor fields.",
};

/** A rejected argument shape, not a stale file or permission to retry/write.
 * Only static contract text is emitted; file contents and argument values stay out.
 */
export class WorkspacePatchInputError extends Error {
  constructor(operation: WorkspacePatchInput["operation"]) {
    const guidance = Object.hasOwn(contracts, operation)
      ? contracts[operation]
      : "Use a declared apply_patch operation and its corresponding fields.";
    super(
      `Workspace patch fields do not match operation. ${guidance} No file write was attempted. Correct the arguments before retrying; do not resend the rejected call.`,
    );
    this.name = "WorkspacePatchInputError";
  }
}
