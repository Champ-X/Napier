import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  BASE_COMMIT,
  CAPTURE_OUTPUT_PATHS,
  captureEvidenceIdentity,
  deterministicExecutionClosure,
  IMPLEMENTATION_COMMIT,
  isProtectedExcludedPath,
  immutableImplementationIdentity,
  LINE_BUDGET_FILES,
  repairSnapshotForPaths,
  currentRepairSnapshot,
} from "./sdk-capability-parity-identity.mjs";
import {
  STAGE7_GATE_HISTORY,
  STAGE7_RETRY_HISTORY,
  STAGE7_REVIEW_HISTORY,
  STAGE8_REPAIR_RETRY_HISTORY,
} from "./sdk-capability-parity-stage7-history.mjs";
import {
  verifyFourStateParity,
  verifyProductionServerTrace,
} from "./sdk-capability-parity-receipts.mjs";

export { captureEvidenceIdentity };

export const EXPECTED_FILES = [
  "README.md",
  "evidence.json",
  "four-state-parity.json",
  "production-server-trace.json",
];
export const FORMAL_COMMANDS = [
  {
    id: "G04",
    command:
      "npm exec -- vitest run scripts/agent-capability-projection-equality.test.mjs",
    evidenceFile: "four-state-parity.json",
  },
  {
    id: "G05",
    command:
      "npm exec -- vitest run scripts/sdk-capability-production-server.test.mjs",
    evidenceFile: "production-server-trace.json",
  },
  {
    id: "G06-credential-reference-canary",
    command: "node --import tsx scripts/run-credential-reference-canary.ts",
    evidenceFile: false,
  },
];

const SHA256 = /^[a-f0-9]{64}$/u;
const CHRONOLOGY = {
  baseCommit: BASE_COMMIT,
  preT14Capture: {
    observedHead: BASE_COMMIT,
    meaning:
      "Stage 7 artifacts were captured before the authorized implementation commit.",
  },
  implementation: {
    commit: IMPLEMENTATION_COMMIT,
    parent: BASE_COMMIT,
    subject: "feat: add SDK capability projection parity",
    changedFiles: 33,
    insertions: 5656,
    deletions: 652,
    amended: false,
    pushed: false,
    rollback: `git revert ${IMPLEMENTATION_COMMIT}`,
  },
  stage8Repair:
    "A separate reversible follow-up repairs acceptance evidence without amending the implementation commit.",
};
const EXTERNAL_BOUNDARY = {
  evidenceSelfBinding:
    "The containing Stage 8 repair commit binds evidence.json because a file cannot contain its own content hash.",
  finalRepairCommitIdentity:
    "Recorded by the external Stage 8 acceptance output after authorization; it is not self-asserted here.",
  finalStage8Reviews:
    "Recorded externally after this artifact and working snapshot are frozen.",
};
const BUDGETS = {
  sdkRootPublicExports: 22,
  sdkRootRuntimeValueExports: 2,
  sdkManagementPublicExports: 5,
  sdkManagementRuntimeValueExports: 2,
  contractsManagementHttpPublicExports: 6,
  contractsManagementHttpRuntimeValueExports: 3,
  maximumHandwrittenProductionLines: 499,
  raisedBudget: false,
};

