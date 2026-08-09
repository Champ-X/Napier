import type {
  StandardSkillRootKind,
  StandardSkillSource,
} from "./skill-load-standard-types.js";
import {
  canonical,
  exact,
  hashed,
  hex,
  integer,
  name,
  object,
  sha256,
} from "./skill-load-validation.js";

export const SKILL_RESOURCE_FAILURE_CODES = [
  "skill_not_enabled",
  "skill_not_loaded",
  "resource_invalid",
  "resource_not_found",
  "resource_untrusted",
  "resource_limit_exceeded",
  "resource_catalog_drift",
  "resource_load_cancelled",
] as const;

export type SkillResourceFailureCode =
  (typeof SKILL_RESOURCE_FAILURE_CODES)[number];

export interface SkillResourceLoadReceiptV1 {
  kind: "napier.skill-resource-load-receipt";
  schemaVersion: 1;
  operation: "skill.resource.load";
  agentToolName: "skill_resource";
  state: "loaded";
  skillName: string;
  requestedNameSha256: string;
  source: StandardSkillSource;
  rootKind: StandardSkillRootKind;
  resourcePath: string;
  requestedResourcePathSha256: string;
  relativePath: string;
  virtualPath: string;
  sizeBytes: number;
  lineCount: number;
  rawContentSha256: string;
  catalogSha256: string;
  snapshotManifestSha256: string;
  resourceBindingSha256: string;
  contentSha256: string;
}

export interface SkillResourceLoadFailureV1 {
  kind: "napier.skill-resource-load-failure";
  schemaVersion: 1;
  operation: "skill.resource.load";
  agentToolName: "skill_resource";
  source: "composite";
  state: "failed";
  failureCode: SkillResourceFailureCode;
  requestedNameSha256: string;
  requestedResourcePathSha256: string;
  skillName?: string;
  resourcePath?: string;
  candidateRootKinds: StandardSkillRootKind[];
  catalogSha256: string;
  snapshotManifestSha256: string;
  diagnosticSha256: string;
  contentSha256: string;
}

const ROOTS: readonly StandardSkillRootKind[] = [
  "project_legacy",
  "project_standard",
  "user_standard",
];
const FAILURES = new Set<string>(SKILL_RESOURCE_FAILURE_CODES);
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const TEXT_EXTENSIONS = new Set([
  "css",
  "csv",
  "html",
  "js",
  "json",
  "jsonl",
  "jsx",
  "md",
  "mdx",
  "mjs",
  "cjs",
  "py",
  "sh",
  "sql",
  "toml",
  "ts",
  "tsx",
  "tsv",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

export function isSkillResourcePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    new TextEncoder().encode(value).length > 240 ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/")
  ) {
    return false;
  }
  const parts = value.split("/");
  if (
    parts.length < 1 ||
    parts.length > 6 ||
    parts.some(
      (part) =>
        !SEGMENT.test(part) ||
        part === "." ||
        part === ".." ||
        part.startsWith(".") ||
        part.endsWith("."),
    )
  ) {
    return false;
  }
  const extension = parts.at(-1)?.split(".").at(-1)?.toLowerCase();
  return Boolean(extension && TEXT_EXTENSIONS.has(extension));
}

export function skillResourceRelativePath(
  rootKind: StandardSkillRootKind,
  skillName: string,
  resourcePath: string,
): string {
  const prefix = rootKind === "project_legacy" ? "skills" : ".agents/skills";
  return `${prefix}/${skillName}/${resourcePath}`;
}

export function skillResourceVirtualPath(
  rootKind: StandardSkillRootKind,
  skillName: string,
  resourcePath: string,
): string {
  const owner = rootKind === "user_standard" ? "/user" : "/project";
  return `${owner}/${skillResourceRelativePath(rootKind, skillName, resourcePath)}`;
}

export function skillResourceBindingSha256(input: {
  skillName: string;
  resourcePath: string;
  rawContentSha256: string;
  catalogSha256: string;
  snapshotManifestSha256: string;
}): string {
  return sha256(canonical(input));
}

