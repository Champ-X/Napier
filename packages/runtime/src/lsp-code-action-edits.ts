import { realpath } from "node:fs/promises";
import path from "node:path";

import { sha256File } from "./command-execution.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { LspCodeActionCandidate } from "./lsp-code-action-parser.js";
import {
  type LspWorkspaceLocation,
  workspaceLspLocation,
} from "./lsp-locations.js";
import {
  assertLspWorkspacePreviewBytes,
  canonicalLspWorkspaceTextEdits,
  lspWorkspaceTextEditFiles,
  lspWorkspaceTextEditReceipt,
  MAX_LSP_RENAME_EDITS,
  MAX_LSP_RENAME_FILES,
  MAX_LSP_RENAME_PREVIEW_BYTES,
  type LspWorkspaceTextEdit,
  type LspWorkspaceTextEditFile,
} from "./lsp-rename-workspace-edit.js";

export interface LspCodeAction {
  actionSha256: string;
  title: string;
  kind: string;
  isPreferred: boolean;
  commandIgnored: boolean;
  resolved: boolean;
  files: LspWorkspaceTextEditFile[];
}

export interface MaterializedLspCodeActions {
  actions: LspCodeAction[];
  allEdits: LspWorkspaceTextEdit[];
  targetFiles: Array<{ pathSha256: string; fileSha256: string }>;
  previewBytes: number;
  actionReceipts: unknown[];
}

interface LspCodeActionMaterializationOptions {
  workspaceRoot: string;
  sourcePath: string;
  sourcePathSha256: string;
  sourceFileSha256: string;
  toHostUri?: (uri: string) => string | undefined;
  signal?: AbortSignal;
}

export async function materializeLspCodeActions(
  options: LspCodeActionMaterializationOptions,
  candidates: LspCodeActionCandidate[],
): Promise<MaterializedLspCodeActions> {
  assertNotAborted(options.signal);
  assertAggregateCandidateLimits(candidates);
  const locationCache = new Map<string, LspWorkspaceLocation | undefined>();
  const actions: LspCodeAction[] = [];
  for (const action of candidates) {
    actions.push(await materializeCodeAction(options, action, locationCache));
  }
  const allEdits = actions.flatMap((action) =>
    action.files.flatMap((file) => file.edits),
  );
  if (allEdits.length > MAX_LSP_RENAME_EDITS) {
    throw new Error(
      `LSP code action previews exceed ${MAX_LSP_RENAME_EDITS} total edits`,
    );
  }
  const targetFiles = canonicalTargetFiles(actions);
  if (targetFiles.length > MAX_LSP_RENAME_FILES) {
    throw new Error(
      `LSP code action previews exceed ${MAX_LSP_RENAME_FILES} total files`,
    );
  }
  const previewBytes = assertLspWorkspacePreviewBytes(
    allEdits,
    "LSP code action",
  );
  const actionReceipts = actions
    .map(codeActionReceipt)
    .sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right)),
    );
  await assertTargetFilesStable(options, actions);
  return {
    actions,
    allEdits,
    targetFiles,
    previewBytes,
    actionReceipts,
  };
}

function assertAggregateCandidateLimits(
  actions: LspCodeActionCandidate[],
): void {
  const edits = actions.flatMap((action) => action.edits);
  if (edits.length > MAX_LSP_RENAME_EDITS) {
    throw new Error(
      `LSP code action previews exceed ${MAX_LSP_RENAME_EDITS} total edits`,
    );
  }
  if (new Set(edits.map((edit) => edit.uri)).size > MAX_LSP_RENAME_FILES) {
    throw new Error(
      `LSP code action previews exceed ${MAX_LSP_RENAME_FILES} total files`,
    );
  }
  const proposedBytes = edits.reduce(
    (total, edit) => total + Buffer.byteLength(edit.newText, "utf8"),
    0,
  );
  if (proposedBytes > MAX_LSP_RENAME_PREVIEW_BYTES) {
    throw new Error(
      `LSP code action preview exceeds ${MAX_LSP_RENAME_PREVIEW_BYTES} UTF-8 bytes`,
    );
  }
}

