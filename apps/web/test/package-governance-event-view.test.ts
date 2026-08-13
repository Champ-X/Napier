import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  packageGovernanceEventTraceSummary,
  packageGovernanceEventTraceView,
} from "../src/package-governance-event-view";

describe("Package governance event trace view", () => {
  it("projects skill content receipts without skill names or paths", () => {
    const event = packageEvent("skill.content.installed", {
      applied: true,
      skillName: "TOP_SECRET_SKILL_NAME",
      relativePath: "TOP_SECRET_SKILL_PATH/SKILL.md",
      action: "install",
      reason: "TOP_SECRET_SKILL_REASON",
      reviewSha256: "a".repeat(64),
      contentSha256: "b".repeat(64),
      frontmatterSha256: "c".repeat(64),
      bodySha256: "d".repeat(64),
      sizeBytes: 128,
      lineCount: 7,
      currentContentSha256: "e".repeat(64),
      currentSizeBytes: 64,
      currentLineCount: 3,
    });

    expect(packageGovernanceEventTraceView(event)).toEqual({
      action: "skill.content.installed",
      family: "skill",
      actionStatus: "install",
      applied: true,
      reviewSha256: "a".repeat(64),
      contentSha256: "b".repeat(64),
      frontmatterSha256: "c".repeat(64),
      bodySha256: "d".repeat(64),
      sizeBytes: 128,
      lineCount: 7,
      currentContentSha256: "e".repeat(64),
      currentSizeBytes: 64,
      currentLineCount: 3,
    });
    expect(packageGovernanceEventTraceSummary(event)).toBe(
      `skill / content.installed / action install / bytes 128 / lines 7 / current-bytes 64 / current-lines 3 / applied true / review ${"a".repeat(12)} / content ${"b".repeat(12)} / frontmatter ${"c".repeat(12)} / body ${"d".repeat(12)} / current-content ${"e".repeat(12)}`,
    );
    expect(packageGovernanceEventTraceSummary(event)).not.toContain(
      "TOP_SECRET",
    );
  });

  it("projects skill package installation receipts without publisher names", () => {
    const event = packageEvent("skill.package.installed", {
      installationId: "skill_installation_1234567890",
      replacedInstallationId: "skill_installation_0987654321",
      status: "trusted",
      created: true,
      publisher: "TOP_SECRET_PUBLISHER",
      keyId: "key_1234567890",
      skillCatalogSha256: "f".repeat(64),
      manifestSha256: "1".repeat(64),
      envelopeSha256: "2".repeat(64),
      skillNamesSha256: "3".repeat(64),
      skillCount: 4,
      publisherChanged: true,
      skillSetChanged: true,
    });

    expect(packageGovernanceEventTraceSummary(event)).toBe(
      `skill / package.installed / installation 1234567890 / replaced-installation 0987654321 / status trusted / key key_1234567890 / skills 4 / created true / publisher-changed true / skill-set-changed true / manifest ${"1".repeat(12)} / envelope ${"2".repeat(12)} / skill-catalog ${"f".repeat(12)} / skill-names ${"3".repeat(12)}`,
    );
    expect(packageGovernanceEventTraceSummary(event)).not.toContain(
      "TOP_SECRET",
    );
  });

  it("projects prompt and inspector package receipts as hashes and counts", () => {
    const prompt = packageEvent("prompt.package.signed", {
      manifestSha256: "4".repeat(64),
      envelopeSha256: "5".repeat(64),
      systemPromptSha256: "6".repeat(64),
      agentId: "agent_1234567890",
      agentRevision: 9,
      keyId: "key_prompt",
      summary: "TOP_SECRET_PROMPT_PACKAGE_SUMMARY",
    });
    const inspector = packageEvent("inspector.package.qualified", {
      status: "qualified",
      verificationStatus: "trusted",
      panelCount: 3,
      manifestSha256: "7".repeat(64),
      envelopeSha256: "8".repeat(64),
      inspectorCatalogSha256: "9".repeat(64),
      observedInspectorCatalogSha256: "a".repeat(64),
      keyId: "key_inspector",
      description: "TOP_SECRET_INSPECTOR_DESCRIPTION",
    });

    expect(packageGovernanceEventTraceSummary(prompt)).toBe(
      `prompt / package.signed / agent 1234567890 / key key_prompt / agent-revision 9 / manifest ${"4".repeat(12)} / envelope ${"5".repeat(12)} / system-prompt ${"6".repeat(12)}`,
    );
    expect(packageGovernanceEventTraceSummary(inspector)).toBe(
      `inspector / package.qualified / status qualified / verification trusted / key key_inspector / panels 3 / manifest ${"7".repeat(12)} / envelope ${"8".repeat(12)} / inspector-catalog ${"9".repeat(12)} / observed-inspector-catalog ${"a".repeat(12)}`,
    );
    expect(packageGovernanceEventTraceSummary(prompt)).not.toContain(
      "TOP_SECRET",
    );
    expect(packageGovernanceEventTraceSummary(inspector)).not.toContain(
      "TOP_SECRET",
    );
  });

  it("fails closed for malformed and unknown package governance receipts", () => {
    expect(
      packageGovernanceEventTraceSummary(
        packageEvent("skill.content.noop", []),
      ),
    ).toBe("package governance receipt");
    expect(
      packageGovernanceEventTraceSummary(
        packageEvent("skill.future", {
          skillName: "TOP_SECRET_FUTURE_SKILL",
        }),
      ),
    ).toBe("extension");
  });
});

function packageEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_package",
    runId: "run_package",
    seq: 48,
    type,
    category: "extension",
    visibility: "user",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
