import { randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  ARTIFACT_KERNEL_PLUGIN_ID,
  ARTIFACT_KERNEL_PLUGIN_VERSION,
} from "./kernel-artifact-plugin.js";
import {
  BROWSER_KERNEL_PLUGIN_ID,
  BROWSER_KERNEL_PLUGIN_VERSION,
} from "./kernel-browser-plugin.js";
import {
  SEARCH_KERNEL_PLUGIN_ID,
  SEARCH_KERNEL_PLUGIN_VERSION,
} from "./kernel-search-plugin.js";
import type { KernelPluginRegistry } from "./kernel-plugin-registry.js";
import { syncDirectory } from "./workspace-file-scope.js";
import { withWorkspacePathLock } from "./workspace-write-lock.js";

const STATE_FILE = "kernel-plugins.json";
const MAX_STATE_BYTES = 8 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;

export const BUILTIN_KERNEL_PLUGIN_CATALOG = [
  {
    id: ARTIFACT_KERNEL_PLUGIN_ID,
    version: ARTIFACT_KERNEL_PLUGIN_VERSION,
    required: true,
  },
  {
    id: BROWSER_KERNEL_PLUGIN_ID,
    version: BROWSER_KERNEL_PLUGIN_VERSION,
    required: false,
  },
  {
    id: SEARCH_KERNEL_PLUGIN_ID,
    version: SEARCH_KERNEL_PLUGIN_VERSION,
    required: false,
  },
] as const;

export type BuiltinKernelPluginId =
  (typeof BUILTIN_KERNEL_PLUGIN_CATALOG)[number]["id"];

export interface KernelPluginDesiredState {
  kind: "napier.kernel-plugin-desired-state";
  schemaVersion: 1;
  plugins: Array<{
    id: BuiltinKernelPluginId;
    version: string;
    enabled: boolean;
  }>;
  contentSha256: string;
}

export interface KernelPluginStateSnapshot {
  source: "default" | "configured";
  desiredState: KernelPluginDesiredState;
  bindingSha256?: string;
}

export interface KernelPluginStatePreview {
  kind: "napier.kernel-plugin-state-preview";
  schemaVersion: 1;
  pluginId: BuiltinKernelPluginId;
  currentEnabled: boolean;
  nextEnabled: boolean;
  currentStateSha256: string;
  currentBindingSha256?: string;
  nextStateSha256: string;
  contentSha256: string;
}

export async function loadKernelPluginDesiredState(
  dataRoot: string,
): Promise<KernelPluginStateSnapshot> {
  const filePath = statePath(dataRoot);
  let bytes: Buffer;
  try {
    const info = await lstat(filePath);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_STATE_BYTES) {
      throw new Error("Kernel plugin desired-state file is invalid");
    }
    bytes = await readFile(filePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return {
        source: "default",
        desiredState: createKernelPluginDesiredState(),
      };
    }
    throw error;
  }
  return {
    source: "configured",
    bindingSha256: sha256(bytes),
    desiredState: validateKernelPluginDesiredState(
      JSON.parse(bytes.toString("utf8")) as unknown,
    ),
  };
}

