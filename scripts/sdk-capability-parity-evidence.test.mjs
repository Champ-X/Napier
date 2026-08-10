import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  jsonText,
  sha256Text,
  verifyArtifacts,
} from "./sdk-capability-parity-evidence.mjs";

const EVIDENCE_DIRECTORY = path.resolve(
  "docs/artifacts/sdk-capability-parity-stage7",
);
const ZERO_DIGEST = "0".repeat(64);

describe("SDK capability parity evidence verifier", () => {
  test("accepts immutable ordinary verification after HEAD advanced from capture", async () => {
    await verifyArtifacts(EVIDENCE_DIRECTORY);
  });

  test("accepts the exact current Stage 8 repair snapshot", async () => {
    await verifyArtifacts(EVIDENCE_DIRECTORY, { verifyCurrent: true });
  }, 20_000);

  test("locks the deterministic execution closures and exclusions", async () => {
    const evidence = await readJson(EVIDENCE_DIRECTORY, "evidence.json");
    const { fourStateParity, productionServerTrace } =
      evidence.identity.executionClosure.groups;
    expect(fourStateParity.counts).toEqual({
      executionFiles: 767,
      sourceCounterparts: 762,
      packageManifests: 2,
      allFiles: 1531,
    });
    expect(fourStateParity.executionAreaCounts).toEqual({
      "apps/cli/dist": 56,
      "apps/server/dist": 100,
      "packages/contracts/dist": 23,
      "packages/runtime/dist": 580,
      "packages/runtime/test/fixtures": 3,
      "packages/sdk/dist": 3,
      scripts: 2,
    });
    expect(productionServerTrace.counts).toEqual({
      executionFiles: 709,
      sourceCounterparts: 705,
      packageManifests: 3,
      allFiles: 1417,
    });
    expect(productionServerTrace.executionAreaCounts).toEqual({
      "apps/server/dist": 101,
      other: 1,
      "packages/contracts/dist": 23,
      "packages/runtime/dist": 578,
      "packages/sdk/dist": 3,
      scripts: 3,
    });
    expect(
      evidence.identity.executionClosure.excludedCategories.map(
        ({ category }) => category,
      ),
    ).toEqual([
      "node_builtins_and_third_party_packages",
      "declarations_and_source_maps",
      "web_static_assets",
      "runtime_created_state_temp_and_process_output",
      "protected_user_files",
      "evidence_self_content_hash",
    ]);
  });

  test.each([
    ["failed formal command", failFormalCommand],
    ["credential-reference match", addCredentialReferenceMatch],
    ["implementation blob drift", changeImplementationBlob],
    ["implementation path omission", omitImplementationPath],
    ["repair content drift", changeRepairContent],
    ["repair path omission", omitRepairPath, { verifyCurrent: true }],
    ["execution closure content drift", changeClosureContent],
    ["execution closure path omission", omitClosurePath],
    ["execution closure count drift", changeClosureCount],
    ["historical gate receipt drift", changeGateReceipt],
    ["historical review receipt drift", changeReviewReceipt],
    ["custom Agent linkage mismatch", breakCustomAgentLink],
    ["four-state digest continuity mismatch", breakDigestContinuity],
    ["production output overflow", exceedProductionOutputBound],
    ["built server entry mismatch", changeServerEntryIdentity],
    ["unexpected evidence key", addUnexpectedEvidenceKey],
    ["missing evidence key", removeRequiredEvidenceKey],
  ])("rejects %s", async (_name, tamper, options = {}) => {
    await withArtifactCopy(async (directory) => {
      await tamper(directory);
      await expect(verifyArtifacts(directory, options)).rejects.toThrow();
    });
  });
});

async function withArtifactCopy(run) {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-sdk-capability-evidence-test-"),
  );
  const directory = path.join(root, "artifacts");
  try {
    await cp(EVIDENCE_DIRECTORY, directory, { recursive: true });
    await run(directory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function failFormalCommand(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    evidence.formalCommands[0].exitCode = 1;
  });
}

async function addCredentialReferenceMatch(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    evidence.credentialReferenceCanary.matchCount = 1;
  });
}

async function changeImplementationBlob(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    evidence.identity.implementation.files[
      "packages/sdk/src/management.ts"
    ].sha256 = ZERO_DIGEST;
  });
}

