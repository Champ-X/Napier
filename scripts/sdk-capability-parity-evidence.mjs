import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  captureCurrentIdentity,
  IDENTITY_FILES,
  LINE_BUDGET_FILES,
} from "./sdk-capability-parity-identity.mjs";

import {
  verifyFourStateParity,
  verifyProductionServerTrace,
} from "./sdk-capability-parity-receipts.mjs";

export { captureCurrentIdentity };

export const BASE_COMMIT = "c9f225388cf40766b9002365121242758abf18d8";
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
    evidenceFile: null,
  },
];
export const EXECUTION_DISCLOSURES = [
  "The pre-existing install lacked the package-lock-declared SDK workspace link; a validated ignored link enabled the locked root import and was removed afterward.",
  "An initial offline temp installation lacked one cached Runtime dependency; the approved extracted-published-tarball consumer then passed JS and TypeScript checks without network access.",
  "A broad read-only plan search was interrupted at its bound before the exact run path was supplied.",
  "One broad cleanup command was rejected before execution; validated task-root cleanup then completed through the bounded Node filesystem API.",
  "The first sparse-array test replay used stale Contracts dist because build was omitted; rebuilding made all systematic validator cases pass without a source correction.",
];

const SHA256 = /^[a-f0-9]{64}$/u;

export function createEvidence(input) {
  const artifactHashes = {
    readme: sha256Text(input.readme),
    fourState: sha256Text(input.fourStateText),
    trace: sha256Text(input.productionTraceText),
  };
  const formalCommands = input.formalCommands.map((receipt) => {
    const contract = FORMAL_COMMANDS.find(({ id }) => id === receipt.id);
    assert.ok(contract);
    return {
      ...receipt,
      evidenceFile: contract.evidenceFile,
      evidenceSha256:
        contract.evidenceFile === "four-state-parity.json"
          ? artifactHashes.fourState
          : contract.evidenceFile === "production-server-trace.json"
            ? artifactHashes.trace
            : null,
    };
  });
  return {
    kind: "napier.sdk-capability-parity-evidence",
    schemaVersion: 1,
    scope: "napier-m0-sdk-capability-projection-parity",
    stage: 7,
    commit: {
      base: BASE_COMMIT,
      observedHead: input.identity.head,
      final: null,
      status: "pending_explicit_T14_authorization",
    },
    result: "formal_evidence_passed",
    execution: {
      offline: true,
      liveModelCalls: false,
      externalNetworkRequired: false,
    },
    gateContract: {
      requiredGateIds: ["G01", "G02", "G03", "G04", "G05", "G06", "G07", "G08"],
      artifactGateIds: FORMAL_COMMANDS.map(({ id }) => id),
      fullRepositoryCommand: "npm run check",
      nonArtifactGatesVerifiedExternally: true,
    },
    formalCommands,
    credentialReferenceCanary: input.canary,
    sourceIdentity: input.identity,
    publicApiBudgets: {
      sdkRootPublicExports: 22,
      sdkRootRuntimeValueExports: 2,
      sdkManagementPublicExports: 5,
      sdkManagementRuntimeValueExports: 2,
      contractsManagementHttpPublicExports: 6,
      contractsManagementHttpRuntimeValueExports: 3,
      maximumHandwrittenProductionLines: 499,
    },
    executionDisclosures: EXECUTION_DISCLOSURES,
    reviews: {
      preimplementation: [
        {
          reviewer: "/root/stage2_goal_intake",
          verdict: "pass-with-known-nonblocking-risks",
          blockers: [],
        },
        {
          reviewer: "/root/stage3_entry_capabilities",
          verdict: "pass-with-known-nonblocking-risks",
          blockers: [],
        },
      ],
      implementation: {
        status: "pending_after_frozen_G01_G07",
        requiredIndependentReviewCount: 2,
      },
    },
    protectedFiles: {
      excluded: [".env", "goal.md", "docs/napier-interview-deep-dive.zh-CN.md"],
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

export async function verifyArtifacts(target) {
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
  verifyEvidence(evidence, texts, fourState, trace);
  verifyFourStateParity(fourState);
  verifyProductionServerTrace(trace, evidence.sourceIdentity);
  assert.deepEqual(evidence.sourceIdentity, await captureCurrentIdentity());
  verifyArtifactCorpus(Object.values(texts).join("\n"));
}

function verifyEvidence(value, texts, fourState, trace) {
  exactKeys(value, [
    "kind",
    "schemaVersion",
    "scope",
    "stage",
    "commit",
    "result",
    "execution",
    "gateContract",
    "formalCommands",
    "credentialReferenceCanary",
    "sourceIdentity",
    "publicApiBudgets",
    "executionDisclosures",
    "reviews",
    "protectedFiles",
    "cleanup",
    "artifacts",
  ]);
  assert.equal(value.kind, "napier.sdk-capability-parity-evidence");
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.scope, "napier-m0-sdk-capability-projection-parity");
  assert.equal(value.stage, 7);
  exactKeys(value.commit, ["base", "observedHead", "final", "status"]);
  assert.deepEqual(value.commit, {
    base: BASE_COMMIT,
    observedHead: BASE_COMMIT,
    final: null,
    status: "pending_explicit_T14_authorization",
  });
  assert.equal(value.result, "formal_evidence_passed");
  assert.deepEqual(value.execution, {
    offline: true,
    liveModelCalls: false,
    externalNetworkRequired: false,
  });
  exactKeys(value.gateContract, [
    "requiredGateIds",
    "artifactGateIds",
    "fullRepositoryCommand",
    "nonArtifactGatesVerifiedExternally",
  ]);
  assert.deepEqual(value.gateContract.requiredGateIds, [
    "G01",
    "G02",
    "G03",
    "G04",
    "G05",
    "G06",
    "G07",
    "G08",
  ]);
  assert.deepEqual(
    value.gateContract.artifactGateIds,
    FORMAL_COMMANDS.map(({ id }) => id),
  );
  assert.equal(value.gateContract.fullRepositoryCommand, "npm run check");
  assert.equal(value.gateContract.nonArtifactGatesVerifiedExternally, true);
  verifyFormalCommands(value.formalCommands);
  exactKeys(value.credentialReferenceCanary, ["status", "matchCount"]);
  assert.deepEqual(value.credentialReferenceCanary, {
    status: "pass",
    matchCount: 0,
  });
  verifyIdentitySchema(value.sourceIdentity);
  assert.deepEqual(value.publicApiBudgets, {
    sdkRootPublicExports: 22,
    sdkRootRuntimeValueExports: 2,
    sdkManagementPublicExports: 5,
    sdkManagementRuntimeValueExports: 2,
    contractsManagementHttpPublicExports: 6,
    contractsManagementHttpRuntimeValueExports: 3,
    maximumHandwrittenProductionLines: 499,
  });
  assert.deepEqual(value.executionDisclosures, EXECUTION_DISCLOSURES);
  verifyReviewAndProtection(value);
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
    ]);
    const expected = FORMAL_COMMANDS[index];
    assert.equal(receipt.id, expected.id);
    assert.equal(receipt.command, expected.command);
    assert.equal(receipt.exitCode, 0);
    sha256(receipt.stdoutSha256);
    sha256(receipt.stderrSha256);
    assert.equal(receipt.evidenceFile, expected.evidenceFile);
    if (receipt.evidenceFile) sha256(receipt.evidenceSha256);
    else assert.equal(receipt.evidenceSha256, null);
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
    exactKeys(artifact, ["file", "sha256"]);
    assert.equal(artifact.file, file);
    assert.equal(artifact.sha256, sha256Text(text));
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

function verifyIdentitySchema(value) {
  exactKeys(value, ["schemaVersion", "head", "files", "lineCounts"]);
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.head, BASE_COMMIT);
  assert.deepEqual(Object.keys(value.files), IDENTITY_FILES);
  for (const digest of Object.values(value.files)) sha256(digest);
  assert.deepEqual(Object.keys(value.lineCounts), IDENTITY_FILES);
  for (const [file, lines] of Object.entries(value.lineCounts)) {
    assert.ok(IDENTITY_FILES.includes(file));
    assert.ok(Number.isSafeInteger(lines) && lines > 0);
    if (LINE_BUDGET_FILES.has(file)) assert.ok(lines <= 499);
  }
}