async function materializeCodeAction(
  options: LspCodeActionMaterializationOptions,
  action: LspCodeActionCandidate,
  locationCache: Map<string, LspWorkspaceLocation | undefined>,
): Promise<LspCodeAction> {
  const edits: LspWorkspaceTextEdit[] = [];
  for (const [index, candidate] of action.edits.entries()) {
    assertNotAborted(options.signal);
    const cacheKey = canonicalJson({
      uri: candidate.uri,
      range: candidate.range,
    });
    let location = locationCache.get(cacheKey);
    if (!locationCache.has(cacheKey)) {
      try {
        location = await workspaceLspLocation(
          options.workspaceRoot,
          candidate,
          "LSP code action",
          {
            allowLineBreakInsertion: true,
            ...(options.toHostUri ? { toHostUri: options.toHostUri } : {}),
          },
        );
      } catch (error) {
        throw new Error(
          `LSP code action edit ${index + 1} could not be materialized at ${candidate.range.start.line}:${candidate.range.start.character}-${candidate.range.end.line}:${candidate.range.end.character} for URI ${sha256(candidate.uri)}`,
          { cause: error },
        );
      }
      locationCache.set(cacheKey, location);
    }
    if (!location) {
      throw new Error(
        `LSP code action edit ${index + 1} targets an unsupported or out-of-workspace file`,
      );
    }
    if (location.previewTruncated) {
      throw new Error(
        `LSP code action edit ${index + 1} exceeds the old-text preview limit`,
      );
    }
    assertDocumentVersion(options, candidate, location);
    edits.push({
      path: location.path,
      pathSha256: location.pathSha256,
      fileSha256: location.fileSha256,
      startLine: location.startLine,
      startCharacter: location.startCharacter,
      endLine: location.endLine,
      endCharacter: location.endCharacter,
      rangeSha256: location.rangeSha256,
      oldText: location.preview,
      oldTextSha256: location.previewSha256,
      newText: candidate.newText,
      newTextSha256: sha256(candidate.newText),
    });
  }
  const canonicalEdits = canonicalLspWorkspaceTextEdits(
    edits,
    "LSP code action",
  );
  const files = lspWorkspaceTextEditFiles(canonicalEdits);
  const receipt = {
    titleSha256: sha256(action.title),
    kind: action.kind,
    isPreferred: action.isPreferred,
    commandIgnored: action.commandIgnored,
    resolved: action.resolved,
    edits: canonicalEdits.map(lspWorkspaceTextEditReceipt),
  };
  return {
    actionSha256: sha256(canonicalJson(receipt)),
    title: action.title,
    kind: action.kind,
    isPreferred: action.isPreferred,
    commandIgnored: action.commandIgnored,
    resolved: action.resolved,
    files,
  };
}

function assertDocumentVersion(
  options: LspCodeActionMaterializationOptions,
  candidate: LspCodeActionCandidate["edits"][number],
  location: LspWorkspaceLocation,
): void {
  const source = location.pathSha256 === options.sourcePathSha256;
  if (source && location.fileSha256 !== options.sourceFileSha256) {
    throw new Error("LSP code action source changed before materialization");
  }
  if (
    typeof candidate.documentVersion === "number" &&
    (!source || candidate.documentVersion !== 1)
  ) {
    throw new Error(
      "LSP code action returned an incompatible document version",
    );
  }
}

async function assertTargetFilesStable(
  options: LspCodeActionMaterializationOptions,
  actions: LspCodeAction[],
): Promise<void> {
  const expected = new Map<string, { path: string; fileSha256: string }>([
    [
      options.sourcePathSha256,
      { path: options.sourcePath, fileSha256: options.sourceFileSha256 },
    ],
  ]);
  for (const file of actions.flatMap((action) => action.files)) {
    const current = expected.get(file.pathSha256);
    if (current && current.fileSha256 !== file.fileSha256) {
      throw new Error(
        "LSP code action alternatives observed a drifting target file",
      );
    }
    expected.set(file.pathSha256, {
      path: file.path,
      fileSha256: file.fileSha256,
    });
  }
  for (const file of expected.values()) {
    assertNotAborted(options.signal);
    const lexical = path.join(options.workspaceRoot, file.path);
    let target: string;
    let observed: string;
    try {
      target = await realpath(lexical);
      if (target !== lexical) throw new Error("target changed");
      observed = await sha256File(target);
    } catch {
      throw new Error("LSP code action target changed after materialization");
    }
    if (observed !== file.fileSha256) {
      throw new Error("LSP code action target changed after materialization");
    }
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("LSP code action was aborted");
  }
}

function codeActionReceipt(action: LspCodeAction): unknown {
  return {
    actionSha256: action.actionSha256,
    titleSha256: sha256(action.title),
    kind: action.kind,
    isPreferred: action.isPreferred,
    commandIgnored: action.commandIgnored,
    resolved: action.resolved,
    edits: action.files.flatMap((file) =>
      file.edits.map(lspWorkspaceTextEditReceipt),
    ),
  };
}

function canonicalTargetFiles(
  actions: LspCodeAction[],
): Array<{ pathSha256: string; fileSha256: string }> {
  const files = new Map<string, { pathSha256: string; fileSha256: string }>();
  for (const file of actions.flatMap((action) => action.files)) {
    const current = files.get(file.pathSha256);
    if (current && current.fileSha256 !== file.fileSha256) {
      throw new Error(
        "LSP code action alternatives observed a drifting target file",
      );
    }
    files.set(file.pathSha256, {
      pathSha256: file.pathSha256,
      fileSha256: file.fileSha256,
    });
  }
  return [...files.values()].sort((left, right) =>
    canonicalJson(left).localeCompare(canonicalJson(right)),
  );
}