async function omitImplementationPath(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    const file = "packages/sdk/src/management.ts";
    evidence.identity.implementation.changedPaths =
      evidence.identity.implementation.changedPaths.filter(
        (candidate) => candidate !== file,
      );
    delete evidence.identity.implementation.files[file];
  });
}

async function changeRepairContent(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    evidence.identity.repairSnapshot.files[
      "scripts/check-architecture.mjs"
    ].sha256 = ZERO_DIGEST;
  });
}

async function omitRepairPath(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    const file = "scripts/check-architecture.mjs";
    evidence.identity.repairSnapshot.changedPaths =
      evidence.identity.repairSnapshot.changedPaths.filter(
        (candidate) => candidate !== file,
      );
    delete evidence.identity.repairSnapshot.files[file];
    evidence.identity.repairSnapshot.manifestSha256 = manifestHash(
      evidence.identity.repairSnapshot,
    );
    evidence.identity.manifestSha256 = manifestHash(evidence.identity);
  });
}

async function changeClosureContent(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    evidence.identity.executionClosure.groups.productionServerTrace.files[
      "apps/server/dist/index.js"
    ].sha256 = ZERO_DIGEST;
  });
}

async function omitClosurePath(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    const group = evidence.identity.executionClosure.groups.fourStateParity;
    const file = "apps/server/dist/app.js";
    group.executionFiles = group.executionFiles.filter(
      (candidate) => candidate !== file,
    );
    delete group.files[file];
  });
}

async function changeClosureCount(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    evidence.identity.executionClosure.groups.fourStateParity.counts.executionFiles -= 1;
  });
}

async function changeGateReceipt(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    evidence.gateReceipts[6].counts.totalReportedPassedTests = 2690;
  });
}

async function changeReviewReceipt(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    evidence.reviewReceipts[0].T11.verdict = "PASS";
  });
}

async function breakCustomAgentLink(directory) {
  await updateLinkedReceipt(directory, "four-state-parity.json", (receipt) => {
    receipt.setupBoundaries[2].importedAgentId = `agent_${"0".repeat(20)}`;
  });
}

async function breakDigestContinuity(directory) {
  await updateLinkedReceipt(directory, "four-state-parity.json", (receipt) => {
    receipt.setupBoundaries[1].before.rawWorkspaceSha256 = ZERO_DIGEST;
  });
}

async function exceedProductionOutputBound(directory) {
  await updateLinkedReceipt(
    directory,
    "production-server-trace.json",
    (receipt) => {
      receipt.child.stdoutBytes = receipt.child.maximumOutputBytes + 1;
      receipt.child.stderrBytes = 0;
      receipt.child.totalOutputBytes = receipt.child.stdoutBytes;
    },
  );
}

async function changeServerEntryIdentity(directory) {
  await updateLinkedReceipt(
    directory,
    "production-server-trace.json",
    (receipt) => {
      receipt.serverEntrySha256 = ZERO_DIGEST;
    },
  );
}

async function addUnexpectedEvidenceKey(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    evidence.unexpected = true;
  });
}

async function removeRequiredEvidenceKey(directory) {
  await updateJson(directory, "evidence.json", (evidence) => {
    delete evidence.result;
  });
}

async function updateLinkedReceipt(directory, file, mutate) {
  const text = await updateJson(directory, file, mutate);
  await updateJson(directory, "evidence.json", (evidence) => {
    const index = file === "four-state-parity.json" ? 0 : 1;
    const artifact =
      file === "four-state-parity.json"
        ? evidence.artifacts.fourStateParity
        : evidence.artifacts.productionServerTrace;
    artifact.sha256 = sha256Text(text);
    evidence.formalCommands[index].evidenceSha256 = sha256Text(text);
    evidence.formalCommands[index].receiptSha256 = receiptHash(
      evidence.formalCommands[index],
    );
  });
}

async function readJson(directory, file) {
  return JSON.parse(await readFile(path.join(directory, file), "utf8"));
}

async function updateJson(directory, file, mutate) {
  const target = path.join(directory, file);
  const value = await readJson(directory, file);
  mutate(value);
  const text = jsonText(value);
  await writeFile(target, text);
  return text;
}

function receiptHash(receipt) {
  const { receiptSha256: _ignored, ...content } = receipt;
  return sha256Text(JSON.stringify(content));
}

function manifestHash(manifest) {
  const { manifestSha256: _ignored, ...content } = manifest;
  return sha256Text(JSON.stringify(content));
}