export async function previewKernelPluginState(
  dataRoot: string,
  pluginId: BuiltinKernelPluginId,
  enabled: boolean,
): Promise<KernelPluginStatePreview> {
  assertMutablePlugin(pluginId);
  const current = await loadKernelPluginDesiredState(dataRoot);
  const currentPlugin = current.desiredState.plugins.find(
    (plugin) => plugin.id === pluginId,
  )!;
  const nextState = createKernelPluginDesiredState(
    current.desiredState.plugins.map((plugin) => ({
      id: plugin.id,
      enabled: plugin.id === pluginId ? enabled : plugin.enabled,
    })),
  );
  const content = {
    kind: "napier.kernel-plugin-state-preview" as const,
    schemaVersion: 1 as const,
    pluginId,
    currentEnabled: currentPlugin.enabled,
    nextEnabled: enabled,
    currentStateSha256: current.desiredState.contentSha256,
    ...(current.bindingSha256
      ? { currentBindingSha256: current.bindingSha256 }
      : {}),
    nextStateSha256: nextState.contentSha256,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export async function applyKernelPluginState(input: {
  dataRoot: string;
  pluginId: BuiltinKernelPluginId;
  enabled: boolean;
  expectedPreviewSha256: string;
}): Promise<KernelPluginStateSnapshot> {
  assertMutablePlugin(input.pluginId);
  if (!SHA256.test(input.expectedPreviewSha256)) {
    throw new Error("Kernel plugin state preview hash is invalid");
  }
  await mkdir(path.resolve(input.dataRoot), { recursive: true });
  const filePath = statePath(input.dataRoot);
  return withWorkspacePathLock(
    input.dataRoot,
    filePath,
    async () => {
      const preview = await previewKernelPluginState(
        input.dataRoot,
        input.pluginId,
        input.enabled,
      );
      if (preview.contentSha256 !== input.expectedPreviewSha256) {
        throw new Error("Kernel plugin state preview is stale");
      }
      const current = await loadKernelPluginDesiredState(input.dataRoot);
      const next = createKernelPluginDesiredState(
        current.desiredState.plugins.map((plugin) => ({
          id: plugin.id,
          enabled:
            plugin.id === input.pluginId ? input.enabled : plugin.enabled,
        })),
      );
      await writeState(filePath, `${canonicalJson(next)}\n`);
      return loadKernelPluginDesiredState(input.dataRoot);
    },
    "Kernel plugin state",
  );
}

export function createKernelPluginDesiredState(
  requested: ReadonlyArray<{
    id: BuiltinKernelPluginId;
    enabled: boolean;
  }> = BUILTIN_KERNEL_PLUGIN_CATALOG.map(({ id }) => ({ id, enabled: true })),
): KernelPluginDesiredState {
  const requestedById = new Map(
    requested.map((plugin) => [plugin.id, plugin.enabled]),
  );
  const plugins = BUILTIN_KERNEL_PLUGIN_CATALOG.map((plugin) => ({
    id: plugin.id,
    version: plugin.version,
    enabled: plugin.required ? true : (requestedById.get(plugin.id) ?? true),
  }));
  const content = {
    kind: "napier.kernel-plugin-desired-state" as const,
    schemaVersion: 1 as const,
    plugins,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateKernelPluginDesiredState(
  value: unknown,
): KernelPluginDesiredState {
  if (
    !record(value) ||
    !exactKeys(value, ["kind", "schemaVersion", "plugins", "contentSha256"])
  ) {
    throw new Error("Kernel plugin desired state is invalid");
  }
  if (
    value["kind"] !== "napier.kernel-plugin-desired-state" ||
    value["schemaVersion"] !== 1 ||
    !Array.isArray(value["plugins"]) ||
    !SHA256.test(String(value["contentSha256"]))
  ) {
    throw new Error("Kernel plugin desired-state header is invalid");
  }
  const plugins = value["plugins"];
  if (plugins.length !== BUILTIN_KERNEL_PLUGIN_CATALOG.length) {
    throw new Error("Kernel plugin desired-state catalog is incomplete");
  }
  const normalized = BUILTIN_KERNEL_PLUGIN_CATALOG.map((catalog, index) => {
    const plugin = plugins[index];
    if (
      !record(plugin) ||
      !exactKeys(plugin, ["id", "version", "enabled"]) ||
      plugin["id"] !== catalog.id ||
      plugin["version"] !== catalog.version ||
      typeof plugin["enabled"] !== "boolean" ||
      (catalog.required && plugin["enabled"] !== true)
    ) {
      throw new Error("Kernel plugin desired-state entry is invalid");
    }
    return {
      id: catalog.id,
      version: catalog.version,
      enabled: plugin["enabled"],
    };
  });
  const state: KernelPluginDesiredState = {
    kind: "napier.kernel-plugin-desired-state",
    schemaVersion: 1,
    plugins: normalized,
    contentSha256: String(value["contentSha256"]),
  };
  const { contentSha256, ...content } = state;
  if (contentSha256 !== sha256(canonicalJson(content))) {
    throw new Error("Kernel plugin desired-state hash mismatch");
  }
  return state;
}

export function enabledBuiltinKernelPluginIds(
  state: KernelPluginDesiredState,
): Set<BuiltinKernelPluginId> {
  return new Set(
    state.plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.id),
  );
}

export async function reconcileBuiltinKernelPluginState(
  state: KernelPluginDesiredState,
  plugins: Pick<KernelPluginRegistry, "disable">,
): Promise<void> {
  for (const plugin of state.plugins) {
    if (!plugin.enabled) await plugins.disable(plugin.id);
  }
}

export function isBuiltinKernelPluginId(
  value: string,
): value is BuiltinKernelPluginId {
  return BUILTIN_KERNEL_PLUGIN_CATALOG.some((plugin) => plugin.id === value);
}

function assertMutablePlugin(pluginId: BuiltinKernelPluginId): void {
  if (!isBuiltinKernelPluginId(pluginId)) {
    throw new Error("Kernel plugin state ID is not built in");
  }
  if (pluginId === ARTIFACT_KERNEL_PLUGIN_ID) {
    throw new Error("Kernel Artifact plugin is boot-required");
  }
}

function statePath(dataRoot: string): string {
  return path.join(path.resolve(dataRoot), STATE_FILE);
}

async function writeState(filePath: string, content: string): Promise<void> {
  const root = await realpath(path.dirname(filePath));
  const target = path.join(root, path.basename(filePath));
  const temporary = `${target}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
    await syncDirectory(root);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: string[],
): boolean {
  return (
    canonicalJson(Object.keys(value).sort()) === canonicalJson(expected.sort())
  );
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}
