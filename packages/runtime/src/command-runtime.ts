import { createHash } from "node:crypto";
import {
  constants as fsConstants,
  createReadStream,
  type Stats,
} from "node:fs";
import { access, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  defaultShellExecutable,
  resolveShellCommandRuntimePaths,
} from "./shell-command-runtime.js";
export { shellInvocationArgs } from "./shell-command-runtime.js";

const MAX_RUNTIME_ASSET_FILES = 128;
const MAX_RUNTIME_READ_PATHS = 8;
const MACOS_PYTHON_CANDIDATES = [
  "/Library/Developer/CommandLineTools/usr/bin/python3",
  "/Applications/Xcode.app/Contents/Developer/usr/bin/python3",
] as const;
const UNIX_PYTHON_EXECUTABLE = "/usr/bin/python3";
const PYTHON_RUNTIME_REQUIRED_ASSETS = [
  "ast.py",
  "base64.py",
  "contextlib.py",
  "enum.py",
  "functools.py",
  "io.py",
  "json/__init__.py",
  "json/decoder.py",
  "json/encoder.py",
  "json/scanner.py",
  "operator.py",
  "os.py",
  "signal.py",
  "threading.py",
  "tracemalloc.py",
  "types.py",
] as const;
const PYTHON_RUNTIME_OPTIONAL_ASSETS = [
  "_bootlocale.py",
  "_collections_abc.py",
  "_compat_pickle.py",
  "_py_abc.py",
  "_weakrefset.py",
  "abc.py",
  "codecs.py",
  "collections/__init__.py",
  "collections/abc.py",
  "copyreg.py",
  "encodings/__init__.py",
  "encodings/aliases.py",
  "encodings/ascii.py",
  "encodings/cp437.py",
  "encodings/latin_1.py",
  "encodings/utf_16_le.py",
  "encodings/utf_8.py",
  "fnmatch.py",
  "genericpath.py",
  "heapq.py",
  "keyword.py",
  "linecache.py",
  "pickle.py",
  "posixpath.py",
  "re.py",
  "re/__init__.py",
  "re/_casefix.py",
  "re/_compiler.py",
  "re/_constants.py",
  "re/_parser.py",
  "reprlib.py",
  "sre_compile.py",
  "sre_constants.py",
  "sre_parse.py",
  "stat.py",
  "struct.py",
  "token.py",
  "tokenize.py",
  "traceback.py",
  "warnings.py",
  "weakref.py",
] as const;
const PYTHON_RUNTIME_EXTENSION_PREFIXES = [
  "_heapq.",
  "_json.",
  "_pickle.",
  "_struct.",
  "binascii.",
  "resource.",
  "zlib.",
] as const;

export type CommandRuntime = "node" | "python" | "shell";

export interface CommandRuntimeAsset {
  path: string;
  sha256: string;
}

export interface CommandRuntimeBinding {
  executable: string;
  executableSha256: string;
  executableSearchPaths?: string[];
  runtimeReadPaths: string[];
  runtimeAssets: CommandRuntimeAsset[];
  runtimeAssetSetSha256?: string;
}

export interface CommandRuntimeReadPathIdentity {
  path: string;
  device: number;
  inode: number;
}

export async function resolveCommandRuntimeBinding(
  runtime: CommandRuntime,
  overrides?: Partial<Record<CommandRuntime, string>>,
): Promise<CommandRuntimeBinding> {
  const candidate =
    overrides?.[runtime] ??
    (runtime === "node"
      ? process.execPath
      : runtime === "python"
        ? await defaultPythonExecutable(process.platform)
        : await defaultShellExecutable(process.platform));
  if (!path.isAbsolute(candidate)) {
    throw new Error(`${runtime} executable must use an absolute path`);
  }
  try {
    await access(candidate, fsConstants.X_OK);
  } catch {
    throw new Error(`${runtime} runtime is unavailable`);
  }
  let resolved: string;
  let executableSha256: string;
  try {
    resolved = await realpath(candidate);
    if (!(await stat(resolved)).isFile()) throw new Error();
    executableSha256 = await sha256File(resolved);
  } catch {
    throw new Error(`${runtime} runtime is unavailable`);
  }
  if (runtime === "node") {
    return {
      executable: resolved,
      executableSha256,
      runtimeReadPaths: [],
      runtimeAssets: [],
    };
  }
  if (runtime === "shell") {
    const nodeExecutable = overrides?.node ?? process.execPath;
    const paths = await resolveShellCommandRuntimePaths(
      resolved,
      process.platform,
      nodeExecutable,
    );
    let nodeAsset: CommandRuntimeAsset;
    try {
      const nodePath = await realpath(nodeExecutable);
      if (!(await stat(nodePath)).isFile()) throw new Error();
      nodeAsset = { path: nodePath, sha256: await sha256File(nodePath) };
    } catch {
      throw new Error("shell Node command runtime is unavailable");
    }
    return {
      executable: resolved,
      executableSha256,
      executableSearchPaths: paths.executableSearchPaths,
      runtimeReadPaths: paths.runtimeReadPaths,
      runtimeAssets: [nodeAsset],
      runtimeAssetSetSha256: runtimeAssetSetSha256([nodeAsset]),
    };
  }
  const runtimeRoot = await pythonRuntimeRoot(resolved, process.platform);
  let runtimeAssets: CommandRuntimeAsset[];
  try {
    runtimeAssets = await pythonRuntimeAssets(runtimeRoot);
  } catch {
    throw new Error("python runtime assets are unavailable");
  }
  return {
    executable: resolved,
    executableSha256,
    runtimeReadPaths: [runtimeRoot],
    runtimeAssets,
    runtimeAssetSetSha256: runtimeAssetSetSha256(runtimeAssets),
  };
}

