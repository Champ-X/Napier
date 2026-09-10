import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { inspectStandardSkillCatalog } from "@napier/runtime/standard-skill-catalog";
import { installTessmoraSkill } from "./install-tessmora-skill.mjs";

it("installs one user Skill discoverable from independent workspaces with an absolute launcher", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napier-shared-skill-"));
  try {
    const home = path.join(root, "home with spaces");
    await mkdir(home);
    const installed = await installTessmoraSkill(home);
    const body = await readFile(path.join(installed, "SKILL.md"), "utf8");
    const example = JSON.parse(body.match(/```json\n([^]*?)\n```/u)[1]);
    expect(example.args).toEqual([
      path.join(installed, "scripts/mma-rag.mjs"),
      "health",
    ]);
    expect(body).not.toContain("__TESSMORA_CLI__");
    for (const workspace of ["first", "second"]) {
      const workspaceRoot = path.join(root, workspace);
      await mkdir(workspaceRoot);
      const catalog = await inspectStandardSkillCatalog(workspaceRoot, {
        userHome: home,
      });
      expect(catalog).toContainEqual(
        expect.objectContaining({
          name: "mma-rag",
          source: "user",
          enabled: true,
        }),
      );
    }
    await installTessmoraSkill(home);
    expect(await readFile(path.join(installed, "SKILL.md"), "utf8")).toBe(body);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
