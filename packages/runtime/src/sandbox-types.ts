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
  terminal?: {
    columns: number;
    rows: number;
  };
}

export interface SandboxedProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  resize?(columns: number, rows: number): Promise<void>;
  terminate(): Promise<void>;
}

export interface OsSandboxAdapter {
  readonly id: string;
  launch(request: SandboxLaunchRequest): Promise<SandboxedProcess>;
}

export interface PlatformSandboxOptions {
  containerImage?: string;
  containerExecutable?: string;
  preferContainer?: boolean;
}
