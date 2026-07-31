import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sha256 } from "../src/ed25519.js";
import {
  type ResearchReportCitation,
  verifyResearchReport,
} from "../src/research-report-verification.js";

const roots: string[] = [];
const FIRST: ResearchReportCitation = {
  id: "citation_first0001",
  sourceId: "source_first0001",
  claim: "The first claim is supported.",
  claimSha256: sha256("The first claim is supported."),
  quoteSha256: "a".repeat(64),
  token: "[citation:citation_first0001]",
};
const SECOND: ResearchReportCitation = {
  id: "citation_second001",
  sourceId: "source_second001",
  claim: "The second claim is supported.",
  claimSha256: sha256("The second claim is supported."),
  quoteSha256: "b".repeat(64),
  token: "[citation:citation_second001]",
};
const CORROBORATION: ResearchReportCitation = {
  ...SECOND,
  claim: FIRST.claim,
  claimSha256: FIRST.claimSha256,
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Research report verification", () => {
  it("binds exact claim lines and current workspace bytes", async () => {
    const workspaceRoot = await workspace();
    const markdown = [
      "# Brief",
      "",
      `${FIRST.claim} ${FIRST.token}`,
      `- ${SECOND.claim} ${SECOND.token}`,
      "",
      "## Evidence Ledger",
      "",
      `- Citation IDs: ${FIRST.id}, ${SECOND.id}`,
      "",
    ].join("\n");
    await writeFile(path.join(workspaceRoot, "brief.md"), markdown);

    await expect(
      verifyResearchReport({
        workspaceRoot,
        path: "brief.md",
        expectedSha256: sha256(markdown),
        citations: [FIRST, SECOND],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        path: "brief.md",
        pathSha256: sha256("brief.md"),
        fileSha256: sha256(markdown),
        fileBytes: Buffer.byteLength(markdown),
        citationCount: 2,
      }),
    );
  });

  it.each([
    {
      name: "unknown token",
      markdown: "An unknown claim. [citation:citation_unknown01]\n",
      error: "not bound to this Run",
    },
    {
      name: "duplicate token",
      markdown: `${FIRST.claim} ${FIRST.token}\n${FIRST.claim} ${FIRST.token}\n`,
      error: "duplicated",
    },
    {
      name: "claim drift",
      markdown: `The first claim changed. ${FIRST.token}\n`,
      error: "claim does not match",
    },
    {
      name: "non-exact claim line",
      markdown: `Unsupported prefix: ${FIRST.claim} ${FIRST.token}\n`,
      error: "not an exact line",
    },
    {
      name: "text after token",
      markdown: `${FIRST.claim} ${FIRST.token} trailing text\n`,
      error: "not at line end",
    },
    {
      name: "mixed claims on one line",
      markdown: `${FIRST.claim} ${FIRST.token} ${SECOND.token}\n`,
      error: "claim does not match",
    },
    {
      name: "malformed token",
      markdown: `${FIRST.claim} [citation:bad]\n`,
      error: "no citation tokens",
    },
  ])("rejects $name", async ({ markdown, error }) => {
    const workspaceRoot = await workspace();
    await writeFile(path.join(workspaceRoot, "brief.md"), markdown);

    await expect(
      verifyResearchReport({
        workspaceRoot,
        path: "brief.md",
        expectedSha256: sha256(markdown),
        citations: [FIRST, SECOND],
      }),
    ).rejects.toThrow(error);
  });

  it("allows multiple current-Run citations for one exact claim line", async () => {
    const workspaceRoot = await workspace();
    const markdown = `${FIRST.claim} ${FIRST.token} ${CORROBORATION.token}\n`;
    await writeFile(path.join(workspaceRoot, "brief.md"), markdown);

    await expect(
      verifyResearchReport({
        workspaceRoot,
        path: "brief.md",
        expectedSha256: sha256(markdown),
        citations: [FIRST, CORROBORATION],
      }),
    ).resolves.toEqual(expect.objectContaining({ citationCount: 2 }));
  });

  it("rejects stale, unsupported, escaping, and cancelled report reads", async () => {
    const workspaceRoot = await workspace();
    const markdown = `${FIRST.claim} ${FIRST.token}\n`;
    await writeFile(path.join(workspaceRoot, "brief.md"), markdown);
    await writeFile(path.join(workspaceRoot, "brief.txt"), markdown);

    await expect(
      verifyResearchReport({
        workspaceRoot,
        path: "brief.md",
        expectedSha256: "f".repeat(64),
        citations: [FIRST],
      }),
    ).rejects.toThrow("does not match expectedSha256");
    await expect(
      verifyResearchReport({
        workspaceRoot,
        path: "brief.txt",
        expectedSha256: sha256(markdown),
        citations: [FIRST],
      }),
    ).rejects.toThrow("must be a Markdown file");
    await expect(
      verifyResearchReport({
        workspaceRoot,
        path: "../brief.md",
        expectedSha256: sha256(markdown),
        citations: [FIRST],
      }),
    ).rejects.toThrow("escapes the workspace");
    const controller = new AbortController();
    controller.abort();
    await expect(
      verifyResearchReport({
        workspaceRoot,
        path: "brief.md",
        expectedSha256: sha256(markdown),
        citations: [FIRST],
        signal: controller.signal,
      }),
    ).rejects.toThrow("cancelled");
  });
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-research-report-"));
  roots.push(root);
  return root;
}