export function createEvidence(input) {
  const artifactHashes = {
    readme: sha256Text(input.readme),
    fourState: sha256Text(input.fourStateText),
    trace: sha256Text(input.productionTraceText),
  };
  const formalCommands = input.formalCommands.map((observation, index) => {
    const contract = FORMAL_COMMANDS[index];
    assert.equal(observation.id, contract.id);
    return withReceiptHash({
      ...observation,
      evidenceFile: contract.evidenceFile,
      evidenceSha256:
        contract.evidenceFile === "four-state-parity.json"
          ? artifactHashes.fourState
          : contract.evidenceFile === "production-server-trace.json"
            ? artifactHashes.trace
            : false,
    });
  });
  return {
    kind: "napier.sdk-capability-parity-evidence",
    schemaVersion: 2,
    scope: "napier-m0-sdk-capability-projection-parity",
    stage: 8,
    result: "stage7_evidence_repaired_and_verified",
    chronology: CHRONOLOGY,
    externalBoundary: EXTERNAL_BOUNDARY,
    execution: {
      offline: true,
      liveModelCalls: false,
      externalNetworkRequired: false,
      overallM0Complete: false,
      outOfScopeMilestones: ["M1", "M2", "M3", "M4", "M5"],
    },
    gateReceipts: STAGE7_GATE_HISTORY.map((gate) =>
      withReceiptHash({
        ...gate,
        source: "validated_stage7_execution_history",
      }),
    ),
    formalCommands,
    credentialReferenceCanary: input.canary,
    identity: input.identity,
    publicApiBudgets: BUDGETS,
    retryLedger: {
      stage7: STAGE7_RETRY_HISTORY,
      stage8Repair: STAGE8_REPAIR_RETRY_HISTORY,
    },
    reviewReceipts: STAGE7_REVIEW_HISTORY.map((review) =>
      withReceiptHash({ ...review, source: "validated_stage7_review_history" }),
    ),
    protectedFiles: {
      excluded: [
        ".env",
        "goal.md",
        "docs/napier-interview-deep-dive.zh-CN.md",
        "ai-news-weekly/",
        "kakeya/",
      ],
      verification: "external_names_only_G08",
    },
    cleanup: {
      fourStateRootRemoved: input.fourStateParity.cleanup.removed,
      productionRootValidated:
        input.productionServerTrace.cleanup.rootValidated,
      productionRootRemoved: input.productionServerTrace.cleanup.removed,
      productionChildForced: input.productionServerTrace.child.forcedCleanup,
      exampleChildForced: input.productionServerTrace.example.forcedCleanup,
      productionPortClosed: input.productionServerTrace.portClosed,
    },
    artifacts: {
      readme: { file: "README.md", sha256: artifactHashes.readme },
      fourStateParity: {
        file: "four-state-parity.json",
        sha256: artifactHashes.fourState,
      },
      productionServerTrace: {
        file: "production-server-trace.json",
        sha256: artifactHashes.trace,
      },
    },
  };
}

export async function verifyArtifacts(target, options = {}) {
  assert.deepEqual((await readdir(target)).sort(), EXPECTED_FILES);
  for (const file of EXPECTED_FILES) {
    const stat = await lstat(path.join(target, file));
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isSymbolicLink(), false);
  }
  const texts = await readArtifactTexts(target);
  const evidence = JSON.parse(texts.evidence);
  const fourState = JSON.parse(texts.fourState);
  const trace = JSON.parse(texts.trace);
  await verifyEvidence(evidence, texts, fourState, trace, options);
  verifyFourStateParity(fourState);
  const productionFiles = Object.fromEntries(
    Object.entries(
      evidence.identity.executionClosure.groups.productionServerTrace.files,
    ).map(([file, record]) => [file, record.sha256]),
  );
  verifyProductionServerTrace(trace, { files: productionFiles });
  verifyArtifactCorpus(Object.values(texts).join("\n"));
}

