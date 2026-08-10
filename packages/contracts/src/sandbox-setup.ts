export type SandboxSetupStatus =
  | "ready"
  | "buildable"
  | "runtime_unavailable"
  | "unsupported";

export interface SandboxSetupChecks {
  node: string;
  shell: string;
  python: string;
  git: string;
  lsp: string;
  dap: string;
  service: string;
}

export interface SandboxSetupPreview {
  kind: "napier.sandbox-runtime-setup-preview";
  schemaVersion: 1;
  component: "sandbox";
  status: SandboxSetupStatus;
  active: boolean;
  imageReference: string;
  imageId?: string;
  dockerfileSha256: string;
  contextSha256: string;
  platform: NodeJS.Platform;
  arch: string;
  contentSha256: string;
}

export interface ApplySandboxSetupRequest {
  expectedPreviewSha256: string;
}

export interface SandboxSetupResult {
  kind: "napier.sandbox-runtime-setup-result";
  schemaVersion: 1;
  component: "sandbox";
  action: "built" | "reused";
  status: "ready";
  imageReference: string;
  imageId: string;
  dockerfileSha256: string;
  contextSha256: string;
  identitySha256: string;
  installationSha256: string;
  checks: SandboxSetupChecks;
  contentSha256: string;
}
