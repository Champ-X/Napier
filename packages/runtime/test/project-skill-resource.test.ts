import {
  appendFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ProjectSkillResourceError } from "../src/project-skill-resource.js";
import { buildProjectSkillSnapshot } from "../src/project-skill-snapshot.js";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-skill-resource-"));
  roots.push(root);
  const skill = path.join(root, "skills", "research-brief");
  await mkdir(path.join(skill, "references"), { recursive: true });
  await writeFile(
    path.join(skill, "SKILL.md"),
    [
      "---",
      "name: research-brief",
      "description: Produce a bounded research brief.",
      "---",
      "# Research brief",
      "",
      "Load references/quality-checklist.md only when checking quality.",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(skill, "references", "quality-checklist.md"),
    "# Quality checklist\n\n- Prefer primary sources.\n- Cite every claim.\n",
  );
  return { root, skill };
}

describe("project Skill resource loading", () => {
  it("loads one nested text resource without including it in the base snapshot", async () => {
    const { root } = await fixture();
    const snapshot = await buildProjectSkillSnapshot(root, ["research-brief"]);

    expect(JSON.stringify(snapshot.content)).not.toContain("Quality checklist");
    const resource = await snapshot.loadResource(
      "research-brief",
      "references/quality-checklist.md",
    );

    expect(resource).toMatchObject({
      skillName: "research-brief",
      resourcePath: "references/quality-checklist.md",
      relativePath: "skills/research-brief/references/quality-checklist.md",
      virtualPath:
        "/project/skills/research-brief/references/quality-checklist.md",
      fileKind: "regular_file",
      symlinkFree: true,
    });
    expect(resource.text).toContain("Prefer primary sources");
    expect(JSON.stringify(snapshot.manifest)).not.toContain(root);
  });

  it("rejects traversal, binary, missing, empty, invalid UTF-8 and oversized files", async () => {
    const { root, skill } = await fixture();
    await writeFile(path.join(skill, "references", "empty.txt"), "");
    await writeFile(
      path.join(skill, "references", "invalid.txt"),
      Buffer.from([0xff, 0xfe]),
    );
    await writeFile(
      path.join(skill, "references", "large.txt"),
      "x".repeat(64 * 1024 + 1),
    );
    const snapshot = await buildProjectSkillSnapshot(root, ["research-brief"]);

    for (const [resourcePath, code] of [
      ["../secret.txt", "resource_invalid"],
      ["references/image.png", "resource_invalid"],
      ["references/missing.txt", "resource_not_found"],
      ["references/empty.txt", "resource_invalid"],
      ["references/invalid.txt", "resource_invalid"],
      ["references/large.txt", "resource_limit_exceeded"],
    ] as const) {
      await expect(
        snapshot.loadResource("research-brief", resourcePath),
        resourcePath,
      ).rejects.toMatchObject({ code });
    }
  });

  it("rejects symlinked resource files and intermediate directories", async () => {
    const { root, skill } = await fixture();
    const outside = await mkdtemp(
      path.join(tmpdir(), "napier-resource-outside-"),
    );
    roots.push(outside);
    await writeFile(path.join(outside, "outside.txt"), "outside");
    await symlink(
      path.join(outside, "outside.txt"),
      path.join(skill, "references", "linked.txt"),
    );
    await symlink(outside, path.join(skill, "linked-directory"));
    const snapshot = await buildProjectSkillSnapshot(root, ["research-brief"]);

    await expect(
      snapshot.loadResource("research-brief", "references/linked.txt"),
    ).rejects.toMatchObject({ code: "resource_untrusted" });
    await expect(
      snapshot.loadResource("research-brief", "linked-directory/outside.txt"),
    ).rejects.toMatchObject({ code: "resource_untrusted" });
  });

  it("fails closed when SKILL.md or a held resource directory drifts", async () => {
    const { root, skill } = await fixture();
    const snapshot = await buildProjectSkillSnapshot(root, ["research-brief"]);
    await appendFile(path.join(skill, "SKILL.md"), "\nchanged\n");
    await expect(
      snapshot.loadResource(
        "research-brief",
        "references/quality-checklist.md",
      ),
    ).rejects.toMatchObject({ code: "resource_catalog_drift" });

    const missingSkill = await fixture();
    const missingSnapshot = await buildProjectSkillSnapshot(missingSkill.root, [
      "research-brief",
    ]);
    await rm(path.join(missingSkill.skill, "SKILL.md"));
    await expect(
      missingSnapshot.loadResource(
        "research-brief",
        "references/quality-checklist.md",
      ),
    ).rejects.toMatchObject({ code: "resource_catalog_drift" });

    const fresh = await buildProjectSkillSnapshot(root, ["research-brief"]);
    const replacement = path.join(skill, "replacement");
    await mkdir(replacement);
    await writeFile(
      path.join(replacement, "quality-checklist.md"),
      "attacker content",
    );
    await expect(
      fresh.loadResource(
        "research-brief",
        "references/quality-checklist.md",
        undefined,
        {
          async afterDirectoryOpen(relative) {
            if (!relative.endsWith("/references")) return;
            await rename(
              path.join(skill, "references"),
              path.join(skill, "held"),
            );
            await rename(replacement, path.join(skill, "references"));
          },
        },
      ),
    ).rejects.toBeInstanceOf(ProjectSkillResourceError);
  });

  it("observes cancellation after a resource file is opened", async () => {
    const { root } = await fixture();
    const snapshot = await buildProjectSkillSnapshot(root, ["research-brief"]);
    const controller = new AbortController();

    await expect(
      snapshot.loadResource(
        "research-brief",
        "references/quality-checklist.md",
        controller.signal,
        {
          afterResourceOpen() {
            controller.abort(new DOMException("cancel-resource", "AbortError"));
          },
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