function runtimeAssetSetSha256(runtimeAssets: CommandRuntimeAsset[]): string {
  return sha256(
    canonicalJson(
      runtimeAssets.map((asset) => ({
        pathSha256: sha256(asset.path),
        sha256: asset.sha256,
      })),
    ),
  );
}

export async function resolveCommandRuntimeReadPaths(
  values: string[],
): Promise<{
  paths: string[];
  identities: CommandRuntimeReadPathIdentity[];
  setSha256: string;
}> {
  if (
    values.length > MAX_RUNTIME_READ_PATHS ||
    values.some(
      (candidate) =>
        typeof candidate !== "string" ||
        !candidate ||
        !path.isAbsolute(candidate) ||
        /[\u0000-\u001f\u007f]/u.test(candidate),
    )
  ) {
    throw new Error("command runtime read paths are invalid");
  }
  const identities: CommandRuntimeReadPathIdentity[] = [];
  for (const candidate of values) {
    let canonical: string;
    let info: Stats;
    try {
      canonical = await realpath(path.resolve(candidate));
      info = await stat(canonical);
    } catch {
      throw new Error("command runtime read path is unavailable");
    }
    if (!info.isFile() && !info.isDirectory()) {
      throw new Error("command runtime read path is unavailable");
    }
    identities.push({
      path: canonical,
      device: info.dev,
      inode: info.ino,
    });
  }
  const unique = new Map(
    identities.map((identity) => [identity.path, identity]),
  );
  const sorted = [...unique.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  if (sorted.length > MAX_RUNTIME_READ_PATHS) {
    throw new Error("command runtime read paths exceed their limit");
  }
  return {
    paths: sorted.map((identity) => identity.path),
    identities: sorted,
    setSha256: sha256(
      canonicalJson(
        sorted.map((identity) => ({
          pathSha256: sha256(identity.path),
          device: identity.device,
          inode: identity.inode,
        })),
      ),
    ),
  };
}

export async function assertCommandRuntimeBindingStable(input: {
  executable: string;
  executableSha256: string;
  runtimeAssets: CommandRuntimeAsset[];
  runtimeReadPathIdentities: CommandRuntimeReadPathIdentity[];
}): Promise<void> {
  let executableSha256: string;
  try {
    executableSha256 = await sha256File(input.executable);
  } catch {
    throw new Error("command runtime changed during execution");
  }
  if (executableSha256 !== input.executableSha256) {
    throw new Error("command runtime changed during execution");
  }
  for (const asset of input.runtimeAssets) {
    let observed: string;
    try {
      observed = await sha256File(asset.path);
    } catch {
      throw new Error("command runtime assets changed during execution");
    }
    if (observed !== asset.sha256) {
      throw new Error("command runtime assets changed during execution");
    }
  }
  for (const identity of input.runtimeReadPathIdentities) {
    try {
      const canonical = await realpath(identity.path);
      const info = await stat(canonical);
      if (
        canonical !== identity.path ||
        info.dev !== identity.device ||
        info.ino !== identity.inode
      ) {
        throw new Error("not canonical");
      }
    } catch {
      throw new Error("command runtime read path changed during execution");
    }
  }
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", resolve);
    stream.once("error", reject);
  });
  return hash.digest("hex");
}