async function verifyEvidence(value, texts, fourState, trace, options) {
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "scope",
    "stage",
    "result",
    "chronology",
    "externalBoundary",
    "execution",
    "gateReceipts",
    "formalCommands",
    "credentialReferenceCanary",
    "identity",
    "publicApiBudgets",
    "retryLedger",
    "reviewReceipts",
    "protectedFiles",
    "cleanup",
    "artifacts",
  ]);
  assert.equal(value.kind, "napier.sdk-capability-parity-evidence");
  assert.equal(value.schemaVersion, 2);
  assert.equal(value.scope, "napier-m0-sdk-capability-projection-parity");
  assert.equal(value.stage, 8);
  assert.equal(value.result, "stage7_evidence_repaired_and_verified");
  assert.deepEqual(value.chronology, CHRONOLOGY);
  assert.deepEqual(value.externalBoundary, EXTERNAL_BOUNDARY);
  assert.deepEqual(value.execution, {
    offline: true,
    liveModelCalls: false,
    externalNetworkRequired: false,
    overallM0Complete: false,
    outOfScopeMilestones: ["M1", "M2", "M3", "M4", "M5"],
  });
  assert.deepEqual(
    value.gateReceipts,
    STAGE7_GATE_HISTORY.map((gate) =>
      withReceiptHash({
        ...gate,
        source: "validated_stage7_execution_history",
      }),
    ),
  );
  verifyFormalCommands(value.formalCommands);
  assert.deepEqual(value.credentialReferenceCanary, {
    status: "pass",
    matchCount: 0,
  });
  await verifyIdentity(value.identity, options.verifyCurrent === true);
  assert.deepEqual(value.publicApiBudgets, BUDGETS);
  assert.deepEqual(value.retryLedger, {
    stage7: STAGE7_RETRY_HISTORY,
    stage8Repair: STAGE8_REPAIR_RETRY_HISTORY,
  });
  assert.deepEqual(
    value.reviewReceipts,
    STAGE7_REVIEW_HISTORY.map((review) =>
      withReceiptHash({ ...review, source: "validated_stage7_review_history" }),
    ),
  );
  assert.deepEqual(value.protectedFiles, {
    excluded: [
      ".env",
      "goal.md",
      "docs/napier-interview-deep-dive.zh-CN.md",
      "ai-news-weekly/",
      "kakeya/",
    ],
    verification: "external_names_only_G08",
  });
  assert.deepEqual(value.cleanup, {
    fourStateRootRemoved: fourState.cleanup.removed,
    productionRootValidated: trace.cleanup.rootValidated,
    productionRootRemoved: trace.cleanup.removed,
    productionChildForced: trace.child.forcedCleanup,
    exampleChildForced: trace.example.forcedCleanup,
    productionPortClosed: trace.portClosed,
  });
  verifyArtifactLinks(value, texts);
}

async function verifyIdentity(value, verifyCurrent) {
  exactKeys(value, [
    "schemaVersion",
    "implementation",
    "repairSnapshot",
    "executionClosure",
    "manifestSha256",
  ]);
  assert.equal(value.schemaVersion, 2);
  assert.equal(value.manifestSha256, manifestHash(value));
  assert.deepEqual(
    value.implementation,
    await immutableImplementationIdentity(),
  );
  assert.deepEqual(
    [...value.repairSnapshot.changedPaths].sort(),
    value.repairSnapshot.changedPaths,
  );
  assert.deepEqual(
    [...value.repairSnapshot.deletedPaths].sort(),
    value.repairSnapshot.deletedPaths,
  );
  for (const file of value.repairSnapshot.changedPaths) {
    assert.equal(isProtectedExcludedPath(file), false);
  }
  for (const file of value.repairSnapshot.deletedPaths) {
    assert.equal(isProtectedExcludedPath(file), false);
  }
  for (const file of Object.keys(value.repairSnapshot.files)) {
    assert.equal(isProtectedExcludedPath(file), false);
  }
  for (const file of value.repairSnapshot.deletedPaths) {
    assert.ok(value.repairSnapshot.changedPaths.includes(file));
    assert.equal(value.repairSnapshot.files[file], undefined);
  }
  for (const file of CAPTURE_OUTPUT_PATHS) {
    assert.ok(value.repairSnapshot.changedPaths.includes(file));
  }
  assert.deepEqual(
    value.repairSnapshot,
    await repairSnapshotForPaths(value.repairSnapshot.changedPaths),
  );
  assert.deepEqual(
    value.executionClosure,
    await deterministicExecutionClosure(),
  );
  if (verifyCurrent) {
    assert.deepEqual(value.repairSnapshot, await currentRepairSnapshot());
  }
  for (const group of Object.values(value.executionClosure.groups)) {
    assert.equal(group.counts.allFiles, Object.keys(group.files).length);
    for (const [file, record] of Object.entries(group.files)) {
      verifyContentRecord(file, record);
    }
  }
  for (const [file, record] of Object.entries(value.implementation.files)) {
    verifyContentRecord(file, record, true);
  }
  for (const [file, record] of Object.entries(value.repairSnapshot.files)) {
    verifyContentRecord(file, record);
  }
}

