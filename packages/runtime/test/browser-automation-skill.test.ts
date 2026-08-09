import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadWorkspaceSkills } from "../src/skills.js";

describe("Browser Automation Skill", () => {
  it("loads through the workspace Skill catalog with a stable fingerprint", async () => {
    const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
    const catalog = await loadWorkspaceSkills(workspaceRoot, [
      "browser-automation",
    ]);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.skills).toEqual([
      expect.objectContaining({
        name: "browser-automation",
        description: expect.stringContaining("dynamic-page"),
      }),
    ]);
    expect(catalog.fingerprint).toEqual(
      expect.objectContaining({
        requestedSkillNames: ["browser-automation"],
        loadedSkillNames: ["browser-automation"],
        missingSkillNames: [],
        skills: [
          expect.objectContaining({
            name: "browser-automation",
            relativePath: "skills/browser-automation/SKILL.md",
            contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
        ],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });
});
