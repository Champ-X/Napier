import { createRequire } from "node:module";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { LspDiagnosticLanguage } from "@napier/contracts";

import { sha256File } from "./command-execution.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  type LspProtocolExecutor,
  type LspProtocolSessionRequest,
  type LspProtocolSessionResult,
  type PrepareLspProtocolOperation,
  runLspProtocolSession,
} from "./lsp-protocol-session.js";
import { resolveLspRuntimeReadPaths } from "./lsp-runtime-read-paths.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export const DEFAULT_LSP_DIAGNOSTICS_TIMEOUT_MS = 10_000;
export const MAX_LSP_DIAGNOSTICS_TIMEOUT_MS = 30_000;
export const MAX_LSP_DIAGNOSTIC_FILE_BYTES = 1024 * 1024;
export const LSP_FIXED_ENVIRONMENT = {
  CI: "1",
  FORCE_COLOR: "0",
  LANG: "C",
  LC_ALL: "C",
  NO_COLOR: "1",
} as const;

const MIN_LSP_DIAGNOSTICS_TIMEOUT_MS = 1_000;
const MAX_TYPESCRIPT_RUNTIME_FILES = 512;
const MAX_TYPESCRIPT_RUNTIME_BYTES = 64 * 1024 * 1024;
const LANGUAGE_BY_EXTENSION = new Map<string, LspDiagnosticLanguage>([
  [".ts", "typescript"],
  [".mts", "typescript"],
  [".cts", "typescript"],
  [".tsx", "typescriptreact"],
  [".js", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".jsx", "javascriptreact"],
]);
const require = createRequire(import.meta.url);

