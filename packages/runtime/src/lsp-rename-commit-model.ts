import { canonicalJson, sha256 } from "./ed25519.js";
import {
  canonicalLspRenameEdits,
  MAX_LSP_RENAME_EDITS,
  MAX_LSP_RENAME_FILES,
  type LspRenameFile,
} from "./lsp-rename-workspace-edit.js";

export function validateLspRenameCommitInput(
  sourcePreviewResultSha256: string,
  files: LspRenameFile[],
): void {
  const editCount = files.reduce((total, file) => total + file.edits.length, 0);
  if (
    !/^[a-f0-9]{64}$/u.test(sourcePreviewResultSha256) ||
    files.length < 1 ||
    files.length > MAX_LSP_RENAME_FILES ||
    editCount < 1 ||
    editCount > MAX_LSP_RENAME_EDITS
  ) {
    throw new Error("LSP rename apply commit input is invalid");
  }
  let previousPath: string | undefined;
  for (const file of files) {
    if (
      sha256(file.path) !== file.pathSha256 ||
      (previousPath !== undefined && previousPath.localeCompare(file.path) >= 0)
    ) {
      throw new Error("LSP rename apply file set is invalid");
    }
    previousPath = file.path;
    const canonical = canonicalLspRenameEdits(file.edits);
    if (
      canonical.length !== file.edits.length ||
      canonical.some((edit, index) => edit !== file.edits[index])
    ) {
      throw new Error("LSP rename apply edit order is invalid");
    }
    for (const edit of file.edits) {
      if (
        edit.path !== file.path ||
        edit.pathSha256 !== file.pathSha256 ||
        edit.fileSha256 !== file.fileSha256 ||
        edit.oldTextSha256 !== sha256(edit.oldText) ||
        edit.newTextSha256 !== sha256(edit.newText) ||
        edit.rangeSha256 !==
          sha256(
            canonicalJson({
              startLine: edit.startLine,
              startCharacter: edit.startCharacter,
              endLine: edit.endLine,
              endCharacter: edit.endCharacter,
            }),
          )
      ) {
        throw new Error("LSP rename apply edit binding is invalid");
      }
    }
  }
}
