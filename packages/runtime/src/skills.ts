import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  formatSkillsForSystemPrompt,
  loadSkills,
  NodeExecutionEnv,
  type Skill,
} from "@earendil-works/pi-agent-core/node";

export interface LoadedSkillCatalog {
  skills: Skill[];
  diagnostics: string[];
  fingerprint: SkillCatalogFingerprint;
}

export interface SkillCatalogFingerprintEntry {
  name: string;
  relativePath: string;
  sizeBytes: number;
  contentSha256: string;
}

export interface SkillCatalogFingerprint {
  schemaVersion: 1;
  requestedSkillNames: string[];
  loadedSkillNames: string[];
  missingSkillNames: string[];
  diagnosticsSha256: string;
  skills: SkillCatalogFingerprintEntry[];
  contentSha256: string;
}

export async function loadWorkspaceSkills(
  workspaceRoot: string,
  enabledNames: readonly string[],
): Promise<LoadedSkillCatalog> {
  const environment = new NodeExecutionEnv({ cwd: workspaceRoot });
  const result = await loadSkills(
    environment,
    path.join(workspaceRoot, "skills"),
  );
  const enabled = new Set(enabledNames);
  const requestedSkillNames = canonicalSet(enabledNames);
  return {
    skills: result.skills.filter(
      (skill) => enabled.size === 0 || enabled.has(skill.name),
    ),
    diagnostics: result.diagnostics.map(
      (diagnostic) => `${diagnostic.path}: ${diagnostic.message}`,
    ),
    fingerprint: await createSkillCatalogFingerprint(
      workspaceRoot,
      result.skills.filter(
        (skill) => enabled.size === 0 || enabled.has(skill.name),
      ),
      requestedSkillNames,
      result.diagnostics.map(
        (diagnostic) => `${diagnostic.path}: ${diagnostic.message}`,
      ),
    ),
  };
}

export function appendSkillCatalog(
  systemPrompt: string,
  skills: readonly Skill[],
): string {
  const catalog = formatSkillsForSystemPrompt([...skills]);
  return catalog ? `${systemPrompt}\n\n${catalog}` : systemPrompt;
}

export async function createSkillCatalogFingerprint(
  workspaceRoot: string,
  skills: readonly Skill[],
  requestedSkillNames: readonly string[] = skills.map((skill) => skill.name),
  diagnostics: readonly string[] = [],
): Promise<SkillCatalogFingerprint> {
  const root = path.resolve(workspaceRoot);
  const entries = await Promise.all(
    skills.map(async (skill): Promise<SkillCatalogFingerprintEntry> => {
      const filePath = path.resolve(skill.filePath);
      const relativePath = path.relative(root, filePath);
      if (
        !relativePath ||
        relativePath.startsWith("..") ||
        path.isAbsolute(relativePath)
      ) {
        throw new Error(`Skill file is outside the workspace: ${skill.name}`);
      }
      const bytes = await readFile(filePath);
      return {
        name: skill.name,
        relativePath,
        sizeBytes: bytes.byteLength,
        contentSha256: sha256(bytes),
      };
    }),
  );
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const loadedSkillNames = entries.map((entry) => entry.name);
  const requested = canonicalSet(requestedSkillNames);
  const missingSkillNames =
    requested.length === 0
      ? []
      : requested.filter((name) => !loadedSkillNames.includes(name));
  const content = {
    schemaVersion: 1 as const,
    requestedSkillNames: requested,
    loadedSkillNames,
    missingSkillNames,
    diagnosticsSha256: sha256(
      Buffer.from(canonicalJson(canonicalSet(diagnostics))),
    ),
    skills: entries,
  };
  return {
    ...content,
    contentSha256: sha256(Buffer.from(canonicalJson(content))),
  };
}

function canonicalSet(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
