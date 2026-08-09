import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildProjectSkillSnapshot } from "../packages/runtime/src/project-skill-snapshot.ts";
import { createSkillLoadTool } from "../packages/runtime/src/skill-load-tool.ts";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertSecretAbsent,
  canonicalJson,
  createReceipt,
  FAST_CORE_BASELINE_HEAD,
  FAST_CORE_FINAL_CHECK_HEAD,
  FAST_CORE_FINAL_CHECK_EXCLUSIONS,
  FAST_CORE_PROMPT,
  parseJsonlFrames,
  verifyFastCoreEvidenceBundle,
  verifyFastCoreFrames,
} from "./skill-load-fast-core-evidence-lib.mjs";

const roots = [];
const runId = "run_fast_core_12345678";
const token = "[citation:citation_fastcore12345678]";
const sha = (value) => createHash("sha256").update(value).digest("hex");

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Skill load fast-core evidence verifier", () => {
  it("accepts only the complete ordered Applied chain", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-evidence-lib-"));
    roots.push(root);
    for (const name of ["research-brief", "data-analysis"]) {
      const directory = path.join(root, "skills", name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name} fixture.\n---\n\n# ${name}\n`,
      );
    }
    const skillSnapshot = await buildProjectSkillSnapshot(root, [
      "research-brief",
      "data-analysis",
    ]);
    const tool = createSkillLoadTool(skillSnapshot);
    const receipt = await tool.execute(
      "call_skill",
      { name: "research-brief" },
      new AbortController().signal,
    );
    const events = [
      event(1, "context.skills", skillSnapshot.binding),
      event(2, "tool.started", {
        callId: "call_skill",
        toolName: "skill_load",
        details: tool.selection({ name: "research-brief" }),
      }),
      event(3, "tool.completed", {
        callId: "call_skill",
        toolName: "skill_load",
        operation: "skill.load",
        details: receipt.details,
      }),
      event(4, "tool.completed", { toolName: "web_search" }),
      event(5, "tool.completed", { toolName: "web_fetch" }),
      event(6, "tool.completed", {
        toolName: "research_source",
        details: research("capture_fetch", 0),
      }),
      event(7, "tool.completed", {
        toolName: "research_source",
        details: {
          ...research("cite", 1),
          citationId: "citation_fastcore12345678",
          citationTokenSha256: sha(token),
          citationStartLine: 1,
          citationEndLine: 1,
          citationQuoteSha256: "b".repeat(64),
          citationClaimSha256: "c".repeat(64),
        },
      }),
      event(8, "message.assistant", { text: `Node.js claim.\n${token}` }),
    ];
    const frames = fixtureFrames(events);
    const verified = verifyFastCoreFrames(frames, {
      provider: "deepseek",
      model: "deepseek-v4-flash",
    });
    expect(verified.projection.state).toBe("applied");
    expect(verified.safeToolSequence.map((item) => item.toolName)).toEqual([
      "skill_load",
      "web_search",
      "web_fetch",
      "research_source",
      "research_source",
    ]);

    expect(() =>
      verifyFastCoreFrames(
        fixtureFrames(events.filter((item) => item.seq !== 4)),
        { provider: "deepseek", model: "deepseek-v4-flash" },
      ),
    ).toThrow(/web_search/u);
  });

  it("parses JSONL and rejects credential canary output", () => {
    const frames = parseJsonlFrames(
      `${JSON.stringify({ type: "snapshot" })}\n${JSON.stringify({ type: "done" })}\n`,
    );
    expect(frames).toHaveLength(2);
    expect(() =>
      assertSecretAbsent(["prefix-secret-suffix"], "secret"),
    ).toThrow(/canary/u);
    expect(FAST_CORE_PROMPT).toContain("official nodejs.org");
  });

  it("verifies the retained receipt closure and rejects every bound tamper", async () => {
    const bundle = await readVerifierBundle();
    expect(verifyFastCoreEvidenceBundle(bundle)).toEqual(
      expect.objectContaining({
        realProviderSha256: bundle.evidence.realProviderSha256,
        securityCleanupSha256: bundle.evidence.securityCleanupSha256,
      }),
    );

    const tamperCases = [
      [
        "attempt ordinal",
        (value) => (value.realProvider.verifiedAttemptLedger[0].ordinal = 2),
      ],
      ["successful payload", (value) => (value.realProvider.exitCode = 1)],
      ["cleanup", (value) => (value.securityCleanup.rawJsonlRetained = true)],
      [
        "retained canary",
        (value) => (value.securityCleanup.retainedCanaryScan.targetCount += 1),
      ],
      [
        "public scan",
        (value) =>
          (value.securityCleanup.publicWorkingTreeScan.targetManifestSha256 =
            "0".repeat(64)),
      ],
      [
        "staged scan",
        (value) => (value.securityCleanup.stagedIndexScan.targetCount += 1),
      ],
      [
        "top-level binding",
        (value) => (value.evidence.realProviderSha256 = "0".repeat(64)),
      ],
    ];
    for (const [label, tamper] of tamperCases) {
      const changed = structuredClone(bundle);
      tamper(changed);
      expect(() => verifyFastCoreEvidenceBundle(changed), label).toThrow();
    }
  });

  it("rejects extra keys at every retained nesting level", async () => {
    const bundle = await readVerifierBundle();
    const mutations = [
      (value) => (value.evidence.extra = true),
      (value) => (value.realProvider.extra = true),
      (value) => (value.realProvider.skillCopies[0].extra = true),
      (value) => (value.realProvider.toolSequence[0].extra = true),
      (value) => (value.realProvider.application.extra = true),
      (value) => (value.realProvider.replay.extra = true),
      (value) => (value.realProvider.verifiedAttemptLedger[0].extra = true),
      (value) =>
        (value.realProvider.unverifiableChronologyNotes[0].extra = true),
      (value) => (value.securityCleanup.extra = true),
      (value) => (value.securityCleanup.orchestrationChronology.extra = true),
      (value) =>
        (value.securityCleanup.orchestrationChronology.externalStage7Chronology.extra = true),
      (value) =>
        (value.securityCleanup.orchestrationChronology.observations[0].extra = true),
      (value) => (value.securityCleanup.retainedCanaryScan.extra = true),
      (value) => (value.securityCleanup.publicWorkingTreeScan.extra = true),
      (value) =>
        (value.securityCleanup.publicWorkingTreeScan.targetManifest[0].extra = true),
      (value) => (value.finalCheck.extra = true),
      (value) => (value.finalCheck.taskTree.extra = true),
      (value) => (value.finalCheck.taskTree.exclusions[0].extra = true),
      (value) => (value.finalCheck.taskTree.entries[0].extra = true),
      (value) => (value.finalCheck.suiteCounts.extra = true),
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(bundle);
      mutate(changed);
      expect(() => verifyFastCoreEvidenceBundle(changed)).toThrow();
    }
  });

  it("rejects same-path byte changes and rehashed public-manifest tampering", async () => {
    const bundle = await readVerifierBundle();
    const changed = structuredClone(bundle);
    changed.readme = Buffer.from(`${changed.readme.toString("utf8")}tamper\n`);
    changed.evidence.readmeSha256 = sha(changed.readme);
    expect(() => verifyFastCoreEvidenceBundle(changed)).toThrow(
      /public manifest/u,
    );

    const rehashed = structuredClone(changed);
    const publicScan = rehashed.securityCleanup.publicWorkingTreeScan;
    const readmeEntry = publicScan.targetManifest.find(
      (entry) =>
        entry.path === "docs/artifacts/skill-load-fast-core-stage7/README.md",
    );
    readmeEntry.contentSha256 = sha(rehashed.readme);
    publicScan.targetManifestSha256 = sha(
      canonicalJson(publicScan.targetManifest),
    );
    publicScan.receiptSha256 = receiptHash(publicScan);
    rehashed.evidence.securityCleanupSha256 = sha(
      canonicalJson(rehashed.securityCleanup),
    );
    rehashed.evidence.publicWorkingTreeScanReceiptSha256 =
      publicScan.receiptSha256;
    expect(() => verifyFastCoreEvidenceBundle(rehashed)).toThrow();
  });

  it("rejects fully rehashed changes to fixed orchestration facts", async () => {
    const bundle = await readVerifierBundle();
    const changed = structuredClone(bundle);
    const chronology = changed.securityCleanup.orchestrationChronology;
    chronology.baselineHead = "f".repeat(40);
    chronology.receiptSha256 = receiptHash(chronology);
    changed.evidence.securityCleanupSha256 = sha(
      canonicalJson(changed.securityCleanup),
    );
    expect(() => verifyFastCoreEvidenceBundle(changed)).toThrow(
      /baselineHead/u,
    );
  });

  it("reuses a verified retained receipt without a provider credential", () => {
    if (process.env.NAPIER_FINAL_CHECK_IN_PROGRESS === "1") {
      return;
    }
    const environment = { ...process.env };
    delete environment.DEEPSEEK_API_KEY;
    const result = spawnSync(
      process.execPath,
      [
        path.resolve(
          import.meta.dirname,
          "run-skill-load-fast-core-evidence.mjs",
        ),
        "--provider",
        "deepseek",
        "--model",
        "deepseek-v4-flash",
        "--credential-env",
        "DEEPSEEK_API_KEY",
        "--output",
        path.resolve(
          import.meta.dirname,
          "../docs/artifacts/skill-load-fast-core-stage7",
        ),
        "--timeout-ms",
        "120000",
      ],
      { cwd: path.resolve(import.meta.dirname, ".."), env: environment },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.toString("utf8"))).toMatchObject({
      result: "passed",
    });
  });
});

