import path from "node:path";

import {
  discoverWriteLinkedResolutionConfiguration,
  observeWriteLinkedResolutionConfigurations,
  type WriteLinkedPathAlias,
  type WriteLinkedResolutionConfiguration,
  type WriteLinkedWorkspacePackage,
} from "./write-linked-resolution-config.js";
import {
  resolveWriteLinkedWorkspaceModule,
  writeLinkedModuleCandidates,
  type WriteLinkedScannedSource,
} from "./write-linked-test-graph.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export {
  MAX_WRITE_LINKED_PATH_ALIASES,
  MAX_WRITE_LINKED_RESOLUTION_CONFIG_BYTES,
  MAX_WRITE_LINKED_RESOLUTION_CONFIGS,
  MAX_WRITE_LINKED_WORKSPACE_PACKAGES,
} from "./write-linked-resolution-config.js";
export type { WriteLinkedResolutionConfiguration };

export type WriteLinkedModuleResolutionKind =
  | "relative"
  | "workspace_package"
  | "path_alias";

export interface WriteLinkedModuleResolution {
  scanRoots: string[];
  configurationFiles: WriteLinkedResolutionConfiguration[];
  configurationPaths: string[];
  workspacePackageCount: number;
  pathAliasCount: number;
  truncated: boolean;
  resolve(
    importer: string,
    specifier: string,
    byPath: ReadonlyMap<string, WriteLinkedScannedSource>,
  ): { path: string; kind: WriteLinkedModuleResolutionKind } | undefined;
  recognizesWorkspaceSpecifier(importer: string, specifier: string): boolean;
}

export async function createWriteLinkedModuleResolution(
  ts: typeof import("typescript"),
  workspaceRoot: string,
  changedPaths: string[],
): Promise<WriteLinkedModuleResolution> {
  const configuration = await discoverWriteLinkedResolutionConfiguration(
    ts,
    workspaceRoot,
    changedPaths,
  );
  const packages = [...configuration.packages].sort(
    (left, right) =>
      right.name.length - left.name.length ||
      left.name.localeCompare(right.name),
  );
  const aliases = [...configuration.aliases].sort(
    (left, right) =>
      right.appliesToRoot.length - left.appliesToRoot.length ||
      compareAliasPatterns(left.pattern, right.pattern),
  );
  return {
    scanRoots: configuration.scanRoots,
    configurationFiles: configuration.configurationFiles,
    configurationPaths: [
      ...new Set([
        ...configuration.configurationFiles.map((entry) => entry.path),
        ...configuration.missingConfigurationPaths,
      ]),
    ].sort(),
    workspacePackageCount: packages.length,
    pathAliasCount: aliases.length,
    truncated: configuration.truncated,
    resolve(importer, specifier, byPath) {
      const relative = resolveWriteLinkedWorkspaceModule(
        importer,
        specifier,
        byPath,
      );
      if (relative) return { path: relative, kind: "relative" };
      const alias = resolvePathAlias(importer, specifier, aliases, byPath);
      if (alias) return { path: alias, kind: "path_alias" };
      const workspacePackage = resolveWorkspacePackage(
        specifier,
        packages,
        byPath,
      );
      return workspacePackage
        ? { path: workspacePackage, kind: "workspace_package" }
        : undefined;
    },
    recognizesWorkspaceSpecifier(importer, specifier) {
      return (
        aliases.some(
          (alias) =>
            configApplies(alias.appliesToRoot, importer) &&
            matchPattern(alias.pattern, specifier) !== undefined,
        ) ||
        packages.some(
          (candidate) =>
            specifier === candidate.name ||
            specifier.startsWith(`${candidate.name}/`),
        )
      );
    },
  };
}

export { observeWriteLinkedResolutionConfigurations };

