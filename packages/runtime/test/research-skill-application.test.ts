import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  parseResearchSourceEvidenceV1,
  projectSkillApplicationV1,
} from "@napier/contracts/skill-load";
import { afterEach, describe, expect, it } from "vitest";

import { buildProjectSkillSnapshot } from "../src/project-skill-snapshot.js";
import { createSkillLoadTool } from "../src/skill-load-tool.js";
import { canonicalJson } from "../src/ed25519.js";

const roots: string[] = [];
const runId = "run_skill_application_12345678";
const token = "[citation:citation_fixture12345678]";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Research Skill application projection", () => {
  it("projects all five states and requires one ordered same-Run evidence chain", async () => {
    const { snapshot, started, loaded, failed } = await fixture();
    const context = event(1, "context.skills", snapshot.binding);
    const unavailableSnapshot = await buildProjectSkillSnapshot(
      path.join(roots.at(-1)!, "workspace"),
      ["missing-skill"],
    );
    expect(
      projectSkillApplicationV1(
        [event(1, "context.skills", unavailableSnapshot.binding)],
        runId,
        { canonicalName: "missing-skill" },
      )?.state,
    ).toBe("unavailable");
    expect(
      projectSkillApplicationV1([context, started], runId, {
        canonicalName: "research-brief",
      })?.state,
    ).toBe("selected");
    expect(
      projectSkillApplicationV1([context, started, failed], runId, {
        canonicalName: "research-brief",
      })?.state,
    ).toBe("failed");
    expect(
      projectSkillApplicationV1([context, started, loaded], runId, {
        canonicalName: "research-brief",
      })?.state,
    ).toBe("loaded");

    const capture = researchEvent(
      4,
      normalizedDetails({ ...captureDetails(), stateCapsule: capsule(0) }),
    );
    const cite = researchEvent(
      5,
      normalizedDetails({ ...citeDetails(), stateCapsule: capsule(1) }),
    );
    const assistant = event(6, "message.assistant", {
      role: "assistant",
      text: `The verified claim is nonempty.\n${token}`,
    });
    const applied = projectSkillApplicationV1(
      [context, started, loaded, capture, cite, assistant],
      runId,
      { canonicalName: "research-brief" },
    );
    expect(applied).toEqual(
      expect.objectContaining({
        state: "applied",
        applicationMode: "citation_adjacent",
        captureSeq: 4,
        citeSeq: 5,
        applicationSeq: 6,
      }),
    );
    expect(
      (capture.payload as { details: Record<string, unknown> }).details,
    ).toEqual(
      expect.objectContaining({
        kind: "napier.research-source-evidence",
        continuityCapsuleContentSha256: capsule(0).capsuleSha256,
      }),
    );

    expect(
      projectSkillApplicationV1(
        [
          context,
          started,
          loaded,
          researchEvent(4, citeDetails()),
          researchEvent(5, captureDetails()),
          assistant,
        ],
        runId,
        { canonicalName: "research-brief" },
      )?.state,
    ).toBe("loaded");
    expect(
      projectSkillApplicationV1(
        [
          context,
          started,
          loaded,
          researchEvent(4, {
            kind: "napier.research-source-evidence",
            schemaVersion: 1,
            action: "list",
            sourceCount: 1,
            citationCount: 0,
            sourceSetSha256: "6".repeat(64),
            inputContentSha256: "9".repeat(64),
            continuityCapsuleContentSha256: capsule(0).capsuleSha256,
          }),
          assistant,
        ],
        runId,
        { canonicalName: "research-brief" },
      )?.state,
    ).toBe("loaded");
    expect(
      projectSkillApplicationV1(
        [
          context,
          started,
          loaded,
          capture,
          researchEvent(5, captureDetails()),
          researchEvent(6, citeDetails()),
          event(7, "message.assistant", {
            text: `Claim.\n${token}`,
          }),
        ],
        runId,
        { canonicalName: "research-brief" },
      )?.state,
    ).toBe("loaded");
    expect(
      projectSkillApplicationV1(
        [
          context,
          started,
          loaded,
          capture,
          cite,
          event(6, "message.assistant", { text: "I applied the Skill." }),
        ],
        runId,
        { canonicalName: "research-brief" },
      )?.state,
    ).toBe("loaded");
    expect(
      projectSkillApplicationV1(
        [
          context,
          started,
          loaded,
          { ...capture, runId: "run_other_12345678" },
          cite,
          assistant,
        ],
        runId,
        { canonicalName: "research-brief" },
      ),
    ).toBeUndefined();

    const afterAppliedFailure = event(7, "tool.failed", {
      callId: "call_other",
      toolName: "skill_load",
      status: "failed",
    });
    expect(
      projectSkillApplicationV1(
        [
          context,
          started,
          loaded,
          capture,
          cite,
          assistant,
          afterAppliedFailure,
        ],
        runId,
        { canonicalName: "research-brief" },
      )?.state,
    ).toBe("applied");
  });

  it("rejects malformed ordering and preserves only a fully bound absorbing Applied state", async () => {
    const {
      snapshot,
      started,
      loaded,
      failed,
      selectionDetails,
      failureDetails,
    } = await fixture();
    const context = event(1, "context.skills", snapshot.binding);
    const capture = researchEvent(
      4,
      normalizedDetails({ ...captureDetails(), stateCapsule: capsule(0) }),
    );
    const cite = researchEvent(
      5,
      normalizedDetails({ ...citeDetails(), stateCapsule: capsule(1) }),
    );
    const assistant = event(6, "message.assistant", {
      text: `Bound claim.\n${token}`,
    });
    const target = { canonicalName: "research-brief" } as const;

    expect(
      projectSkillApplicationV1([context, loaded, started], runId, target),
    ).toBeUndefined();
    expect(
      projectSkillApplicationV1(
        [context, started, { ...loaded, seq: 2 }],
        runId,
        target,
      ),
    ).toBeUndefined();
    expect(
      projectSkillApplicationV1(
        [context, started, loaded, { ...failed, seq: 4 }],
        runId,
        target,
      ),
    ).toBeUndefined();

    const { contentSha256: _content, ...failureCore } = failureDetails;
    const mismatchedCore = {
      ...failureCore,
      canonicalName: "data-analysis",
      requestedNameSha256: sha("data-analysis"),
    };
    const mismatchedFailure = {
      ...mismatchedCore,
      contentSha256: sha(canonicalJson(mismatchedCore)),
    };
    expect(
      projectSkillApplicationV1(
        [
          context,
          started,
          event(3, "tool.failed", {
            callId: "call_skill",
            toolName: "skill_load",
            details: mismatchedFailure,
          }),
        ],
        runId,
        target,
      ),
    ).toBeUndefined();

    expect(
      projectSkillApplicationV1(
        [
          context,
          started,
          loaded,
          capture,
          cite,
          assistant,
          event(7, "message.assistant", {
            text: "Later uncited terminal answer.",
          }),
        ],
        runId,
        target,
      )?.state,
    ).toBe("loaded");

    expect(
      projectSkillApplicationV1(
        [
          context,
          started,
          loaded,
          researchEvent(4, { ...captureDetails(), stateCapsule: capsule(0) }),
          researchEvent(5, { ...citeDetails(), stateCapsule: capsule(1) }),
          assistant,
        ],
        runId,
        target,
      )?.state,
    ).toBe("loaded");

    const retryStarted = event(7, "tool.started", {
      callId: "call_retry",
      toolName: "skill_load",
      details: selectionDetails,
    });
    const retryFailed = event(8, "tool.failed", {
      callId: "call_retry",
      toolName: "skill_load",
      details: failureDetails,
    });
    expect(
      projectSkillApplicationV1(
        [
          context,
          started,
          loaded,
          capture,
          cite,
          assistant,
          retryStarted,
          retryFailed,
        ],
        runId,
        target,
      ),
    ).toEqual(expect.objectContaining({ state: "applied", applicationSeq: 6 }));
  });
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-application-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const directory = path.join(workspaceRoot, "skills", "research-brief");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "SKILL.md"),
    "---\nname: research-brief\ndescription: Research fixture.\n---\n\n# Research\n",
  );
  const snapshot = await buildProjectSkillSnapshot(workspaceRoot, [
    "research-brief",
  ]);
  const tool = createSkillLoadTool(snapshot);
  const selection = tool.selection({ name: "research-brief" })!;
  const success = await tool.execute(
    "call_skill",
    { name: "research-brief" },
    new AbortController().signal,
  );
  const cancelled = new AbortController();
  cancelled.abort(new DOMException("cancelled", "AbortError"));
  const failure = await tool.execute(
    "call_skill",
    { name: "research-brief" },
    cancelled.signal,
  );
  return {
    snapshot,
    selectionDetails: selection,
    failureDetails: failure.details as Record<string, unknown>,
    started: event(2, "tool.started", {
      callId: "call_skill",
      toolName: "skill_load",
      details: selection,
    }),
    loaded: event(3, "tool.completed", {
      callId: "call_skill",
      toolName: "skill_load",
      details: success.details,
    }),
    failed: event(3, "tool.failed", {
      callId: "call_skill",
      toolName: "skill_load",
      details: failure.details,
    }),
  };
}