async function readRetainedBundle() {
  const root = path.resolve(
    import.meta.dirname,
    "../docs/artifacts/skill-load-fast-core-stage7",
  );
  return {
    readme: await readFile(path.join(root, "README.md")),
    evidence: JSON.parse(
      await readFile(path.join(root, "evidence.json"), "utf8"),
    ),
    realProvider: JSON.parse(
      await readFile(path.join(root, "real-provider-cli.json"), "utf8"),
    ),
    securityCleanup: JSON.parse(
      await readFile(path.join(root, "security-cleanup.json"), "utf8"),
    ),
    finalCheck: JSON.parse(
      await readFile(path.join(root, "final-check.json"), "utf8"),
    ),
  };
}

async function readVerifierBundle() {
  const bundle = await readRetainedBundle().catch(async (error) => {
    if (
      error?.code !== "ENOENT" ||
      process.env.NAPIER_FINAL_CHECK_IN_PROGRESS !== "1"
    ) {
      throw error;
    }
    const root = path.resolve(
      import.meta.dirname,
      "../docs/artifacts/skill-load-fast-core-stage7",
    );
    return {
      readme: await readFile(path.join(root, "README.md")),
      evidence: JSON.parse(
        await readFile(path.join(root, "evidence.json"), "utf8"),
      ),
      realProvider: JSON.parse(
        await readFile(path.join(root, "real-provider-cli.json"), "utf8"),
      ),
      securityCleanup: JSON.parse(
        await readFile(path.join(root, "security-cleanup.json"), "utf8"),
      ),
    };
  });
  if (bundle.finalCheck) return bundle;
  const entries = [
    {
      path: "docs/artifacts/skill-load-fast-core-stage7/README.md",
      state: "file",
      sizeBytes: bundle.readme.byteLength,
      contentSha256: sha(bundle.readme),
    },
    {
      path: "docs/artifacts/skill-load-fast-core-stage7/real-provider-cli.json",
      state: "file",
      sizeBytes: Buffer.byteLength(
        `${JSON.stringify(bundle.realProvider, null, 2)}\n`,
      ),
      contentSha256: sha(`${JSON.stringify(bundle.realProvider, null, 2)}\n`),
    },
  ];
  const taskTreePayload = {
    algorithm: "sha256_canonical_json_v1",
    exclusions: FAST_CORE_FINAL_CHECK_EXCLUSIONS,
    entries,
  };
  const taskTree = {
    ...taskTreePayload,
    entryCount: entries.length,
    manifestSha256: sha(canonicalJson(taskTreePayload)),
  };
  const finalCheck = createReceipt({
    kind: "napier.skill-load-fast-core-final-check",
    schemaVersion: 1,
    command: "npm run check",
    exactHead: FAST_CORE_FINAL_CHECK_HEAD,
    taskTree,
    preCheckTaskTreeManifestSha256: taskTree.manifestSha256,
    postCheckTaskTreeManifestSha256: taskTree.manifestSha256,
    exitCode: 0,
    suiteCounts: {
      rootTests: 1,
      cliTestsPassed: 1,
      cliTestsSkipped: 0,
      serverTests: 1,
      webTests: 1,
      contractsTests: 1,
      runtimeTestsPassed: 1,
      runtimeTestsSkipped: 0,
      sdkTests: 1,
    },
    stdoutBytes: 0,
    stdoutSha256: sha(""),
    stderrBytes: 0,
    stderrSha256: sha(""),
  });
  bundle.finalCheck = finalCheck;
  bundle.evidence.result = "passed";
  bundle.evidence.finalCheckSha256 = sha(canonicalJson(finalCheck));
  bundle.evidence.finalCheckReceiptSha256 = finalCheck.receiptSha256;
  return bundle;
}

