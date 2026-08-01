import path from "node:path";

import {
  admitMissingWriteLinkedResolutionConfiguration,
  admitWriteLinkedResolutionConfiguration,
  loadWriteLinkedResolutionConfiguration,
  type LoadedWriteLinkedResolutionConfiguration,
  type WriteLinkedResolutionConfiguration,
} from "./write-linked-resolution-files.js";
import { normalizeWriteLinkedPath } from "./write-linked-test-graph.js";
import {
  expandWriteLinkedWorkspacePattern,
  MAX_WRITE_LINKED_WORKSPACE_PACKAGES,
  nearestWriteLinkedPackageRoot,
  writeLinkedWorkspacePatterns,
} from "./write-linked-workspace-discovery.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export const MAX_WRITE_LINKED_PATH_ALIASES = 128;
export { MAX_WRITE_LINKED_WORKSPACE_PACKAGES };
export {
  MAX_WRITE_LINKED_RESOLUTION_CONFIG_BYTES,
  MAX_WRITE_LINKED_RESOLUTION_CONFIGS,
  MAX_WRITE_LINKED_RESOLUTION_TOTAL_BYTES,
  observeWriteLinkedResolutionConfigurations,
} from "./write-linked-resolution-files.js";
export type { WriteLinkedResolutionConfiguration };

export interface WriteLinkedWorkspacePackage {
  root: string;
  name: string;
  manifest: Record<string, unknown>;
}

export interface WriteLinkedPathAlias {
  appliesToRoot: string;
  pattern: string;
  targets: string[];
}

export interface WriteLinkedResolutionConfigurationSet {
  scanRoots: string[];
  configurationFiles: WriteLinkedResolutionConfiguration[];
  missingConfigurationPaths: string[];
  packages: WriteLinkedWorkspacePackage[];
  aliases: WriteLinkedPathAlias[];
  truncated: boolean;
}

