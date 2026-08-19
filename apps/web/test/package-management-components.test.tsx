import { readFile } from "node:fs/promises";

import type {
  AgentProfile,
  SkillContentReview,
  SkillPackageInstallation,
} from "@napier/contracts";
import { describe, expect, it, vi } from "vitest";

import { contextCopy } from "../src/context-copy";
import { PromptPackageDesk } from "../src/PromptPackageDesk";
import { SkillContentDesk } from "../src/SkillContentDesk";
import { SkillPackageDesk } from "../src/SkillPackageDesk";
import { renderToStaticMarkup } from "./render-static-preact";

describe("package management components", () => {
  it("renders Prompt package administration as a bounded L3 form", () => {
    const markup = renderToStaticMarkup(
      PromptPackageDesk({
        agent: agent(),
        anchors: [],
        publisher: "Napier",
        selectedAnchorId: "",
        busy: false,
        canSign: false,
        receipt: undefined,
        onPublisher: vi.fn(),
        onAnchor: vi.fn(),
        onSign: vi.fn(),
        onInspectFile: vi.fn(),
      }),
    );

    expect(markup).toContain("Prompt package");
    expect(markup).toContain(contextCopy.promptPackageNoSigner);
    expect(markup).toContain("application/json,.json");
    expect(markup).not.toContain("#");
  });

  it("requires explicit install confirmation before applying Skill content", () => {
    const base = {
      content: "---\nname: evidence\n---\n\n# Evidence\n",
      busy: false,
      receipt: {
        action: "previewed" as const,
        review: contentReview(),
        reason: "Ready",
      },
      replacementConfirmed: false,
      onContent: vi.fn(),
      onLoadFile: vi.fn(),
      onPreview: vi.fn(),
      onApply: vi.fn(),
      onInstallConfirmed: vi.fn(),
      onReplacementConfirmed: vi.fn(),
    };
    const blocked = renderToStaticMarkup(
      SkillContentDesk({ ...base, installConfirmed: false }),
    );
    const admitted = renderToStaticMarkup(
      SkillContentDesk({ ...base, installConfirmed: true }),
    );

    expect(buttonMarkup(blocked, contextCopy.skillContentApply)).toContain(
      "disabled",
    );
    expect(buttonMarkup(admitted, contextCopy.skillContentApply)).not.toContain(
      "disabled",
    );
    expect(admitted).toContain(contextCopy.skillContentCandidateFootprint);
    expect(admitted).toContain("+64 / +8");
  });

  it("keeps active Skill installation risk confirmations visible", () => {
    const markup = renderToStaticMarkup(
      SkillPackageDesk({
        enabledSkills: ["evidence"],
        anchors: [],
        activeInstallation: installation(),
        publisher: "Napier",
        selectedAnchorId: "",
        busy: false,
        canSign: false,
        replacementConfirmed: false,
        publisherChangeConfirmed: false,
        skillSetChangeConfirmed: false,
        receipt: undefined,
        onPublisher: vi.fn(),
        onAnchor: vi.fn(),
        onReplacementConfirmed: vi.fn(),
        onPublisherChangeConfirmed: vi.fn(),
        onSkillSetChangeConfirmed: vi.fn(),
        onSign: vi.fn(),
        onInspectFile: vi.fn(),
      }),
    );

    expect(markup).toContain(contextCopy.skillPackageActive);
    expect(markup).toContain(contextCopy.skillPackageReplaceConfirm);
    expect(markup).toContain(contextCopy.skillPackagePublisherChangeConfirm);
    expect(markup).toContain(contextCopy.skillPackageSkillSetChangeConfirm);
  });

  it("owns responsive, interaction, motion, and forced-color states", async () => {
    const css = (
      await Promise.all(
        [
          "package-management.css",
          "package-receipts.css",
          "skill-package-management.css",
        ].map((file) =>
          readFile(new URL(`../src/${file}`, import.meta.url), "utf8"),
        ),
      )
    ).join("\n");

    expect(css).toContain(
      "min-height: calc(var(--control-target-primary) + var(--space-1))",
    );
    expect(css).toContain(":hover");
    expect(css).toContain(":active");
    expect(css).toContain(":focus-visible");
    expect(css).toContain(":disabled");
    expect(css).toContain("@container");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
  });
});

function buttonMarkup(markup: string, label: string): string {
  const labelIndex = markup.indexOf(label);
  const start = markup.lastIndexOf("<button", labelIndex);
  const end = markup.indexOf("</button>", labelIndex);
  return start >= 0 && end >= 0 ? markup.slice(start, end + 9) : "";
}

function agent(): AgentProfile {
  return {
    id: "agent_napier",
    name: "Napier",
    description: "Fixture",
    systemPrompt: "Stay bounded.",
    model: { provider: "faux", id: "faux-1" },
    thinkingLevel: "minimal",
    toolPolicy: "observe",
    enabledTools: [],
    enabledSkills: [],
    enabledSubagents: [],
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    revision: 3,
  };
}

function contentReview(): SkillContentReview {
  return {
    kind: "napier.skill-content-review",
    schemaVersion: 1,
    apiVersion: "v1",
    skillName: "evidence",
    relativePath: "skills/evidence/SKILL.md",
    action: "install",
    sizeBytes: 64,
    lineCount: 8,
    contentSha256: "1".repeat(64),
    frontmatterSha256: "2".repeat(64),
    bodySha256: "3".repeat(64),
    generatedAt: "2026-08-19T00:00:00.000Z",
    reviewSha256: "4".repeat(64),
  };
}

function installation(): SkillPackageInstallation {
  return {
    id: "installation_1",
    status: "active",
    publisher: "Napier",
    keyId: "key_1",
    loadedSkillNames: ["evidence"],
    skillCatalogSha256: "5".repeat(64),
    manifestSha256: "6".repeat(64),
    envelopeSha256: "7".repeat(64),
    skillNamesSha256: "8".repeat(64),
    installedByThreadId: "thread_1",
    installedAt: "2026-08-19T00:00:00.000Z",
    contentSha256: "9".repeat(64),
  };
}