export interface LspSourceRequest {
  path: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LspDiagnosticsRunnerOptions {
  workspaceRoot: string;
  sandbox: OsSandboxAdapter;
  nodeExecutable?: string;
  languageServerPath?: string;
  typescriptServerPath?: string;
  runtimeReadPaths?: string[];
  session?: LspProtocolExecutor;
}

export interface LspRuntimeAssets {
  nodeExecutable: string;
  nodeExecutableSha256: string;
  languageServerPath: string;
  languageServerRoot: string;
  languageServerVersion: string;
  languageServerSha256: string;
  typescriptServerPath: string;
  typescriptRoot: string;
  typescriptVersion: string;
  typescriptServerSha256: string;
}

export interface PreparedLspSource {
  workspaceRoot: string;
  target: string;
  relativePath: string;
  language: LspDiagnosticLanguage;
  source: string;
  fileSha256: string;
  fileBytes: number;
  timeoutMs: number;
  assets: LspRuntimeAssets;
}

interface LspRuntimeAssetOptions {
  nodeExecutable?: string;
  languageServerPath?: string;
  typescriptServerPath?: string;
}

export class LspDiagnosticsTargetDriftError extends Error {
  constructor(
    readonly expectedFileSha256: string,
    readonly observedFileSha256?: string,
    label = "LSP diagnostics",
  ) {
    super(`${label} target changed during execution`);
    this.name = "LspDiagnosticsTargetDriftError";
  }
}

export function lspDiagnosticLanguageForPath(
  candidate: string,
): LspDiagnosticLanguage | undefined {
  return LANGUAGE_BY_EXTENSION.get(path.extname(candidate).toLowerCase());
}

export async function runBoundLspSourceSession<T>(
  options: LspDiagnosticsRunnerOptions,
  request: LspSourceRequest,
  labels: { label: string; abortedMessage: string },
  prepareOperation: PrepareLspProtocolOperation<T>,
  validatePrepared?: (prepared: PreparedLspSource) => void,
): Promise<{
  prepared: PreparedLspSource;
  execution: LspProtocolSessionResult<T>;
  durationMs: number;
}> {
  if (request.signal?.aborted) {
    throw new Error(labels.abortedMessage);
  }
  const prepared = await prepareLspSource(options, request, labels.label);
  validatePrepared?.(prepared);
  if (options.session && (options.runtimeReadPaths?.length ?? 0) > 0) {
    throw new Error(
      `${labels.label} cannot add runtime paths to a persistent LSP Session`,
    );
  }
  if (options.sandbox.id === "oci-container") {
    throw new Error(
      `${labels.label} requires a local OS sandbox until container runtime asset identity binding is available`,
    );
  }
  const startedAt = Date.now();
  const protocolRequest = createProtocolRequest(prepared, labels);
  const execution = options.session
    ? await options.session.execute(
        protocolRequest,
        prepareOperation,
        request.signal,
      )
    : await runOneShotSession(
        options.sandbox,
        prepared,
        protocolRequest,
        prepareOperation,
        options.runtimeReadPaths,
        request.signal,
      );
  await assertLspTargetStable(
    prepared.target,
    prepared.fileSha256,
    labels.label,
  );
  await assertLspRuntimeStable(prepared.assets, labels.label);
  return {
    prepared,
    execution,
    durationMs: Math.max(0, Date.now() - startedAt),
  };
}

async function prepareLspSource(
  options: LspDiagnosticsRunnerOptions,
  request: LspSourceRequest,
  label: string,
): Promise<PreparedLspSource> {
  if (
    !request.path ||
    path.isAbsolute(request.path) ||
    request.path.length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(request.path)
  ) {
    throw new Error(`${label} path must be workspace-relative`);
  }
  const timeoutMs = request.timeoutMs ?? DEFAULT_LSP_DIAGNOSTICS_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MIN_LSP_DIAGNOSTICS_TIMEOUT_MS ||
    timeoutMs > MAX_LSP_DIAGNOSTICS_TIMEOUT_MS
  ) {
    throw new Error(
      `${label} timeoutMs must be ${MIN_LSP_DIAGNOSTICS_TIMEOUT_MS}-${MAX_LSP_DIAGNOSTICS_TIMEOUT_MS}`,
    );
  }
  const workspaceRoot = await realpath(path.resolve(options.workspaceRoot));
  const lexicalTarget = path.resolve(workspaceRoot, request.path);
  if (!isPathInside(lexicalTarget, workspaceRoot)) {
    throw new Error(`${label} path escapes the workspace`);
  }
  const relativePath = path.relative(workspaceRoot, lexicalTarget);
  if (
    relativePath
      .split(path.sep)
      .filter(Boolean)
      .some(isProtectedWorkspacePathSegment)
  ) {
    throw new Error(`${label} path targets a protected workspace root`);
  }
  const target = await realpath(lexicalTarget);
  if (path.resolve(target) !== path.resolve(lexicalTarget)) {
    throw new Error(`${label} path must not traverse a symlink`);
  }
  if (!isPathInside(target, workspaceRoot)) {
    throw new Error(`${label} path resolves outside the workspace`);
  }
  const info = await stat(target);
  if (!info.isFile()) throw new Error(`${label} path must be a file`);
  if (info.size > MAX_LSP_DIAGNOSTIC_FILE_BYTES) {
    throw new Error(
      `${label} supports files up to ${MAX_LSP_DIAGNOSTIC_FILE_BYTES} bytes`,
    );
  }
  const language = lspDiagnosticLanguageForPath(relativePath);
  if (!language) {
    throw new Error(`${label} supports TypeScript and JavaScript source files`);
  }
  const buffer = await readFile(target);
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${label} target must be valid UTF-8`);
  }
  return {
    workspaceRoot,
    target,
    relativePath,
    language,
    source,
    fileSha256: sha256(buffer),
    fileBytes: buffer.byteLength,
    timeoutMs,
    assets: await resolveLspRuntimeAssets(options),
  };
}

function createProtocolRequest(
  prepared: PreparedLspSource,
  labels: { label: string; abortedMessage: string },
): LspProtocolSessionRequest {
  return {
    ...labels,
    workspaceRoot: prepared.workspaceRoot,
    target: prepared.target,
    language: prepared.language,
    source: prepared.source,
    timeoutMs: prepared.timeoutMs,
    typescriptServerPath: prepared.assets.typescriptServerPath,
    nodeExecutable: prepared.assets.nodeExecutable,
    languageServerPath: prepared.assets.languageServerPath,
    languageServerRoot: prepared.assets.languageServerRoot,
    typescriptRoot: prepared.assets.typescriptRoot,
    runtimeIdentitySha256: sha256(
      canonicalJson({
        nodeExecutableSha256: prepared.assets.nodeExecutableSha256,
        languageServerSha256: prepared.assets.languageServerSha256,
        typescriptServerSha256: prepared.assets.typescriptServerSha256,
      }),
    ),
  };
}

async function runOneShotSession<T>(
  sandbox: OsSandboxAdapter,
  prepared: PreparedLspSource,
  request: LspProtocolSessionRequest,
  prepareOperation: PrepareLspProtocolOperation<T>,
  additionalRuntimeReadPaths: string[] | undefined,
  signal?: AbortSignal,
): Promise<LspProtocolSessionResult<T>> {
  const runtimeReadPaths = await resolveLspRuntimeReadPaths(
    [prepared.assets.languageServerRoot, prepared.assets.typescriptRoot],
    additionalRuntimeReadPaths,
  );
  const child = await sandbox.launch({
    command: prepared.assets.nodeExecutable,
    args: [prepared.assets.languageServerPath, "--stdio", "--log-level", "1"],
    cwd: prepared.workspaceRoot,
    env: { ...LSP_FIXED_ENVIRONMENT },
    workspaceRoot: prepared.workspaceRoot,
    approvedCapabilities: ["process.spawn", "workspace.read"],
    runtimeReadPaths,
  });
  return runLspProtocolSession(child, request, prepareOperation, signal);
}

async function resolveLspRuntimeAssets(
  options: LspRuntimeAssetOptions,
): Promise<LspRuntimeAssets> {
  const nodeExecutable = await realpath(
    options.nodeExecutable ?? process.execPath,
  );
  const languageServerPath = await realpath(
    options.languageServerPath ??
      require.resolve("typescript-language-server/lib/cli.mjs"),
  );
  const typescriptServerPath = await realpath(
    options.typescriptServerPath ??
      require.resolve("typescript/lib/tsserver.js"),
  );
  const languageServerRoot = await realpath(
    path.resolve(languageServerPath, "../.."),
  );
  const typescriptRoot = await realpath(
    path.resolve(typescriptServerPath, "../.."),
  );
  const languageServerPackage = path.join(languageServerRoot, "package.json");
  const typescriptPackage = path.join(typescriptRoot, "package.json");
  const typescriptRuntime = path.join(
    path.dirname(typescriptServerPath),
    "typescript.js",
  );
  const [languageServerVersion, typescriptVersion] = await Promise.all([
    packageVersion(languageServerPackage, "TypeScript language server"),
    packageVersion(typescriptPackage, "TypeScript"),
  ]);
  const [nodeExecutableSha256, languageServerSha256, typescriptServerSha256] =
    await Promise.all([
      sha256File(nodeExecutable),
      assetSetSha256([
        ["package.json", languageServerPackage],
        ["lib/cli.mjs", languageServerPath],
      ]),
      typescriptAssetSetSha256(
        typescriptPackage,
        path.dirname(typescriptRuntime),
      ),
    ]);
  return {
    nodeExecutable,
    nodeExecutableSha256,
    languageServerPath,
    languageServerRoot,
    languageServerVersion,
    languageServerSha256,
    typescriptServerPath,
    typescriptRoot,
    typescriptVersion,
    typescriptServerSha256,
  };
}

async function assertLspRuntimeStable(
  assets: LspRuntimeAssets,
  label: string,
): Promise<void> {
  const current = await resolveLspRuntimeAssets({
    nodeExecutable: assets.nodeExecutable,
    languageServerPath: assets.languageServerPath,
    typescriptServerPath: assets.typescriptServerPath,
  });
  if (
    current.nodeExecutableSha256 !== assets.nodeExecutableSha256 ||
    current.languageServerVersion !== assets.languageServerVersion ||
    current.languageServerSha256 !== assets.languageServerSha256 ||
    current.typescriptVersion !== assets.typescriptVersion ||
    current.typescriptServerSha256 !== assets.typescriptServerSha256
  ) {
    throw new Error(`${label} runtime assets changed during execution`);
  }
}

async function assertLspTargetStable(
  target: string,
  expectedFileSha256: string,
  label: string,
): Promise<void> {
  let observedFileSha256: string | undefined;
  try {
    observedFileSha256 = await sha256File(target);
  } catch {
    throw new LspDiagnosticsTargetDriftError(
      expectedFileSha256,
      undefined,
      label,
    );
  }
  if (observedFileSha256 !== expectedFileSha256) {
    throw new LspDiagnosticsTargetDriftError(
      expectedFileSha256,
      observedFileSha256,
      label,
    );
  }
}

async function packageVersion(
  packageJsonPath: string,
  label: string,
): Promise<string> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(packageJsonPath, "utf8")) as unknown;
  } catch {
    throw new Error(`${label} package metadata is unavailable`);
  }
  if (!record(value) || typeof value["version"] !== "string") {
    throw new Error(`${label} package version is invalid`);
  }
  return value["version"];
}

async function assetSetSha256(
  assets: Array<[relativePath: string, absolutePath: string]>,
): Promise<string> {
  const entries = await Promise.all(
    assets.map(async ([relativePath, absolutePath]) => {
      const info = await stat(absolutePath);
      if (!info.isFile()) throw new Error("LSP runtime asset must be a file");
      return {
        path: relativePath,
        bytes: info.size,
        sha256: await sha256File(absolutePath),
      };
    }),
  );
  return sha256(canonicalJson(entries));
}

async function typescriptAssetSetSha256(
  packageJsonPath: string,
  libDirectory: string,
): Promise<string> {
  const runtimeFiles = await collectRuntimeFiles(libDirectory);
  const assets: Array<[relativePath: string, absolutePath: string]> = [
    ["package.json", packageJsonPath],
    ...runtimeFiles
      .map((absolutePath): [string, string] => [
        `lib/${path.relative(libDirectory, absolutePath).split(path.sep).join("/")}`,
        absolutePath,
      ])
      .sort((left, right) => left[0].localeCompare(right[0])),
  ];
  const entries = await Promise.all(
    assets.map(async ([relativePath, absolutePath]) => {
      const info = await stat(absolutePath);
      return {
        path: relativePath,
        bytes: info.size,
        sha256: await sha256File(absolutePath),
      };
    }),
  );
  const totalBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  if (totalBytes > MAX_TYPESCRIPT_RUNTIME_BYTES) {
    throw new Error("TypeScript runtime asset set exceeds its byte boundary");
  }
  return sha256(canonicalJson(entries));
}

async function collectRuntimeFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink() || /[\u0000-\u001f\u007f]/u.test(entry.name)) {
        throw new Error("TypeScript runtime asset set is invalid");
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
        if (files.length > MAX_TYPESCRIPT_RUNTIME_FILES) {
          throw new Error(
            "TypeScript runtime asset set exceeds its file boundary",
          );
        }
      } else {
        throw new Error("TypeScript runtime asset set is invalid");
      }
    }
  };
  await visit(root);
  return files;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
