import {
  assertCommandRuntimeStable,
  prepareCommandExecution,
  type PreparedCommandExecution,
} from "./command-execution.js";
import { resolveCommandRuntimeBinding } from "./command-runtime.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  assertNodeDebuggerRuntimeStable,
  nodeDebuggerRuntimeLimitEvidence,
  resolveNodeDebuggerRuntime,
} from "./node-debugger-runtime.js";
import {
  createPlatformSandboxAdapter,
  type OsSandboxAdapter,
} from "./sandbox.js";
import { runSandboxedProcess } from "./sandboxed-process.js";
import { isSkillLoadReceipt } from "./skill-load-contracts.js";
import { createSkillLoadTool } from "./skill-load-tool.js";
import { createSkillAccessState } from "./skill-access-state.js";
import { createSkillResourceTool } from "./skill-resource-tool.js";
import {
  buildStandardSkillSnapshot,
  discoverStandardSkillNames,
} from "./standard-skill-snapshot.js";
import { bindWorkspaceProcessIo } from "./workspace-process-terminal.js";

const MAX_PROBED_SKILLS = 64;
const PROCESS_PROBE_MARKER = "napier_process_probe_v1";
const SHELL_PROBE_MARKER = "napier_shell_probe_v1";
const PYTHON_PROBE_MARKER = "napier_python_probe_v1";
const PROCESS_PROBE_TIMEOUT_MS = 5_000;

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

