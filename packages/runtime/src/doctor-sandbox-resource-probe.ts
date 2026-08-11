import {
  assertCommandRuntimeStable,
  prepareCommandExecution,
  type PreparedCommandExecution,
} from "./command-execution.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createPlatformSandboxAdapter } from "./sandbox.js";
import {
  OCI_PROCESS_RESOURCE_POLICY,
  OCI_PROCESS_RESOURCE_POLICY_SHA256,
} from "./sandbox-container-policy.js";
import type { OsSandboxAdapter } from "./sandbox-types.js";
import { runSandboxedProcess } from "./sandboxed-process.js";

const PROBE_TIMEOUT_MS = 5_000;
const MAX_PROBE_OUTPUT_CHARS = 4_096;

export interface SandboxResourceObservation {
  cgroupVersion: 1 | 2;
  pidsMax: number;
  memoryMaxBytes: number;
  memorySwapMaxBytes: number;
  cpuQuotaMicros: number;
  cpuPeriodMicros: number;
  rootReadOnly: boolean;
  workspaceReadOnly: boolean;
  temporaryFileSystemBytes: number;
  homeFileSystemBytes: number;
  temporaryFileSystemRestricted: boolean;
  homeFileSystemRestricted: boolean;
  capabilitiesDropped: boolean;
  noNewPrivileges: boolean;
  networkInterfaces: string[];
}

export interface SandboxResourceEvidence {
  cgroupVersion: 1 | 2;
  pidsMax: number;
  memoryMaxBytes: number;
  memorySwapMaxBytes: number;
  cpuQuotaMicros: number;
  cpuPeriodMicros: number;
  rootReadOnly: true;
  workspaceReadOnly: true;
  temporaryFileSystemBytes: number;
  homeFileSystemBytes: number;
  temporaryFileSystemRestricted: true;
  homeFileSystemRestricted: true;
  capabilitiesDropped: true;
  noNewPrivileges: true;
  networkInterfaceCount: 1;
  resourcePolicySha256: string;
}

export interface SandboxResourceCapabilityProbe {
  status: "ready" | "unavailable";
  code: string;
  message: string;
  evidence?: Record<string, boolean | number | string>;
}

/**
 * Executes a production Node command through the active OCI adapter and
 * validates the limits observed by that process, rather than trusting launch
 * arguments alone.
 */
