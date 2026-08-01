import { link, lstat, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  MAX_SUBAGENT_WORKTREE_FILE_BYTES,
  normalizeSubagentWorktreePath,
  type SubagentWorktreeSession,
} from "./subagent-worktree-files.js";

const SHA256_PATTERN = "^[a-f0-9]{64}$";

const candidateFileSchema = Type.Union([
  Type.Object(
    {
      operation: Type.Literal("delete"),
      path: Type.String({ minLength: 1, maxLength: 500 }),
      expectedSha256: Type.String({ pattern: SHA256_PATTERN }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      operation: Type.Literal("move"),
      sourcePath: Type.String({ minLength: 1, maxLength: 500 }),
      destinationPath: Type.String({ minLength: 1, maxLength: 500 }),
      expectedSourceSha256: Type.String({ pattern: SHA256_PATTERN }),
      expectedDestinationSha256: Type.Null(),
    },
    { additionalProperties: false },
  ),
]);

export interface SubagentWorktreeFileDetails {
  operation: "delete" | "move";
  sourcePathSha256: string;
  destinationPathSha256?: string;
  beforeSha256: string;
  afterSha256: string | null;
  createdDirectoryCount: number;
  createdDirectorySetSha256: string;
  resultSha256: string;
}

interface SubagentWorktreeFileOperations {
  linkFile?: typeof link;
  unlinkFile?: typeof unlink;
}

export function createSubagentWorktreeFileTool(
  session: SubagentWorktreeSession,
  runMutation: <T>(operation: () => Promise<T>) => Promise<T>,
  operations: SubagentWorktreeFileOperations = {},
): AgentTool<typeof candidateFileSchema, SubagentWorktreeFileDetails> {
  const linkFile = operations.linkFile ?? link;
  const unlinkFile = operations.unlinkFile ?? unlink;
  return {
    name: "candidate_file",
    label: "Manage candidate file",
    description:
      "Delete or move one explicitly authorized UTF-8 file inside this private candidate. Both move paths require delegation grants and hash/non-existence preconditions. This never mutates the parent workspace.",
    parameters: candidateFileSchema,
    execute: async (_toolCallId, input, signal) =>
      runMutation(async () => {
        signal?.throwIfAborted();
        return input.operation === "delete"
          ? deleteCandidateFile(
              session,
              input.path,
              input.expectedSha256,
              unlinkFile,
            )
          : moveCandidateFile(session, input, linkFile, unlinkFile);
      }),
  };
}

async function deleteCandidateFile(
  session: SubagentWorktreeSession,
  rawPath: string,
  expectedSha256: string,
  unlinkFile: typeof unlink,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  details: SubagentWorktreeFileDetails;
}> {
  const relativePath = authorizedPath(session, rawPath);
  const current = await readCandidateFile(session.root, relativePath);
  if (current.sha256 !== expectedSha256) {
    throw new Error("Candidate file delete SHA-256 precondition failed");
  }
  await unlinkFile(current.target);
  const base = {
    operation: "delete" as const,
    sourcePathSha256: sha256(relativePath),
    beforeSha256: current.sha256,
    afterSha256: null,
    createdDirectoryCount: 0,
    createdDirectorySetSha256: sha256(canonicalJson([])),
  };
  return {
    content: [
      {
        type: "text",
        text: [
          `Candidate file deleted: ${relativePath}`,
          `Before SHA-256: ${current.sha256}`,
          "Parent workspace unchanged.",
        ].join("\n"),
      },
    ],
    details: { ...base, resultSha256: sha256(canonicalJson(base)) },
  };
}

async function moveCandidateFile(
  session: SubagentWorktreeSession,
  input: {
    sourcePath: string;
    destinationPath: string;
    expectedSourceSha256: string;
    expectedDestinationSha256: null;
  },
  linkFile: typeof link,
  unlinkFile: typeof unlink,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  details: SubagentWorktreeFileDetails;
}> {
  const sourcePath = authorizedPath(session, input.sourcePath);
  const destinationPath = authorizedPath(session, input.destinationPath);
  if (sourcePath === destinationPath) {
    throw new Error("Candidate file move paths must differ");
  }
  const source = await readCandidateFile(session.root, sourcePath);
  if (source.sha256 !== input.expectedSourceSha256) {
    throw new Error("Candidate file move SHA-256 precondition failed");
  }
  const destination = await absentCandidateTarget(
    session.root,
    destinationPath,
  );
  await linkFile(source.target, destination);
  try {
    await unlinkFile(source.target);
  } catch (error) {
    await unlinkFile(destination).catch(() => undefined);
    throw error;
  }
  const createdDirectorySetSha256 = sha256(canonicalJson([]));
  const base = {
    operation: "move" as const,
    sourcePathSha256: sha256(sourcePath),
    destinationPathSha256: sha256(destinationPath),
    beforeSha256: source.sha256,
    afterSha256: source.sha256,
    createdDirectoryCount: 0,
    createdDirectorySetSha256,
  };
  return {
    content: [
      {
        type: "text",
        text: [
          `Candidate file moved: ${sourcePath} -> ${destinationPath}`,
          `Content SHA-256: ${source.sha256}`,
          "Created parent directories: 0",
          "Parent workspace unchanged.",
        ].join("\n"),
      },
    ],
    details: { ...base, resultSha256: sha256(canonicalJson(base)) },
  };
}

function authorizedPath(
  session: SubagentWorktreeSession,
  candidate: string,
): string {
  const normalized = normalizeSubagentWorktreePath(candidate);
  if (!session.writePaths.includes(normalized)) {
    throw new Error(
      "Candidate file operation is limited to declared write paths",
    );
  }
  return normalized;
}

async function readCandidateFile(
  rootInput: string,
  relativePath: string,
): Promise<{ target: string; sha256: string }> {
  const root = await realpath(rootInput);
  const target = path.resolve(root, ...relativePath.split("/"));
  const resolved = await realpath(target);
  if (resolved !== target || !inside(target, root)) {
    throw new Error("Candidate file target is not canonical");
  }
  const info = await lstat(target);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > MAX_SUBAGENT_WORKTREE_FILE_BYTES
  ) {
    throw new Error("Candidate file target is unavailable");
  }
  const buffer = await readFile(target);
  decodeUtf8(buffer);
  return { target, sha256: sha256(buffer) };
}

async function absentCandidateTarget(
  rootInput: string,
  relativePath: string,
): Promise<string> {
  const root = await realpath(rootInput);
  const target = path.resolve(root, ...relativePath.split("/"));
  if (!inside(target, root)) throw new Error("Candidate file path escapes");
  const parent = path.dirname(target);
  if ((await realpath(parent)) !== parent) {
    throw new Error("Candidate file parent is not canonical");
  }
  try {
    await lstat(target);
    throw new Error("Candidate file destination already exists");
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  return target;
}

function decodeUtf8(buffer: Buffer): void {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("Candidate file must be valid UTF-8");
  }
}

function inside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}
