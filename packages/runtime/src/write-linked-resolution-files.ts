import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./ed25519.js";
import { normalizeWriteLinkedPath } from "./write-linked-test-graph.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export const MAX_WRITE_LINKED_RESOLUTION_CONFIGS = 128;
export const MAX_WRITE_LINKED_RESOLUTION_CONFIG_BYTES = 1024 * 1024;
export const MAX_WRITE_LINKED_RESOLUTION_TOTAL_BYTES = 4 * 1024 * 1024;

export interface WriteLinkedResolutionConfiguration {
  path: string;
  fileSha256: string;
}

export interface LoadedWriteLinkedResolutionConfiguration extends WriteLinkedResolutionConfiguration {
  source: string;
  fileBytes: number;
}

export type WriteLinkedResolutionConfigurationLoad =
  | { status: "loaded"; file: LoadedWriteLinkedResolutionConfiguration }
  | { status: "missing" }
  | { status: "unsafe" };

export async function loadWriteLinkedResolutionConfiguration(
  workspaceRoot: string,
  relativePathInput: string,
): Promise<WriteLinkedResolutionConfigurationLoad> {
  const relativePath = normalizeWriteLinkedPath(relativePathInput);
  if (
    !relativePath ||
    path.isAbsolute(relativePathInput) ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    relativePath.split("/").some(isProtectedWorkspacePathSegment)
  ) {
    return { status: "unsafe" };
  }
  const target = path.resolve(workspaceRoot, relativePath);
  try {
    if ((await realpath(target)) !== target) return { status: "unsafe" };
    const handle = await open(
      target,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.size > MAX_WRITE_LINKED_RESOLUTION_CONFIG_BYTES
      ) {
        return { status: "unsafe" };
      }
      const buffer = await handle.readFile();
      const current = await lstat(target);
      if (
        buffer.byteLength > MAX_WRITE_LINKED_RESOLUTION_CONFIG_BYTES ||
        current.isSymbolicLink() ||
        !current.isFile() ||
        current.dev !== opened.dev ||
        current.ino !== opened.ino ||
        (await realpath(target)) !== target
      ) {
        return { status: "unsafe" };
      }
      return {
        status: "loaded",
        file: {
          path: relativePath,
          source: new TextDecoder("utf-8", { fatal: true }).decode(buffer),
          fileSha256: sha256(buffer),
          fileBytes: buffer.byteLength,
        },
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    return missing(error) ? { status: "missing" } : { status: "unsafe" };
  }
}

export function admitWriteLinkedResolutionConfiguration(
  configurations: Map<string, LoadedWriteLinkedResolutionConfiguration>,
  loaded: LoadedWriteLinkedResolutionConfiguration,
  reservedPathCount = 0,
): boolean {
  if (configurations.has(loaded.path)) return true;
  if (
    configurations.size + reservedPathCount >=
    MAX_WRITE_LINKED_RESOLUTION_CONFIGS
  ) {
    return false;
  }
  const currentBytes = [...configurations.values()].reduce(
    (total, configuration) => total + configuration.fileBytes,
    0,
  );
  if (
    currentBytes + loaded.fileBytes >
    MAX_WRITE_LINKED_RESOLUTION_TOTAL_BYTES
  ) {
    return false;
  }
  configurations.set(loaded.path, loaded);
  return true;
}

export function admitMissingWriteLinkedResolutionConfiguration(
  configurations: ReadonlyMap<string, LoadedWriteLinkedResolutionConfiguration>,
  missingConfigurations: Set<string>,
  relativePath: string,
): boolean {
  if (
    configurations.has(relativePath) ||
    missingConfigurations.has(relativePath)
  ) {
    return true;
  }
  if (
    configurations.size + missingConfigurations.size >=
    MAX_WRITE_LINKED_RESOLUTION_CONFIGS
  ) {
    return false;
  }
  missingConfigurations.add(relativePath);
  return true;
}

export async function observeWriteLinkedResolutionConfigurations(
  workspaceRoot: string,
  configurationPaths: string[],
): Promise<WriteLinkedResolutionConfiguration[]> {
  const observed = [];
  for (const configurationPath of [...configurationPaths].sort()) {
    const outcome = await loadWriteLinkedResolutionConfiguration(
      workspaceRoot,
      configurationPath,
    );
    observed.push({
      path: configurationPath,
      fileSha256:
        outcome.status === "loaded"
          ? outcome.file.fileSha256
          : sha256(outcome.status),
    });
  }
  return observed;
}

function missing(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && String(error.code) === "ENOENT"
  );
}
