import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { LspDiagnosticLanguage } from "@napier/contracts";

import { sha256File } from "./command-execution.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  assertLspRuntimeStable,
  resolveLspRuntimeAssets,
  type LspRuntimeAssets,
  type LspRuntimeResolutionOptions,
} from "./lsp-runtime-assets.js";
import {
  type LspProtocolExecutor,
  type LspProtocolSessionRequest,
  type LspProtocolSessionResult,
  type PrepareLspProtocolOperation,
  runLspProtocolSession,
} from "./lsp-protocol-session.js";
import { createLspProtocolPathBinding } from "./lsp-protocol-path-binding.js";
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

export interface LspSourceRequest {
  path: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LspDiagnosticsRunnerOptions extends LspRuntimeResolutionOptions {
  workspaceRoot: string;
  session?: LspProtocolExecutor;
}

export type { LspRuntimeAssets } from "./lsp-runtime-assets.js";

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
  protocolTargetUri: string;
  toHostUri(uri: string): string | undefined;
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
  await assertLspRuntimeStable(prepared.assets, labels.label, options.sandbox);
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
  const assets = await resolveLspRuntimeAssets(options);
  const pathBinding = createLspProtocolPathBinding({
    workspaceRoot,
    target,
    ...(assets.protocolWorkspaceRoot
      ? { protocolWorkspaceRoot: assets.protocolWorkspaceRoot }
      : {}),
  });
  return {
    workspaceRoot,
    target,
    relativePath,
    language,
    source,
    fileSha256: sha256(buffer),
    fileBytes: buffer.byteLength,
    timeoutMs,
    assets,
    protocolTargetUri: pathBinding.targetUri,
    toHostUri: pathBinding.toHostUri,
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
    runtimeIdentitySha256:
      prepared.assets.runtimeIdentitySha256 ??
      sha256(
        canonicalJson({
          nodeExecutableSha256: prepared.assets.nodeExecutableSha256,
          languageServerSha256: prepared.assets.languageServerSha256,
          typescriptServerSha256: prepared.assets.typescriptServerSha256,
        }),
      ),
    runtimeLocation: prepared.assets.runtimeIdentitySha256
      ? "provider"
      : "host",
    ...(prepared.assets.protocolWorkspaceRoot
      ? { protocolWorkspaceRoot: prepared.assets.protocolWorkspaceRoot }
      : {}),
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
  const runtimeReadPaths = prepared.assets.runtimeIdentitySha256
    ? []
    : await resolveLspRuntimeReadPaths(
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
    stdinMode: "open",
    ...(runtimeReadPaths.length > 0 ? { runtimeReadPaths } : {}),
  });
  return runLspProtocolSession(child, request, prepareOperation, signal);
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

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
