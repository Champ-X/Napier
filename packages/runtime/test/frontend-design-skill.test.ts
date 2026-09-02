import path from "node:path";

import {
  isSkillResourceLoadFailureV1,
  isSkillResourceLoadReceiptV1,
} from "@napier/contracts/skill-resource";
import { describe, expect, it } from "vitest";

import { buildProjectSkillSnapshot } from "../src/project-skill-snapshot.js";
import { createSkillAccessState } from "../src/skill-access-state.js";
import { createSkillLoadTool } from "../src/skill-load-tool.js";
import { createSkillResourceTool } from "../src/skill-resource-tool.js";
import { formatSkillCatalog, loadWorkspaceSkills } from "../src/skills.js";

describe("Frontend Design Skill progressive disclosure", () => {
  it("senses frontend intent from metadata without injecting the Skill body", async () => {
    const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
    const catalog = await loadWorkspaceSkills(workspaceRoot, [
      "frontend-design",
    ]);
    const prompt = formatSkillCatalog(catalog.skills);

    expect(prompt).toContain("frontend-design");
    expect(prompt).toContain("distinctive, intentional visual design");
    expect(prompt).not.toContain("Approach this as the design lead");
    expect(prompt).not.toContain("Frontend visual quality gate");
  });

  it("loads the selected body first and its referenced quality gate only afterwards", async () => {
    const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
    const snapshot = await buildProjectSkillSnapshot(workspaceRoot, [
      "frontend-design",
    ]);
    const access = createSkillAccessState();
    const load = createSkillLoadTool(snapshot, access);
    const resource = createSkillResourceTool(snapshot, access);
    const signal = new AbortController().signal;
    const request = {
      name: "frontend-design",
      path: "references/visual-quality-gate.md",
    };

    const premature = await resource.execute(
      "resource_before_load",
      request,
      signal,
    );
    expect(isSkillResourceLoadFailureV1(premature.details)).toBe(true);
    expect(premature.details).toMatchObject({
      failureCode: "skill_not_loaded",
    });

    const loaded = await load.execute(
      "load_frontend_design",
      { name: "frontend-design" },
      signal,
    );
    const body = String(
      loaded.content[0]?.type === "text" ? loaded.content[0].text : "",
    );
    expect(body).toContain("Approach this as the design lead");
    expect(body).toContain("references/visual-quality-gate.md");
    expect(body).not.toContain("The primary action or reading path is clear");

    const gate = await resource.execute("load_visual_gate", request, signal);
    expect(isSkillResourceLoadReceiptV1(gate.details)).toBe(true);
    expect(gate.details).toMatchObject({
      skillName: "frontend-design",
      resourcePath: "references/visual-quality-gate.md",
    });
    expect(
      String(gate.content[0]?.type === "text" ? gate.content[0].text : ""),
    ).toContain("The primary action or reading path is clear");
  });
});
