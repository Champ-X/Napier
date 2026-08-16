import { NAPIER_API_VERSION } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export type KernelPluginCapability =
  | "tool"
  | "provider"
  | "prompt"
  | "projection"
  | "ui_slot";

export type KernelPluginPermission =
  | "workspace.read"
  | "workspace.write"
  | "network.public"
  | "browser.control"
  | "model.invoke";

export type KernelPluginUiSlot =
  | "composer.control"
  | "conversation.card"
  | "inspector.panel"
  | "trace.card";

export interface KernelPluginDependency {
  id: string;
  versionRange: string;
}

export interface KernelPluginEntry {
  package: string;
  export: string;
}

export interface KernelPluginContributions {
  tools: string[];
  providers: string[];
  prompts: string[];
  projections: string[];
  uiSlots: KernelPluginUiSlot[];
}

export interface KernelPluginManifest {
  kind: "napier.kernel-plugin-manifest";
  schemaVersion: 1;
  apiVersion: string;
  id: string;
  version: string;
  displayName: string;
  description: string;
  trust: "first_party";
  dependencies: KernelPluginDependency[];
  capabilities: KernelPluginCapability[];
  permissions: KernelPluginPermission[];
  entries: {
    host: KernelPluginEntry;
    client?: KernelPluginEntry;
  };
  contributions: KernelPluginContributions;
  contentSha256: string;
}

const PLUGIN_ID = /^plugin\.[a-z][a-z0-9_.-]{1,71}$/u;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const EXPORT = /^(?:\.|\.\/[A-Za-z0-9._/-]{1,160})$/u;
const CONTRIBUTION_ID = /^[a-z][a-z0-9_.-]{1,79}$/u;
const VERSION_RANGE =
  /^(?:\*|(?:\^|~)?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)|(?:(?:>=|<=|>|<|=)(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:(?: (?:>=|<=|>|<|=)(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))*))$/u;
const CAPABILITIES = new Set<KernelPluginCapability>([
  "tool",
  "provider",
  "prompt",
  "projection",
  "ui_slot",
]);
const PERMISSIONS = new Set<KernelPluginPermission>([
  "workspace.read",
  "workspace.write",
  "network.public",
  "browser.control",
  "model.invoke",
]);
const UI_SLOTS = new Set<KernelPluginUiSlot>([
  "composer.control",
  "conversation.card",
  "inspector.panel",
  "trace.card",
]);

