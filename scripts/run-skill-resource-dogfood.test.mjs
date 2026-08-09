import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { canonicalJson, sha256 } from "./skill-load-fast-core-evidence-lib.mjs";

const artifactUrl = new URL(
  "../docs/artifacts/skill-resource-stage0/dogfood.json",
  import.meta.url,
);

describe("Skill resource dogfood evidence", () => {
  it("binds a real derived resource load, model application, and cleanup", async () => {
    const value = JSON.parse(await readFile(artifactUrl, "utf8"));
    const { contentSha256, ...core } = value;

    assert.equal(value.kind, "napier.skill-resource-dogfood");
    assert.equal(value.schemaVersion, 1);
    assert.equal(value.result, "passed");
    assert.equal(value.provider, "deepseek");
    assert.equal(value.model, "deepseek-v4-flash");
    assert.equal(value.layout, "project_standard");
    assert.equal(contentSha256, sha256(canonicalJson(core)));
    assert.deepEqual(value.binding.loadableSkillNames, [
      "data-analysis",
      "research-brief",
    ]);
    assert.equal(value.binding.baseSnapshotResourceMarkerMatches, 0);
    assert.equal(value.capability.skillLoadConfigured, true);
    assert.equal(value.capability.skillResourceConfigured, false);
    assert.equal(value.capability.skillResourceExposed, true);
    assert.equal(value.capability.skillResourceReadiness, "ready");
    assert.equal(value.skillLoad.rootKind, "project_standard");
    assert.equal(value.resourceLoad.rootKind, "project_standard");
    assert.equal(
      value.resourceLoad.relativePath,
      ".agents/skills/research-brief/references/dogfood-quality-gate.md",
    );
    assert.equal(
      value.resourceLoad.virtualPath,
      "/project/.agents/skills/research-brief/references/dogfood-quality-gate.md",
    );
    assert.equal(value.application.markerMatched, true);
    assert.equal(value.application.durableResourceBodyCanaryMatches, 0);
    assert.equal(value.profileBeforeSha256, value.profileAfterSha256);
    assert.equal(value.revisionCountBefore, value.revisionCountAfter);
    assert.equal(value.replay.status, "valid");
    assert.equal(value.credentialCanaryMatches, 0);
    assert.equal(value.rawJsonlRetained, false);
    assert.equal(value.resourceBodyRetained, false);
    assert.equal(value.privateCapsulesRetained, false);
    assert.equal(value.taskRootRemoved, true);

    let cursor = -1;
    for (const toolName of ["skill_load", "skill_resource"]) {
      cursor = value.toolSequence.findIndex(
        (tool, index) =>
          index > cursor &&
          tool.status === "completed" &&
          tool.toolName === toolName,
      );
      assert.ok(cursor >= 0, `missing ${toolName}`);
    }
    const serialized = JSON.stringify(value);
    assert.doesNotMatch(serialized, /NAPIER-LAZY-RESOURCE-2405/u);
    assert.doesNotMatch(serialized, /NAPIER-RESOURCE-BODY-CANARY-9F2C/u);
    assert.doesNotMatch(serialized, /\/Users\//u);
    assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{16,}/u);
  });
});
