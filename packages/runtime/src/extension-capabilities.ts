import type { ExtensionCapability } from "@napier/contracts";

export const EXTENSION_CAPABILITIES = new Set<ExtensionCapability>([
  "network.connect",
  "network.listen",
  "secrets.env",
  "process.spawn",
  "workspace.read",
  "workspace.write",
  "external.read",
  "external.write",
]);