export async function discoverWriteLinkedResolutionConfiguration(
  ts: typeof import("typescript"),
  workspaceRoot: string,
  changedPaths: string[],
): Promise<WriteLinkedResolutionConfigurationSet> {
  const configurations = new Map<
    string,
    LoadedWriteLinkedResolutionConfiguration
  >();
  const missingConfigurations = new Set<string>();
  const packageRoots = new Set<string>();
  const nearestPackageRoots = new Set<string>();
  const declaredPackageRoots = new Set<string>();
  let truncated = false;
  let workspaceDeclared = false;
  let workspaceDeclarationPresent = false;
  let workspaceDeclarationInvalid = false;

  for (const changedPath of changedPaths) {
    const nearest = await nearestWriteLinkedPackageRoot(
      workspaceRoot,
      changedPath,
    );
    packageRoots.add(nearest.root);
    nearestPackageRoots.add(nearest.root);
    truncated ||= nearest.truncated;
  }
  const rootOutcome = await loadWriteLinkedResolutionConfiguration(
    workspaceRoot,
    "package.json",
  );
  if (rootOutcome.status === "unsafe") truncated = true;
  if (rootOutcome.status === "missing") {
    if (
      !admitMissingWriteLinkedResolutionConfiguration(
        configurations,
        missingConfigurations,
        "package.json",
      )
    ) {
      truncated = true;
    }
  }
  const rootManifest =
    rootOutcome.status === "loaded" ? rootOutcome.file : undefined;
  if (rootManifest) {
    if (
      !admitWriteLinkedResolutionConfiguration(
        configurations,
        rootManifest,
        missingConfigurations.size,
      )
    ) {
      truncated = true;
    }
    let manifest: Record<string, unknown> | undefined;
    try {
      manifest = jsonRecord(JSON.parse(rootManifest.source));
    } catch {
      truncated = true;
    }
    if (manifest?.["workspaces"] !== undefined) {
      workspaceDeclarationPresent = true;
      const patterns = writeLinkedWorkspacePatterns(manifest["workspaces"]);
      if (!patterns) {
        truncated = true;
        workspaceDeclarationInvalid = true;
      } else {
        for (const pattern of patterns) {
          const expanded = await expandWriteLinkedWorkspacePattern(
            workspaceRoot,
            pattern,
          );
          if (!expanded) {
            truncated = true;
            workspaceDeclarationInvalid = true;
            continue;
          }
          for (const root of expanded) {
            declaredPackageRoots.add(root);
            if (
              declaredPackageRoots.size > MAX_WRITE_LINKED_WORKSPACE_PACKAGES
            ) {
              truncated = true;
              break;
            }
          }
        }
      }
    }
  }
  workspaceDeclared =
    workspaceDeclarationPresent &&
    (workspaceDeclarationInvalid ||
      nearestPackageRoots.has(workspaceRoot) ||
      [...nearestPackageRoots].some((root) => declaredPackageRoots.has(root)));
  for (const root of declaredPackageRoots) {
    packageRoots.add(root);
    if (packageRoots.size > MAX_WRITE_LINKED_WORKSPACE_PACKAGES) {
      truncated = true;
      break;
    }
  }

  const packages: WriteLinkedWorkspacePackage[] = [];
  const names = new Set<string>();
  for (const packageRoot of [...packageRoots].sort()) {
    if (packages.length >= MAX_WRITE_LINKED_WORKSPACE_PACKAGES) {
      truncated = true;
      break;
    }
    const relativeManifest = normalizeWriteLinkedPath(
      path.relative(workspaceRoot, path.join(packageRoot, "package.json")),
    );
    const cached = configurations.get(relativeManifest);
    const outcome = cached
      ? ({ status: "loaded", file: cached } as const)
      : missingConfigurations.has(relativeManifest)
        ? ({ status: "missing" } as const)
        : await loadWriteLinkedResolutionConfiguration(
            workspaceRoot,
            relativeManifest,
          );
    if (outcome.status === "unsafe") {
      truncated = true;
      continue;
    }
    if (outcome.status === "missing") {
      if (
        !admitMissingWriteLinkedResolutionConfiguration(
          configurations,
          missingConfigurations,
          relativeManifest,
        )
      ) {
        truncated = true;
      }
      continue;
    }
    const loaded = outcome.file;
    if (
      !admitWriteLinkedResolutionConfiguration(
        configurations,
        loaded,
        missingConfigurations.size,
      )
    ) {
      truncated = true;
      break;
    }
    let manifest: Record<string, unknown>;
    try {
      const parsed = jsonRecord(JSON.parse(loaded.source));
      if (!parsed) throw new Error("package manifest must be an object");
      manifest = parsed;
    } catch {
      truncated = true;
      continue;
    }
    const name = manifest["name"];
    if (typeof name !== "string" || !packageName(name)) continue;
    if (names.has(name)) {
      truncated = true;
      continue;
    }
    names.add(name);
    packages.push({
      root: normalizeWriteLinkedPath(path.relative(workspaceRoot, packageRoot)),
      name,
      manifest,
    });
  }

  const aliases: WriteLinkedPathAlias[] = [];
  for (const configRoot of new Set([
    workspaceRoot,
    ...[...packageRoots].sort(),
  ])) {
    const relative = normalizeWriteLinkedPath(
      path.relative(workspaceRoot, path.join(configRoot, "tsconfig.json")),
    );
    const outcome = await loadTsconfigChain(
      ts,
      workspaceRoot,
      relative,
      configurations,
      missingConfigurations,
      aliases,
      normalizeWriteLinkedPath(path.relative(workspaceRoot, configRoot) || "."),
      new Set(),
      0,
    );
    truncated ||= outcome.truncated;
  }
  return {
    scanRoots: workspaceDeclared
      ? [workspaceRoot]
      : [...nearestPackageRoots].sort(),
    configurationFiles: [...configurations.values()]
      .map((config) => ({
        path: config.path,
        fileSha256: config.fileSha256,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    missingConfigurationPaths: [...missingConfigurations].sort(),
    packages,
    aliases,
    truncated,
  };
}

async function loadTsconfigChain(
  ts: typeof import("typescript"),
  workspaceRoot: string,
  relativePath: string,
  configurations: Map<string, LoadedWriteLinkedResolutionConfiguration>,
  missingConfigurations: Set<string>,
  aliases: WriteLinkedPathAlias[],
  appliesToRoot: string,
  active: Set<string>,
  depth: number,
  required = false,
): Promise<{ truncated: boolean }> {
  if (depth > 4) return { truncated: true };
  if (missingConfigurations.has(relativePath)) {
    return { truncated: required };
  }
  const cached = configurations.get(relativePath);
  const outcome = cached
    ? ({ status: "loaded", file: cached } as const)
    : await loadWriteLinkedResolutionConfiguration(workspaceRoot, relativePath);
  if (outcome.status === "missing") {
    return {
      truncated:
        required ||
        !admitMissingWriteLinkedResolutionConfiguration(
          configurations,
          missingConfigurations,
          relativePath,
        ),
    };
  }
  if (outcome.status === "unsafe") return { truncated: true };
  if (active.has(relativePath)) return { truncated: true };
  active.add(relativePath);
  try {
    const loaded = outcome.file;
    if (
      !admitWriteLinkedResolutionConfiguration(
        configurations,
        loaded,
        missingConfigurations.size,
      )
    ) {
      return { truncated: true };
    }
    const parsed = ts.parseConfigFileTextToJson(relativePath, loaded.source);
    if (parsed.error || !parsed.config || typeof parsed.config !== "object") {
      return { truncated: true };
    }
    const config = parsed.config as Record<string, unknown>;
    let truncated = false;
    const extension = config["extends"];
    if (extension !== undefined) {
      if (
        typeof extension !== "string" ||
        !extension.startsWith(".") ||
        extension.includes("\0")
      ) {
        truncated = true;
      } else {
        const extended = normalizeWriteLinkedPath(
          path.posix.join(
            path.posix.dirname(relativePath),
            extension.endsWith(".json") ? extension : `${extension}.json`,
          ),
        );
        if (extended === ".." || extended.startsWith("../")) {
          truncated = true;
        } else {
          const result = await loadTsconfigChain(
            ts,
            workspaceRoot,
            extended,
            configurations,
            missingConfigurations,
            aliases,
            appliesToRoot,
            active,
            depth + 1,
            true,
          );
          truncated ||= result.truncated;
        }
      }
    }
    const compilerOptions = jsonRecord(config["compilerOptions"]);
    const paths = compilerOptions
      ? jsonRecord(compilerOptions["paths"])
      : undefined;
    if (!compilerOptions || !paths) return { truncated };
    if (extension !== undefined) truncated = true;
    const entries = Object.entries(paths);
    if (entries.length > MAX_WRITE_LINKED_PATH_ALIASES) truncated = true;
    const configRoot = path.posix.dirname(relativePath);
    const baseUrlValue =
      typeof compilerOptions["baseUrl"] === "string"
        ? compilerOptions["baseUrl"]
        : ".";
    if (
      path.posix.isAbsolute(baseUrlValue) ||
      /[\u0000-\u001f\u007f]/u.test(baseUrlValue)
    ) {
      return { truncated: true };
    }
    const baseRoot = path.posix.normalize(
      path.posix.join(configRoot, baseUrlValue),
    );
    if (baseRoot === ".." || baseRoot.startsWith("../")) {
      return { truncated: true };
    }
    for (const [pattern, value] of entries.slice(
      0,
      MAX_WRITE_LINKED_PATH_ALIASES,
    )) {
      if (
        !safeAliasPattern(pattern) ||
        !Array.isArray(value) ||
        value.length < 1 ||
        value.length > 8
      ) {
        truncated = true;
        continue;
      }
      const targets = [];
      for (const target of value) {
        if (typeof target !== "string" || !safeAliasPattern(target)) {
          truncated = true;
          continue;
        }
        const resolved = path.posix.normalize(
          path.posix.join(baseRoot, target),
        );
        if (
          resolved === ".." ||
          resolved.startsWith("../") ||
          resolved.split("/").some(isProtectedWorkspacePathSegment)
        ) {
          truncated = true;
          continue;
        }
        targets.push(resolved);
      }
      if (targets.length > 0) {
        if (aliases.length >= MAX_WRITE_LINKED_PATH_ALIASES) {
          truncated = true;
        } else {
          aliases.push({ appliesToRoot, pattern, targets });
        }
      }
    }
    return { truncated };
  } finally {
    active.delete(relativePath);
  }
}

function safeAliasPattern(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 500 &&
    !path.posix.isAbsolute(value) &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    (value.match(/\*/gu)?.length ?? 0) <= 1
  );
}

function packageName(value: string): boolean {
  return (
    value.length <= 214 && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/iu.test(value)
  );
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
