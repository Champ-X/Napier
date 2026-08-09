import { randomUUID } from "node:crypto";
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

import {
  buildProjectSkillSnapshot,
  ProjectSkillSnapshotError,
  resolveProjectSkillTraversalStrategy,
  type ProjectSkillSnapshotHooks,
} from "../src/project-skill-snapshot.js";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-skill-snapshot-"));
  roots.push(root);
  await mkdir(path.join(root, "skills"));
  return root;
}

function skillText(
  name: string,
  options: { disabled?: boolean; description?: string; body?: string } = {},
): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${options.description ?? `Use ${name} safely.`}`,
    ...(options.disabled ? ["disable-model-invocation: true"] : []),
    "---",
    options.body ?? `# ${name}\n\nFollow the bounded workflow.`,
    "",
  ].join("\n");
}

async function putSkill(root: string, name: string, text = skillText(name)) {
  const directory = path.join(root, "skills", name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "SKILL.md"), text);
}

describe("immutable project Skill snapshots", () => {
  it("uses fd traversal only when supported and the exact Darwin held-path fallback", () => {
    expect(
      resolveProjectSkillTraversalStrategy("linux", {
        fdIdentityMatches: true,
        directoryOpened: true,
        childOpened: true,
      }),
    ).toBe("fd_relative");
    expect(
      resolveProjectSkillTraversalStrategy("darwin", {
        fdIdentityMatches: true,
        directoryOpened: false,
        directoryOpenErrorCode: "ENOTDIR",
        childOpened: false,
        childOpenErrorCode: "ENOENT",
      }),
    ).toBe("darwin_held_path");
    expect(
      resolveProjectSkillTraversalStrategy("darwin", {
        fdIdentityMatches: true,
        directoryOpened: false,
        directoryOpenErrorCode: "ENOTDIR",
        childOpened: false,
        childOpenErrorCode: "ENOTDIR",
      }),
    ).toBe("darwin_held_path");
    expect(() =>
      resolveProjectSkillTraversalStrategy("linux", {
        fdIdentityMatches: true,
        directoryOpened: false,
        directoryOpenErrorCode: "ENOTDIR",
        childOpened: false,
        childOpenErrorCode: "ENOENT",
      }),
    ).toThrow("workspace_untrusted");
    expect(() =>
      resolveProjectSkillTraversalStrategy("freebsd", {
        fdIdentityMatches: true,
        directoryOpened: true,
        childOpened: true,
      }),
    ).toThrow("workspace_untrusted");
  });

  it("keeps held directory and file handles open through final validation", async () => {
    const root = await workspace();
    await putSkill(root, "research-brief");

    const snapshot = await buildProjectSkillSnapshot(root, ["research-brief"]);

    expect(snapshot.entry("research-brief")?.canonicalName).toBe(
      "research-brief",
    );
  });

  it("acquires two exact direct Skills once into a frozen private/public snapshot", async () => {
    const root = await workspace();
    await putSkill(root, "research-brief");
    await putSkill(root, "data-analysis");
    const snapshot = await buildProjectSkillSnapshot(root, [
      "research-brief",
      "data-analysis",
    ]);

    expect(snapshot.manifest.entries.map((entry) => entry.canonicalName)).toEqual([
      "data-analysis",
      "research-brief",
    ]);
    expect(snapshot.binding.loadableSkillNames).toEqual([
      "data-analysis",
      "research-brief",
    ]);
    expect(snapshot.content.aggregateRawBytes).toBe(
      Buffer.byteLength(skillText("research-brief")) +
        Buffer.byteLength(skillText("data-analysis")),
    );
    expect(snapshot.entry("research-brief")?.formattedInvocation).toContain(
      '<skill name="research-brief" location="/project/skills/research-brief/SKILL.md">',
    );
    expect(snapshot.content.entries[0]?.rawContentBase64).toBeTruthy();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.content.entries)).toBe(true);
    expect(JSON.stringify(snapshot.manifest)).not.toContain(root);
    expect(JSON.stringify(snapshot.binding)).not.toContain(root);

    await rm(path.join(root, "skills"), { recursive: true });
    expect(snapshot.entry("research-brief")?.formattedInvocation).toContain(
      "Follow the bounded workflow.",
    );
  });

  it("keeps unsafe, duplicate, disabled, malformed and missing requests unavailable", async () => {
    const root = await workspace();
    await putSkill(root, "duplicate");
    await putSkill(root, "disabled", skillText("disabled", { disabled: true }));
    await putSkill(root, "malformed", "---\nname: malformed\n---\nbody\n");
    const snapshot = await buildProjectSkillSnapshot(root, [
      "bad_name",
      "duplicate",
      "duplicate",
      "disabled",
      "malformed",
      "missing",
    ]);

    expect(snapshot.content.entries).toEqual([]);
    expect(
      snapshot.content.unavailableSkills.map((failure) => failure.failureCode),
    ).toEqual(
      expect.arrayContaining([
        "skill_invalid",
        "skill_ambiguous",
        "skill_disabled",
        "skill_not_found",
      ]),
    );
    const unsafe = snapshot.binding.configuredSkillRequests[0]!;
    expect(unsafe).not.toHaveProperty("canonicalName");
    expect(JSON.stringify(snapshot.binding)).not.toContain("bad_name");
    expect(snapshot.binding.configuredSkillRequests.slice(1, 3)).toEqual([
      expect.objectContaining({ state: "unavailable", canonicalName: "duplicate" }),
      expect.objectContaining({ state: "unavailable", canonicalName: "duplicate" }),
    ]);
  });

  it("rejects symlinked directories/files and non-directory path kinds", async () => {
    const root = await workspace();
    const outside = await mkdtemp(path.join(tmpdir(), "napier-skill-outside-"));
    roots.push(outside);
    await putSkill(outside, "linked");
    await symlink(
      path.join(outside, "skills", "linked"),
      path.join(root, "skills", "linked"),
    );
    await mkdir(path.join(root, "skills", "file-link"));
    await symlink(
      path.join(outside, "skills", "linked", "SKILL.md"),
      path.join(root, "skills", "file-link", "SKILL.md"),
    );
    await writeFile(path.join(root, "skills", "not-directory"), "not a dir");

    const snapshot = await buildProjectSkillSnapshot(root, [
      "linked",
      "file-link",
      "not-directory",
    ]);
    expect(snapshot.content.entries).toEqual([]);
    expect(
      snapshot.content.unavailableSkills.map((failure) => failure.failureCode),
    ).toEqual(expect.arrayContaining(["skill_untrusted", "skill_invalid"]));
  });

  it("enforces the 64/65 direct-directory sentinel before reading bodies", async () => {
    const root64 = await workspace();
    await Promise.all(
      Array.from({ length: 64 }, (_, index) =>
        mkdir(path.join(root64, "skills", `skill-${String(index).padStart(2, "0")}`)),
      ),
    );
    const bounded = await buildProjectSkillSnapshot(root64, []);
    expect(bounded.manifest.directDirectoryCount).toBe(64);

    const root65 = await workspace();
    await Promise.all(
      Array.from({ length: 65 }, (_, index) =>
        mkdir(path.join(root65, "skills", `skill-${String(index).padStart(2, "0")}`)),
      ),
    );
    await expect(buildProjectSkillSnapshot(root65, [])).rejects.toMatchObject({
      code: "project_catalog_overflow",
      failure: expect.objectContaining({
        subject: "project_catalog",
        observedDirectoryCount: 65,
      }),
    });
  });

  it("enforces the exact per-file limit and strict UTF-8/NUL boundary", async () => {
    const root = await workspace();
    const prefix = skillText("max-size", { body: "" });
    const exact = `${prefix}${"x".repeat(128 * 1024 - Buffer.byteLength(prefix))}`;
    await putSkill(root, "max-size", exact);
    const accepted = await buildProjectSkillSnapshot(root, ["max-size"]);
    expect(accepted.content.aggregateRawBytes).toBe(128 * 1024);

    const overRoot = await workspace();
    await putSkill(overRoot, "too-large", `${skillText("too-large")}${"x".repeat(128 * 1024)}`);
    const oversized = await buildProjectSkillSnapshot(overRoot, ["too-large"]);
    expect(oversized.content.unavailableSkills[0]?.failureCode).toBe(
      "skill_limit_exceeded",
    );

    const invalidRoot = await workspace();
    await mkdir(path.join(invalidRoot, "skills", "invalid-utf8"));
    await writeFile(
      path.join(invalidRoot, "skills", "invalid-utf8", "SKILL.md"),
      Buffer.from([0xff, 0xfe, 0xfd]),
    );
    await putSkill(invalidRoot, "nul-content", `${skillText("nul-content")}\0`);
    const invalid = await buildProjectSkillSnapshot(invalidRoot, [
      "invalid-utf8",
      "nul-content",
    ]);
    expect(
      invalid.content.unavailableSkills.map((failure) => failure.failureCode),
    ).toEqual(["skill_invalid", "skill_invalid"]);
  });

  it("accepts the exact 8 MiB aggregate ceiling across 64 bounded files", async () => {
    const root = await workspace();
    for (let index = 0; index < 64; index += 1) {
      const name = `aggregate-${String(index).padStart(2, "0")}`;
      const prefix = skillText(name, { body: "" });
      await putSkill(
        root,
        name,
        `${prefix}${"x".repeat(128 * 1024 - Buffer.byteLength(prefix))}`,
      );
    }
    const names = Array.from(
      { length: 64 },
      (_, index) => `aggregate-${String(index).padStart(2, "0")}`,
    );
    const snapshot = await buildProjectSkillSnapshot(root, names);
    expect(snapshot.content.aggregateRawBytes).toBe(8 * 1024 * 1024);
    expect(snapshot.content.entryCount).toBe(64);
  });

  it("checks cancellation before any acquisition", async () => {
    const root = await workspace();
    await putSkill(root, "research-brief");
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(
      buildProjectSkillSnapshot(root, ["research-brief"], controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fails closed for nonexistent workspaces and mid-scan cancellation", async () => {
    const missing = path.join(tmpdir(), `napier-missing-${randomUUID()}`);
    await expect(buildProjectSkillSnapshot(missing, [])).rejects.toMatchObject({
      code: "workspace_untrusted",
      message: expect.not.stringContaining(missing),
    });

    const root = await workspace();
    await putSkill(root, "research-brief");
    const controller = new AbortController();
    await expect(
      buildProjectSkillSnapshot(root, ["research-brief"], controller.signal, {
        afterDirectoryEntry() {
          controller.abort(new DOMException("mid-scan", "AbortError"));
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects growing files after open with a bounded max-plus-one read", async () => {
    const root = await workspace();
    await putSkill(root, "research-brief");
    const snapshot = await buildProjectSkillSnapshot(
      root,
      ["research-brief"],
      undefined,
      {
        async afterSkillFileOpen() {
          await appendFile(
            path.join(root, "skills", "research-brief", "SKILL.md"),
            "x".repeat(128 * 1024),
          );
        },
      },
    );
    expect(snapshot.content.entries).toEqual([]);
    expect(snapshot.content.unavailableSkills[0]?.failureCode).toBe(
      "skill_limit_exceeded",
    );
  });

  it("fails closed across an injected parent rename and swap-back ABA", async () => {
    const root = await workspace();
    await putSkill(root, "research-brief", skillText("research-brief", { body: "# trusted" }));
    await putSkill(root, "attacker", skillText("research-brief", { body: "# attacker" }));
    const skills = path.join(root, "skills");
    await expect(
      buildProjectSkillSnapshot(root, ["research-brief"], undefined, {
        async afterSkillDirectoryOpen() {
          await rename(path.join(skills, "research-brief"), path.join(skills, "held-original"));
          await rename(path.join(skills, "attacker"), path.join(skills, "research-brief"));
        },
        async afterSkillFileRead() {
          await rename(path.join(skills, "research-brief"), path.join(skills, "attacker"));
          await rename(path.join(skills, "held-original"), path.join(skills, "research-brief"));
        },
      }),
    ).rejects.toMatchObject({ code: "workspace_untrusted" });
  });

  it("rejects a Darwin held-root swap-back ABA through the workspace parent anchor", async () => {
    const root = await workspace();
    await putSkill(
      root,
      "research-brief",
      skillText("research-brief", { body: "# trusted" }),
    );
    const replacement = path.join(root, "replacement-skills");
    await mkdir(path.join(replacement, "research-brief"), { recursive: true });
    await writeFile(
      path.join(replacement, "research-brief", "SKILL.md"),
      skillText("research-brief", { body: "# attacker" }),
    );
    const skills = path.join(root, "skills");
    const held = path.join(root, "held-skills");
    let swapped = false;
    await expect(
      buildProjectSkillSnapshot(root, ["research-brief"], undefined, {
        async afterRootOpen() {
          await rename(skills, held);
          await rename(replacement, skills);
          swapped = true;
        },
        async afterDirectoryEntry() {
          if (!swapped) return;
          await rename(skills, replacement);
          await rename(held, skills);
          swapped = false;
        },
      }),
    ).rejects.toMatchObject({ code: "workspace_untrusted" });
  });

  it("uses the same deterministic overflow identity for every 65-directory catalog", async () => {
    const failures = [];
    for (const prefix of ["first", "second"]) {
      const root = await workspace();
      for (let index = 0; index < 65; index += 1) {
        await mkdir(path.join(root, "skills", `${prefix}-${String(index).padStart(2, "0")}`));
      }
      try {
        await buildProjectSkillSnapshot(root, []);
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectSkillSnapshotError);
        failures.push((error as ProjectSkillSnapshotError).failure);
      }
    }
    expect(failures).toHaveLength(2);
    expect(failures[0]?.directoryIdentitySetSha256).toBe(
      failures[1]?.directoryIdentitySetSha256,
    );
    expect(failures[0]?.contentSha256).toBe(failures[1]?.contentSha256);
  });

  it("fails closed at the bounded incremental direct-entry scan cap", async () => {
    const root = await workspace();
    const names = Array.from({ length: 4097 }, (_, index) =>
      path.join(root, "skills", `entry-${String(index).padStart(4, "0")}.txt`),
    );
    for (let offset = 0; offset < names.length; offset += 256) {
      await Promise.all(
        names.slice(offset, offset + 256).map((name) => writeFile(name, "x")),
      );
    }
    await expect(buildProjectSkillSnapshot(root, [])).rejects.toMatchObject({
      code: "workspace_untrusted",
    });
  });

  it("observes cancellation at every injectable acquisition phase", async () => {
    const phases: (keyof ProjectSkillSnapshotHooks)[] = [
      "afterRootOpen",
      "afterDirectoryEntry",
      "afterSkillDirectoryOpen",
      "afterSkillFileOpen",
      "afterSkillFileRead",
    ];
    for (const phase of phases) {
      const root = await workspace();
      await putSkill(root, "research-brief");
      const controller = new AbortController();
      const hooks = {
        [phase]() {
          controller.abort(new DOMException(`abort-${phase}`, "AbortError"));
        },
      } as ProjectSkillSnapshotHooks;
      await expect(
        buildProjectSkillSnapshot(root, ["research-brief"], controller.signal, hooks),
        phase,
      ).rejects.toMatchObject({ name: "AbortError" });
    }
  });

  it("rejects more than 64 configured requests without catalog disclosure", async () => {
    const root = await workspace();
    await expect(
      buildProjectSkillSnapshot(
        root,
        Array.from({ length: 65 }, (_, index) => `request-${index}`),
      ),
    ).rejects.toBeInstanceOf(ProjectSkillSnapshotError);
  });
});
