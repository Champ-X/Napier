import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  migrateCompatibilitySkills,
  migrateCompatibilityStore,
} from "./migrate-compatibility.ts";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporary(label) {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-compat-" + label + "-"),
  );
  roots.push(root);
  return root;
}

describe("compatibility migration commands", () => {
  it("preflights and migrates the oldest Store fixture with a backup", async () => {
    const root = await temporary("store");
    const dataRoot = path.join(root, "data");
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    await cp(
      path.join(
        process.cwd(),
        "packages/runtime/test/fixtures/capability-contract-v1/pre-search",
      ),
      dataRoot,
      { recursive: true },
    );

    await expect(
      migrateCompatibilityStore({
        apply: false,
        dataRoot,
        workspaceRoot,
      }),
    ).resolves.toMatchObject({ status: "ready", applied: false });
    const migrated = await migrateCompatibilityStore({
      apply: true,
      dataRoot,
      workspaceRoot,
    });
    expect(migrated).toMatchObject({ status: "migrated", applied: true });
    expect(
      await readFile(path.join(dataRoot, "ledger.sqlite")),
    ).not.toHaveLength(0);
    expect(
      await readFile(path.join(migrated.backupRoot, "workspace.json")),
    ).not.toHaveLength(0);
  });

  it("copies legacy Skills without modifying the legacy source", async () => {
    const root = await temporary("skills");
    const workspaceRoot = path.join(root, "workspace");
    const source = path.join(workspaceRoot, "skills", "research-brief");
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, "SKILL.md"), "# Legacy Skill\n");

    await expect(
      migrateCompatibilitySkills({ apply: false, workspaceRoot }),
    ).resolves.toMatchObject({
      status: "ready",
      applied: false,
      copiedSkills: ["research-brief"],
    });
    const migrated = await migrateCompatibilitySkills({
      apply: true,
      workspaceRoot,
    });
    expect(migrated).toMatchObject({
      status: "migrated",
      applied: true,
      copiedSkills: ["research-brief"],
    });
    expect(
      await readFile(
        path.join(
          workspaceRoot,
          ".agents",
          "skills",
          "research-brief",
          "SKILL.md",
        ),
        "utf8",
      ),
    ).toBe("# Legacy Skill\n");
    expect(await readFile(path.join(source, "SKILL.md"), "utf8")).toBe(
      "# Legacy Skill\n",
    );
  });
});