async function defaultPythonExecutable(
  platform: NodeJS.Platform,
): Promise<string> {
  const candidates =
    platform === "darwin"
      ? MACOS_PYTHON_CANDIDATES
      : ([UNIX_PYTHON_EXECUTABLE] as const);
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next fixed system location.
    }
  }
  throw new Error("python runtime is unavailable");
}

async function pythonRuntimeRoot(
  executable: string,
  platform: NodeJS.Platform,
): Promise<string> {
  if (platform === "darwin") {
    const versionRoot = path.resolve(executable, "../..");
    const frameworkMarker = "/Library/Frameworks/Python3.framework/Versions/";
    if (
      !versionRoot.includes(frameworkMarker) ||
      !/^python3(?:\.\d+)?$/u.test(path.basename(executable))
    ) {
      throw new Error(
        "python runtime must use a recognized Xcode or Command Line Tools executable",
      );
    }
    try {
      const resolved = await realpath(versionRoot);
      if (!(await stat(resolved)).isDirectory()) throw new Error();
      return resolved;
    } catch {
      throw new Error("python runtime assets are unavailable");
    }
  }
  if (platform === "linux") {
    const version = path.basename(executable).match(/^python(\d+\.\d+)$/u)?.[1];
    if (!version) {
      throw new Error("python runtime executable version is unavailable");
    }
    const candidates = [
      `/usr/lib/python${version}`,
      `/usr/local/lib/python${version}`,
    ];
    for (const candidate of candidates) {
      try {
        const resolved = await realpath(candidate);
        if ((await stat(resolved)).isDirectory()) return resolved;
      } catch {
        // Try the next fixed library root.
      }
    }
  }
  throw new Error(`python runtime assets are unavailable on ${platform}`);
}

async function pythonRuntimeAssets(
  runtimeRoot: string,
): Promise<CommandRuntimeAsset[]> {
  let stdlib = runtimeRoot;
  const paths: string[] = [];
  if (!/^python\d+\.\d+$/u.test(path.basename(runtimeRoot))) {
    const libraryRoot = path.join(runtimeRoot, "lib");
    const versions = (await readdir(libraryRoot, { withFileTypes: true }))
      .filter(
        (entry) => entry.isDirectory() && /^python\d+\.\d+$/u.test(entry.name),
      )
      .map((entry) => entry.name)
      .sort();
    const version = versions.at(-1);
    if (!version) throw new Error("python stdlib version is unavailable");
    stdlib = path.join(libraryRoot, version);
    paths.push(path.join(runtimeRoot, "Python3"));
  }
  for (const relative of PYTHON_RUNTIME_REQUIRED_ASSETS) {
    await addPythonRuntimeAsset(paths, stdlib, relative, true);
  }
  for (const relative of PYTHON_RUNTIME_OPTIONAL_ASSETS) {
    await addPythonRuntimeAsset(paths, stdlib, relative, false);
  }
  const extensionRoot = path.join(stdlib, "lib-dynload");
  for (const entry of await readdir(extensionRoot, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      PYTHON_RUNTIME_EXTENSION_PREFIXES.some((prefix) =>
        entry.name.startsWith(prefix),
      )
    ) {
      paths.push(path.join(extensionRoot, entry.name));
    }
  }
  const unique = [...new Set(paths)].sort();
  if (unique.length > MAX_RUNTIME_ASSET_FILES) {
    throw new Error("python runtime assets exceed the file limit");
  }
  return Promise.all(
    unique.map(async (assetPath) => {
      const resolved = await realpath(assetPath);
      if (!(await stat(resolved)).isFile()) throw new Error();
      return { path: resolved, sha256: await sha256File(resolved) };
    }),
  );
}

async function addPythonRuntimeAsset(
  paths: string[],
  stdlib: string,
  relative: string,
  required: boolean,
): Promise<void> {
  const source = path.join(stdlib, relative);
  try {
    if (!(await stat(source)).isFile()) throw new Error();
    paths.push(source);
  } catch {
    if (required) throw new Error("python runtime asset is unavailable");
    return;
  }
  if (!source.endsWith(".py")) return;
  const cacheRoot = path.join(path.dirname(source), "__pycache__");
  const prefix = `${path.basename(source, ".py")}.`;
  let entries;
  try {
    entries = await readdir(cacheRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (
      entry.isFile() &&
      entry.name.startsWith(prefix) &&
      entry.name.endsWith(".pyc")
    ) {
      paths.push(path.join(cacheRoot, entry.name));
    }
  }
}