function resolvePathAlias(
  importer: string,
  specifier: string,
  aliases: WriteLinkedPathAlias[],
  byPath: ReadonlyMap<string, WriteLinkedScannedSource>,
): string | undefined {
  for (const alias of aliases) {
    if (!configApplies(alias.appliesToRoot, importer)) continue;
    const matched = matchPattern(alias.pattern, specifier);
    if (matched === undefined) continue;
    for (const target of alias.targets) {
      const base = target.replace("*", matched);
      const resolved = writeLinkedModuleCandidates(base).find((candidate) =>
        byPath.has(candidate),
      );
      if (resolved) return resolved;
    }
  }
  return undefined;
}

function resolveWorkspacePackage(
  specifier: string,
  packages: WriteLinkedWorkspacePackage[],
  byPath: ReadonlyMap<string, WriteLinkedScannedSource>,
): string | undefined {
  const workspacePackage = packages.find(
    (candidate) =>
      specifier === candidate.name ||
      specifier.startsWith(`${candidate.name}/`),
  );
  if (!workspacePackage) return undefined;
  const subpath =
    specifier === workspacePackage.name
      ? ""
      : specifier.slice(workspacePackage.name.length + 1);
  for (const base of packageModuleBases(workspacePackage, subpath)) {
    const resolved = writeLinkedModuleCandidates(base).find((candidate) =>
      byPath.has(candidate),
    );
    if (resolved) return resolved;
  }
  return undefined;
}

function packageModuleBases(
  workspacePackage: WriteLinkedWorkspacePackage,
  subpath: string,
): string[] {
  const configured =
    subpath === ""
      ? [
          workspacePackage.manifest["source"],
          ...exportTargets(workspacePackage.manifest["exports"], "."),
          workspacePackage.manifest["types"],
          workspacePackage.manifest["module"],
          workspacePackage.manifest["main"],
        ]
      : [
          ...exportTargets(
            workspacePackage.manifest["exports"],
            `./${subpath}`,
          ),
        ];
  const bases = configured.flatMap((candidate) =>
    typeof candidate === "string" && safePackageTarget(candidate)
      ? [
          path.posix.normalize(
            path.posix.join(workspacePackage.root || ".", candidate),
          ),
        ]
      : [],
  );
  bases.unshift(
    path.posix.join(
      workspacePackage.root || ".",
      subpath ? `src/${subpath}` : "src/index",
    ),
  );
  bases.push(
    path.posix.join(workspacePackage.root || ".", subpath ? subpath : "index"),
  );
  return [...new Set(bases)];
}

function exportTargets(value: unknown, key: string): string[] {
  const record = jsonRecord(value);
  return record ? collectStringLeaves(record[key]).slice(0, 8) : [];
}

function collectStringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  const record = jsonRecord(value);
  return record
    ? Object.values(record).flatMap(collectStringLeaves).slice(0, 8)
    : [];
}

function matchPattern(pattern: string, value: string): string | undefined {
  const star = pattern.indexOf("*");
  if (star < 0) return pattern === value ? "" : undefined;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return value.startsWith(prefix) && value.endsWith(suffix)
    ? value.slice(prefix.length, value.length - suffix.length)
    : undefined;
}

function compareAliasPatterns(left: string, right: string): number {
  const leftStar = left.indexOf("*");
  const rightStar = right.indexOf("*");
  if (leftStar < 0 || rightStar < 0) {
    if (leftStar < 0 && rightStar >= 0) return -1;
    if (rightStar < 0 && leftStar >= 0) return 1;
  }
  return (
    rightStar - leftStar ||
    right.slice(rightStar + 1).length - left.slice(leftStar + 1).length ||
    left.localeCompare(right)
  );
}

function configApplies(configRoot: string, importer: string): boolean {
  return (
    configRoot === "." ||
    importer === configRoot ||
    importer.startsWith(`${configRoot}/`)
  );
}

function safePackageTarget(value: string): boolean {
  return (
    value.startsWith("./") &&
    !value.includes("*") &&
    !value.split("/").some(isProtectedWorkspacePathSegment) &&
    !path.posix.normalize(value).startsWith("../")
  );
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
