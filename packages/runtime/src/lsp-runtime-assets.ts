import { createRequire } from "node:module";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { sha256File } from "./command-execution.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import type { SandboxLspRuntimeBinding } from "./sandbox-types.js";

const MAX_TYPESCRIPT_RUNTIME_FILES = 512;
const MAX_TYPESCRIPT_RUNTIME_BYTES = 64 * 1024 * 1024;
const require = createRequire(import.meta.url);

export interface LspRuntimeResolutionOptions {
  sandbox: OsSandboxAdapter;
  nodeExecutable?: string;
  languageServerPath?: string;
  typescriptServerPath?: string;
  runtimeReadPaths?: string[];
}

export interface LspRuntimeAssets {
  nodeExecutable: string;
  nodeExecutableSha256: string;
  protocolWorkspaceRoot?: string;
  languageServerPath: string;
  languageServerRoot: string;
  languageServerVersion: string;
  languageServerSha256: string;
  typescriptServerPath: string;
  typescriptRoot: string;
  typescriptVersion: string;
  typescriptServerSha256: string;
  runtimeIdentitySha256?: string;
}

interface HostLspRuntimeAssetOptions {
  nodeExecutable?: string;
  languageServerPath?: string;
  typescriptServerPath?: string;
}

export async function resolveLspRuntimeAssets(
  options: LspRuntimeResolutionOptions,
): Promise<LspRuntimeAssets> {
  const provider = await options.sandbox.resolveLspRuntime?.();
  if (provider) {
    validateLspProviderBinding(provider);
    if (
      options.nodeExecutable !== undefined ||
      options.languageServerPath !== undefined ||
      options.typescriptServerPath !== undefined ||
      (options.runtimeReadPaths?.length ?? 0) > 0
    ) {
      throw new Error(
        "Image-bound LSP runtime does not accept host asset overrides",
      );
    }
    return providerAssets(provider);
  }
  if (options.sandbox.id === "oci-container") {
    throw new Error("OCI image-bound LSP runtime identity is unavailable");
  }
  return resolveHostLspRuntimeAssets(options);
}

export async function assertLspRuntimeStable(
  assets: LspRuntimeAssets,
  label: string,
  sandbox?: OsSandboxAdapter,
): Promise<void> {
  if (assets.runtimeIdentitySha256) {
    const current = await sandbox?.resolveLspRuntime?.();
    if (
      !current ||
      current.runtimeIdentitySha256 !== assets.runtimeIdentitySha256
    ) {
      throw new Error(`${label} provider runtime identity changed`);
    }
    return;
  }
  const current = await resolveHostLspRuntimeAssets({
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

export function lspProviderRuntimeLimitEvidence(assets: LspRuntimeAssets): {
  providerRuntimeIdentitySha256?: string;
} {
  return assets.runtimeIdentitySha256
    ? { providerRuntimeIdentitySha256: assets.runtimeIdentitySha256 }
    : {};
}

async function resolveHostLspRuntimeAssets(
  options: HostLspRuntimeAssetOptions,
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

function providerAssets(binding: SandboxLspRuntimeBinding): LspRuntimeAssets {
  return {
    nodeExecutable: binding.nodeExecutable,
    nodeExecutableSha256: binding.nodeExecutableSha256,
    ...(binding.protocolWorkspaceRoot
      ? { protocolWorkspaceRoot: binding.protocolWorkspaceRoot }
      : {}),
    languageServerPath: binding.languageServerPath,
    languageServerRoot: binding.languageServerRoot,
    languageServerVersion: binding.languageServerVersion,
    languageServerSha256: binding.languageServerSha256,
    typescriptServerPath: binding.typescriptServerPath,
    typescriptRoot: binding.typescriptRoot,
    typescriptVersion: binding.typescriptVersion,
    typescriptServerSha256: binding.typescriptServerSha256,
    runtimeIdentitySha256: binding.runtimeIdentitySha256,
  };
}

function validateLspProviderBinding(binding: SandboxLspRuntimeBinding): void {
  const paths = [
    binding.nodeExecutable,
    binding.languageServerPath,
    binding.languageServerRoot,
    binding.typescriptServerPath,
    binding.typescriptRoot,
  ];
  const hashes = [
    binding.nodeExecutableSha256,
    binding.languageServerSha256,
    binding.typescriptServerSha256,
    binding.runtimeIdentitySha256,
  ];
  if (
    binding.runtime !== "lsp" ||
    paths.some(
      (candidate) =>
        !path.posix.isAbsolute(candidate) ||
        /[\u0000-\u001f\u007f]/u.test(candidate),
    ) ||
    hashes.some((candidate) => !/^[a-f0-9]{64}$/u.test(candidate)) ||
    (binding.protocolWorkspaceRoot !== undefined &&
      binding.protocolWorkspaceRoot !== "/workspace") ||
    !version(binding.languageServerVersion) ||
    !version(binding.typescriptVersion) ||
    !posixPathInside(binding.languageServerPath, binding.languageServerRoot) ||
    !posixPathInside(binding.typescriptServerPath, binding.typescriptRoot)
  ) {
    throw new Error("Provider LSP runtime identity is invalid");
  }
}

function posixPathInside(candidate: string, root: string): boolean {
  const relative = path.posix.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("../") &&
      relative !== ".." &&
      !path.posix.isAbsolute(relative))
  );
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
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile()) {
        files.push(absolutePath);
        if (files.length > MAX_TYPESCRIPT_RUNTIME_FILES) {
          throw new Error(
            "TypeScript runtime asset set exceeds its file boundary",
          );
        }
      } else throw new Error("TypeScript runtime asset set is invalid");
    }
  };
  await visit(root);
  return files;
}

function version(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,79}$/u.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
