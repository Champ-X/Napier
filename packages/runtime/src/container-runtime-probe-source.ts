import {
  NODE_DEBUGGER_RUNTIME_PROBE_ARGUMENTS,
  NODE_DEBUGGER_RUNTIME_PROBE_MARKER,
} from "./node-debugger-runtime-probe-source.js";

const PYTHON_RUNTIME_PROBE_SOURCE = [
  "import ast,base64,builtins,json,os,resource,signal,sys,threading,time,tracemalloc,types,zlib",
  'print(json.dumps({"executable":os.path.realpath(sys.executable),"version":".".join(str(value) for value in sys.version_info[:3])}))',
].join("\n");

export const CONTAINER_RUNTIME_IDENTITY_SOURCE = String.raw`
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const module_ = require("node:module");
const path = require("node:path");
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const hashJson = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identity = (file) => { const executable = fs.realpathSync(file); return { executable, executableSha256: hash(executable) }; };
const packageMetadata = (root, name) => {
  const file = fs.realpathSync(path.join(root, "package.json"));
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value.name !== name || typeof value.version !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,79}$/.test(value.version)) throw new Error("invalid package");
  return { file, version: value.version };
};
const assetSetHash = (entries) => hashJson(entries.map(([relativePath, file]) => {
  const canonical = fs.realpathSync(file);
  const info = fs.statSync(canonical);
  if (!info.isFile()) throw new Error("invalid asset");
  return { path: relativePath, bytes: info.size, sha256: hash(canonical) };
}));
const typescriptAssetHash = (packageFile, libRoot) => {
  const files = [];
  let totalBytes = 0;
  const visit = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink() || /[\u0000-\u001f\u007f]/.test(entry.name)) throw new Error("invalid asset");
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        const info = fs.statSync(absolute);
        totalBytes += info.size;
        files.push(absolute);
        if (files.length > 512 || totalBytes > 64 * 1024 * 1024) throw new Error("asset limit");
      } else throw new Error("invalid asset");
    }
  };
  visit(libRoot);
  return assetSetHash([
    ["package.json", packageFile],
    ...files.map((file) => ["lib/" + path.relative(libRoot, file).split(path.sep).join("/"), file]),
  ]);
};
let shell = null;
try { shell = identity("/bin/sh"); } catch {}
let git = null;
const gitCandidates = [...new Set([
  "/usr/bin/git",
  "/usr/local/bin/git",
  "/opt/homebrew/bin/git",
  ...(process.env.PATH || "/usr/local/bin:/usr/bin:/bin").split(path.delimiter).filter(path.isAbsolute).map((directory) => path.join(directory, "git")),
])];
for (const candidate of gitCandidates) {
  try {
    const result = childProcess.spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      env: { CI: "1", LANG: "C", LC_ALL: "C", NO_COLOR: "1" },
      timeout: 2000,
      maxBuffer: 512,
      windowsHide: true,
    });
    if (result.status !== 0) continue;
    const version = result.stdout.trim();
    if (!/^git version [^\u0000-\u001f\u007f]{1,160}$/.test(version)) continue;
    git = { ...identity(candidate), version };
    break;
  } catch {}
}
let lsp = null;
const moduleRoots = [...new Set([
  "/opt/napier/node_modules",
  "/usr/local/lib/node_modules",
  "/usr/lib/node_modules",
  ...module_.globalPaths.filter(path.isAbsolute),
])];
for (const moduleRoot of moduleRoots) {
  try {
    const languageServerPath = fs.realpathSync(path.join(moduleRoot, "typescript-language-server/lib/cli.mjs"));
    const typescriptServerPath = fs.realpathSync(path.join(moduleRoot, "typescript/lib/tsserver.js"));
    const languageServerRoot = fs.realpathSync(path.resolve(languageServerPath, "../.."));
    const typescriptRoot = fs.realpathSync(path.resolve(typescriptServerPath, "../.."));
    const languageServerPackage = packageMetadata(languageServerRoot, "typescript-language-server");
    const typescriptPackage = packageMetadata(typescriptRoot, "typescript");
    lsp = {
      languageServerPath,
      languageServerRoot,
      languageServerVersion: languageServerPackage.version,
      languageServerSha256: assetSetHash([["package.json", languageServerPackage.file], ["lib/cli.mjs", languageServerPath]]),
      typescriptServerPath,
      typescriptRoot,
      typescriptVersion: typescriptPackage.version,
      typescriptServerSha256: typescriptAssetHash(typescriptPackage.file, path.dirname(typescriptServerPath)),
    };
    break;
  } catch {}
}
let verification = null;
for (const moduleRoot of moduleRoots) {
  try {
    const toolchainRoot = fs.realpathSync(path.dirname(moduleRoot));
    const rootPackage = packageMetadata(toolchainRoot, "napier-sandbox-toolchain");
    const packageLockPath = fs.realpathSync(path.join(toolchainRoot, "package-lock.json"));
    const packageLockInfo = fs.statSync(packageLockPath);
    if (!packageLockInfo.isFile() || packageLockInfo.size > 4 * 1024 * 1024) throw new Error("invalid package lock");
    const verifier = (name, relativePath) => {
      const root = fs.realpathSync(path.join(moduleRoot, name));
      const metadata = packageMetadata(root, name);
      const executable = fs.realpathSync(path.join(root, relativePath));
      return {
        path: executable,
        version: metadata.version,
        sha256: assetSetHash([
          ["package.json", metadata.file],
          [relativePath, executable],
        ]),
      };
    };
    verification = {
      toolchainRoot,
      packageJsonSha256: hash(rootPackage.file),
      packageLockSha256: hash(packageLockPath),
      typecheck: verifier("typescript", "bin/tsc"),
      test: verifier("vitest", "vitest.mjs"),
      format: verifier("prettier", "bin/prettier.cjs"),
    };
    break;
  } catch {}
}
let debugger_ = null;
try {
  const result = childProcess.spawnSync(process.execPath, ${JSON.stringify([...NODE_DEBUGGER_RUNTIME_PROBE_ARGUMENTS])}, {
    encoding: "utf8",
    env: { CI: "1", LANG: "C", LC_ALL: "C", NO_COLOR: "1" },
    timeout: 2500,
    maxBuffer: 2048,
    windowsHide: true,
  });
  if (result.status === 0 && result.stderr === "") {
    const observed = JSON.parse(result.stdout);
    if (observed.marker === ${JSON.stringify(NODE_DEBUGGER_RUNTIME_PROBE_MARKER)} && typeof observed.nodeVersion === "string") {
      debugger_ = { nodeVersion: observed.nodeVersion };
    }
  }
} catch {}
let python = null;
for (const candidate of ["/usr/local/bin/python3", "/usr/bin/python3", "/opt/conda/bin/python3", "python3"]) {
  try {
    const result = childProcess.spawnSync(candidate, ["-I", "-B", "-S", "-c", ${JSON.stringify(PYTHON_RUNTIME_PROBE_SOURCE)}], {
      encoding: "utf8",
      env: {
        CI: "1",
        LANG: "C",
        LC_ALL: "C",
        PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONHASHSEED: "0",
        PYTHONNOUSERSITE: "1",
      },
      timeout: 2000,
      maxBuffer: 2048,
      windowsHide: true,
    });
    if (result.status !== 0) continue;
    const observed = JSON.parse(result.stdout);
    if (typeof observed.executable !== "string" || typeof observed.version !== "string") continue;
    python = { ...identity(observed.executable), version: observed.version };
    break;
  } catch {}
}
process.stdout.write(JSON.stringify({ node: identity(process.execPath), shell, git, lsp, verification, debugger: debugger_, python }));
`;
