import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalStore } from "../src/store.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

function skillContent(title: string): string {
  return [
    "---",
    "name: remote-skill",
    "description: Installed through reviewed Skill content flow.",
    "---",
    "",
    `# ${title}`,
    "",
    "Private remote Skill instruction must not be copied into Ledger events.",
    "",
  ].join("\n");
}

describe("reviewed Skill content installation", () => {
  it("previews, installs, no-ops, and replaces SKILL.md content with review hashes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-skill-content-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot,
    });
    await store.initialize();
    const thread = store.listThreads()[0]!;
    const firstContent = skillContent("Remote Skill V1");

    const firstReview = await store.previewSkillContent({
      threadId: thread.id,
      content: firstContent,
    });
    expect(firstReview).toEqual(
      expect.objectContaining({
        kind: "napier.skill-content-review",
        skillName: "remote-skill",
        relativePath: "skills/remote-skill/SKILL.md",
        action: "install",
        lineCount: 9,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        frontmatterSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        bodySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        reviewSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    await expect(
      store.applySkillContent({
        threadId: thread.id,
        content: firstContent,
        expectedReviewSha256: firstReview.reviewSha256,
      }),
    ).rejects.toThrow("install requires confirmation");

    await expect(
      store.applySkillContent({
        threadId: thread.id,
        content: firstContent,
        expectedReviewSha256: firstReview.reviewSha256,
        confirmInstall: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        applied: true,
        review: expect.objectContaining({
          action: "install",
          reviewSha256: firstReview.reviewSha256,
        }),
      }),
    );
    await expect(
      readFile(
        path.join(workspaceRoot, "skills/remote-skill/SKILL.md"),
        "utf8",
      ),
    ).resolves.toBe(firstContent);

    const noopReview = await store.previewSkillContent({
      threadId: thread.id,
      content: firstContent,
    });
    expect(noopReview).toEqual(
      expect.objectContaining({
        action: "noop",
        currentContentSha256: firstReview.contentSha256,
        currentSizeBytes: firstReview.sizeBytes,
        currentLineCount: firstReview.lineCount,
      }),
    );
    await expect(
      store.applySkillContent({
        threadId: thread.id,
        content: firstContent,
        expectedReviewSha256: noopReview.reviewSha256,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        applied: false,
        review: expect.objectContaining({ action: "noop" }),
      }),
    );

    const secondContent = skillContent("Remote Skill V2");
    const secondReview = await store.previewSkillContent({
      threadId: thread.id,
      content: secondContent,
    });
    expect(secondReview).toEqual(
      expect.objectContaining({
        action: "replace",
        currentContentSha256: firstReview.contentSha256,
        currentSizeBytes: firstReview.sizeBytes,
        currentLineCount: firstReview.lineCount,
      }),
    );
    await expect(
      store.applySkillContent({
        threadId: thread.id,
        content: secondContent,
        expectedReviewSha256: secondReview.reviewSha256,
      }),
    ).rejects.toThrow("replacement requires confirmation");
    await expect(
      store.applySkillContent({
        threadId: thread.id,
        content: secondContent,
        expectedReviewSha256: secondReview.reviewSha256,
        confirmReplacement: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        applied: true,
        review: expect.objectContaining({
          action: "replace",
          reviewSha256: secondReview.reviewSha256,
        }),
      }),
    );
    await expect(
      readFile(
        path.join(workspaceRoot, "skills/remote-skill/SKILL.md"),
        "utf8",
      ),
    ).resolves.toBe(secondContent);
    store.close();
  });
});
