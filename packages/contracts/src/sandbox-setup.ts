export type SandboxSetupStatus =
  | "ready"
  | "pullable"
  | "buildable"
  | "runtime_unavailable"
  | "unsupported";

export type SandboxSetupAcquisition =
  | "local_verified"
  | "external_release"
  | "packaged_source";

export interface SandboxSetupChecks {
  node: string;
  resources: string;
  verification: string;
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
  acquisition: SandboxSetupAcquisition;
  active: boolean;
  imageReference: string;
  imageId?: string;
  releaseReference?: string;
  releaseDigest?: string;
  releaseSourceSha?: string;
  releaseReceiptSha256?: string;
  dockerfileSha256: string;
  contextSha256: string;
  platform: NodeJS.Platform;
  arch: string;
  contentSha256: string;
}

export interface ApplySandboxSetupRequest {
  expectedPreviewSha256: string;
}

export interface SandboxUninstallPreview {
  kind: "napier.sandbox-runtime-uninstall-preview";
  schemaVersion: 1;
  component: "sandbox";
  status: "installed" | "invalid" | "not_installed";
  active: boolean;
  imageRetained: true;
  bindingSha256?: string;
  imageReference?: string;
  imageId?: string;
  identitySha256?: string;
  installationSha256?: string;
  fallbackSandbox: string;
  contentSha256: string;
}

export interface ApplySandboxUninstallRequest {
  expectedPreviewSha256: string;
}

export interface SandboxUninstallResult {
  kind: "napier.sandbox-runtime-uninstall-result";
  schemaVersion: 1;
  component: "sandbox";
  action: "uninstalled";
  status: "removed";
  imageRetained: true;
  bindingSha256: string;
  imageReference?: string;
  imageId?: string;
  identitySha256?: string;
  installationSha256?: string;
  fallbackSandbox: string;
  contentSha256: string;
}

export interface SandboxSetupResult {
  kind: "napier.sandbox-runtime-setup-result";
  schemaVersion: 1;
  component: "sandbox";
  action: "built" | "pulled" | "repaired" | "reused";
  acquisition: SandboxSetupAcquisition;
  status: "ready";
  imageReference: string;
  imageId: string;
  releaseReference?: string;
  releaseDigest?: string;
  releaseSourceSha?: string;
  releaseReceiptSha256?: string;
  dockerfileSha256: string;
  contextSha256: string;
  identitySha256: string;
  installationSha256: string;
  checks: SandboxSetupChecks;
  contentSha256: string;
}
