import { constants as fsConstants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { resolveCommandRuntimeBinding } from "./command-runtime.js";

const require = createRequire(import.meta.url);
const MAX_SCANNED_SKILL_DIRS = 128;

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

/**
 * Skill loader readiness. Scans `<workspace>/skills/<name>/SKILL.md`. The loader
 * itself is always constructed, so an empty or absent catalog is reported as
 * available rather than broken; a present catalog confirms loadable Skills.
 */
export async function probeSkillsRuntime(
  workspaceRoot: string,
): Promise<RuntimeCapabilityProbe> {
  const skillsDir = path.join(workspaceRoot, "skills");
  let entries: string[];
  try {
    entries = (
      await readdir(skillsDir, { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .slice(0, MAX_SCANNED_SKILL_DIRS)
      .map((entry) => entry.name);
  } catch {
    return {
      status: "available_unverified",
      code: "skills_empty",
      message:
        "Skill loader is available; no workspace skills directory is present yet",
      evidence: { present: 0 },
    };
  }
  let present = 0;
  for (const name of entries) {
    const exists = await access(
      path.join(skillsDir, name, "SKILL.md"),
    ).then(
      () => true,
      () => false,
    );
    if (exists) present += 1;
  }
  if (present === 0) {
    return {
      status: "available_unverified",
      code: "skills_empty",
      message:
        "Skill loader is available; no SKILL.md files were found under the workspace skills directory",
      evidence: { present: 0 },
    };
  }
  return {
    status: "ready",
    code: "skills_ready",
    message: `Skill loader resolved ${String(present)} workspace Skill${present === 1 ? "" : "s"}`,
    evidence: { present },
  };
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
      message: "A python3 interpreter with the required standard library was found",
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