function fixtureFrames(events) {
  return [
    {
      type: "snapshot",
      detail: {
        events: [
          event(1, "run.started", {}),
          ...events.map((item) => ({ ...item, seq: item.seq + 1 })),
        ],
        runs: [
          {
            id: runId,
            status: "completed",
            configuration: {
              enabledTools: ["skill_load"],
              model: {
                provider: "deepseek",
                id: "deepseek-v4-flash",
              },
            },
          },
        ],
      },
    },
    {
      type: "done",
      runId,
      status: "completed",
      snapshotSha256: "d".repeat(64),
    },
  ];
}

function research(action, citationCount) {
  return {
    kind: "napier.research-source-evidence",
    schemaVersion: 1,
    action,
    sourceKind: "web_fetch",
    sourceId: "source_fastcore12345678",
    sourceContentSha256: "1".repeat(64),
    sourceUrlSha256: "2".repeat(64),
    sourceOriginSha256: "3".repeat(64),
    sourceTitleSha256: "4".repeat(64),
    sourceTextSha256: "5".repeat(64),
    sourceLineCount: 1,
    sourceTextChars: 32,
    sourceTruncated: false,
    sourceCount: 1,
    citationCount,
    sourceSetSha256: "6".repeat(64),
    inputContentSha256: "9".repeat(64),
    webSourceContentSha256: "7".repeat(64),
    webSourceBodySha256: "8".repeat(64),
    webSourceFormat: "text",
    webSourceLineCount: 1,
    webSourceRenderMode: "static",
    browserFallbackStatus: "not_needed",
  };
}

function receiptHash(value) {
  const payload = { ...value };
  delete payload.receiptSha256;
  return sha(canonicalJson(payload));
}

function event(seq, type, payload) {
  return { runId, seq, type, payload };
}
