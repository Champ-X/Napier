import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BUNDLED_SKILL_NAMES,
  copyBundledSkills,
} from "./copy-bundled-skills.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Runtime bundled Skill build assets", () => {
  it("copies only the six pinned Skills into the distribution", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-bundled-skills-"));
    roots.push(root);
    for (const name of BUNDLED_SKILL_NAMES) {
      const directory = path.join(root, "skills", name);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "SKILL.md"), `# ${name}\n`);
    }
    await writeFile(path.join(root, "skills", ".DS_Store"), "not packaged");
    await mkdir(path.join(root, "skills", "experimental"));
    await writeFile(
      path.join(root, "skills", "experimental", "SKILL.md"),
      "# not pinned\n",
    );

    await copyBundledSkills(root);

    const destination = path.join(
      root,
      "packages/runtime/dist/bundled-skills/skills",
    );
    await expect(readdir(destination)).resolves.toEqual(BUNDLED_SKILL_NAMES);
    for (const name of BUNDLED_SKILL_NAMES) {
      await expect(
        readFile(path.join(destination, name, "SKILL.md"), "utf8"),
      ).resolves.toBe(`# ${name}\n`);
    }
  });
});
