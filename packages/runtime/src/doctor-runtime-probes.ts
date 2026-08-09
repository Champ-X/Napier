import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";

import { resolveCommandRuntimeBinding } from "./command-runtime.js";
import { isSkillLoadReceipt } from "./skill-load-contracts.js";
import { createSkillLoadTool } from "./skill-load-tool.js";
import {
  buildStandardSkillSnapshot,
  discoverStandardSkillNames,
} from "./standard-skill-snapshot.js";

const require = createRequire(import.meta.url);
const MAX_PROBED_SKILLS = 64;

export type RuntimeCapabilityStatus =
  | "ready"
  | "available_unverified"
  | "unavailable";

export interface RuntimeCapabilityProbe {
  status: RuntimeCapabilityStatus;
  code: string;
  message: string;
  evidence?: Record<string, boolean | number | string>;
}

export interface SandboxIsolationStrength {
  level: "none" | "os_profile" | "namespace" | "container";
  networkDeniedByDefault: boolean;
  resourceLimited: boolean;
  summary: string;
}

/**
 * Describes the isolation an OS sandbox adapter actually enforces, so Doctor can
 * report isolation strength and degradation impact instead of only the adapter
 * id. Values reflect the concrete launch arguments each adapter builds.
 */
export function sandboxIsolationStrength(
  adapterId: string,
): SandboxIsolationStrength {
  switch (adapterId) {
    case "oci-container":
      return {
        level: "container",
        networkDeniedByDefault: true,
        resourceLimited: true,
        summary:
          "Container isolation with dropped capabilities, no-new-privileges, pid/memory/cpu limits, read-only root, and default-denied network",
      };
    case "macos-sandbox-exec":
      return {
        level: "os_profile",
        networkDeniedByDefault: true,
        resourceLimited: false,
        summary:
          "macOS sandbox-exec profile with default-denied network and scoped filesystem; no CPU or memory ceiling",
      };
    case "linux-bubblewrap":
      return {
        level: "namespace",
        networkDeniedByDefault: true,
        resourceLimited: false,
        summary:
          "Linux bubblewrap namespaces with default-denied network and scoped filesystem; no CPU or memory ceiling",
      };
    case "host-direct":
      return {
        level: "none",
        networkDeniedByDefault: false,
        resourceLimited: false,
        summary:
          "Direct host execution with no OS isolation, network open, and full workspace access; enabled only by explicit operator opt-in",
      };
    default:
      return {
        level: "none",
        networkDeniedByDefault: false,
        resourceLimited: false,
        summary:
          "No supported OS process isolation on this host; process capabilities fail closed",
      };
  }
}

/**
 * Skill loader readiness. An available catalog is admitted through the same
 * snapshot builder and production tool used by Agent Runs, then one Skill is
 * actually loaded. Empty workspaces remain unverified rather than claiming a
 * production call that could not be made.
 */
export async function probeSkillsRuntime(
  workspaceRoot: string,
  options: { userHome?: string } = {},
): Promise<RuntimeCapabilityProbe> {
  let present: string[];
  try {
    present = (await discoverStandardSkillNames(workspaceRoot, options)).slice(
      0,
      MAX_PROBED_SKILLS,
    );
  } catch {
    return {
      status: "unavailable",
      code: "skills_unavailable",
      message:
        "Project or user Skill roots were found, but their catalogs could not be safely inspected",
      evidence: { present: 0, productionCall: false },
    };
  }
  if (present.length === 0) {
    return {
      status: "available_unverified",
      code: "skills_empty",
      message:
        "Skill loader is available; no direct project or user Skill directories were found",
      evidence: { present: 0 },
    };
  }
  try {
    const snapshot = await buildStandardSkillSnapshot(
      workspaceRoot,
      present.slice(0, 64),
      undefined,
      options,
    );
    const name = snapshot.binding.loadableSkillNames[0];
    if (!name) throw new Error("No Skill passed snapshot admission");
    const result = await createSkillLoadTool(snapshot).execute(
      "doctor_skill_load",
      { name },
      new AbortController().signal,
    );
    if (!isSkillLoadReceipt(result.details)) {
      throw new Error("Production Skill load did not return a valid receipt");
    }
    return {
      status: "ready",
      code: "skills_ready",
      message: `Production Skill loader loaded 1 of ${String(snapshot.binding.loadableSkillNames.length)} admitted project or user Skills`,
      evidence: {
        present: present.length,
        admitted: snapshot.binding.loadableSkillNames.length,
        productionCall: true,
        catalogSha256: snapshot.binding.catalogSha256,
        source: result.details.source,
        ...(result.details.schemaVersion === 2
          ? { rootKind: result.details.rootKind }
          : {}),
      },
    };
  } catch {
    return {
      status: "unavailable",
      code: "skills_unavailable",
      message:
        "Project or user Skills were found, but the production Skill loader could not safely load one",
      evidence: { present: present.length, productionCall: false },
    };
  }
}

