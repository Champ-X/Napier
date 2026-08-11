import type { Readable, Writable } from "node:stream";

import type { ExtensionCapability } from "@napier/contracts";

export interface SandboxLaunchRequest {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  workspaceRoot: string;
  approvedCapabilities: ExtensionCapability[];
  runtimeReadPaths?: string[];
  workspaceWritePaths?: string[];
  parentDeathGuard?: boolean;
  stdinMode?: "open";
  signal?: AbortSignal;
  localService?: SandboxLocalServiceRequest;
  terminal?: {
    columns: number;
    rows: number;
  };
}

export interface SandboxLocalServiceRequest {
  protocol: "http";
  containerPort: number;
  healthPath: string;
}

export interface SandboxLocalServiceBinding {
  protocol: "http";
  containerPort: number;
  host: "127.0.0.1";
  hostPort: number;
  url: string;
  healthPathSha256: string;
  identitySha256: string;
  readyAt: string;
}

export interface SandboxedProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  localService?: SandboxLocalServiceBinding;
  resize?(columns: number, rows: number): Promise<void>;
  terminate(): Promise<void>;
}

export type SandboxCommandRuntime = "git" | "node" | "python" | "shell";

export interface SandboxCommandRuntimeBinding {
  runtime: SandboxCommandRuntime;
  executable: string;
  executableSha256: string;
  executableSearchPaths?: string[];
  runtimeIdentitySha256: string;
}

export interface SandboxLspRuntimeBinding {
  runtime: "lsp";
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
  runtimeIdentitySha256: string;
}

export interface SandboxNodeDebuggerRuntimeBinding {
  runtime: "node-debugger";
  nodeExecutable: string;
  nodeExecutableSha256: string;
  nodeVersion: string;
  runtimeIdentitySha256: string;
}

export interface SandboxVerificationRuntimeBinding {
  runtime: "verification";
  nodeExecutable: string;
  nodeExecutableSha256: string;
  toolchainRoot: string;
  packageJsonSha256: string;
  packageLockSha256: string;
  typecheckPath: string;
  typecheckVersion: string;
  typecheckSha256: string;
  testPath: string;
  testVersion: string;
  testSha256: string;
  formatPath: string;
  formatVersion: string;
  formatSha256: string;
  runtimeIdentitySha256: string;
}

export interface OsSandboxAdapter {
  readonly id: string;
  readonly readinessVersion?: number;
  readonly setupIdentitySha256?: string | undefined;
  resolveCommandRuntime?(
    runtime: SandboxCommandRuntime,
  ): Promise<SandboxCommandRuntimeBinding> | undefined;
  resolveLspRuntime?(): Promise<SandboxLspRuntimeBinding> | undefined;
  resolveNodeDebuggerRuntime?():
    | Promise<SandboxNodeDebuggerRuntimeBinding>
    | undefined;
  resolveVerificationRuntime?():
    | Promise<SandboxVerificationRuntimeBinding>
    | undefined;
  launch(request: SandboxLaunchRequest): Promise<SandboxedProcess>;
}

export interface PlatformSandboxOptions {
  containerImage?: string;
  containerExecutable?: string;
  preferContainer?: boolean;
}
