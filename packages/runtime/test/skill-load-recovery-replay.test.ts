import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { JsonValue } from "@napier/contracts";
import { isSkillLoadReceiptV1 } from "@napier/contracts/skill-load";
import { afterEach, describe, expect, it } from "vitest";

import { buildProjectSkillSnapshot } from "../src/project-skill-snapshot.js";
import { createSkillLoadTool } from "../src/skill-load-tool.js";
import {
  validateSkillLoadFrozenReplay,
  validateSkillSnapshotForContinuation,
} from "../src/skill-load-replay.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-skill-replay-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await writeSkill(workspaceRoot, "research-brief", "Original guidance.");
  return { root, workspaceRoot };
}

async function writeSkill(
  workspaceRoot: string,
  name: string,
  body: string,
): Promise<void> {
  const directory = path.join(workspaceRoot, "skills", name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} fixture.\n---\n\n# ${name}\n\n${body}\n`,
  );
}

describe("Skill snapshot recovery and frozen replay", () => {
  it("accepts exact restart equality and frozen reuse without another disk read", async () => {
    const { workspaceRoot } = await fixture();
    const source = await buildProjectSkillSnapshot(workspaceRoot, [
      "research-brief",
    ]);
    const target = await buildProjectSkillSnapshot(workspaceRoot, [
      "research-brief",
    ]);
    validateSkillSnapshotForContinuation(source.binding, target);

    const result = await createSkillLoadTool(source).execute(
      "call_source",
      { name: "research-brief" },
      new AbortController().signal,
    );
    expect(isSkillLoadReceiptV1(result.details)).toBe(true);
    await rm(path.join(workspaceRoot, "skills"), { recursive: true });

    expect(
      validateSkillLoadFrozenReplay(source.binding, target, {
        toolName: "skill_load",
        isError: false,
        result: { details: result.details as JsonValue },
      }),
    ).toEqual(result.details);
  });

  it("fails before continuation on catalog, availability, or manifest drift", async () => {
    const { workspaceRoot } = await fixture();
    const source = await buildProjectSkillSnapshot(workspaceRoot, [
      "research-brief",
    ]);

    await writeSkill(workspaceRoot, "unselected", "Catalog drift.");
    const catalogDrift = await buildProjectSkillSnapshot(workspaceRoot, [
      "research-brief",
    ]);
    expect(() =>
      validateSkillSnapshotForContinuation(source.binding, catalogDrift),
    ).toThrow(/catalog changed/u);

    await rm(path.join(workspaceRoot, "skills", "unselected"), {
      recursive: true,
    });
    const availabilityDrift = await buildProjectSkillSnapshot(workspaceRoot, [
      "research-brief",
      "missing-skill",
    ]);
    expect(
      source.binding.catalogSha256,
      "availability-only fixture must retain the catalog hash",
    ).toBe(availabilityDrift.binding.catalogSha256);
    expect(() =>
      validateSkillSnapshotForContinuation(source.binding, availabilityDrift),
    ).toThrow(/availability changed/u);

    await writeSkill(workspaceRoot, "research-brief", "Changed guidance.");
    const contentDrift = await buildProjectSkillSnapshot(workspaceRoot, [
      "research-brief",
    ]);
    expect(() =>
      validateSkillSnapshotForContinuation(source.binding, contentDrift),
    ).toThrow(/catalog changed/u);
  });

  it("rejects missing, failed, or tampered private replay receipts", async () => {
    const { workspaceRoot } = await fixture();
    const snapshot = await buildProjectSkillSnapshot(workspaceRoot, [
      "research-brief",
    ]);
    const loaded = await createSkillLoadTool(snapshot).execute(
      "call_loaded",
      { name: "research-brief" },
      new AbortController().signal,
    );
    expect(isSkillLoadReceiptV1(loaded.details)).toBe(true);

    expect(() =>
      validateSkillLoadFrozenReplay(snapshot.binding, snapshot, {
        toolName: "skill_load",
        isError: true,
        result: { details: loaded.details as JsonValue },
      }),
    ).toThrow(/reusable success receipt/u);
    expect(() =>
      validateSkillLoadFrozenReplay(snapshot.binding, snapshot, {
        toolName: "skill_load",
        isError: false,
        result: {
          details: {
            ...(loaded.details as Record<string, JsonValue>),
            rawContentSha256: "0".repeat(64),
          },
        },
      }),
    ).toThrow(/reusable success receipt/u);
    expect(() =>
      validateSkillLoadFrozenReplay(snapshot.binding, snapshot, {
        toolName: "web_search",
        isError: false,
        result: { details: loaded.details as JsonValue },
      }),
    ).toThrow(/reusable success receipt/u);
  });

  it("honors cancellation before a restart snapshot is returned", async () => {
    const { workspaceRoot } = await fixture();
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(
      buildProjectSkillSnapshot(
        workspaceRoot,
        ["research-brief"],
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