/**
 * TypeScript LSP readiness. Resolves the exact language-server and tsserver
 * entry points the LSP session launches so a missing dependency is reported
 * before a task relies on diagnostics or rename.
 */
export async function probeLspRuntime(): Promise<RuntimeCapabilityProbe> {
  try {
    require.resolve("typescript-language-server/lib/cli.mjs");
    require.resolve("typescript/lib/tsserver.js");
    return {
      status: "available_unverified",
      code: "lsp_ready",
      message:
        "TypeScript language server and tsserver entry points are installed",
    };
  } catch {
    return {
      status: "unavailable",
      code: "lsp_missing",
      message:
        "TypeScript language server is not installed; reinstall dependencies to enable LSP tools",
    };
  }
}

/**
 * Debug adapter readiness. The Node debugger drives a PTY-hosted inspector, so
 * DAP is ready only when the node-pty helper resolves against the current Node
 * runtime.
 */
export async function probeDapRuntime(): Promise<RuntimeCapabilityProbe> {
  try {
    require.resolve("node-pty");
    return {
      status: "available_unverified",
      code: "dap_ready",
      message:
        "Node debug adapter dependencies (node-pty, inspector) are available",
      evidence: { inspector: typeof process.pid === "number" },
    };
  } catch {
    return {
      status: "unavailable",
      code: "dap_missing",
      message:
        "node-pty is not installed; the Node debug adapter cannot attach until dependencies are repaired",
    };
  }
}

/**
 * Python runtime readiness. Uses the same resolver the python command tool
 * relies on, so an unavailable interpreter or missing standard-library asset is
 * reported honestly.
 */
export async function probePythonRuntime(): Promise<RuntimeCapabilityProbe> {
  try {
    const binding = await resolveCommandRuntimeBinding("python");
    return {
      status: "available_unverified",
      code: "python_ready",
      message:
        "A python3 interpreter with the required standard library was found",
      evidence: {
        assetCount: binding.runtimeAssets.length,
        executableSha256: binding.executableSha256,
      },
    };
  } catch (error) {
    return {
      status: "unavailable",
      code: "python_missing",
      message:
        error instanceof Error && /assets/u.test(error.message)
          ? "python3 was found but its standard library assets are incomplete"
          : "No usable python3 interpreter was found for the Python tools",
    };
  }
}

/**
 * Interactive shell readiness. PTY-backed terminals and background processes
 * depend on node-pty; without it, shell sessions fail closed.
 */
export async function probeShellRuntime(): Promise<RuntimeCapabilityProbe> {
  try {
    const specifier = require.resolve("node-pty");
    await access(specifier, fsConstants.R_OK);
    return {
      status: "available_unverified",
      code: "shell_ready",
      message:
        "PTY-backed shell sessions are available through the node-pty helper",
    };
  } catch {
    return {
      status: "unavailable",
      code: "shell_missing",
      message:
        "node-pty is unavailable; PTY shell and background process tools fail closed",
    };
  }
}
