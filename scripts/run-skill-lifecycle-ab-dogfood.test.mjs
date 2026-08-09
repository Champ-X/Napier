import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { canonicalJson, sha256 } from "./skill-load-fast-core-evidence-lib.mjs";

const artifactUrl = new URL(
  "../docs/artifacts/skill-lifecycle-stage0/ab-dogfood.json",
  import.meta.url,
);

describe("Skill lifecycle A/B dogfood evidence", () => {
  it("binds fair real Research and Software Delivery comparisons", async () => {
    const value = JSON.parse(await readFile(artifactUrl, "utf8"));
    const { contentSha256, ...core } = value;

    assert.equal(value.kind, "napier.skill-lifecycle-ab-dogfood");
    assert.equal(value.schemaVersion, 1);
    assert.equal(value.result, "passed");
    assert.equal(value.provider, "deepseek");
    assert.equal(value.model, "deepseek-v4-flash");
    assert.equal(contentSha256, sha256(canonicalJson(core)));
    assert.deepEqual(
      value.campaigns.map((campaign) => campaign.task),
      ["software_delivery", "research"],
    );
    assert.deepEqual(value.comparisonPolicy, {
      sameModel: true,
      samePromptWithinTask: true,
      samePresetWithinTask: true,
      isolatedWorkspaceAndState: true,
      productionCli: true,
      trialCountPerVariant: 1,
    });
    for (const campaign of value.campaigns) {
      assert.equal(campaign.withSkill.outcomePassed, true);
      assert.equal(campaign.withoutSkill.outcomePassed, true);
      assert.equal(campaign.withSkill.catalogState, "loadable");
      assert.equal(campaign.withoutSkill.catalogState, "unavailable");
      assert.equal(campaign.withSkill.lifecycle.state, "applied");
      assert.equal(campaign.withoutSkill.lifecycle.state, "unavailable");
      assert.equal(campaign.withSkill.lifecycle.proofEventCount, 2);
      assert.equal(campaign.skillImpactObserved, true);
      assert.equal(
        campaign.withSkill.profileBeforeSha256,
        campaign.withSkill.profileAfterSha256,
      );
      assert.equal(
        campaign.withoutSkill.profileBeforeSha256,
        campaign.withoutSkill.profileAfterSha256,
      );
      assert.equal(
        campaign.withSkill.revisionCountBefore,
        campaign.withSkill.revisionCountAfter,
      );
      assert.equal(
        campaign.withoutSkill.revisionCountBefore,
        campaign.withoutSkill.revisionCountAfter,
      );
      assert.equal(campaign.withSkill.replay.status, "valid");
      assert.equal(campaign.withoutSkill.replay.status, "valid");
      assert.ok(campaign.withSkill.durationMs > 0);
      assert.ok(campaign.withoutSkill.durationMs > 0);
    }
    assert.equal(
      value.campaigns[0].withSkill.lifecycle.applicationMode,
      "software_change_observed",
    );
    assert.equal(
      value.campaigns[1].withSkill.lifecycle.applicationMode,
      "research_evidence_cited",
    );
    assert.equal(value.credentialCanaryMatches, 0);
    assert.equal(value.rawJsonlRetained, false);
    assert.equal(value.privateSkillContentRetained, false);
    assert.equal(value.taskRootRemoved, true);
    const serialized = JSON.stringify(value);
    assert.doesNotMatch(serialized, /\/Users\//u);
    assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{16,}/u);
  });
});