export { probeGitRuntime } from "./doctor-git-runtime-probe.js";
export { probeLspRuntime } from "./doctor-lsp-runtime-probe.js";
export { probeLocalServiceRuntime } from "./doctor-local-service-runtime-probe.js";
export { probeSandboxResourceRuntime } from "./doctor-sandbox-resource-probe.js";
export { probeVerificationRuntime } from "./doctor-verification-runtime-probe.js";

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
    const access = createSkillAccessState();
    const result = await createSkillLoadTool(snapshot, access).execute(
      "doctor_skill_load",
      { name },
      new AbortController().signal,
    );
    if (!isSkillLoadReceipt(result.details)) {
      throw new Error("Production Skill load did not return a valid receipt");
    }
    const resourceTool = createSkillResourceTool(snapshot, access);
    if (resourceTool.name !== "skill_resource") {
      throw new Error("Derived Skill resource tool was not constructed");
    }
    return {
      status: "ready",
      code: "skills_ready",
      message: `Production Skill loader loaded 1 of ${String(snapshot.binding.loadableSkillNames.length)} admitted project or user Skills; the derived resource tool is available and reads content only when referenced`,
      evidence: {
        present: present.length,
        admitted: snapshot.binding.loadableSkillNames.length,
        productionCall: true,
        resourceToolConstructed: true,
        resourceProductionCall: false,
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

/** Executes the exact Worker-to-main-thread Inspector primitive used by DAP. */
export async function probeDapRuntime(
  workspaceRoot = process.cwd(),
  signal?: AbortSignal,
  sandbox: OsSandboxAdapter = createPlatformSandboxAdapter(),
): Promise<RuntimeCapabilityProbe> {
  try {
    const resolution = {
      sandbox,
      workspaceRoot,
      ...(signal ? { signal } : {}),
    };
    const runtime = await resolveNodeDebuggerRuntime(resolution);
    await assertNodeDebuggerRuntimeStable(
      runtime,
      resolution,
      "Node debugger Doctor probe",
    );
    const limits = nodeDebuggerRuntimeLimitEvidence();
    return {
      status: "ready",
      code: "dap_ready",
      message: `The active ${sandbox.id} provider completed the bounded production Node Inspector Worker probe used by the debug adapter`,
      evidence: {
        adapter: sandbox.id,
        productionCall: true,
        runtimeLocation: runtime.location,
        nodeVersion: runtime.nodeVersion,
        nodeExecutableSha256: runtime.nodeExecutableSha256,
        runtimeIdentitySha256: runtime.runtimeIdentitySha256,
        ...limits,
        resourceLimitsSha256: sha256(
          canonicalJson({
            ...limits,
            environment: "fixed",
            networkAccess: "denied",
            workspaceAccess: "read_only",
            processGroupTermination: true,
          }),
        ),
      },
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const missing =
      /image-bound Node debugger runtime is unavailable|Node debugger runtime primitives are unavailable/iu.test(
        message,
      );
    return {
      status: "unavailable",
      code: missing ? "dap_missing" : "dap_provider_unavailable",
      message: missing
        ? "The active provider has no identity-bound Node runtime with the required Inspector Worker and SourceMap primitives; debugger tasks fail closed"
        : "The active provider could not complete the production Node debugger runtime probe; debugger tasks fail closed",
    };
  }
}

/**
 * Python runtime readiness. Uses the same resolver the python command tool
 * relies on, so an unavailable interpreter or missing standard-library asset is
 * reported honestly.
 */
export async function probePythonRuntime(
  workspaceRoot?: string,
  signal?: AbortSignal,
  sandbox: OsSandboxAdapter = createPlatformSandboxAdapter(),
): Promise<RuntimeCapabilityProbe> {
  if (workspaceRoot) {
    return activeProcessProbe({
      workspaceRoot,
      sandbox,
      runtime: "python",
      args: [
        "-I",
        "-B",
        "-S",
        "-c",
        `print(${JSON.stringify(PYTHON_PROBE_MARKER)}, end="")`,
      ],
      marker: PYTHON_PROBE_MARKER,
      ...(signal ? { signal } : {}),
    });
  }
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

/** Executes the same bounded Node pipe path used by run_command. */
export async function probeSandboxProcessRuntime(
  workspaceRoot: string,
  signal?: AbortSignal,
  sandbox: OsSandboxAdapter = createPlatformSandboxAdapter(),
): Promise<RuntimeCapabilityProbe> {
  return activeProcessProbe({
    workspaceRoot,
    sandbox,
    runtime: "node",
    args: [
      "-e",
      `process.stdout.write(${JSON.stringify(PROCESS_PROBE_MARKER)})`,
    ],
    marker: PROCESS_PROBE_MARKER,
    ...(signal ? { signal } : {}),
  });
}

/**
 * Executes the production shell preparation, Sandbox, parent guard, and PTY
 * path. Merely resolving node-pty or a shell executable is never reported as
 * ready.
 */
export async function probeShellRuntime(
  workspaceRoot: string,
  signal?: AbortSignal,
  sandbox: OsSandboxAdapter = createPlatformSandboxAdapter(),
): Promise<RuntimeCapabilityProbe> {
  const script =
    process.platform === "win32"
      ? `node -e "process.stdout.write('${SHELL_PROBE_MARKER}')"`
      : `node -e 'process.stdout.write("${SHELL_PROBE_MARKER}")'`;
  return activeProcessProbe({
    workspaceRoot,
    sandbox,
    runtime: "shell",
    args: [script],
    marker: SHELL_PROBE_MARKER,
    terminal: true,
    ...(signal ? { signal } : {}),
  });
}

async function activeProcessProbe(input: {
  workspaceRoot: string;
  sandbox: OsSandboxAdapter;
  runtime: "node" | "python" | "shell";
  args: string[];
  marker: string;
  terminal?: boolean;
  signal?: AbortSignal;
}): Promise<RuntimeCapabilityProbe> {
  let prepared: PreparedCommandExecution | undefined;
  try {
    prepared = await prepareCommandExecution(
      { workspaceRoot: input.workspaceRoot, sandbox: input.sandbox },
      {
        runtime: input.runtime,
        args: input.args,
        timeoutMs: PROCESS_PROBE_TIMEOUT_MS,
      },
    );
    const io = input.terminal
      ? bindWorkspaceProcessIo(prepared, { columns: 80, rows: 24 })
      : undefined;
    const result = await runSandboxedProcess({
      sandbox: input.sandbox,
      launch: io?.launch ?? prepared.launch,
      timeoutMs: PROCESS_PROBE_TIMEOUT_MS,
      maxOutputChars: 256,
      ...(input.signal ? { signal: input.signal } : {}),
      abortedMessage: "Runtime process probe was cancelled",
    });
    const ready =
      result.status === "exited" &&
      result.exitCode === 0 &&
      result.stdout === input.marker &&
      result.stderr === "";
    if (!ready) return processProbeFailure(input.runtime, "probe_result");
    return {
      status: "ready",
      code:
        input.runtime === "shell"
          ? "shell_ready"
          : input.runtime === "python"
            ? "python_ready"
            : "sandbox_process_ready",
      message:
        input.runtime === "shell"
          ? `The active ${input.sandbox.id} provider completed a bounded shell command through the production PTY path`
          : input.runtime === "python"
            ? `The active ${input.sandbox.id} provider completed a bounded Python command through the production execution path`
            : `The active ${input.sandbox.id} provider completed a bounded command through the production execution path`,
      evidence: {
        adapter: input.sandbox.id,
        productionCall: true,
        pty: input.terminal === true,
        executableSha256: prepared.executableSha256,
        ...(prepared.runtimeIdentitySha256
          ? { runtimeIdentitySha256: prepared.runtimeIdentitySha256 }
          : {}),
        ...(input.runtime === "python"
          ? { runtimeAssetCount: prepared.runtimeAssets.length }
          : {}),
        commandSha256:
          io?.commandSha256 ?? sha256(canonicalJson(prepared.receipt)),
        exitCode: result.exitCode!,
      },
    };
  } catch (error) {
    if (input.signal?.aborted) throw error;
    return processProbeFailure(input.runtime, error);
  } finally {
    if (prepared) await assertCommandRuntimeStable(prepared);
  }
}

function processProbeFailure(
  runtime: "node" | "python" | "shell",
  error: unknown,
): RuntimeCapabilityProbe {
  const message = error instanceof Error ? error.message : String(error);
  if (runtime === "python") {
    const missing = /python runtime (?:is|assets are) unavailable/iu.test(
      message,
    );
    return {
      status: "unavailable",
      code: missing ? "python_missing" : "python_provider_unavailable",
      message: missing
        ? "The active provider has no usable python3 interpreter and required standard library; Python tools fail closed"
        : "The active provider could not complete the production Python command probe; Python tools fail closed",
    };
  }
  if (runtime === "shell" && /node-pty|PTY launch failed/iu.test(message)) {
    return {
      status: "unavailable",
      code: "shell_missing",
      message:
        "The production PTY helper is unavailable; shell sessions fail closed",
    };
  }
  if (runtime === "shell" && /shell runtime/iu.test(message)) {
    return {
      status: "unavailable",
      code: "shell_runtime_missing",
      message: "No supported system shell runtime is available",
    };
  }
  const incompatible =
    /container runtime identity binding|image-bound terminal runtime support/iu.test(
      message,
    );
  return {
    status: "unavailable",
    code:
      runtime === "shell"
        ? incompatible
          ? "shell_provider_incompatible"
          : "shell_provider_unavailable"
        : incompatible
          ? "sandbox_provider_incompatible"
          : "sandbox_provider_unavailable",
    message:
      runtime === "shell"
        ? incompatible
          ? "The active provider cannot bind the shell runtime identity or PTY yet; shell sessions fail closed"
          : "The active provider could not complete the production shell PTY probe; shell sessions fail closed"
        : incompatible
          ? "The active provider cannot bind the command runtime identity yet; process capabilities fail closed"
          : "The active provider could not complete the production command probe; process capabilities fail closed",
  };
}