function capsule(citationCount: number) {
  return {
    kind: "napier.research-source-capsule-receipt",
    schemaVersion: 1,
    sourceRunId: runId,
    sourceCount: 1,
    citationCount,
    sourceSetSha256: "6".repeat(64),
    capsuleSha256: sha(`capsule-${citationCount}`),
    capsuleBytes: 128,
    storage: "local_only",
    contentSha256: sha(`capsule-receipt-${citationCount}`),
  };
}

function normalizedDetails(details: Record<string, unknown>) {
  const normalized = parseResearchSourceEvidenceV1(details);
  if (!normalized) throw new Error("Research fixture did not normalize");
  return normalized;
}

function captureDetails() {
  return sourceDetails("capture_fetch", 0);
}

function citeDetails() {
  return {
    ...sourceDetails("cite", 1),
    citationId: "citation_fixture12345678",
    citationTokenSha256: sha(token),
    citationStartLine: 1,
    citationEndLine: 1,
    citationQuoteSha256: "b".repeat(64),
    citationClaimSha256: "c".repeat(64),
  };
}

function sourceDetails(
  action: "capture_fetch" | "cite",
  citationCount: number,
) {
  return {
    kind: "napier.research-source",
    schemaVersion: 1,
    action,
    sourceKind: "web_fetch",
    sourceId: "source_fixture12345678",
    sourceContentSha256: "1".repeat(64),
    sourceUrlSha256: "2".repeat(64),
    sourceOriginSha256: "3".repeat(64),
    sourceTitleSha256: "4".repeat(64),
    sourceTextSha256: "5".repeat(64),
    sourceLineCount: 1,
    sourceTextChars: 48,
    sourceTruncated: false,
    sourceCount: 1,
    citationCount,
    sourceSetSha256: "6".repeat(64),
    webSourceContentSha256: "7".repeat(64),
    webSourceBodySha256: "8".repeat(64),
    webSourceFormat: "text",
    webSourceLineCount: 1,
    webSourceRenderMode: "static",
    browserFallbackStatus: "not_needed",
  };
}

function researchEvent(seq: number, details: unknown) {
  return event(seq, "tool.completed", {
    callId: `call_research_${seq}`,
    toolName: "research_source",
    details,
  });
}

function event(seq: number, type: string, payload: unknown) {
  return { runId, seq, type, payload };
}
