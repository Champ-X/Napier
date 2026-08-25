import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { isStandardSkillLoadReceiptV2 } from "@napier/contracts/skill-load-standard";

import {
  buildStandardSkillSnapshot,
  discoverStandardSkillNames,
  StandardSkillSnapshotError,
} from "../src/standard-skill-snapshot.js";
import { inspectStandardSkillCatalog } from "../src/standard-skill-catalog.js";
import { createSkillLoadTool } from "../src/skill-load-tool.js";
import {
  compatibilityTelemetrySnapshot,
  resetCompatibilityTelemetryForTest,
} from "../src/compatibility-telemetry.js";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporary(label: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `napier-${label}-`));
  roots.push(root);
  return root;
}

function skillText(
  name: string,
  options: { disabled?: boolean; body?: string } = {},
): string {
  return [
    "---",
    `name: ${name}`,
    `description: Use ${name} safely.`,
    ...(options.disabled ? ["disable-model-invocation: true"] : []),
    "---",
    options.body ?? `# ${name}\n\nFollow the bounded workflow.`,
    "",
  ].join("\n");
}

async function putSkill(
  ownerRoot: string,
  name: string,
  text = skillText(name),
): Promise<void> {
  const directory = path.join(ownerRoot, "skills", name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "SKILL.md"), text);
}

async function putResource(
  ownerRoot: string,
  name: string,
  resourcePath: string,
  text: string,
): Promise<void> {
  const target = path.join(ownerRoot, "skills", name, resourcePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text);
}

async function setup() {
  return {
    workspace: await temporary("standard-workspace"),
    home: await temporary("standard-home"),
  };
}