export function createKernelPluginManifest(
  input: Omit<
    KernelPluginManifest,
    "kind" | "schemaVersion" | "apiVersion" | "contentSha256"
  >,
): KernelPluginManifest {
  const content = {
    kind: "napier.kernel-plugin-manifest" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    ...structuredClone(input),
  };
  return validateKernelPluginManifest({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

export function validateKernelPluginManifest(
  value: unknown,
): KernelPluginManifest {
  const manifest = exactRecord(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "id",
    "version",
    "displayName",
    "description",
    "trust",
    "dependencies",
    "capabilities",
    "permissions",
    "entries",
    "contributions",
    "contentSha256",
  ]) as unknown as KernelPluginManifest;
  if (
    manifest.kind !== "napier.kernel-plugin-manifest" ||
    manifest.schemaVersion !== 1 ||
    manifest.apiVersion !== NAPIER_API_VERSION ||
    manifest.trust !== "first_party" ||
    !PLUGIN_ID.test(manifest.id) ||
    !SEMVER.test(manifest.version) ||
    !text(manifest.displayName, 80) ||
    !text(manifest.description, 500) ||
    !/^[a-f0-9]{64}$/u.test(manifest.contentSha256)
  ) {
    throw new Error("Kernel plugin manifest header is invalid");
  }
  const dependencies = dependenciesOf(manifest.dependencies, manifest.id);
  const capabilities = enumList(
    manifest.capabilities,
    CAPABILITIES,
    "capabilities",
  );
  const permissions = enumList(
    manifest.permissions,
    PERMISSIONS,
    "permissions",
  );
  const entries = entriesOf(manifest.entries);
  const contributions = contributionsOf(manifest.contributions);
  assertContributionCapabilities(capabilities, contributions);
  if (contributions.uiSlots.length > 0 && !entries.client) {
    throw new Error("Kernel plugin UI contributions require a client entry");
  }
  const normalized: KernelPluginManifest = {
    ...structuredClone(manifest),
    dependencies,
    capabilities,
    permissions,
    entries,
    contributions,
  };
  const { contentSha256: _contentSha256, ...content } = normalized;
  if (sha256(canonicalJson(content)) !== normalized.contentSha256) {
    throw new Error("Kernel plugin manifest hash mismatch");
  }
  return normalized;
}

function dependenciesOf(
  value: unknown,
  pluginId: string,
): KernelPluginDependency[] {
  if (!Array.isArray(value) || value.length > 32) {
    throw new Error("Kernel plugin dependencies are invalid");
  }
  const dependencies = value.map((item) => {
    const dependency = exactRecord(item, ["id", "versionRange"]);
    if (
      typeof dependency.id !== "string" ||
      !PLUGIN_ID.test(dependency.id) ||
      dependency.id === pluginId ||
      typeof dependency.versionRange !== "string" ||
      !VERSION_RANGE.test(dependency.versionRange)
    ) {
      throw new Error("Kernel plugin dependency is invalid");
    }
    return {
      id: dependency.id,
      versionRange: dependency.versionRange,
    };
  });
  assertSortedUnique(dependencies.map((dependency) => dependency.id));
  return dependencies;
}

function entriesOf(value: unknown): KernelPluginManifest["entries"] {
  const entries = exactRecord(value, ["host"], ["client"]);
  return {
    host: entryOf(entries.host),
    ...(entries.client === undefined
      ? {}
      : { client: entryOf(entries.client) }),
  };
}

function entryOf(value: unknown): KernelPluginEntry {
  const entry = exactRecord(value, ["package", "export"]);
  if (
    typeof entry.package !== "string" ||
    !PACKAGE.test(entry.package) ||
    typeof entry.export !== "string" ||
    !EXPORT.test(entry.export)
  ) {
    throw new Error("Kernel plugin entry is invalid");
  }
  return { package: entry.package, export: entry.export };
}

function contributionsOf(value: unknown): KernelPluginContributions {
  const contributions = exactRecord(value, [
    "tools",
    "providers",
    "prompts",
    "projections",
    "uiSlots",
  ]);
  return {
    tools: contributionList(contributions.tools, "tools"),
    providers: contributionList(contributions.providers, "providers"),
    prompts: contributionList(contributions.prompts, "prompts"),
    projections: contributionList(contributions.projections, "projections"),
    uiSlots: enumList(contributions.uiSlots, UI_SLOTS, "uiSlots"),
  };
}

function contributionList(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 64 ||
    value.some(
      (item) => typeof item !== "string" || !CONTRIBUTION_ID.test(item),
    )
  ) {
    throw new Error(`Kernel plugin ${label} are invalid`);
  }
  assertSortedUnique(value);
  return [...value];
}

function enumList<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string,
): T[] {
  if (
    !Array.isArray(value) ||
    value.length > 16 ||
    value.some((item) => typeof item !== "string" || !allowed.has(item as T))
  ) {
    throw new Error(`Kernel plugin ${label} are invalid`);
  }
  assertSortedUnique(value as string[]);
  return [...(value as T[])];
}

function assertContributionCapabilities(
  capabilities: KernelPluginCapability[],
  contributions: KernelPluginContributions,
): void {
  const expected = [
    ...(contributions.tools.length ? ["tool" as const] : []),
    ...(contributions.providers.length ? ["provider" as const] : []),
    ...(contributions.prompts.length ? ["prompt" as const] : []),
    ...(contributions.projections.length ? ["projection" as const] : []),
    ...(contributions.uiSlots.length ? ["ui_slot" as const] : []),
  ].sort();
  if (canonicalJson(capabilities) !== canonicalJson(expected)) {
    throw new Error("Kernel plugin capabilities do not match contributions");
  }
}

function exactRecord(
  value: unknown,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Kernel plugin manifest record is invalid");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => !allowed.has(key))
  ) {
    throw new Error("Kernel plugin manifest keys are invalid");
  }
  return record;
}

function assertSortedUnique(values: string[]): void {
  if (
    values.some(
      (value, index) =>
        index > 0 && values[index - 1]!.localeCompare(value) >= 0,
    )
  ) {
    throw new Error("Kernel plugin manifest values must be sorted and unique");
  }
}

function text(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}
