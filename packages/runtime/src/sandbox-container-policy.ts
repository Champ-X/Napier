import { canonicalJson, sha256 } from "./ed25519.js";

export const OCI_PROCESS_RESOURCE_POLICY = {
  pidsMax: 256,
  memoryMaxBytes: 1_073_741_824,
  memorySwapMaxBytes: 0,
  cpuQuota: 2,
  temporaryFileSystemBytes: 67_108_864,
  rootReadOnly: true,
  workspaceReadOnly: true,
  capabilitiesDropped: true,
  noNewPrivileges: true,
  networkInterfaces: ["lo"],
} as const;

export const OCI_PROCESS_RESOURCE_POLICY_SHA256 = sha256(
  canonicalJson(OCI_PROCESS_RESOURCE_POLICY),
);

export const OCI_PROCESS_RESOURCE_ARGUMENTS = [
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges",
  "--pids-limit",
  String(OCI_PROCESS_RESOURCE_POLICY.pidsMax),
  "--memory",
  "1g",
  "--memory-swap",
  "1g",
  "--cpus",
  String(OCI_PROCESS_RESOURCE_POLICY.cpuQuota),
  "--read-only",
  "--tmpfs",
  "/tmp:rw,nosuid,nodev,size=64m,mode=1777",
] as const;
