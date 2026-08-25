import {
  inspectBrowserUseLocalRuntime,
  resolveBrowserRuntime,
  RunBrowserSessionManager,
} from "@napier/runtime/browser";

import type {
  DoctorCheck,
  DoctorCredentialReferenceStatus,
} from "./doctor-check-model.js";

export async function defaultBrowserProbe(
  workspaceRoot: string,
  signal: AbortSignal,
): Promise<DoctorCheck> {
  const startedAt = Date.now();
  await resolveBrowserRuntime();
  const manager = new RunBrowserSessionManager({ workspaceRoot });
  const owner = { threadId: "thread_doctor", runId: "run_doctor" };
  try {
    const started = await manager.execute(
      owner,
      { action: "start", url: "https://example.com/" },
      signal,
    );
    await manager.execute(owner, { action: "close" }, signal);
    return {
      id: "browser",
      status: "passed",
      required: true,
      code: "browser_ready",
      message: "Sandboxed Chrome loaded one public page through the safe proxy",
      durationMs: Date.now() - startedAt,
      evidence: {
        executableSha256: started.details.browserExecutableSha256,
        destinationCount: started.details.network.destinationCount,
        chromiumSandbox: true,
      },
    };
  } finally {
    await manager.cancelRun(owner);
  }
}

export async function defaultBrowserUseLocalProbe(
  dataRoot: string,
  selected: boolean,
): Promise<DoctorCheck> {
  const startedAt = Date.now();
  const inspection = await inspectBrowserUseLocalRuntime(dataRoot);
  if (inspection.status === "ready") {
    return {
      id: "browser_use_local",
      status: "passed",
      required: selected,
      code: "browser_use_local_ready",
      message: `Browser Use local ${inspection.packageVersion} is ready with ${inspection.browserProduct?.replace("system_", "")} ${inspection.browserVersion}${selected ? " and selected" : " as an optional backend"}`,
      durationMs: Date.now() - startedAt,
      evidence: {
        backend: inspection.backend,
        packageVersion: inspection.packageVersion,
        pythonVersion: inspection.pythonVersion,
        browserProduct: inspection.browserProduct!,
        browserVersion: inspection.browserVersion!,
        telemetryDisabled: true,
        cloudSyncDisabled: true,
      },
    };
  }
  return {
    id: "browser_use_local",
    status: selected ? "failed" : "warning",
    required: selected,
    code:
      inspection.status === "installable"
        ? "browser_use_local_missing"
        : "browser_use_local_unsupported",
    message:
      inspection.status === "installable"
        ? "Browser Use local is available to install but is not ready"
        : "Browser Use local requires uv, a supported host, and an installed current Chrome or Chromium browser",
    durationMs: Date.now() - startedAt,
    evidence: {
      backend: inspection.backend,
      packageVersion: inspection.packageVersion,
      platform: inspection.platform,
      arch: inspection.arch,
    },
  };
}

export function defaultBrowserUseCloudProbe(
  env: Readonly<Record<string, string | undefined>>,
  credentialEnv: string,
  credentialReference?: DoctorCredentialReferenceStatus,
): DoctorCheck {
  const startedAt = Date.now();
  const environmentConfigured = Boolean(env[credentialEnv]?.trim());
  const configured =
    environmentConfigured || credentialReference === "available";
  const unavailable = !environmentConfigured && credentialReference === "error";
  return {
    id: "browser_use_cloud",
    status: configured ? "passed" : "failed",
    required: true,
    code: configured
      ? "browser_use_cloud_configured"
      : unavailable
        ? "browser_use_cloud_credential_unavailable"
        : "browser_use_cloud_credential_missing",
    message: configured
      ? `${environmentConfigured ? `Browser Use Cloud credential locator ${credentialEnv}` : "Browser Use Cloud active credential reference"} is configured; no billable readiness task was created`
      : unavailable
        ? "Browser Use Cloud active credential reference could not be resolved"
        : `Browser Use Cloud has no active credential reference and locator ${credentialEnv} is empty`,
    durationMs: Date.now() - startedAt,
    evidence: {
      backend: "browser_use_cloud",
      credentialStatus: configured
        ? "configured"
        : unavailable
          ? "unavailable"
          : "missing",
      credentialSource: environmentConfigured
        ? "environment_override"
        : "active_reference",
      apiVersion: "v2",
      workspaceAccess: "none",
      recording: "disabled",
      retentionPolicy: "provider_plan",
      readinessBilling: false,
    },
  };
}