export function isSkillResourceLoadReceiptV1(
  value: unknown,
): value is SkillResourceLoadReceiptV1 {
  if (!object(value) || !exact(value, RECEIPT_KEYS)) return false;
  if (
    value.kind !== "napier.skill-resource-load-receipt" ||
    value.schemaVersion !== 1 ||
    value.operation !== "skill.resource.load" ||
    value.agentToolName !== "skill_resource" ||
    value.state !== "loaded" ||
    !name(value.skillName) ||
    value.requestedNameSha256 !== sha256(value.skillName) ||
    !rootSource(value.rootKind, value.source) ||
    !isSkillResourcePath(value.resourcePath) ||
    value.requestedResourcePathSha256 !== sha256(value.resourcePath) ||
    value.relativePath !==
      skillResourceRelativePath(
        value.rootKind,
        value.skillName,
        value.resourcePath,
      ) ||
    value.virtualPath !==
      skillResourceVirtualPath(
        value.rootKind,
        value.skillName,
        value.resourcePath,
      ) ||
    !integer(value.sizeBytes, 1, 65_536) ||
    !integer(value.lineCount, 1, 65_537) ||
    !["rawContentSha256", "catalogSha256", "snapshotManifestSha256"].every(
      (key) => hex(value[key]),
    )
  ) {
    return false;
  }
  const binding = skillResourceBindingSha256({
    skillName: value.skillName,
    resourcePath: value.resourcePath,
    rawContentSha256: value.rawContentSha256 as string,
    catalogSha256: value.catalogSha256 as string,
    snapshotManifestSha256: value.snapshotManifestSha256 as string,
  });
  return (
    value.resourceBindingSha256 === binding && hashed(value, "contentSha256")
  );
}

export function isSkillResourceLoadFailureV1(
  value: unknown,
): value is SkillResourceLoadFailureV1 {
  if (
    !object(value) ||
    !exact(value, FAILURE_KEYS, ["skillName", "resourcePath"]) ||
    value.kind !== "napier.skill-resource-load-failure" ||
    value.schemaVersion !== 1 ||
    value.operation !== "skill.resource.load" ||
    value.agentToolName !== "skill_resource" ||
    value.source !== "composite" ||
    value.state !== "failed" ||
    !FAILURES.has(String(value.failureCode)) ||
    !hex(value.requestedNameSha256) ||
    !hex(value.requestedResourcePathSha256) ||
    !hex(value.catalogSha256) ||
    !hex(value.snapshotManifestSha256) ||
    !hex(value.diagnosticSha256) ||
    !roots(value.candidateRootKinds)
  ) {
    return false;
  }
  if (
    (value.skillName !== undefined &&
      (!name(value.skillName) ||
        value.requestedNameSha256 !== sha256(value.skillName))) ||
    (value.resourcePath !== undefined &&
      (!isSkillResourcePath(value.resourcePath) ||
        value.requestedResourcePathSha256 !== sha256(value.resourcePath)))
  ) {
    return false;
  }
  return hashed(value, "contentSha256");
}

const RECEIPT_KEYS = [
  "kind",
  "schemaVersion",
  "operation",
  "agentToolName",
  "state",
  "skillName",
  "requestedNameSha256",
  "source",
  "rootKind",
  "resourcePath",
  "requestedResourcePathSha256",
  "relativePath",
  "virtualPath",
  "sizeBytes",
  "lineCount",
  "rawContentSha256",
  "catalogSha256",
  "snapshotManifestSha256",
  "resourceBindingSha256",
  "contentSha256",
];
const FAILURE_KEYS = [
  "kind",
  "schemaVersion",
  "operation",
  "agentToolName",
  "source",
  "state",
  "failureCode",
  "requestedNameSha256",
  "requestedResourcePathSha256",
  "candidateRootKinds",
  "catalogSha256",
  "snapshotManifestSha256",
  "diagnosticSha256",
  "contentSha256",
];

function rootSource(
  root: unknown,
  source: unknown,
): root is StandardSkillRootKind {
  return (
    ROOTS.includes(root as StandardSkillRootKind) &&
    source === (root === "user_standard" ? "user" : "project")
  );
}

function roots(value: unknown): value is StandardSkillRootKind[] {
  return (
    Array.isArray(value) &&
    value.length <= ROOTS.length &&
    value.every(
      (root, index) =>
        root === ROOTS[ROOTS.indexOf(root)] &&
        ROOTS.indexOf(root) >= 0 &&
        (index === 0 ||
          ROOTS.indexOf(root) >
            ROOTS.indexOf(value[index - 1] as StandardSkillRootKind)),
    )
  );
}
