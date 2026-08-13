import type { DoctorCheck } from "./doctor-check-model.js";

export type DoctorRemediationPriority = "required" | "optional";

export interface DoctorRemediation {
  id: string;
  priority: DoctorRemediationPriority;
  checkIds: DoctorCheck["id"][];
  codes: string[];
  instruction: string;
  verifyCommand: string;
  automatic: false;
}

interface RemediationSpec {
  id: string;
  instruction: string;
  verifyCommand: string;
}

const REMEDIATION_BY_CODE: Readonly<Record<string, RemediationSpec>> = {
  runtime_unavailable: {
    id: "repair_runtime",
    instruction:
      "Install or select a supported Node runtime, then rerun the offline readiness checks.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  node_version_unsupported: {
    id: "upgrade_node",
    instruction:
      "Install Node 22.19 or newer from a trusted distribution, then rerun Doctor.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  model_not_selected: {
    id: "select_model",
    instruction:
      "Select a catalog model for a conclusive check. Doctor uses its active credential reference by default; --credential-env remains an override.",
    verifyCommand:
      "napier doctor --workspace 'WORKSPACE_PATH' --model 'PROVIDER/MODEL_ID'",
  },
  model_unknown: {
    id: "select_catalog_model",
    instruction:
      "Choose a model from the installed catalog before starting a live task.",
    verifyCommand:
      "napier doctor --workspace 'WORKSPACE_PATH' --model 'PROVIDER/MODEL_ID' --credential-env 'CREDENTIAL_ENV_VAR'",
  },
  credential_not_checked: {
    id: "check_model_credential",
    instruction:
      "Name the selected model credential environment variable without passing its value in argv.",
    verifyCommand:
      "napier doctor --workspace 'WORKSPACE_PATH' --model 'PROVIDER/MODEL_ID' --credential-env 'CREDENTIAL_ENV_VAR'",
  },
  credential_reference_missing: {
    id: "configure_model_credential_reference",
    instruction:
      "Add an active credential in Web Context → Credentials, or rerun Doctor with an environment-variable override.",
    verifyCommand:
      "napier doctor --workspace 'WORKSPACE_PATH' --model 'PROVIDER/MODEL_ID'",
  },
  credential_reference_unavailable: {
    id: "repair_model_credential_reference",
    instruction:
      "Repair the selected provider's active environment or keychain reference in Web Context → Credentials, then rerun Doctor.",
    verifyCommand:
      "napier doctor --workspace 'WORKSPACE_PATH' --model 'PROVIDER/MODEL_ID'",
  },
  credential_missing: {
    id: "configure_model_credential",
    instruction:
      "Set the selected provider credential in the parent environment; never pass the secret value in argv.",
    verifyCommand:
      "napier doctor --workspace 'WORKSPACE_PATH' --model 'PROVIDER/MODEL_ID' --credential-env 'CREDENTIAL_ENV_VAR'",
  },
  model_check_unavailable: {
    id: "retry_model_check",
    instruction:
      "Confirm the model reference and environment locator, then rerun the bounded model check.",
    verifyCommand:
      "napier doctor --workspace 'WORKSPACE_PATH' --model 'PROVIDER/MODEL_ID' --credential-env 'CREDENTIAL_ENV_VAR'",
  },
  sandbox_unavailable: {
    id: "repair_process_sandbox",
    instruction:
      "Use a supported host sandbox before coding or process tasks; those capabilities fail closed without it.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  sandbox_container_available: {
    id: "enable_container_sandbox",
    instruction:
      "A local container runtime is ready. Run napier setup --workspace 'WORKSPACE_PATH' --component sandbox, then apply its exact preview to build and verify the supported toolchain.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  sandbox_configured_unavailable: {
    id: "repair_configured_sandbox",
    instruction:
      "Start the same local Docker daemon and rerun Doctor, or use exact-preview Sandbox --uninstall to remove the Napier binding and return to the platform fallback. If identity changed, rerun Setup to replace it.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  sandbox_configured_invalid: {
    id: "repair_invalid_sandbox",
    instruction:
      "Run napier setup --workspace 'WORKSPACE_PATH' --component sandbox --uninstall, inspect its exact preview, and apply that SHA-256 to remove the invalid binding; then rerun Setup only if OCI isolation is still wanted.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  sandbox_host_direct: {
    id: "prefer_isolated_sandbox",
    instruction:
      "Direct host execution runs with no OS isolation. Disable NAPIER_HOST_DIRECT_SANDBOX, then run napier setup --workspace 'WORKSPACE_PATH' --component sandbox and exact-apply its locked preview; keep host-direct enabled only on trusted machines you control.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  sandbox_git_unavailable: {
    id: "repair_git_runtime",
    instruction:
      "Install Git in the active host sandbox or trusted OCI image, then rerun the production Sandbox checks.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  sandbox_resources_unavailable: {
    id: "repair_sandbox_resources",
    instruction:
      "Rerun Sandbox setup against the same local Docker daemon. Napier will not mark the OCI provider ready until the production process proves its pinned process, memory, CPU, temporary-storage, filesystem, privilege, and network limits.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  skills_missing: {
    id: "repair_skill_loader",
    instruction:
      "Add a reviewed SKILL.md under skills/<name>, .agents/skills/<name>, or ~/.agents/skills/<name>; resolve any same-name conflict, then rerun Doctor.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  lsp_missing: {
    id: "repair_lsp_runtime",
    instruction:
      "Install typescript-language-server and typescript in the active host sandbox or trusted OCI image; LSP tools fail closed without identity-bound assets.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  lsp_provider_unavailable: {
    id: "repair_lsp_provider",
    instruction:
      "Configure an active process Sandbox that can launch its identity-bound TypeScript language server, then rerun Doctor.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  dap_missing: {
    id: "repair_debug_adapter",
    instruction:
      "Install Node 22 or newer with Worker, Inspector, SourceMap, and zlib support in the active host sandbox or trusted OCI image; debugger tasks fail closed without an identity-bound runtime.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  dap_provider_unavailable: {
    id: "repair_debug_adapter_provider",
    instruction:
      "Configure an active process Sandbox that can launch its identity-bound Node Inspector Worker probe, then rerun Doctor.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  python_missing: {
    id: "repair_python_runtime",
    instruction:
      "Install a python3 interpreter with its standard library in the active host sandbox or trusted OCI image before Python tasks.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  python_provider_unavailable: {
    id: "repair_python_provider",
    instruction:
      "Configure an active process Sandbox that can launch the production Python path, then rerun Doctor.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  shell_missing: {
    id: "repair_shell_runtime",
    instruction:
      "Reinstall dependencies so the locked current-platform PTY binary is restored; shell and background process tools fail closed without it.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  shell_runtime_missing: {
    id: "repair_shell_runtime",
    instruction:
      "Install a supported system shell runtime, then rerun the production PTY readiness probe.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  shell_provider_unavailable: {
    id: "repair_shell_provider",
    instruction:
      "Configure an active process Sandbox that can launch the production shell PTY path, then rerun Doctor.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  shell_provider_incompatible: {
    id: "repair_shell_provider",
    instruction:
      "Select a process Sandbox with runtime identity and PTY support; the configured provider cannot run Shell Sessions yet.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  verification_provider_unavailable: {
    id: "repair_verification_provider",
    instruction:
      "Rerun Sandbox setup with the locked official image. Coding verification remains unavailable until the active provider binds and executes TypeScript, Vitest, and Prettier from the same immutable image.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  service_provider_unavailable: {
    id: "repair_local_service_provider",
    instruction:
      "Configure a local OCI provider that can create an internal bridge, publish one ephemeral 127.0.0.1 port, complete the HTTP health probe, and clean up both container and network resources.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  search_unavailable: networkRemediation(),
  fetch_unavailable: networkRemediation(),
  browser_unavailable: networkRemediation(),
  browser_missing: {
    id: "install_supported_browser",
    instruction:
      "Run napier setup --workspace 'WORKSPACE_PATH' --component browser, explicitly apply its exact preview, or install a trusted vendor Browser.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH'",
  },
  browser_sandbox_unavailable: {
    id: "repair_browser_sandbox",
    instruction:
      "Run Napier on a host where the browser production sandbox can start; do not disable Chromium sandboxing.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH'",
  },
  browser_use_local_missing: {
    id: "install_browser_use_local",
    instruction:
      "Preview the pinned local Browser Use runtime, then exact-apply that SHA-256. Native Playwright remains available while this optional backend is absent.",
    verifyCommand:
      "napier setup --workspace 'WORKSPACE_PATH' --component browser-use-local",
  },
  browser_use_local_unsupported: {
    id: "repair_browser_use_local_host",
    instruction:
      "Install uv on a supported macOS, Linux, or Windows host, then rerun the pinned Browser Use local setup preview.",
    verifyCommand:
      "napier doctor --workspace 'WORKSPACE_PATH' --browser-backend browser_use_local --offline",
  },
  browser_use_cloud_credential_missing: {
    id: "configure_browser_use_cloud_credential",
    instruction:
      "Add an active Browser Use credential in Web Context → Credentials, or pass a working environment-variable override. Doctor never prints or sends the key.",
    verifyCommand:
      "napier doctor --workspace 'WORKSPACE_PATH' --browser-backend browser_use_cloud --offline",
  },
  browser_use_cloud_credential_unavailable: {
    id: "repair_browser_use_cloud_credential",
    instruction:
      "Repair the active Browser Use credential in Web Context → Credentials, or pass a working environment-variable override.",
    verifyCommand:
      "napier doctor --workspace 'WORKSPACE_PATH' --browser-backend browser_use_cloud --offline",
  },
  offline_mode: {
    id: "run_online_checks",
    instruction:
      "Rerun Doctor without --offline when public Search, Fetch, and Browser readiness should be verified.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH'",
  },
  workspace_unavailable: {
    id: "select_workspace",
    instruction:
      "Choose an existing accessible directory as the workspace; Doctor never creates it automatically.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  doctor_cancelled: {
    id: "retry_doctor",
    instruction:
      "Rerun Doctor with enough time for the selected online probes to complete.",
    verifyCommand:
      "napier doctor --workspace 'WORKSPACE_PATH' --timeout-ms 'MILLISECONDS'",
  },
};

export function createDoctorRemediations(
  checks: readonly DoctorCheck[],
): DoctorRemediation[] {
  const grouped = new Map<
    string,
    {
      spec: RemediationSpec;
      required: boolean;
      checkIds: Set<DoctorCheck["id"]>;
      codes: Set<string>;
    }
  >();
  for (const check of checks) {
    if (check.status === "passed") continue;
    const spec = REMEDIATION_BY_CODE[check.code];
    if (!spec) continue;
    const existing = grouped.get(spec.id) ?? {
      spec,
      required: false,
      checkIds: new Set<DoctorCheck["id"]>(),
      codes: new Set<string>(),
    };
    existing.required ||= check.required && check.status === "failed";
    existing.checkIds.add(check.id);
    existing.codes.add(check.code);
    grouped.set(spec.id, existing);
  }
  return [...grouped.values()]
    .sort((left, right) => left.spec.id.localeCompare(right.spec.id))
    .map((entry) => ({
      id: entry.spec.id,
      priority: entry.required ? "required" : "optional",
      checkIds: [...entry.checkIds].sort(),
      codes: [...entry.codes].sort(),
      instruction: entry.spec.instruction,
      verifyCommand: entry.spec.verifyCommand,
      automatic: false,
    }));
}

function networkRemediation(): RemediationSpec {
  return {
    id: "repair_public_network",
    instruction:
      "Check DNS, proxy, firewall, TLS interception, and provider rate limits for public HTTPS access.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH'",
  };
}