function verifyFormalCommands(value) {
  assert.equal(denseArray(value), true);
  assert.equal(value.length, FORMAL_COMMANDS.length);
  for (const [index, receipt] of value.entries()) {
    exactKeys(receipt, [
      "id",
      "command",
      "exitCode",
      "stdoutSha256",
      "stderrSha256",
      "evidenceFile",
      "evidenceSha256",
      "receiptSha256",
    ]);
    const expected = FORMAL_COMMANDS[index];
    assert.equal(receipt.id, expected.id);
    assert.equal(receipt.command, expected.command);
    assert.equal(receipt.exitCode, 0);
    sha256(receipt.stdoutSha256);
    sha256(receipt.stderrSha256);
    assert.equal(receipt.evidenceFile, expected.evidenceFile);
    if (receipt.evidenceFile) sha256(receipt.evidenceSha256);
    else assert.equal(receipt.evidenceSha256, false);
    assert.equal(receipt.receiptSha256, receiptHash(receipt));
  }
}

function verifyArtifactLinks(value, texts) {
  exactKeys(value.artifacts, [
    "readme",
    "fourStateParity",
    "productionServerTrace",
  ]);
  const linked = [
    [value.artifacts.readme, "README.md", texts.readme],
    [
      value.artifacts.fourStateParity,
      "four-state-parity.json",
      texts.fourState,
    ],
    [
      value.artifacts.productionServerTrace,
      "production-server-trace.json",
      texts.trace,
    ],
  ];
  for (const [artifact, file, text] of linked) {
    assert.deepEqual(artifact, { file, sha256: sha256Text(text) });
  }
  assert.equal(
    value.formalCommands[0].evidenceSha256,
    value.artifacts.fourStateParity.sha256,
  );
  assert.equal(
    value.formalCommands[1].evidenceSha256,
    value.artifacts.productionServerTrace.sha256,
  );
}

function verifyContentRecord(file, record, gitBlob = false) {
  exactKeys(
    record,
    gitBlob ? ["gitBlobSha1", "sha256", "lines"] : ["sha256", "lines"],
  );
  if (gitBlob) assert.match(record.gitBlobSha1, /^[a-f0-9]{40}$/u);
  sha256(record.sha256);
  assert.ok(Number.isSafeInteger(record.lines) && record.lines >= 0);
  if (LINE_BUDGET_FILES.has(file)) assert.ok(record.lines <= 499);
}

async function readArtifactTexts(target) {
  const [readme, evidence, fourState, trace] = await Promise.all([
    readFile(path.join(target, "README.md"), "utf8"),
    readFile(path.join(target, "evidence.json"), "utf8"),
    readFile(path.join(target, "four-state-parity.json"), "utf8"),
    readFile(path.join(target, "production-server-trace.json"), "utf8"),
  ]);
  return { readme, evidence, fourState, trace };
}

function withReceiptHash(receipt) {
  return { ...receipt, receiptSha256: receiptHash(receipt) };
}

function receiptHash(receipt) {
  const { receiptSha256: _ignored, ...content } = receipt;
  return sha256Text(JSON.stringify(content));
}

function manifestHash(manifest) {
  const { manifestSha256: _ignored, ...content } = manifest;
  return sha256Text(JSON.stringify(content));
}

function exactKeys(value, keys) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value), keys);
}

function denseArray(value) {
  return (
    Array.isArray(value) &&
    value.every((_, index) => Object.hasOwn(value, index))
  );
}

function sha256(value) {
  assert.equal(typeof value, "string");
  assert.match(value, SHA256);
}

function verifyArtifactCorpus(value) {
  for (const forbidden of [
    /\/Users\//u,
    /\/private\/tmp\//u,
    /(?:^|[^A-Za-z])\/tmp\//u,
    /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/u,
    /AKIA[0-9A-Z]{16}/u,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
    /Napier is listening on http:\/\//u,
    /"agents"\s*:\s*\[/u,
  ])
    assert.equal(forbidden.test(value), false);
}

export function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}
