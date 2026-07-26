import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ApplySkillContentResult,
  SkillContentReview,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  createApp,
  createServices as createNapierServices,
} from "../src/app.js";

const temporaryRoots: string[] = [];
const openServices: Awaited<ReturnType<typeof createNapierServices>>[] = [];

afterEach(async () => {
  for (const services of openServices.splice(0)) {
    await services.recovery.stop();
    await services.automation.stop();
    await services.channels.stop();
    await services.extensions.shutdown();
    services.store.close();
  }
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

function jsonRequest(value: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}

function skillContent(): string {
  return [
    "---",
    "name: api-skill",
    "description: Installed through the Skill content API.",
    "---",
    "",
    "# API Skill",
    "",
    "Do not leak this remote Skill instruction into Ledger events.",
    "",
  ].join("\n");
}

function responseSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function expectSkillContentReviewHeaders(
  response: Response,
  review: SkillContentReview,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    review.reviewSha256,
  );
  expect(response.headers.get("x-napier-skill-content-review-sha256")).toBe(
    review.reviewSha256,
  );
  expect(response.headers.get("x-napier-skill-content-sha256")).toBe(
    review.contentSha256,
  );
  expect(
    response.headers.get("x-napier-skill-content-frontmatter-sha256"),
  ).toBe(review.frontmatterSha256);
  expect(response.headers.get("x-napier-skill-content-body-sha256")).toBe(
    review.bodySha256,
  );
  expect(response.headers.get("x-napier-skill-content-action")).toBe(
    review.action,
  );
  expect(response.headers.get("x-napier-skill-content-size-bytes")).toBe(
    String(review.sizeBytes),
  );
  expect(response.headers.get("x-napier-skill-content-line-count")).toBe(
    String(review.lineCount),
  );
  expect(response.headers.get("x-napier-skill-content-current-sha256")).toBe(
    review.currentContentSha256 ?? null,
  );
}

function expectSkillContentApplyResultHeaders(
  response: Response,
  result: ApplySkillContentResult,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(result),
  );
  expect(response.headers.get("x-napier-skill-content-review-sha256")).toBe(
    result.review.reviewSha256,
  );
  expect(response.headers.get("x-napier-skill-content-sha256")).toBe(
    result.review.contentSha256,
  );
  expect(response.headers.get("x-napier-skill-content-action")).toBe(
    result.review.action,
  );
  expect(response.headers.get("x-napier-skill-content-applied")).toBe(
    String(result.applied),
  );
  expect(response.headers.get("x-napier-skill-content-size-bytes")).toBe(
    String(result.review.sizeBytes),
  );
  expect(response.headers.get("x-napier-skill-content-line-count")).toBe(
    String(result.review.lineCount),
  );
}

async function createFixture() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-server-skillcontent-"),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const services = await createNapierServices({
    dataRoot: path.join(root, "data"),
    workspaceRoot,
  });
  openServices.push(services);
  return { services, app: createApp(services), workspaceRoot };
}

describe("reviewed Skill content API", () => {
  it("previews and applies SKILL.md content with hash-only audit evidence", async () => {
    const { services, app, workspaceRoot } = await createFixture();
    const thread = services.store.listThreads()[0]!;
    const content = skillContent();

    const previewResponse = await app.request(
      "/api/skills/content/preview",
      jsonRequest({ threadId: thread.id, content }),
    );
    expect(previewResponse.status).toBe(200);
    const review = (await previewResponse.json()) as SkillContentReview;
    expectSkillContentReviewHeaders(previewResponse, review);
    expect(review).toEqual(
      expect.objectContaining({
        skillName: "api-skill",
        relativePath: "skills/api-skill/SKILL.md",
        action: "install",
        lineCount: 9,
        reviewSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        frontmatterSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        bodySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );

    const unconfirmedResponse = await app.request(
      "/api/skills/content/apply",
      jsonRequest({
        threadId: thread.id,
        content,
        expectedReviewSha256: review.reviewSha256,
      }),
    );
    expect(unconfirmedResponse.status).toBe(409);
    await expect(unconfirmedResponse.json()).resolves.toEqual({
      error: "Skill content install requires confirmation",
    });

    const applyResponse = await app.request(
      "/api/skills/content/apply",
      jsonRequest({
        threadId: thread.id,
        content,
        expectedReviewSha256: review.reviewSha256,
        confirmInstall: true,
      }),
    );
    const applyText = await applyResponse.text();
    expect(applyResponse.status, applyText).toBe(200);
    const result = JSON.parse(applyText) as ApplySkillContentResult;
    expectSkillContentApplyResultHeaders(applyResponse, result);
    expect(result).toEqual(
      expect.objectContaining({
        applied: true,
        review: expect.objectContaining({
          action: "install",
          reviewSha256: review.reviewSha256,
          contentSha256: review.contentSha256,
        }),
      }),
    );
    await expect(
      readFile(path.join(workspaceRoot, "skills/api-skill/SKILL.md"), "utf8"),
    ).resolves.toBe(content);

    const events = await services.store.listEvents(thread.id);
    const appliedEvent = events.find(
      (event) => event.type === "skill.content.installed",
    );
    expect(appliedEvent?.payload).toEqual(
      expect.objectContaining({
        applied: true,
        skillName: "api-skill",
        relativePath: "skills/api-skill/SKILL.md",
        action: "install",
        reviewSha256: review.reviewSha256,
        contentSha256: review.contentSha256,
        frontmatterSha256: review.frontmatterSha256,
        bodySha256: review.bodySha256,
        sizeBytes: review.sizeBytes,
        lineCount: review.lineCount,
      }),
    );
    expect(JSON.stringify(appliedEvent?.payload)).not.toContain(
      "Do not leak this remote Skill instruction",
    );
  });
});