export async function probeSandboxResourceRuntime(
  workspaceRoot: string,
  signal?: AbortSignal,
  sandbox: OsSandboxAdapter = createPlatformSandboxAdapter(),
): Promise<SandboxResourceCapabilityProbe> {
  if (sandbox.id !== "oci-container") {
    return resourceProbeFailure();
  }
  let prepared: PreparedCommandExecution | undefined;
  try {
    prepared = await prepareCommandExecution(
      { workspaceRoot, sandbox },
      {
        runtime: "node",
        args: ["-"],
        timeoutMs: PROBE_TIMEOUT_MS,
      },
    );
    const result = await runSandboxedProcess({
      sandbox,
      launch: prepared.launch,
      stdin: RESOURCE_PROBE_SOURCE,
      timeoutMs: PROBE_TIMEOUT_MS,
      maxOutputChars: MAX_PROBE_OUTPUT_CHARS,
      ...(signal ? { signal } : {}),
      abortedMessage: "Sandbox resource probe was cancelled",
    });
    if (
      result.status !== "exited" ||
      result.exitCode !== 0 ||
      result.stderr !== "" ||
      result.stdoutTruncated
    ) {
      throw new Error("Sandbox resource probe returned an invalid result");
    }
    const evidence = validateSandboxResourceObservation(result.stdout);
    return {
      status: "ready",
      code: "sandbox_resources_ready",
      message:
        "The active OCI provider enforced and exposed the pinned process, memory, CPU, temporary-storage, filesystem, privilege, and network limits",
      evidence: {
        adapter: sandbox.id,
        productionCall: true,
        commandSha256: sha256(canonicalJson(prepared.receipt)),
        probeSourceSha256: sha256(RESOURCE_PROBE_SOURCE),
        ...evidence,
      },
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return resourceProbeFailure();
  } finally {
    if (prepared) await assertCommandRuntimeStable(prepared);
  }
}

export function validateSandboxResourceObservation(
  serialized: string,
): SandboxResourceEvidence {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("Sandbox resource observation is not valid JSON");
  }
  if (!isSandboxResourceObservation(value)) {
    throw new Error("Sandbox resource observation shape is invalid");
  }
  const policy = OCI_PROCESS_RESOURCE_POLICY;
  if (
    value.pidsMax !== policy.pidsMax ||
    value.memoryMaxBytes !== policy.memoryMaxBytes ||
    value.memorySwapMaxBytes !== policy.memorySwapMaxBytes ||
    value.cpuPeriodMicros <= 0 ||
    value.cpuQuotaMicros !== value.cpuPeriodMicros * policy.cpuQuota ||
    value.rootReadOnly !== policy.rootReadOnly ||
    value.workspaceReadOnly !== policy.workspaceReadOnly ||
    value.temporaryFileSystemBytes !== policy.temporaryFileSystemBytes ||
    value.homeFileSystemBytes !== policy.temporaryFileSystemBytes ||
    value.temporaryFileSystemRestricted !== true ||
    value.homeFileSystemRestricted !== true ||
    value.capabilitiesDropped !== policy.capabilitiesDropped ||
    value.noNewPrivileges !== policy.noNewPrivileges ||
    canonicalJson(value.networkInterfaces) !==
      canonicalJson(policy.networkInterfaces)
  ) {
    throw new Error("Sandbox resource observation does not match policy");
  }
  return {
    cgroupVersion: value.cgroupVersion,
    pidsMax: value.pidsMax,
    memoryMaxBytes: value.memoryMaxBytes,
    memorySwapMaxBytes: value.memorySwapMaxBytes,
    cpuQuotaMicros: value.cpuQuotaMicros,
    cpuPeriodMicros: value.cpuPeriodMicros,
    rootReadOnly: true,
    workspaceReadOnly: true,
    temporaryFileSystemBytes: value.temporaryFileSystemBytes,
    homeFileSystemBytes: value.homeFileSystemBytes,
    temporaryFileSystemRestricted: true,
    homeFileSystemRestricted: true,
    capabilitiesDropped: true,
    noNewPrivileges: true,
    networkInterfaceCount: 1,
    resourcePolicySha256: OCI_PROCESS_RESOURCE_POLICY_SHA256,
  };
}

function resourceProbeFailure(): SandboxResourceCapabilityProbe {
  return {
    status: "unavailable",
    code: "sandbox_resources_unavailable",
    message:
      "The active provider could not prove the pinned process, memory, CPU, temporary-storage, filesystem, privilege, and network limits; resource-sensitive tasks fail closed",
  };
}

