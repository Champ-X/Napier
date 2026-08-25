import { cp, lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

import {
  canonicalJson,
  sha256,
} from "@napier/runtime/core";
import {
  createWorkspacePathSnapshot,
} from "@napier/runtime/code";

import {
  validateCodingBenchmarkCase,
  type CodingBenchmarkCase,
} from "./coding-benchmark-contract.js";
export { writeBenchmarkCasFile as writeCodingBenchmarkCasFile } from "./benchmark-artifact-file.js";

const MAX_FIXTURE_FILES = 256;
const MAX_FIXTURE_BYTES = 2 * 1024 * 1024;
const MAX_TARGET_BYTES = 256 * 1024;
const MAX_OUTCOME_TEST_BYTES = 64 * 1024;

export interface LoadedCodingBenchmarkCase {
  benchmarkCase: CodingBenchmarkCase;
  prompt: string;
  outcomeTestSource: string;
  fixtureRoot: string;
}

export async function loadCodingBenchmarkCase(
  caseRootInput: string,
): Promise<LoadedCodingBenchmarkCase> {
  const caseRoot = await realpath(path.resolve(caseRootInput));
  const manifestPath = await resolveCaseEntry(
    caseRoot,
    "manifest.json",
    "file",
  );
  const manifest = validateCodingBenchmarkCase(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  const promptPath = await resolveCaseEntry(
    caseRoot,
    manifest.promptPath,
    "file",
  );
  const fixtureRoot = await resolveCaseEntry(
    caseRoot,
    manifest.fixturePath,
    "directory",
  );
  const expectedTarget = await resolveCaseEntry(
    caseRoot,
    manifest.expectedTargetPath,
    "file",
  );
  const outcomeTest = await resolveCaseEntry(
    caseRoot,
    manifest.outcomeTestPath,
    "file",
  );
  const prompt = await readFile(promptPath, "utf8");
  if (sha256(prompt) !== manifest.promptSha256) {
    throw new Error("Coding benchmark prompt hash mismatch");
  }
  await inspectFixtureTree(fixtureRoot);
  const fixture = await createWorkspacePathSnapshot(fixtureRoot, fixtureRoot);
  if (fixture.truncated || fixture.sha256 !== manifest.fixtureSha256) {
    throw new Error("Coding benchmark fixture hash mismatch");
  }
  const targetBeforeSha256 = sha256(
    await readFile(path.join(fixtureRoot, manifest.targetPath)),
  );
  if (targetBeforeSha256 !== manifest.targetBeforeSha256) {
    throw new Error("Coding benchmark target-before hash mismatch");
  }
  const expectedTargetSource = await readFile(expectedTarget, "utf8");
  if (sha256(expectedTargetSource) !== manifest.expectedTargetSha256) {
    throw new Error("Coding benchmark expected target hash mismatch");
  }
  if (
    codingBenchmarkAstSha256(expectedTargetSource) !==
    manifest.expectedTargetAstSha256
  ) {
    throw new Error("Coding benchmark expected target AST hash mismatch");
  }
  const outcomeTestBuffer = await readFile(outcomeTest);
  if (
    outcomeTestBuffer.byteLength > MAX_OUTCOME_TEST_BYTES ||
    sha256(outcomeTestBuffer) !== manifest.outcomeTestSha256
  ) {
    throw new Error("Coding benchmark outcome test hash mismatch");
  }
  const outcomeTestSource = new TextDecoder("utf-8", { fatal: true }).decode(
    outcomeTestBuffer,
  );
  return {
    benchmarkCase: manifest,
    prompt,
    outcomeTestSource,
    fixtureRoot,
  };
}

export async function copyCodingBenchmarkFixture(
  source: string,
  destination: string,
): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    await cp(
      path.join(source, entry.name),
      path.join(destination, entry.name),
      {
        recursive: entry.isDirectory(),
        errorOnExist: true,
        force: false,
      },
    );
  }
}

export async function codingBenchmarkTargetEvidence(
  filePath: string,
): Promise<{ sha256: string; astSha256: string }> {
  try {
    const buffer = await readFile(filePath);
    if (buffer.byteLength > MAX_TARGET_BYTES) {
      throw new Error("Coding benchmark target exceeds its size limit");
    }
    const source = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return {
      sha256: sha256(buffer),
      astSha256: codingBenchmarkAstSha256(source),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      String(error.code) === "ENOENT"
    ) {
      const missing = sha256(canonicalJson({ missing: true }));
      return { sha256: missing, astSha256: missing };
    }
    throw error;
  }
}

export function codingBenchmarkAstSha256(source: string): string {
  if (Buffer.byteLength(source, "utf8") > MAX_TARGET_BYTES) {
    throw new Error("Coding benchmark target exceeds its size limit");
  }
  const sourceFile = ts.createSourceFile(
    "target.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  return sha256(canonicalJson(astProjection(sourceFile, sourceFile)));
}

async function inspectFixtureTree(root: string): Promise<void> {
  let files = 0;
  let bytes = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(candidate);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error("Coding benchmark fixture contains an unsafe entry");
      }
      const info = await lstat(candidate);
      files += 1;
      bytes += info.size;
      if (files > MAX_FIXTURE_FILES || bytes > MAX_FIXTURE_BYTES) {
        throw new Error("Coding benchmark fixture exceeds its size limit");
      }
    }
  }
}

function resolveInside(root: string, relativePath: string): string {
  const candidate = path.resolve(root, relativePath);
  const relative = path.relative(root, candidate);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Coding benchmark case path escapes its root");
  }
  return candidate;
}

async function resolveCaseEntry(
  root: string,
  relativePath: string,
  expectedType: "file" | "directory",
): Promise<string> {
  const candidate = resolveInside(root, relativePath);
  const [canonical, info] = await Promise.all([
    realpath(candidate),
    lstat(candidate),
  ]);
  const canonicalRelative = path.relative(root, canonical);
  if (
    canonical !== candidate ||
    canonicalRelative === ".." ||
    canonicalRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(canonicalRelative) ||
    info.isSymbolicLink() ||
    (expectedType === "file" ? !info.isFile() : !info.isDirectory())
  ) {
    throw new Error("Coding benchmark case entry is unsafe");
  }
  return candidate;
}

function astProjection(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): {
  kind: number;
  value?: string | number;
  children: ReturnType<typeof astProjection>[];
} {
  let value: string | number | undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) {
    value = node.text;
  } else if (ts.isNumericLiteral(node)) {
    value = Number(node.text.replaceAll("_", ""));
  }
  return {
    kind: node.kind,
    ...(value !== undefined ? { value } : {}),
    children: node
      .getChildren(sourceFile)
      .filter((child) => child.kind !== ts.SyntaxKind.EndOfFileToken)
      .map((child) => astProjection(child, sourceFile)),
  };
}
