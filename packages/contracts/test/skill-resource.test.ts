import {
  isSkillResourceLoadFailureV1,
  isSkillResourceLoadReceiptV1,
  isSkillResourcePath,
  skillResourceBindingSha256,
  skillResourceRelativePath,
  skillResourceVirtualPath,
} from "../src/skill-resource.js";
import { canonical, sha256 } from "../src/skill-load-validation.js";
import { describe, expect, it } from "vitest";

describe("Skill resource contracts", () => {
  it("accepts a source-bound user resource receipt", () => {
    const skillName = "research-brief";
    const resourcePath = "references/quality-checklist.md";
    const core = {
      kind: "napier.skill-resource-load-receipt",
      schemaVersion: 1,
      operation: "skill.resource.load",
      agentToolName: "skill_resource",
      state: "loaded",
      skillName,
      requestedNameSha256: sha256(skillName),
      source: "user",
      rootKind: "user_standard",
      resourcePath,
      requestedResourcePathSha256: sha256(resourcePath),
      relativePath: skillResourceRelativePath(
        "user_standard",
        skillName,
        resourcePath,
      ),
      virtualPath: skillResourceVirtualPath(
        "user_standard",
        skillName,
        resourcePath,
      ),
      sizeBytes: 81,
      lineCount: 4,
      rawContentSha256: "1".repeat(64),
      catalogSha256: "2".repeat(64),
      snapshotManifestSha256: "3".repeat(64),
      resourceBindingSha256: skillResourceBindingSha256({
        skillName,
        resourcePath,
        rawContentSha256: "1".repeat(64),
        catalogSha256: "2".repeat(64),
        snapshotManifestSha256: "3".repeat(64),
      }),
    } as const;
    const receipt = seal(core);
    const bundledReceipt = seal({
      ...core,
      source: "bundled" as const,
      rootKind: "bundled_standard" as const,
      relativePath: skillResourceRelativePath(
        "bundled_standard",
        skillName,
        resourcePath,
      ),
      virtualPath: skillResourceVirtualPath(
        "bundled_standard",
        skillName,
        resourcePath,
      ),
    });

    expect(isSkillResourceLoadReceiptV1(receipt)).toBe(true);
    expect(isSkillResourceLoadReceiptV1(bundledReceipt)).toBe(true);
    expect(
      isSkillResourceLoadReceiptV1({ ...receipt, source: "project" }),
    ).toBe(false);
    expect(
      isSkillResourceLoadReceiptV1({
        ...bundledReceipt,
        rootKind: "project_standard",
      }),
    ).toBe(false);
    expect(
      isSkillResourceLoadReceiptV1({
        ...receipt,
        virtualPath: "/user/.agents/skills/other.md",
      }),
    ).toBe(false);
  });

  it("accepts bounded typed failures without retaining invalid paths", () => {
    const core = {
      kind: "napier.skill-resource-load-failure",
      schemaVersion: 1,
      operation: "skill.resource.load",
      agentToolName: "skill_resource",
      source: "composite",
      state: "failed",
      failureCode: "resource_invalid",
      requestedNameSha256: sha256("research-brief"),
      requestedResourcePathSha256: sha256("../../secret"),
      skillName: "research-brief",
      candidateRootKinds: ["project_standard"],
      catalogSha256: "2".repeat(64),
      snapshotManifestSha256: "3".repeat(64),
      diagnosticSha256: "4".repeat(64),
    } as const;
    const failure = seal(core);

    expect(isSkillResourceLoadFailureV1(failure)).toBe(true);
    expect(
      isSkillResourceLoadFailureV1({
        ...failure,
        candidateRootKinds: ["user_standard", "project_standard"],
      }),
    ).toBe(false);
  });

  it("rejects traversal, hidden, binary and over-deep resource paths", () => {
    expect(isSkillResourcePath("references/checklist.md")).toBe(true);
    expect(isSkillResourcePath("examples/query.sql")).toBe(true);
    expect(isSkillResourcePath("../secret.txt")).toBe(false);
    expect(isSkillResourcePath("/absolute.txt")).toBe(false);
    expect(isSkillResourcePath(".hidden/secret.txt")).toBe(false);
    expect(isSkillResourcePath("assets/logo.png")).toBe(false);
    expect(isSkillResourcePath("a/b/c/d/e/f/g.md")).toBe(false);
  });
});

function seal<T extends Record<string, unknown>>(value: T) {
  return { ...value, contentSha256: sha256(canonical(value)) };
}
