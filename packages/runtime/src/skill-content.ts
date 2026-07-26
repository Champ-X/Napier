import { lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  NAPIER_API_VERSION,
  type ApplySkillContentResult,
  type SkillContentReviewAction,
  type SkillContentReview,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { nowIso } from "./ids.js";
import { applyWorkspacePatch } from "./tools.js";

export const MAX_SKILL_CONTENT_BYTES = 128 * 1024;

const SKILL_NAME = /^[a-z0-9][a-z0-9_-]{0,79}$/;

interface SkillContentCandidate {
  name: string;
  content: string;
  sizeBytes: number;
  lineCount: number;
  contentSha256: string;
  frontmatterSha256: string;
  bodySha256: string;
  relativePath: string;
}

export async function createSkillContentReview(
  workspaceRoot: string,
  content: string,
  generatedAt = nowIso(),
): Promise<SkillContentReview> {
  const candidate = parseSkillContentCandidate(content);
  const current = await inspectSkillTarget(workspaceRoot, candidate.name);
  const action: SkillContentReviewAction =
    current.currentContentSha256 === undefined
      ? "install"
      : current.currentContentSha256 === candidate.contentSha256
        ? "noop"
        : "replace";
  const stable = {
    kind: "napier.skill-content-review" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    skillName: candidate.name,
    relativePath: candidate.relativePath,
    action,
    sizeBytes: candidate.sizeBytes,
    lineCount: candidate.lineCount,
    contentSha256: candidate.contentSha256,
    frontmatterSha256: candidate.frontmatterSha256,
    bodySha256: candidate.bodySha256,
    ...(current.currentContentSha256
      ? {
          currentContentSha256: current.currentContentSha256,
          currentSizeBytes: current.currentSizeBytes!,
          currentLineCount: current.currentLineCount!,
        }
      : {}),
  };
  return {
    ...stable,
    generatedAt,
    reviewSha256: hashSkillContentReview(stable),
  };
}

export function hashSkillContentReview(
  input: Omit<SkillContentReview, "generatedAt" | "reviewSha256">,
): string {
  return sha256(canonicalJson(input));
}

export async function applyReviewedSkillContent(
  workspaceRoot: string,
  dataRoot: string,
  input: {
    content: string;
    expectedReviewSha256: string;
    confirmInstall?: boolean;
    confirmReplacement?: boolean;
  },
): Promise<ApplySkillContentResult> {
  if (!/^[a-f0-9]{64}$/.test(input.expectedReviewSha256)) {
    throw new Error("Skill content review SHA-256 is invalid");
  }
  const review = await createSkillContentReview(workspaceRoot, input.content);
  if (review.reviewSha256 !== input.expectedReviewSha256) {
    throw new Error("Skill content review has changed");
  }
  if (review.action === "install" && input.confirmInstall !== true) {
    throw new Error("Skill content install requires confirmation");
  }
  if (review.action === "replace" && input.confirmReplacement !== true) {
    throw new Error("Skill content replacement requires confirmation");
  }
  if (review.action === "noop") {
    return { review, applied: false };
  }
  const candidate = parseSkillContentCandidate(input.content);
  await ensureSkillTargetParent(workspaceRoot, candidate.name);
  const result =
    review.action === "install"
      ? await applyWorkspacePatch(workspaceRoot, dataRoot, {
          operation: "create",
          path: candidate.relativePath,
          expectedSha256: null,
          content: candidate.content,
        })
      : await applyWorkspacePatch(workspaceRoot, dataRoot, {
          operation: "replace",
          path: candidate.relativePath,
          expectedSha256: review.currentContentSha256!,
          edits: [
            {
              oldText: await readCurrentSkillText(
                workspaceRoot,
                candidate.name,
              ),
              newText: candidate.content,
            },
          ],
        });
  if (result.afterSha256 !== review.contentSha256) {
    throw new Error("Skill content write hash mismatch");
  }
  return { review, applied: true };
}

function parseSkillContentCandidate(content: string): SkillContentCandidate {
  if (typeof content !== "string" || content.includes("\u0000")) {
    throw new Error("Skill content must be UTF-8 text without null bytes");
  }
  const bytes = Buffer.from(content, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_SKILL_CONTENT_BYTES) {
    throw new Error(`Skill content must be 1-${MAX_SKILL_CONTENT_BYTES} bytes`);
  }
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) {
    throw new Error("Skill content must start with SKILL.md frontmatter");
  }
  const frontmatterText = frontmatter[0];
  const bodyText = content.slice(frontmatterText.length);
  const name = frontmatter[1]
    ?.split(/\r?\n/)
    .map((line) => line.match(/^name:\s*([a-z0-9][a-z0-9_-]{0,79})\s*$/)?.[1])
    .find((value): value is string => Boolean(value));
  if (!name || !SKILL_NAME.test(name)) {
    throw new Error("Skill content frontmatter name is invalid");
  }
  return {
    name,
    content,
    sizeBytes: bytes.byteLength,
    lineCount: countLines(content),
    contentSha256: sha256(bytes),
    frontmatterSha256: sha256(Buffer.from(frontmatterText, "utf8")),
    bodySha256: sha256(Buffer.from(bodyText, "utf8")),
    relativePath: `skills/${name}/SKILL.md`,
  };
}

async function inspectSkillTarget(
  workspaceRoot: string,
  skillName: string,
): Promise<{
  currentContentSha256?: string;
  currentSizeBytes?: number;
  currentLineCount?: number;
}> {
  const root = path.resolve(workspaceRoot);
  const skillsDir = path.join(root, "skills");
  const skillDir = path.join(skillsDir, skillName);
  const target = path.join(skillDir, "SKILL.md");
  for (const directory of [skillsDir, skillDir]) {
    try {
      const info = await lstat(directory);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error("Skill content target parent is invalid");
      }
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      throw error;
    }
  }
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error("Skill content target is invalid");
    }
    const content = await readFile(target);
    return {
      currentContentSha256: sha256(content),
      currentSizeBytes: content.byteLength,
      currentLineCount: countLines(content.toString("utf8")),
    };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return {};
    throw error;
  }
}

async function ensureSkillTargetParent(
  workspaceRoot: string,
  skillName: string,
): Promise<void> {
  const root = path.resolve(workspaceRoot);
  const skillsDir = path.join(root, "skills");
  const skillDir = path.join(skillsDir, skillName);
  await mkdir(root, { recursive: true });
  await ensureDirectory(skillsDir);
  await ensureDirectory(skillDir);
}

async function ensureDirectory(directory: string): Promise<void> {
  try {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("Skill content target parent is invalid");
    }
    return;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  try {
    await mkdir(directory);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("Skill content target parent is invalid");
  }
}

async function readCurrentSkillText(
  workspaceRoot: string,
  skillName: string,
): Promise<string> {
  const target = path.join(
    path.resolve(workspaceRoot),
    "skills",
    skillName,
    "SKILL.md",
  );
  const content = await readFile(target, "utf8");
  if (!content) {
    throw new Error("Skill content target is empty");
  }
  return content;
}

function countLines(content: string): number {
  return content.split(/\r\n|\r|\n/).length;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