function verifyReviewAndProtection(value) {
  exactKeys(value.reviews, ["preimplementation", "implementation"]);
  assert.deepEqual(value.reviews.preimplementation, [
    {
      reviewer: "/root/stage2_goal_intake",
      verdict: "pass-with-known-nonblocking-risks",
      blockers: [],
    },
    {
      reviewer: "/root/stage3_entry_capabilities",
      verdict: "pass-with-known-nonblocking-risks",
      blockers: [],
    },
  ]);
  assert.deepEqual(value.reviews.implementation, {
    status: "pending_after_frozen_G01_G07",
    requiredIndependentReviewCount: 2,
  });
  assert.deepEqual(value.protectedFiles, {
    excluded: [".env", "goal.md", "docs/napier-interview-deep-dive.zh-CN.md"],
    verification: "external_names_only_G08",
  });
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

function exactKeys(value, keys) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value), keys);
}

function denseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
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
    /sk-[A-Za-z0-9_-]{20,}/u,
    /AKIA[0-9A-Z]{16}/u,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
    /Napier is listening on http:\/\//u,
    /"agents"\s*:\s*\[/u,
  ]) {
    assert.equal(forbidden.test(value), false);
  }
}

export function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256Text(value) {
  return sha256Bytes(Buffer.from(value, "utf8"));
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}
