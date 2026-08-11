import path from "node:path";

const FILE_SHA256 = /^[a-f0-9]{64}$/u;
const VISIBLE_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,79}$/u;

export interface ContainerExecutableIdentity {
  executable: string;
  executableSha256: string;
}

export interface ContainerPythonIdentity extends ContainerExecutableIdentity {
  version: string;
}

export interface ContainerGitIdentity extends ContainerExecutableIdentity {
  version: string;
}

export interface ContainerLspIdentity {
  languageServerPath: string;
  languageServerRoot: string;
  languageServerVersion: string;
  languageServerSha256: string;
  typescriptServerPath: string;
  typescriptRoot: string;
  typescriptVersion: string;
  typescriptServerSha256: string;
}

export interface ContainerNodeDebuggerIdentity {
  nodeVersion: string;
}

export interface ContainerVerificationIdentity {
  toolchainRoot: string;
  packageJsonSha256: string;
  packageLockSha256: string;
  typecheck: ContainerVerifierIdentity;
  test: ContainerVerifierIdentity;
  format: ContainerVerifierIdentity;
}

export interface ContainerVerifierIdentity {
  path: string;
  version: string;
  sha256: string;
}

export interface ContainerRuntimeIdentityOutput {
  node: ContainerExecutableIdentity;
  shell: ContainerExecutableIdentity | null;
  git: ContainerGitIdentity | null;
  lsp: ContainerLspIdentity | null;
  verification: ContainerVerificationIdentity | null;
  debugger: ContainerNodeDebuggerIdentity | null;
  python: ContainerPythonIdentity | null;
}

export function parseContainerRuntimeIdentity(
  output: string,
): ContainerRuntimeIdentityOutput {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error("OCI container runtime identity output is invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OCI container runtime identity output is invalid");
  }
  const record = value as Record<string, unknown>;
  return {
    node: executableIdentity(record["node"]),
    shell:
      record["shell"] === null ? null : executableIdentity(record["shell"]),
    git: record["git"] === null ? null : gitExecutableIdentity(record["git"]),
    lsp: record["lsp"] === null ? null : lspIdentity(record["lsp"]),
    verification:
      record["verification"] === null
        ? null
        : verificationIdentity(record["verification"]),
    debugger:
      record["debugger"] === null
        ? null
        : nodeDebuggerIdentity(record["debugger"]),
    python:
      record["python"] === null
        ? null
        : pythonExecutableIdentity(record["python"]),
  };
}

function verificationIdentity(value: unknown): ContainerVerificationIdentity {
  if (!record(value)) {
    throw new Error("OCI container verification identity is invalid");
  }
  const result = {
    toolchainRoot: absolutePath(value["toolchainRoot"]),
    packageJsonSha256: fileSha256(value["packageJsonSha256"]),
    packageLockSha256: fileSha256(value["packageLockSha256"]),
    typecheck: verifierIdentity(value["typecheck"]),
    test: verifierIdentity(value["test"]),
    format: verifierIdentity(value["format"]),
  };
  if (
    !isInside(result.typecheck.path, result.toolchainRoot) ||
    !isInside(result.test.path, result.toolchainRoot) ||
    !isInside(result.format.path, result.toolchainRoot)
  ) {
    throw new Error("OCI container verification identity is invalid");
  }
  return result;
}

function verifierIdentity(value: unknown): ContainerVerifierIdentity {
  if (!record(value)) {
    throw new Error("OCI container verifier identity is invalid");
  }
  return {
    path: absolutePath(value["path"]),
    version: visibleVersion(value["version"]),
    sha256: fileSha256(value["sha256"]),
  };
}

function nodeDebuggerIdentity(value: unknown): ContainerNodeDebuggerIdentity {
  if (!record(value) || typeof value["nodeVersion"] !== "string") {
    throw new Error("OCI container Node debugger identity is invalid");
  }
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value["nodeVersion"]);
  if (
    !match ||
    Number(match[1]) < 22 ||
    (Number(match[1]) === 22 && Number(match[2]) < 19)
  ) {
    throw new Error("OCI container Node debugger identity is invalid");
  }
  return { nodeVersion: value["nodeVersion"] };
}

function lspIdentity(value: unknown): ContainerLspIdentity {
  if (!record(value)) {
    throw new Error("OCI container LSP identity is invalid");
  }
  const result = {
    languageServerPath: absolutePath(value["languageServerPath"]),
    languageServerRoot: absolutePath(value["languageServerRoot"]),
    languageServerVersion: visibleVersion(value["languageServerVersion"]),
    languageServerSha256: fileSha256(value["languageServerSha256"]),
    typescriptServerPath: absolutePath(value["typescriptServerPath"]),
    typescriptRoot: absolutePath(value["typescriptRoot"]),
    typescriptVersion: visibleVersion(value["typescriptVersion"]),
    typescriptServerSha256: fileSha256(value["typescriptServerSha256"]),
  };
  if (
    !isInside(result.languageServerPath, result.languageServerRoot) ||
    !isInside(result.typescriptServerPath, result.typescriptRoot)
  ) {
    throw new Error("OCI container LSP identity is invalid");
  }
  return result;
}

function gitExecutableIdentity(value: unknown): ContainerGitIdentity {
  const executable = executableIdentity(value);
  const version = record(value) ? value["version"] : undefined;
  if (
    typeof version !== "string" ||
    !/^git version [^\u0000-\u001f\u007f]{1,160}$/u.test(version)
  ) {
    throw new Error("OCI container Git identity is invalid");
  }
  return { ...executable, version };
}

function pythonExecutableIdentity(value: unknown): ContainerPythonIdentity {
  const executable = executableIdentity(value);
  const version = record(value) ? value["version"] : undefined;
  if (typeof version !== "string") {
    throw new Error("OCI container Python identity is invalid");
  }
  const match = /^3\.(\d+)\.(\d+)$/u.exec(version);
  if (!match || Number(match[1]) < 9) {
    throw new Error("OCI container Python identity is invalid");
  }
  return { ...executable, version };
}

function executableIdentity(value: unknown): ContainerExecutableIdentity {
  if (!record(value)) {
    throw new Error("OCI container executable identity is invalid");
  }
  return {
    executable: absolutePath(value["executable"]),
    executableSha256: fileSha256(value["executableSha256"]),
  };
}

function absolutePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !path.posix.isAbsolute(value) ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error("OCI container runtime path identity is invalid");
  }
  return value;
}

function fileSha256(value: unknown): string {
  if (typeof value !== "string" || !FILE_SHA256.test(value)) {
    throw new Error("OCI container runtime hash identity is invalid");
  }
  return value;
}

function visibleVersion(value: unknown): string {
  if (typeof value !== "string" || !VISIBLE_VERSION.test(value)) {
    throw new Error("OCI container runtime version identity is invalid");
  }
  return value;
}

function isInside(candidate: string, root: string): boolean {
  const relative = path.posix.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("../") &&
      relative !== ".." &&
      !path.posix.isAbsolute(relative))
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