describe("standard project and user Skill snapshots", () => {
  it("preserves the V1 contract for a relevant legacy-only Skill", async () => {
    resetCompatibilityTelemetryForTest();
    const { workspace, home } = await setup();
    await putSkill(workspace, "legacy-brief");

    const snapshot = await buildStandardSkillSnapshot(
      workspace,
      ["legacy-brief"],
      undefined,
      { userHome: home },
    );

    expect(snapshot.binding.schemaVersion).toBe(1);
    expect(snapshot.entry("legacy-brief")?.formattedInvocation).toContain(
      'location="/project/skills/legacy-brief/SKILL.md"',
    );
    expect(
      compatibilityTelemetrySnapshot().metrics.find(
        (metric) => metric.id === "compat.skill.project_legacy_read",
      )?.count,
    ).toBe(1);
  });

  it("loads a project-standard Skill with source-explicit V2 evidence", async () => {
    const { workspace, home } = await setup();
    await putSkill(path.join(workspace, ".agents"), "project-brief");

    const snapshot = await buildStandardSkillSnapshot(
      workspace,
      ["project-brief"],
      undefined,
      { userHome: home },
    );

    expect(snapshot.binding).toMatchObject({
      schemaVersion: 2,
      loadableSkillNames: ["project-brief"],
      configuredSkillRequests: [
        expect.objectContaining({
          source: "project",
          rootKind: "project_standard",
        }),
      ],
    });
    expect(snapshot.entry("project-brief")).toMatchObject({
      source: "project",
      rootKind: "project_standard",
      relativePath: ".agents/skills/project-brief/SKILL.md",
      virtualPath: "/project/.agents/skills/project-brief/SKILL.md",
    });
  });

  it("loads a user-standard Skill without leaking the user home path", async () => {
    const { workspace, home } = await setup();
    await putSkill(path.join(home, ".agents"), "user-brief");
    await putResource(
      path.join(home, ".agents"),
      "user-brief",
      "references/checklist.md",
      "# User checklist\n\nKeep the result bounded.\n",
    );

    const snapshot = await buildStandardSkillSnapshot(
      workspace,
      ["user-brief"],
      undefined,
      { userHome: home },
    );
    const serialized = JSON.stringify({
      content: snapshot.content,
      manifest: snapshot.manifest,
      binding: snapshot.binding,
    });

    expect(snapshot.binding).toMatchObject({
      schemaVersion: 2,
      configuredSkillRequests: [
        expect.objectContaining({ source: "user", rootKind: "user_standard" }),
      ],
    });
    expect(snapshot.entry("user-brief")?.formattedInvocation).toContain(
      'location="/user/.agents/skills/user-brief/SKILL.md"',
    );
    expect(serialized).not.toContain(home);

    const result = await createSkillLoadTool(snapshot).execute(
      "call_user_standard",
      { name: "user-brief" },
      new AbortController().signal,
    );
    expect(isStandardSkillLoadReceiptV2(result.details)).toBe(true);
    expect(result.details).toMatchObject({
      schemaVersion: 2,
      source: "user",
      rootKind: "user_standard",
      state: "loaded",
    });
    expect(JSON.stringify(result)).not.toContain(home);

    const resource = await snapshot.loadResource(
      "user-brief",
      "references/checklist.md",
    );
    expect(resource).toMatchObject({
      relativePath: ".agents/skills/user-brief/references/checklist.md",
      virtualPath: "/user/.agents/skills/user-brief/references/checklist.md",
    });
    expect(resource.text).toContain("Keep the result bounded");
    expect(JSON.stringify(resource)).not.toContain(home);
  });

  it("fails closed when the same Skill is present in multiple roots", async () => {
    const { workspace, home } = await setup();
    await putSkill(workspace, "shared-brief");
    await putSkill(path.join(workspace, ".agents"), "shared-brief");
    await putSkill(path.join(home, ".agents"), "shared-brief");

    const snapshot = await buildStandardSkillSnapshot(
      workspace,
      ["shared-brief"],
      undefined,
      { userHome: home },
    );

    expect(snapshot.binding.schemaVersion).toBe(2);
    expect(snapshot.binding.loadableSkillNames).toEqual([]);
    expect(snapshot.binding.unavailableSkills).toEqual([
      expect.objectContaining({
        failureCode: "skill_ambiguous",
        candidateRootKinds: [
          "project_legacy",
          "project_standard",
          "user_standard",
        ],
      }),
    ]);
  });

  it("keeps disabled and malformed cross-root candidates explicit", async () => {
    const { workspace, home } = await setup();
    await putSkill(
      path.join(workspace, ".agents"),
      "disabled-brief",
      skillText("disabled-brief", { disabled: true }),
    );
    await putSkill(
      path.join(home, ".agents"),
      "disabled-brief",
      "---\nname: disabled-brief\n---\nbody\n",
    );

    const conflict = await buildStandardSkillSnapshot(
      workspace,
      ["disabled-brief"],
      undefined,
      { userHome: home },
    );
    expect(conflict.binding.unavailableSkills[0]).toMatchObject({
      failureCode: "skill_ambiguous",
      candidateRootKinds: ["project_standard", "user_standard"],
    });

    await rm(path.join(home, ".agents"), { recursive: true });
    const disabled = await buildStandardSkillSnapshot(
      workspace,
      ["disabled-brief"],
      undefined,
      { userHome: home },
    );
    expect(disabled.binding.unavailableSkills[0]).toMatchObject({
      failureCode: "skill_disabled",
      candidateRootKinds: ["project_standard"],
    });
  });

  it("does not bind unrelated standard roots into a legacy snapshot", async () => {
    const { workspace, home } = await setup();
    await putSkill(workspace, "legacy-only");
    await putSkill(path.join(home, ".agents"), "unrelated-user-skill");

    const legacy = await buildStandardSkillSnapshot(
      workspace,
      ["legacy-only"],
      undefined,
      { userHome: home },
    );
    const missing = await buildStandardSkillSnapshot(
      workspace,
      ["missing-skill"],
      undefined,
      { userHome: home },
    );

    expect(legacy.binding.schemaVersion).toBe(1);
    expect(missing.binding.schemaVersion).toBe(2);
    expect(missing.manifest).toMatchObject({
      observedRootKinds: [],
      directDirectoryCount: 0,
    });
  });

  it("rejects symlinked standard roots and catalogs", async () => {
    const { workspace, home } = await setup();
    const outside = await temporary("standard-outside");
    await putSkill(outside, "linked-brief");
    await mkdir(path.join(workspace, ".agents"));
    await symlink(
      path.join(outside, "skills"),
      path.join(workspace, ".agents", "skills"),
    );

    await expect(
      buildStandardSkillSnapshot(workspace, ["linked-brief"], undefined, {
        userHome: home,
      }),
    ).rejects.toMatchObject({
      code: "standard_catalog_untrusted",
      rootKind: "project_standard",
    });
  });

  it("honors cancellation and configured request bounds before traversal", async () => {
    const { workspace, home } = await setup();
    const controller = new AbortController();
    controller.abort(new Error("cancel-standard-snapshot"));

    await expect(
      buildStandardSkillSnapshot(workspace, ["brief"], controller.signal, {
        userHome: home,
      }),
    ).rejects.toThrow("cancel-standard-snapshot");
    await expect(
      buildStandardSkillSnapshot(
        workspace,
        Array.from({ length: 65 }, (_, index) => `brief-${index}`),
        undefined,
        { userHome: home },
      ),
    ).rejects.toBeInstanceOf(StandardSkillSnapshotError);
  });

  it("discovers the sorted union of direct standard and legacy Skills", async () => {
    const { workspace, home } = await setup();
    await putSkill(workspace, "zeta-brief");
    await putSkill(path.join(workspace, ".agents"), "alpha-brief");
    await putSkill(path.join(home, ".agents"), "user-brief");
    await mkdir(path.join(home, ".agents", "skills", "Bad_Name"));

    await expect(
      discoverStandardSkillNames(workspace, { userHome: home }),
    ).resolves.toEqual(["alpha-brief", "user-brief", "zeta-brief"]);
  });

  it("projects Web-safe source, description and conflict summaries", async () => {
    const { workspace, home } = await setup();
    await putSkill(path.join(workspace, ".agents"), "project-summary");
    await putSkill(path.join(home, ".agents"), "user-summary");
    await putSkill(path.join(workspace, ".agents"), "shared-summary");
    await putSkill(path.join(home, ".agents"), "shared-summary");

    await expect(
      inspectStandardSkillCatalog(workspace, { userHome: home }),
    ).resolves.toEqual([
      {
        name: "project-summary",
        description: "Use project-summary safely.",
        source: "workspace",
        enabled: true,
      },
      {
        name: "shared-summary",
        description:
          "Unavailable (skill_ambiguous; candidates: project_standard, user_standard)",
        source: "workspace",
        enabled: false,
      },
      {
        name: "user-summary",
        description: "Use user-summary safely.",
        source: "user",
        enabled: true,
      },
    ]);
  });
});
