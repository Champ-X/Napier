import { createHash } from "node:crypto";

import {
  isSkillCatalogBindingV1,
  projectSkillApplicationV1,
} from "@napier/contracts/skill-load";

export const FAST_CORE_PROMPT =
  "Use the research-brief Skill. Find the official nodejs.org release announcement for Node.js v24.0.0, identify its release date, capture and cite the official page with web_search, web_fetch and research_source, then answer with one nonempty claim line immediately followed by its citation token.";
export const FAST_CORE_BASELINE_HEAD =
  "15379397889dd3b4e86374dd377aee8479e1b264";
export const FAST_CORE_FINAL_CHECK_HEAD =
  "d868c0821e77671e6cbc05fe54e9e41e8c49be14";
export const FAST_CORE_PLAN_SHA256 =
  "4245df04c4274b43f5568fd15178251c7cc16429e4b76c8e903862bef350a1fb";
export const FAST_CORE_STAGE7_CHRONOLOGY_SHA256 =
  "308a38d619757ad82ce9f3bd994ae9a0d308399115dfd493e869ee6cc04da7fa";
export const FAST_CORE_FINAL_CHECK_EXCLUSIONS = [
  {
    path: "docs/artifacts/skill-load-fast-core-stage7/evidence.json",
    reason: "self_referential_post_check_bundle_binding",
  },
  {
    path: "docs/artifacts/skill-load-fast-core-stage7/final-check.json",
    reason: "self_referential_final_check_receipt",
  },
  {
    path: "docs/artifacts/skill-load-fast-core-stage7/security-cleanup.json",
    reason: "self_referential_post_check_public_scan_binding",
  },
];

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function parseJsonlFrames(raw) {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length < 2) throw new Error("Fast-core JSONL is incomplete");
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Fast-core JSONL line ${index + 1} is invalid`);
    }
  });
}

export function verifyFastCoreFrames(frames, expected) {
  const errors = frames.filter((frame) => frame?.type === "error");
  if (errors.length > 0)
    throw new Error("Fast-core CLI emitted an error frame");
  const done = frames.at(-1);
  if (
    !done ||
    done.type !== "done" ||
    done.status !== "completed" ||
    typeof done.runId !== "string"
  ) {
    throw new Error("Fast-core CLI did not complete");
  }
  const snapshots = frames.filter((frame) => frame?.type === "snapshot");
  if (snapshots.length !== 1) {
    throw new Error("Fast-core CLI snapshot evidence is ambiguous");
  }
  const snapshot = snapshots[0];
  const detail = snapshot.detail;
  const events = Array.isArray(detail?.events) ? detail.events : [];
  const run = Array.isArray(detail?.runs)
    ? detail.runs.find((candidate) => candidate.id === done.runId)
    : undefined;
  if (
    !run ||
    run.status !== "completed" ||
    run.configuration?.model?.provider !== expected.provider ||
    run.configuration?.model?.id !== expected.model
  ) {
    throw new Error("Fast-core Run model binding is invalid");
  }
  if (!run.configuration?.enabledTools?.includes("skill_load")) {
    throw new Error(
      "Fast-core Run did not use the persisted Skill loader capability",
    );
  }
  const starts = events.filter(
    (event) => event.runId === done.runId && event.type === "run.started",
  );
  if (
    starts.length !== 1 ||
    record(starts[0]?.payload)?.capabilityPreset !== undefined
  ) {
    throw new Error("Fast-core Run used a run-scoped capability preset");
  }
  const bindingEvents = events.filter(
    (event) => event.runId === done.runId && event.type === "context.skills",
  );
  const binding = bindingEvents[0]?.payload;
  if (
    bindingEvents.length !== 1 ||
    !isSkillCatalogBindingV1(binding) ||
    canonicalJson(binding.loadableSkillNames) !==
      canonicalJson(["data-analysis", "research-brief"])
  ) {
    throw new Error("Fast-core Project Skill binding is invalid");
  }
  const tools = events
    .filter(
      (event) =>
        event.runId === done.runId &&
        (event.type === "tool.completed" || event.type === "tool.failed"),
    )
    .map((event) => ({
      seq: event.seq,
      status: event.type === "tool.completed" ? "completed" : "failed",
      toolName: record(event.payload)?.toolName,
      action: record(record(event.payload)?.details)?.action,
      operation: record(event.payload)?.operation,
    }));
  const required = [
    ["skill_load", undefined],
    ["web_search", undefined],
    ["web_fetch", undefined],
    ["research_source", "capture_fetch"],
    ["research_source", "cite"],
  ];
  let cursor = -1;
  for (const [toolName, action] of required) {
    cursor = tools.findIndex(
      (tool, index) =>
        index > cursor &&
        tool.status === "completed" &&
        tool.toolName === toolName &&
        (action === undefined || tool.action === action),
    );
    if (cursor < 0) {
      throw new Error(`Fast-core tool evidence is missing ${toolName}`);
    }
  }
  const skill = tools.find((tool) => tool.toolName === "skill_load");
  if (skill?.operation !== "skill.load") {
    throw new Error("Fast-core Skill operation mapping is invalid");
  }
  const projection = projectSkillApplicationV1(events, done.runId, {
    canonicalName: "research-brief",
  });
  if (
    projection?.state !== "applied" ||
    projection.applicationMode !== "citation_adjacent"
  ) {
    throw new Error("Fast-core Research Skill was not applied");
  }
  return {
    done,
    snapshot,
    detail,
    events,
    run,
    binding,
    projection,
    tools,
    safeToolSequence: tools.map((tool) => ({
      seq: tool.seq,
      toolName: tool.toolName,
      status: tool.status,
      ...(tool.action ? { action: tool.action } : {}),
      ...(tool.operation ? { operation: tool.operation } : {}),
    })),
  };
}

export function assertSecretAbsent(values, secret) {
  if (!secret) throw new Error("Fast-core credential is missing");
  for (const value of values) {
    if (String(value).includes(secret)) {
      throw new Error("Fast-core credential canary matched output");
    }
  }
}

export function createReceipt(payload) {
  return {
    ...payload,
    receiptSha256: sha256(canonicalJson(payload)),
  };
}

export function createVerifiedRealProviderAttemptLedger(successPayload) {
  return [
    {
      ordinal: 3,
      result: "passed",
      exitCode: 0,
      payloadSha256: sha256(canonicalJson(successPayload)),
    },
  ];
}

export function createUnverifiableRealProviderChronologyNotes() {
  return [1, 2].map((ordinal) => ({
    ordinal,
    verification: "unverifiable",
    note: "No independently retained sanitized receipt exists; result, reason, exit code, timestamp, and payload hash were not reconstructed.",
  }));
}

export function verifyFastCoreEvidenceBundle(bundle) {
  const { readme, evidence, realProvider, securityCleanup, finalCheck } =
    bundle;
  verifyTopLevelEvidence(evidence);
  verifyRealProvider(realProvider);
  if (realProvider.application?.state !== "applied") {
    throw new Error("Fast-core retained application is not Applied");
  }
  if (realProvider.replay?.status !== "valid") {
    throw new Error("Fast-core retained replay is invalid");
  }
  if (realProvider.profileBeforeSha256 !== realProvider.profileAfterSha256) {
    throw new Error("Fast-core retained profile changed");
  }

  const { verifiedAttemptLedger, unverifiableChronologyNotes } =
    verifyAttemptEvidence(realProvider);
  verifySecurityCleanup(securityCleanup);
  verifyFinalCheck(finalCheck);
  verifyRetainedPublicContentBindings(
    readme,
    realProvider,
    securityCleanup.publicWorkingTreeScan.targetManifest,
  );
  verifyRetainedFinalTaskTreeBindings(
    readme,
    realProvider,
    finalCheck.taskTree.entries,
  );

  const expected = {
    readmeSha256: sha256(readme),
    realProviderSha256: sha256(canonicalJson(realProvider)),
    verifiedAttemptLedgerSha256: sha256(canonicalJson(verifiedAttemptLedger)),
    unverifiableChronologyNotesSha256: sha256(
      canonicalJson(unverifiableChronologyNotes),
    ),
    securityCleanupSha256: sha256(canonicalJson(securityCleanup)),
    finalCheckSha256: sha256(canonicalJson(finalCheck)),
    finalCheckReceiptSha256: finalCheck.receiptSha256,
    retainedCanaryScanReceiptSha256:
      securityCleanup.retainedCanaryScan.receiptSha256,
    publicWorkingTreeScanReceiptSha256:
      securityCleanup.publicWorkingTreeScan.receiptSha256,
    stagedIndexScanReceiptSha256: securityCleanup.stagedIndexScan.receiptSha256,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (evidence[key] !== value) {
      throw new Error(`Fast-core evidence ${key} binding is invalid`);
    }
  }
  return expected;
}

function verifyTopLevelEvidence(value) {
  assertExactKeys(
    value,
    [
      "kind",
      "schemaVersion",
      "result",
      "readmeSha256",
      "realProviderSha256",
      "verifiedAttemptLedgerSha256",
      "unverifiableChronologyNotesSha256",
      "securityCleanupSha256",
      "finalCheckSha256",
      "finalCheckReceiptSha256",
      "retainedCanaryScanReceiptSha256",
      "publicWorkingTreeScanReceiptSha256",
      "stagedIndexScanReceiptSha256",
    ],
    "top-level evidence",
  );
  assertValues(
    value,
    {
      kind: "napier.skill-load-fast-core-stage7-evidence",
      schemaVersion: 1,
      result: "passed",
    },
    "top-level evidence",
  );
  for (const key of Object.keys(value).filter((key) =>
    key.endsWith("Sha256"),
  )) {
    assertSha256(value[key], `top-level evidence ${key}`);
  }
}

function verifyRealProvider(value) {
  assertExactKeys(
    value,
    [
      "kind",
      "schemaVersion",
      "provider",
      "model",
      "protocol",
      "capabilityPath",
      "capabilityContractVersion",
      "capabilityProjectionSha256",
      "runScopedPreset",
      "credentialLocator",
      "cliEntrypointSha256",
      "promptSha256",
      "exitCode",
      "stdoutBytes",
      "stderrBytes",
      "stderrSha256",
      "rawJsonlSha256",
      "frameCount",
      "runIdSha256",
      "runStatus",
      "snapshotSha256",
      "skillCopies",
      "catalogSha256",
      "availabilitySetSha256",
      "snapshotManifestSha256",
      "bindingContentSha256",
      "toolSequence",
      "application",
      "replay",
      "profileBeforeSha256",
      "profileAfterSha256",
      "revisionCountBefore",
      "revisionCountAfter",
      "verifiedAttemptLedger",
      "unverifiableChronologyNotes",
    ],
    "real-provider evidence",
  );
  assertValues(
    value,
    {
      kind: "napier.skill-load-fast-core-real-provider-cli",
      schemaVersion: 1,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      protocol: "openai-completions",
      capabilityPath: "persistent_default_profile",
      capabilityContractVersion: 3,
      runScopedPreset: false,
      credentialLocator: "DEEPSEEK_API_KEY",
      exitCode: 0,
      runStatus: "completed",
    },
    "real-provider evidence",
  );
  for (const [key, field] of Object.entries(value)) {
    if (key.endsWith("Sha256")) assertSha256(field, `real-provider ${key}`);
  }
  for (const key of [
    "stdoutBytes",
    "stderrBytes",
    "frameCount",
    "revisionCountBefore",
    "revisionCountAfter",
  ]) {
    assertNonnegativeInteger(value[key], `real-provider ${key}`);
  }
  if (!Array.isArray(value.skillCopies) || value.skillCopies.length !== 2) {
    throw new Error("Fast-core skillCopies are invalid");
  }
  for (const copy of value.skillCopies) {
    assertExactKeys(
      copy,
      ["name", "relativePath", "contentSha256"],
      "skill copy",
    );
    assertSha256(copy.contentSha256, "skill copy contentSha256");
  }
  if (!Array.isArray(value.toolSequence) || value.toolSequence.length === 0) {
    throw new Error("Fast-core toolSequence is invalid");
  }
  for (const tool of value.toolSequence) {
    const optionals = ["action", "operation"].filter((key) => key in tool);
    assertExactKeys(
      tool,
      ["seq", "toolName", "status", ...optionals],
      "tool sequence entry",
    );
    assertNonnegativeInteger(tool.seq, "tool sequence seq");
    if (tool.status !== "completed" && tool.status !== "failed") {
      throw new Error("Fast-core tool sequence status is invalid");
    }
  }
  assertExactKeys(
    value.application,
    [
      "state",
      "mode",
      "projectionSha256",
      "receiptContentSha256",
      "citationTokenSha256",
      "contextSeq",
      "selectedSeq",
      "terminalSeq",
      "captureSeq",
      "citeSeq",
      "applicationSeq",
    ],
    "application",
  );
  for (const key of [
    "projectionSha256",
    "receiptContentSha256",
    "citationTokenSha256",
  ]) {
    assertSha256(value.application[key], `application ${key}`);
  }
  for (const key of [
    "contextSeq",
    "selectedSeq",
    "terminalSeq",
    "captureSeq",
    "citeSeq",
    "applicationSeq",
  ]) {
    assertNonnegativeInteger(value.application[key], `application ${key}`);
  }
  assertExactKeys(
    value.replay,
    ["status", "contentSha256", "eventStreamSha256", "eventCount", "runCount"],
    "replay",
  );
  assertSha256(value.replay.contentSha256, "replay contentSha256");
  assertSha256(value.replay.eventStreamSha256, "replay eventStreamSha256");
  assertNonnegativeInteger(value.replay.eventCount, "replay eventCount");
  assertNonnegativeInteger(value.replay.runCount, "replay runCount");
}

function verifyAttemptEvidence(realProvider) {
  const attempts = realProvider.verifiedAttemptLedger;
  if (!Array.isArray(attempts) || attempts.length !== 1) {
    throw new Error(
      "Fast-core verified attempt ledger must contain only the retained success",
    );
  }
  const successPayload = { ...realProvider };
  delete successPayload.verifiedAttemptLedger;
  delete successPayload.unverifiableChronologyNotes;
  const last = attempts[0];
  assertExactKeys(
    last,
    ["ordinal", "result", "exitCode", "payloadSha256"],
    "verified attempt",
  );
  if (
    canonicalJson(last) !==
    canonicalJson({
      ordinal: 3,
      result: "passed",
      exitCode: 0,
      payloadSha256: sha256(canonicalJson(successPayload)),
    })
  ) {
    throw new Error("Fast-core successful attempt payload hash is invalid");
  }
  const notes = realProvider.unverifiableChronologyNotes;
  const expectedNotes = createUnverifiableRealProviderChronologyNotes();
  if (!Array.isArray(notes)) {
    throw new Error("Fast-core unverifiable chronology notes are missing");
  }
  for (const note of notes) {
    assertExactKeys(
      note,
      ["ordinal", "verification", "note"],
      "unverifiable chronology note",
    );
  }
  if (canonicalJson(notes) !== canonicalJson(expectedNotes)) {
    throw new Error("Fast-core unverifiable chronology notes are invalid");
  }
  return {
    verifiedAttemptLedger: attempts,
    unverifiableChronologyNotes: notes,
  };
}

function verifySecurityCleanup(value) {
  assertExactKeys(
    value,
    [
      "kind",
      "schemaVersion",
      "originalCredentialCanaryMatches",
      "rawJsonlRetained",
      "privateCapsulesRetained",
      "taskOwnedRootRemoved",
      "childExitConfirmed",
      "orchestrationChronology",
      "retainedCanaryScan",
      "publicWorkingTreeScan",
      "stagedIndexScan",
    ],
    "security cleanup",
  );
  assertValues(
    value,
    {
      kind: "napier.skill-load-fast-core-security-cleanup",
      schemaVersion: 1,
      originalCredentialCanaryMatches: 0,
      rawJsonlRetained: false,
      privateCapsulesRetained: false,
      taskOwnedRootRemoved: true,
      childExitConfirmed: true,
    },
    "security cleanup",
  );
  verifyOrchestrationChronology(value.orchestrationChronology);
  verifySimpleScanReceipt(value.retainedCanaryScan, "retainedCanaryScan");
  verifyManifestScanReceipt(
    value.publicWorkingTreeScan,
    "publicWorkingTreeScan",
  );
  verifyManifestScanReceipt(value.stagedIndexScan, "stagedIndexScan");
}

function verifyOrchestrationChronology(value) {
  assertExactKeys(
    value,
    [
      "kind",
      "schemaVersion",
      "evidenceStrength",
      "baselineHead",
      "planSha256",
      "preRunStatusDigest",
      "externalStage7Chronology",
      "observations",
      "receiptSha256",
    ],
    "orchestration chronology",
  );
  assertValues(
    value,
    {
      kind: "napier.skill-load-fast-core-orchestration-chronology",
      schemaVersion: 1,
      evidenceStrength:
        "orchestration_chronology_not_independent_pre_mutation_tree_proof",
      preRunStatusDigest: "unavailable_not_retained",
      baselineHead: FAST_CORE_BASELINE_HEAD,
      planSha256: FAST_CORE_PLAN_SHA256,
    },
    "orchestration chronology",
  );
  assertGitCommit(value.baselineHead, "orchestration baselineHead");
  assertSha256(value.planSha256, "orchestration planSha256");
  assertExactKeys(
    value.externalStage7Chronology,
    ["status", "scope", "entryCount", "canonicalSha256"],
    "external Stage7 chronology",
  );
  assertValues(
    value.externalStage7Chronology,
    {
      status: "retained",
      scope: "pre_f09_chronology_prefix",
      entryCount: 7,
      canonicalSha256: FAST_CORE_STAGE7_CHRONOLOGY_SHA256,
    },
    "external Stage7 chronology",
  );
  assertSha256(
    value.externalStage7Chronology.canonicalSha256,
    "external Stage7 chronology digest",
  );
  if (!Array.isArray(value.observations) || value.observations.length !== 2) {
    throw new Error("Fast-core orchestration observations are invalid");
  }
  assertExactKeys(
    value.observations[0],
    [
      "ordinal",
      "result",
      "exitCode",
      "credentialSource",
      "providerCallAttempted",
      "temporaryRootCreated",
    ],
    "orchestration observation 1",
  );
  assertExactKeys(
    value.observations[1],
    [
      "ordinal",
      "result",
      "exitCode",
      "credentialSource",
      "provider",
      "model",
      "protocol",
      "toolName",
      "toolCallCount",
      "toolResultCount",
      "assistantTurnsAfterTool",
      "argumentSha256",
      "resultSha256",
      "sourceReceiptSha256",
      "stdoutBytes",
      "stderrBytes",
      "credentialCanaryMatches",
      "taskOwnedRootRemoved",
    ],
    "orchestration observation 2",
  );
  for (const key of ["argumentSha256", "resultSha256", "sourceReceiptSha256"]) {
    assertSha256(
      value.observations[1][key],
      `orchestration observation ${key}`,
    );
  }
  verifyReceiptHash(value, "orchestration chronology");
}

function verifySimpleScanReceipt(receipt, label) {
  assertExactKeys(
    receipt,
    [
      "scope",
      "targetCount",
      "credentialCanaryMatches",
      "privatePayloadMatches",
      "receiptSha256",
    ],
    label,
  );
  verifyReceiptHash(receipt, label);
  verifyCleanScan(receipt, label);
}

function verifyManifestScanReceipt(receipt, label) {
  const historicalScan = "credentialCanaryMatches" in receipt;
  assertExactKeys(
    receipt,
    [
      "scope",
      "targetCount",
      "targetManifest",
      "targetManifestSha256",
      ...(historicalScan
        ? ["credentialCanaryMatches", "privatePayloadMatches"]
        : ["credentialCanaryVerification", "privatePayloadVerification"]),
      "receiptSha256",
    ],
    label,
  );
  if (
    !historicalScan &&
    (receipt.credentialCanaryVerification !==
      "unavailable_credential_not_retained" ||
      receipt.privatePayloadVerification !==
        "unavailable_private_payload_not_retained")
  ) {
    throw new Error(
      `Fast-core ${label} sensitive-material verification is invalid`,
    );
  }
  if (
    !Array.isArray(receipt.targetManifest) ||
    receipt.targetCount !== receipt.targetManifest.length
  ) {
    throw new Error(`Fast-core ${label} target manifest count is invalid`);
  }
  const paths = new Set();
  for (const entry of receipt.targetManifest) {
    if (entry?.state === "file") {
      assertExactKeys(
        entry,
        ["path", "state", "contentSha256"],
        `${label} file entry`,
      );
      assertSha256(entry.contentSha256, `${label} contentSha256`);
    } else if (entry?.state === "deleted") {
      assertExactKeys(entry, ["path", "state"], `${label} deleted entry`);
    } else if (entry?.state === "content_excluded") {
      assertExactKeys(
        entry,
        ["path", "state", "exclusionReason"],
        `${label} excluded entry`,
      );
      if (!String(entry.exclusionReason).startsWith("self_referential_")) {
        throw new Error(`Fast-core ${label} exclusion reason is invalid`);
      }
    } else {
      throw new Error(`Fast-core ${label} manifest state is invalid`);
    }
    if (typeof entry.path !== "string" || paths.has(entry.path)) {
      throw new Error(`Fast-core ${label} manifest path is invalid`);
    }
    paths.add(entry.path);
  }
  if (
    receipt.targetManifestSha256 !==
    sha256(canonicalJson(receipt.targetManifest))
  ) {
    throw new Error(`Fast-core ${label} target manifest hash is invalid`);
  }
  verifyReceiptHash(receipt, label);
  if (historicalScan) verifyCleanScan(receipt, label);
}

function verifyCleanScan(receipt, label) {
  assertNonnegativeInteger(receipt.targetCount, `${label} targetCount`);
  if (
    ("credentialCanaryMatches" in receipt &&
      receipt.credentialCanaryMatches !== 0) ||
    receipt.privatePayloadMatches !== 0
  ) {
    throw new Error(`Fast-core ${label} scan matched private material`);
  }
}

function verifyFinalCheck(value) {
  assertExactKeys(
    value,
    [
      "kind",
      "schemaVersion",
      "command",
      "exactHead",
      "taskTree",
      "preCheckTaskTreeManifestSha256",
      "postCheckTaskTreeManifestSha256",
      "exitCode",
      "suiteCounts",
      "stdoutBytes",
      "stdoutSha256",
      "stderrBytes",
      "stderrSha256",
      "receiptSha256",
    ],
    "final check",
  );
  assertValues(
    value,
    {
      kind: "napier.skill-load-fast-core-final-check",
      schemaVersion: 1,
      command: "npm run check",
      exactHead: FAST_CORE_FINAL_CHECK_HEAD,
      exitCode: 0,
    },
    "final check",
  );
  assertGitCommit(value.exactHead, "final check exactHead");
  assertExactKeys(
    value.taskTree,
    ["algorithm", "entryCount", "exclusions", "entries", "manifestSha256"],
    "final check task tree",
  );
  if (value.taskTree.algorithm !== "sha256_canonical_json_v1") {
    throw new Error("Fast-core final check task tree algorithm is invalid");
  }
  if (
    !Array.isArray(value.taskTree.exclusions) ||
    !Array.isArray(value.taskTree.entries)
  ) {
    throw new Error("Fast-core final check task tree lists are invalid");
  }
  if (
    canonicalJson(value.taskTree.exclusions) !==
    canonicalJson(FAST_CORE_FINAL_CHECK_EXCLUSIONS)
  ) {
    throw new Error("Fast-core final check exclusions are invalid");
  }
  for (const exclusion of value.taskTree.exclusions) {
    assertExactKeys(exclusion, ["path", "reason"], "final check exclusion");
  }
  for (const entry of value.taskTree.entries) {
    if (entry?.state === "file") {
      assertExactKeys(
        entry,
        ["path", "state", "sizeBytes", "contentSha256"],
        "final check file",
      );
      assertNonnegativeInteger(entry.sizeBytes, "final check file sizeBytes");
      assertSha256(entry.contentSha256, "final check file contentSha256");
    } else if (entry?.state === "deleted") {
      assertExactKeys(entry, ["path", "state"], "final check deleted file");
    } else {
      throw new Error("Fast-core final check task tree entry state is invalid");
    }
  }
  if (value.taskTree.entryCount !== value.taskTree.entries.length) {
    throw new Error("Fast-core final check task tree count is invalid");
  }
  const manifestPayload = {
    algorithm: value.taskTree.algorithm,
    exclusions: value.taskTree.exclusions,
    entries: value.taskTree.entries,
  };
  if (
    value.taskTree.manifestSha256 !== sha256(canonicalJson(manifestPayload))
  ) {
    throw new Error("Fast-core final check task tree manifest is invalid");
  }
  if (
    value.preCheckTaskTreeManifestSha256 !== value.taskTree.manifestSha256 ||
    value.postCheckTaskTreeManifestSha256 !== value.taskTree.manifestSha256
  ) {
    throw new Error("Fast-core final check pre/post task tree changed");
  }
  assertExactKeys(
    value.suiteCounts,
    [
      "rootTests",
      "cliTestsPassed",
      "cliTestsSkipped",
      "serverTests",
      "webTests",
      "contractsTests",
      "runtimeTestsPassed",
      "runtimeTestsSkipped",
      "sdkTests",
    ],
    "final check suite counts",
  );
  for (const [key, count] of Object.entries(value.suiteCounts)) {
    assertNonnegativeInteger(count, `final check suiteCounts.${key}`);
  }
  for (const key of ["stdoutBytes", "stderrBytes"]) {
    assertNonnegativeInteger(value[key], `final check ${key}`);
  }
  for (const key of ["stdoutSha256", "stderrSha256"]) {
    assertSha256(value[key], `final check ${key}`);
  }
  verifyReceiptHash(value, "final check");
}

export function verifyFastCoreFinalCheckReceipt(value) {
  verifyFinalCheck(value);
  return value;
}

function verifyRetainedPublicContentBindings(readme, realProvider, manifest) {
  const expected = new Map([
    ["docs/artifacts/skill-load-fast-core-stage7/README.md", sha256(readme)],
    [
      "docs/artifacts/skill-load-fast-core-stage7/real-provider-cli.json",
      sha256(`${JSON.stringify(realProvider, null, 2)}\n`),
    ],
  ]);
  for (const [targetPath, contentSha256] of expected) {
    const entry = manifest.find((candidate) => candidate.path === targetPath);
    if (
      !entry ||
      entry.state !== "file" ||
      entry.contentSha256 !== contentSha256
    ) {
      throw new Error(
        `Fast-core public manifest content binding is invalid: ${targetPath}`,
      );
    }
  }
  const expectedExclusions = new Map(
    FAST_CORE_FINAL_CHECK_EXCLUSIONS.map(({ path: targetPath, reason }) => [
      targetPath,
      reason,
    ]),
  );
  for (const [targetPath, reason] of expectedExclusions) {
    const entry = manifest.find((candidate) => candidate.path === targetPath);
    if (
      !entry ||
      entry.state !== "content_excluded" ||
      entry.exclusionReason !== reason
    ) {
      throw new Error(
        `Fast-core public manifest exclusion is invalid: ${targetPath}`,
      );
    }
  }
}

function verifyRetainedFinalTaskTreeBindings(readme, realProvider, entries) {
  const expected = new Map([
    ["docs/artifacts/skill-load-fast-core-stage7/README.md", sha256(readme)],
    [
      "docs/artifacts/skill-load-fast-core-stage7/real-provider-cli.json",
      sha256(`${JSON.stringify(realProvider, null, 2)}\n`),
    ],
  ]);
  for (const [targetPath, contentSha256] of expected) {
    const entry = entries.find((candidate) => candidate.path === targetPath);
    if (
      !entry ||
      entry.state !== "file" ||
      entry.contentSha256 !== contentSha256
    ) {
      throw new Error(
        `Fast-core final task tree content binding is invalid: ${targetPath}`,
      );
    }
  }
}

function verifyReceiptHash(receipt, label) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error(`Fast-core ${label} receipt is missing`);
  }
  const payload = { ...receipt };
  const receiptSha256 = payload.receiptSha256;
  delete payload.receiptSha256;
  if (receiptSha256 !== sha256(canonicalJson(payload))) {
    throw new Error(`Fast-core ${label} receipt hash is invalid`);
  }
}

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Fast-core ${label} record is missing`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`Fast-core ${label} keys are not exact`);
  }
}

function assertValues(value, expected, label) {
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) {
      throw new Error(`Fast-core ${label} ${key} is invalid`);
    }
  }
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Fast-core ${label} is not a SHA-256 digest`);
  }
}

function assertGitCommit(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value)) {
    throw new Error(`Fast-core ${label} is not a Git commit id`);
  }
}

function assertNonnegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Fast-core ${label} is not a nonnegative integer`);
  }
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}
