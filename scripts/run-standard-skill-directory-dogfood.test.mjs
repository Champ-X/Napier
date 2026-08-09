import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { canonicalJson, sha256 } from "./skill-load-fast-core-evidence-lib.mjs";

const artifactUrl = new URL(
  "../docs/artifacts/skill-load-standard-stage1/dogfood.json",
  import.meta.url,
);

describe("standard Skill directory dogfood evidence", () => {
  it("binds the real V2 project-standard lifecycle and cleanup", async () => {
    const value = JSON.parse(await readFile(artifactUrl, "utf8"));
    const { contentSha256, ...core } = value;

    assert.equal(value.kind, "napier.standard-skill-directory-dogfood");
    assert.equal(value.schemaVersion, 1);
    assert.equal(value.result, "passed");
    assert.equal(value.provider, "deepseek");
    assert.equal(value.model, "deepseek-v4-flash");
    assert.equal(value.layout, "project_standard");
    assert.equal(value.relativeRoot, ".agents/skills");
    assert.equal(contentSha256, sha256(canonicalJson(core)));
    assert.equal(value.binding.researchSource, "project");
    assert.equal(value.binding.researchRootKind, "project_standard");
    assert.deepEqual(value.binding.loadableSkillNames, [
      "data-analysis",
      "research-brief",
    ]);
    assert.equal(value.lifecycle.source, "project");
    assert.equal(value.lifecycle.rootKind, "project_standard");
    assert.equal(
      value.lifecycle.relativePath,
      ".agents/skills/research-brief/SKILL.md",
    );
    assert.equal(value.profileBeforeSha256, value.profileAfterSha256);
    assert.equal(value.revisionCountBefore, value.revisionCountAfter);
    assert.equal(value.replay.status, "valid");
    assert.equal(value.credentialCanaryMatches, 0);
    assert.equal(value.rawJsonlRetained, false);
    assert.equal(value.privateCapsulesRetained, false);
    assert.equal(value.taskRootRemoved, true);

    const required = [
      ["skill_load"],
      ["web_search"],
      ["web_fetch"],
      ["research_source", "capture_fetch"],
      ["research_source", "cite"],
    ];
    let cursor = -1;
    for (const [toolName, action] of required) {
      cursor = value.toolSequence.findIndex(
        (tool, index) =>
          index > cursor &&
          tool.status === "completed" &&
          tool.toolName === toolName &&
          (action === undefined || tool.action === action),
      );
      assert.ok(cursor >= 0, `missing ${toolName}/${action ?? "terminal"}`);
    }
    const serialized = JSON.stringify(value);
    assert.doesNotMatch(serialized, /\/Users\//u);
    assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{16,}/u);
  });
});
