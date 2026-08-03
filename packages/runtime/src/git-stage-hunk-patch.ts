import { canonicalJson, sha256 } from "./ed25519.js";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u;
const UNSUPPORTED_HEADERS = [
  "new file mode ",
  "deleted file mode ",
  "old mode ",
  "new mode ",
  "similarity index ",
  "rename from ",
  "rename to ",
  "Binary files ",
  "GIT binary patch",
] as const;

export const MAX_GIT_STAGE_SELECTED_HUNKS = 32;
export const GIT_STAGE_HUNK_PROTOCOL_SHA256 = sha256(
  canonicalJson({
    schemaVersion: 1,
    indexing: "one_based_patch_order",
    acceptedFileKind: "existing_regular_text_modification",
    acceptedBodyPrefixes: [" ", "+", "-", "\\ No newline at end of file"],
    hunkHeader: HUNK_HEADER.source,
    unsupportedHeaders: UNSUPPORTED_HEADERS,
    sourceAndTargetLineCountVerification: true,
    selectedPatch: "original_headers_plus_selected_complete_hunks",
  }),
);

export interface GitStageHunkSelection {
  mode: "hunks";
  selectedHunkCount: number;
  selectedPatch: string;
  selectionSha256: string;
}

export function normalizeGitStageHunkIndexes(
  value: unknown,
): number[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_GIT_STAGE_SELECTED_HUNKS ||
    value.some(
      (item) =>
        !Number.isSafeInteger(item) ||
        Number(item) < 1 ||
        Number(item) > MAX_GIT_STAGE_SELECTED_HUNKS,
    )
  ) {
    throw new Error("Git stage hunk selection is invalid");
  }
  const indexes = value.map(Number);
  if (
    new Set(indexes).size !== indexes.length ||
    indexes.some((item, index) => index > 0 && indexes[index - 1]! >= item)
  ) {
    throw new Error(
      "Git stage hunk selection must be unique and strictly increasing",
    );
  }
  return indexes;
}

export function selectGitStageHunks(
  fullPatch: string,
  hunkIndexes: number[],
): GitStageHunkSelection {
  const parsed = parseSingleFilePatch(fullPatch);
  if (hunkIndexes.some((index) => index > parsed.hunks.length)) {
    throw new Error("Git stage hunk selection exceeds the available hunks");
  }
  const selectedHunks = hunkIndexes.map((index) => parsed.hunks[index - 1]!);
  const selectedPatch = `${parsed.headers.join("\n")}\n${selectedHunks
    .map((hunk) => hunk.join("\n"))
    .join("\n")}\n`;
  return {
    mode: "hunks",
    selectedHunkCount: hunkIndexes.length,
    selectedPatch,
    selectionSha256: sha256(
      canonicalJson({
        schemaVersion: 1,
        protocolSha256: GIT_STAGE_HUNK_PROTOCOL_SHA256,
        fullPatchSha256: sha256(fullPatch),
        hunkIndexes,
        selectedPatchSha256: sha256(selectedPatch),
      }),
    ),
  };
}

export function gitStagePathSelectionSha256(): string {
  return sha256(
    canonicalJson({
      schemaVersion: 1,
      mode: "path",
    }),
  );
}

function parseSingleFilePatch(fullPatch: string): {
  headers: string[];
  hunks: string[][];
} {
  if (
    !fullPatch.endsWith("\n") ||
    fullPatch.includes("\u0000") ||
    fullPatch.includes("\r")
  ) {
    throw new Error("Git stage hunk patch is not canonical text");
  }
  const lines = fullPatch.slice(0, -1).split("\n");
  const firstHunk = lines.findIndex((line) => line.startsWith("@@ "));
  const headers = lines.slice(0, firstHunk);
  if (
    firstHunk < 1 ||
    headers[0]?.startsWith("diff --git ") !== true ||
    headers.filter((line) => line.startsWith("diff --git ")).length !== 1 ||
    headers.filter((line) => line.startsWith("--- ")).length !== 1 ||
    headers.filter((line) => line.startsWith("+++ ")).length !== 1 ||
    headers.some((line) =>
      UNSUPPORTED_HEADERS.some((prefix) => line.startsWith(prefix)),
    )
  ) {
    throw new Error(
      "Git stage hunk selection requires one existing text modification",
    );
  }
  const hunks: string[][] = [];
  for (const line of lines.slice(firstHunk)) {
    if (line.startsWith("@@ ")) hunks.push([line]);
    else {
      const current = hunks.at(-1);
      if (!current) throw new Error("Git stage hunk patch is invalid");
      current.push(line);
    }
  }
  if (hunks.length < 1 || hunks.length > MAX_GIT_STAGE_SELECTED_HUNKS) {
    throw new Error("Git stage patch hunk count exceeds its bounded limit");
  }
  for (const hunk of hunks) validateHunk(hunk);
  return { headers, hunks };
}

function validateHunk(hunk: string[]): void {
  const match = HUNK_HEADER.exec(hunk[0] ?? "");
  if (!match) throw new Error("Git stage hunk header is invalid");
  const expectedSource = match[2] === undefined ? 1 : Number(match[2]);
  const expectedTarget = match[4] === undefined ? 1 : Number(match[4]);
  let source = 0;
  let target = 0;
  let previousWasContent = false;
  for (const line of hunk.slice(1)) {
    if (line.startsWith(" ")) {
      source += 1;
      target += 1;
      previousWasContent = true;
    } else if (line.startsWith("-")) {
      source += 1;
      previousWasContent = true;
    } else if (line.startsWith("+")) {
      target += 1;
      previousWasContent = true;
    } else if (line === "\\ No newline at end of file" && previousWasContent) {
      previousWasContent = false;
    } else {
      throw new Error("Git stage hunk body is invalid");
    }
  }
  if (source !== expectedSource || target !== expectedTarget) {
    throw new Error("Git stage hunk line counts are invalid");
  }
}
