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
      "Select a catalog model and credential environment locator for a conclusive model check.",
    verifyCommand:
      "napier doctor --workspace 'WORKSPACE_PATH' --model 'PROVIDER/MODEL_ID' --credential-env 'CREDENTIAL_ENV_VAR'",
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
  skills_missing: {
    id: "repair_skill_loader",
    instruction:
      "Add at least one skills/<name>/SKILL.md file to the workspace, or install a reviewed Skill baseline, so the loader can resolve content.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  lsp_missing: {
    id: "repair_lsp_runtime",
    instruction:
      "Reinstall dependencies so typescript-language-server and typescript resolve; LSP tools fail closed without them.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  dap_missing: {
    id: "repair_debug_adapter",
    instruction:
      "Reinstall dependencies so node-pty rebuilds for this Node version; the Node debug adapter cannot attach without it.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  python_missing: {
    id: "repair_python_runtime",
    instruction:
      "Install a python3 interpreter with its standard library (for example Xcode Command Line Tools on macOS) before Python tasks.",
    verifyCommand: "napier doctor --workspace 'WORKSPACE_PATH' --offline",
  },
  shell_missing: {
    id: "repair_shell_runtime",
    instruction:
      "Reinstall dependencies so node-pty rebuilds; PTY shell and background process tools fail closed without it.",
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