function isSandboxResourceObservation(
  value: unknown,
): value is SandboxResourceObservation {
  if (!isRecord(value)) return false;
  const exactKeys = [
    "capabilitiesDropped",
    "cgroupVersion",
    "cpuPeriodMicros",
    "cpuQuotaMicros",
    "homeFileSystemBytes",
    "homeFileSystemRestricted",
    "memoryMaxBytes",
    "memorySwapMaxBytes",
    "networkInterfaces",
    "noNewPrivileges",
    "pidsMax",
    "rootReadOnly",
    "temporaryFileSystemBytes",
    "temporaryFileSystemRestricted",
    "workspaceReadOnly",
  ];
  if (
    canonicalJson(Object.keys(value).sort()) !== canonicalJson(exactKeys) ||
    (value["cgroupVersion"] !== 1 && value["cgroupVersion"] !== 2)
  ) {
    return false;
  }
  const integerFields = [
    "pidsMax",
    "memoryMaxBytes",
    "memorySwapMaxBytes",
    "cpuQuotaMicros",
    "cpuPeriodMicros",
    "temporaryFileSystemBytes",
    "homeFileSystemBytes",
  ];
  const booleanFields = [
    "rootReadOnly",
    "workspaceReadOnly",
    "temporaryFileSystemRestricted",
    "homeFileSystemRestricted",
    "capabilitiesDropped",
    "noNewPrivileges",
  ];
  return (
    integerFields.every(
      (name) =>
        Number.isSafeInteger(value[name]) && Number(value[name]) >= 0,
    ) &&
    booleanFields.every((name) => typeof value[name] === "boolean") &&
    Array.isArray(value["networkInterfaces"]) &&
    value["networkInterfaces"].every(
      (name) =>
        typeof name === "string" &&
        /^[a-zA-Z0-9_.-]{1,32}$/u.test(name),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const RESOURCE_PROBE_SOURCE = String.raw`
const fs = require("node:fs");
const read = (...paths) => {
  for (const candidate of paths) {
    try {
      return fs.readFileSync(candidate, "utf8").trim();
    } catch {}
  }
  return undefined;
};
const integer = (value) => {
  if (value === undefined || value === "max" || !/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};
const cgroupVersion = fs.existsSync("/sys/fs/cgroup/cgroup.controllers") ? 2 : 1;
const memoryMaxBytes = integer(read(
  "/sys/fs/cgroup/memory.max",
  "/sys/fs/cgroup/memory/memory.limit_in_bytes",
));
const swapValue = cgroupVersion === 2
  ? integer(read("/sys/fs/cgroup/memory.swap.max"))
  : integer(read("/sys/fs/cgroup/memory/memory.memsw.limit_in_bytes"));
const memorySwapMaxBytes = cgroupVersion === 2 || swapValue === null || memoryMaxBytes === null
  ? swapValue
  : Math.max(0, swapValue - memoryMaxBytes);
const pidsMax = integer(read(
  "/sys/fs/cgroup/pids.max",
  "/sys/fs/cgroup/pids/pids.max",
));
const cpu = cgroupVersion === 2
  ? (read("/sys/fs/cgroup/cpu.max") || "").split(/\s+/)
  : [
      read("/sys/fs/cgroup/cpu/cpu.cfs_quota_us"),
      read("/sys/fs/cgroup/cpu/cpu.cfs_period_us"),
    ];
const cpuQuotaMicros = integer(cpu[0]);
const cpuPeriodMicros = integer(cpu[1]);
const unescapeMount = (value) => value.replace(/\\([0-7]{3})/g, (_match, octal) =>
  String.fromCharCode(Number.parseInt(octal, 8)),
);
const mounts = fs.readFileSync("/proc/self/mountinfo", "utf8")
  .trim()
  .split("\n")
  .map((line) => {
    const [left, right] = line.split(" - ");
    const fields = left.split(" ");
    const after = right.split(" ");
    return {
      point: unescapeMount(fields[4]),
      options: fields[5].split(","),
      type: after[0],
      superOptions: after[2].split(","),
    };
  });
const mountFor = (target) => mounts
  .filter((mount) => target === mount.point || target.startsWith(mount.point === "/" ? "/" : mount.point + "/"))
  .sort((left, right) => right.point.length - left.point.length)[0];
const root = mountFor("/");
const workspace = mountFor(process.cwd());
const temporary = mountFor("/tmp");
const home = mountFor("/home/napier");
const fileSystemBytes = (target) => {
  const stats = fs.statfsSync(target);
  return stats.blocks * stats.bsize;
};
const status = fs.readFileSync("/proc/self/status", "utf8");
const statusValue = (name) => status.match(new RegExp("^" + name + ":\\s*(\\S+)", "m"))?.[1];
const capabilitiesDropped = ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]
  .every((name) => /^0+$/.test(statusValue(name) || ""));
process.stdout.write(JSON.stringify({
  cgroupVersion,
  pidsMax,
  memoryMaxBytes,
  memorySwapMaxBytes,
  cpuQuotaMicros,
  cpuPeriodMicros,
  rootReadOnly: root?.options.includes("ro") === true,
  workspaceReadOnly: workspace?.options.includes("ro") === true,
  temporaryFileSystemBytes: fileSystemBytes("/tmp"),
  homeFileSystemBytes: fileSystemBytes("/home/napier"),
  temporaryFileSystemRestricted:
    temporary?.type === "tmpfs" &&
    temporary.options.includes("rw") &&
    temporary.options.includes("nosuid") &&
    temporary.options.includes("nodev"),
  homeFileSystemRestricted:
    home?.type === "tmpfs" &&
    home.options.includes("rw") &&
    home.options.includes("nosuid") &&
    home.options.includes("nodev"),
  capabilitiesDropped,
  noNewPrivileges: statusValue("NoNewPrivs") === "1",
  networkInterfaces: fs.readdirSync("/sys/class/net").sort(),
}));
`;
