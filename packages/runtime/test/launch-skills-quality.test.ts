import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadWorkspaceSkills } from "../src/skills.js";

const LAUNCH_SKILLS = [
  "artifact-studio",
  "browser-automation",
  "data-analysis",
  "frontend-design",
  "research-brief",
  "software-delivery",
] as const;

describe("launch Skill quality contract", () => {
  it("loads all six launch Skills without diagnostics", async () => {
    const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
    const catalog = await loadWorkspaceSkills(workspaceRoot, LAUNCH_SKILLS);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.fingerprint).toEqual(
      expect.objectContaining({
        requestedSkillNames: [...LAUNCH_SKILLS],
        loadedSkillNames: [...LAUNCH_SKILLS],
        missingSkillNames: [],
        skills: LAUNCH_SKILLS.map((name) =>
          expect.objectContaining({
            name,
            relativePath: `skills/${name}/SKILL.md`,
            contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
        ),
      }),
    );
  });

  it("keeps Frontend Design tied to rendered browser verification and a progressively loaded gate", async () => {
    const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
    const content = await readFile(
      path.join(workspaceRoot, "skills/frontend-design/SKILL.md"),
      "utf8",
    );

    for (const requirement of [
      "Approach this as the design lead",
      "AI-generated design right now clusters",
      "Work in two passes",
      "visible keyboard focus",
      "narrow viewport",
      "skill_resource",
      "references/visual-quality-gate.md",
      "do not claim rendered visual verification",
    ]) {
      expect(content).toContain(requirement);
    }
    expect(content).toContain("53048666b05b4799081517d00e09e0a2dd688678");
    expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(12 * 1024);
  });

  it("keeps Artifact Studio bound to the real Plan verification workflow", async () => {
    const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
    const content = await readFile(
      path.join(workspaceRoot, "skills/artifact-studio/SKILL.md"),
      "utf8",
    );

    for (const requirement of [
      "acceptance criteria",
      "update_plan_artifact",
      "`produced`, then `verify`",
      "computes its SHA-256",
      "replan_plan",
      "artifact_drift",
      "do not claim delivery",
      "exact missing capability",
    ]) {
      expect(content).toContain(requirement);
    }
    expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(4 * 1024);
  });

  it("keeps Research Brief bounded by evidence sufficiency", async () => {
    const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
    const content = await readFile(
      path.join(workspaceRoot, "skills/research-brief/SKILL.md"),
      "utf8",
    );

    for (const requirement of [
      "at most 6 discovery searches",
      "Do not keep searching",
      "transition to",
      "artifact production",
      "do not repeatedly retry",
    ]) {
      expect(content).toContain(requirement);
    }
    expect(content).toMatch(/8 fetched\s+sources/u);
    expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(4 * 1024);
  });
});
