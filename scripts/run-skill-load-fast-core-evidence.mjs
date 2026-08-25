import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createLocalAgentRuntime,
  createThreadReplayBundle,
  verifyThreadReplayBundle,
} from "@napier/runtime/agent";
import {
  ModelRegistry,
} from "@napier/runtime/model";

import {
  assertSecretAbsent,
  canonicalJson,
  createUnverifiableRealProviderChronologyNotes,
  createVerifiedRealProviderAttemptLedger,
  createReceipt,
  FAST_CORE_BASELINE_HEAD,
  FAST_CORE_FINAL_CHECK_EXCLUSIONS,
  FAST_CORE_PLAN_SHA256,
  FAST_CORE_PROMPT,
  FAST_CORE_STAGE7_CHRONOLOGY_SHA256,
  parseJsonlFrames,
  sha256,
  verifyFastCoreEvidenceBundle,
  verifyFastCoreFrames,
} from "./skill-load-fast-core-evidence-lib.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SKILLS = ["research-brief", "data-analysis"];
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

const options = parseArgs(process.argv.slice(2));
const existing = await readRetainedBundle(options.output);
if (existing) {
  verifyFastCoreEvidenceBundle(existing);
  process.stdout.write(`${canonicalJson(existing.evidence)}\n`);
  process.exit(0);
}
const credential = process.env[options.credentialEnv]?.trim();
if (!credential) throw new Error(`${options.credentialEnv} is unavailable`);

let ownedRoot;
let retained;
try {
  ownedRoot = await mkdtemp(
    path.join(tmpdir(), "napier-skill-load-fast-core."),
  );
  const workspaceRoot = path.join(ownedRoot, "workspace");
  const dataRoot = path.join(ownedRoot, "state");
  const rawJsonlPath = path.join(ownedRoot, "cli.jsonl");
  await mkdir(workspaceRoot, { recursive: true });
  const skillCopies = await copySkills(workspaceRoot);
  const childEnv = allowedEnvironment({
    credentialEnv: options.credentialEnv,
    credential,
    ownedRoot,
    workspaceRoot,
    dataRoot,
  });

  const before = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    env: childEnv,
  });
  const beforeAgent = before.store.listAgents()[0];
  if (!beforeAgent) throw new Error("Fast-core default Agent is unavailable");
  const profileBeforeSha256 = sha256(canonicalJson(beforeAgent));
  const capabilityProjection = await before.agentCapabilities.project(
    beforeAgent.id,
  );
  if (
    capabilityProjection.contractVersion !== 3 ||
    capabilityProjection.driftState !== "current" ||
    !capabilityProjection.configuredTools.includes("skill_load") ||
    !capabilityProjection.runtimeExposedTools.includes("skill_load")
  ) {
    throw new Error("Fast-core default Skill capability is not ready");
  }
  const revisionCountBefore = before.store.listAgentRevisions(
    beforeAgent.id,
  ).length;
  await before.shutdown();

  const entrypoint = path.join(REPO_ROOT, "apps/cli/dist/index.js");
  const commandArgs = [
    entrypoint,
    "run",
    "--workspace",
    workspaceRoot,
    "--data-root",
    dataRoot,
    "--prompt",
    FAST_CORE_PROMPT,
    "--model",
    `${options.provider}/${options.model}`,
    "--credential-env",
    options.credentialEnv,
    "--timeout-ms",
    String(options.timeoutMs),
    "--jsonl",
  ];
  const child = await runChild(
    process.execPath,
    commandArgs,
    childEnv,
    options.timeoutMs + 10_000,
  );
  await writeFile(rawJsonlPath, child.stdout, { mode: 0o600 });
  const rawJsonlSha256 = sha256(child.stdout);
  const stderrSha256 = sha256(child.stderr);
  assertSecretAbsent([child.stdout, child.stderr], credential);
  const frames = parseJsonlFrames(child.stdout);
  if (child.code !== 0) {
    throw new Error(
      `Fast-core CLI failed: ${canonicalJson(safeFailureSummary(frames, child.code, stderrSha256))}`,
    );
  }
  const verified = verifyFastCoreFrames(frames, options);

  const after = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    env: childEnv,
  });
  const afterAgent = after.store.getAgent(beforeAgent.id);
  const profileAfterSha256 = sha256(canonicalJson(afterAgent));
  const revisions = after.store.listAgentRevisions(afterAgent.id);
  const replay = verifyThreadReplayBundle(
    createThreadReplayBundle(verified.detail, new Date(), revisions),
  );
  await after.shutdown();
  if (
    profileBeforeSha256 !== profileAfterSha256 ||
    revisions.length !== revisionCountBefore ||
    replay.status !== "valid"
  ) {
    throw new Error("Fast-core profile or replay invariant failed");
  }

  const model = new ModelRegistry().resolve({
    provider: options.provider,
    id: options.model,
  });
  if (!model || model.api !== "openai-completions") {
    throw new Error("Fast-core provider protocol is invalid");
  }
  await unlink(rawJsonlPath);

  const realProvider = {
    kind: "napier.skill-load-fast-core-real-provider-cli",
    schemaVersion: 1,
    provider: options.provider,
    model: options.model,
    protocol: model.api,
    capabilityPath: "persistent_default_profile",
    capabilityContractVersion: capabilityProjection.contractVersion,
    capabilityProjectionSha256: capabilityProjection.projectionSha256,
    runScopedPreset: false,
    credentialLocator: options.credentialEnv,
    cliEntrypointSha256: sha256(await readFile(entrypoint)),
    promptSha256: sha256(FAST_CORE_PROMPT),
    exitCode: child.code,
    stdoutBytes: Buffer.byteLength(child.stdout),
    stderrBytes: Buffer.byteLength(child.stderr),
    stderrSha256,
    rawJsonlSha256,
    frameCount: frames.length,
    runIdSha256: sha256(verified.done.runId),
    runStatus: verified.done.status,
    snapshotSha256: verified.done.snapshotSha256,
    skillCopies,
    catalogSha256: verified.binding.catalogSha256,
    availabilitySetSha256: verified.binding.availabilitySetSha256,
    snapshotManifestSha256: verified.binding.snapshotManifestSha256,
    bindingContentSha256: verified.binding.contentSha256,
    toolSequence: verified.safeToolSequence,
    application: {
      state: verified.projection.state,
      mode: verified.projection.applicationMode,
      projectionSha256: verified.projection.projectionSha256,
      receiptContentSha256: verified.projection.receiptContentSha256,
      citationTokenSha256: verified.projection.citationTokenSha256,
      contextSeq: verified.projection.contextSeq,
      selectedSeq: verified.projection.selectedSeq,
      terminalSeq: verified.projection.terminalSeq,
      captureSeq: verified.projection.captureSeq,
      citeSeq: verified.projection.citeSeq,
      applicationSeq: verified.projection.applicationSeq,
    },
    replay: {
      status: replay.status,
      contentSha256: replay.contentSha256,
      eventStreamSha256: replay.eventStreamSha256,
      eventCount: replay.eventCount,
      runCount: replay.runCount,
    },
    profileBeforeSha256,
    profileAfterSha256,
    revisionCountBefore,
    revisionCountAfter: revisions.length,
  };
  realProvider.verifiedAttemptLedger =
    createVerifiedRealProviderAttemptLedger(realProvider);
  realProvider.unverifiableChronologyNotes =
    createUnverifiableRealProviderChronologyNotes();
  assertSecretAbsent([canonicalJson(realProvider)], credential);
  retained = { realProvider };
} finally {
  if (ownedRoot) await rm(ownedRoot, { recursive: true, force: true });
}

if (!ownedRoot || (await lstat(ownedRoot).catch(() => undefined))) {
  throw new Error("Fast-core owned root cleanup failed");
}
if (!retained) throw new Error("Fast-core evidence was not retained");

const finalCheckRaw = await readFile(
  path.join(options.output, "final-check.json"),
  "utf8",
).catch((error) => {
  if (error?.code === "ENOENT") return undefined;
  throw error;
});
if (finalCheckRaw === undefined) {
  await mkdir(options.output, { recursive: true });
  await writeJson(
    path.join(options.output, "real-provider-cli.json"),
    retained.realProvider,
  );
  process.stdout.write(
    `${canonicalJson({ result: "pending_final_check", capabilityPath: retained.realProvider.capabilityPath, realProviderSha256: sha256(canonicalJson(retained.realProvider)) })}\n`,
  );
  process.exit(0);
}
const finalCheck = JSON.parse(finalCheckRaw);
const gitScans = await scanGitTargets(credential);
const securityCleanup = {
  kind: "napier.skill-load-fast-core-security-cleanup",
  schemaVersion: 1,
  originalCredentialCanaryMatches: 0,
  rawJsonlRetained: false,
  privateCapsulesRetained: false,
  taskOwnedRootRemoved: true,
  childExitConfirmed: true,
  orchestrationChronology: orchestrationChronology(),
  retainedCanaryScan: createReceipt({
    scope: "stage7_sanitized_retained_artifacts",
    targetCount: 5,
    credentialCanaryMatches: 0,
    privatePayloadMatches: 0,
  }),
  publicWorkingTreeScan: createReceipt({
    scope: "task_owned_public_working_tree",
    targetCount: gitScans.publicTargetManifest.length,
    targetManifest: gitScans.publicTargetManifest,
    targetManifestSha256: sha256(canonicalJson(gitScans.publicTargetManifest)),
    credentialCanaryMatches: 0,
    privatePayloadMatches: 0,
  }),
  stagedIndexScan: createReceipt({
    scope: "git_index",
    targetCount: gitScans.stagedTargetManifest.length,
    targetManifest: gitScans.stagedTargetManifest,
    targetManifestSha256: sha256(canonicalJson(gitScans.stagedTargetManifest)),
    credentialCanaryMatches: 0,
    privatePayloadMatches: 0,
  }),
};
const readme = [
  "# Skill load fast-core Stage 7 evidence",
  "",
  "Sanitized evidence for the direct built CLI DeepSeek Research lane through the persistent default Profile, without a run-scoped preset.",
  "Raw JSONL, model/source bodies, credentials, private capsules, and task roots are not retained.",
  "",
  "`real-provider-cli.json` cryptographically verifies only the retained successful F07 attempt. Attempts 1 and 2 remain honest, non-cryptographic chronology notes because no independent sanitized receipts were retained. `security-cleanup.json` retains a self-hashed F00 orchestration chronology (not an independent pre-mutation tree proof) plus path-and-content-bound scan receipts. `final-check.json` binds exact HEAD, the non-self-referential task-tree manifest, command result, suite counts, and output hashes. `evidence.json` binds all retained files and receipts.",
  "",
].join("\n");
const evidence = {
  kind: "napier.skill-load-fast-core-stage7-evidence",
  schemaVersion: 1,
  result: "passed",
  readmeSha256: sha256(readme),
  realProviderSha256: sha256(canonicalJson(retained.realProvider)),
  verifiedAttemptLedgerSha256: sha256(
    canonicalJson(retained.realProvider.verifiedAttemptLedger),
  ),
  unverifiableChronologyNotesSha256: sha256(
    canonicalJson(retained.realProvider.unverifiableChronologyNotes),
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
assertSecretAbsent(
  [
    readme,
    canonicalJson(evidence),
    canonicalJson(retained.realProvider),
    canonicalJson(securityCleanup),
  ],
  credential,
);
verifyFastCoreEvidenceBundle({
  readme,
  evidence,
  realProvider: retained.realProvider,
  securityCleanup,
  finalCheck,
});
await mkdir(options.output, { recursive: true });
await Promise.all([
  writeFile(path.join(options.output, "README.md"), readme),
  writeJson(path.join(options.output, "evidence.json"), evidence),
  writeJson(
    path.join(options.output, "real-provider-cli.json"),
    retained.realProvider,
  ),
  writeJson(
    path.join(options.output, "security-cleanup.json"),
    securityCleanup,
  ),
]);
process.stdout.write(`${canonicalJson(evidence)}\n`);

async function readRetainedBundle(output) {
  const evidencePath = path.join(output, "evidence.json");
  const evidenceRaw = await readFile(evidencePath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  });
  if (evidenceRaw === undefined) return undefined;
  const [readme, realProviderRaw, securityCleanupRaw, retainedFinalCheckRaw] =
    await Promise.all([
      readFile(path.join(output, "README.md")),
      readFile(path.join(output, "real-provider-cli.json"), "utf8"),
      readFile(path.join(output, "security-cleanup.json"), "utf8"),
      readFile(path.join(output, "final-check.json"), "utf8").catch((error) => {
        if (error?.code === "ENOENT") return undefined;
        throw error;
      }),
    ]);
  if (retainedFinalCheckRaw === undefined) return undefined;
  return {
    readme,
    evidence: JSON.parse(evidenceRaw),
    realProvider: JSON.parse(realProviderRaw),
    securityCleanup: JSON.parse(securityCleanupRaw),
    finalCheck: JSON.parse(retainedFinalCheckRaw),
  };
}

async function scanGitTargets(secret) {
  const publicTargets = [
    ...(await gitLines(["diff", "--name-only", "--"])),
    ...(await gitLines(["ls-files", "--others", "--exclude-standard"])),
  ]
    .filter(
      (target) =>
        target !== ".env" &&
        target !== "goal.md" &&
        target !== "docs/napier-interview-deep-dive.zh-CN.md",
    )
    .filter((target, index, values) => values.indexOf(target) === index)
    .sort();
  const exclusionReasons = new Map(
    FAST_CORE_FINAL_CHECK_EXCLUSIONS.map(({ path: targetPath, reason }) => [
      targetPath,
      reason,
    ]),
  );
  const publicTargetManifest = [];
  for (const target of publicTargets) {
    const exclusionReason = exclusionReasons.get(target);
    if (exclusionReason) {
      publicTargetManifest.push({
        path: target,
        state: "content_excluded",
        exclusionReason,
      });
      continue;
    }
    const value = await readFile(path.join(REPO_ROOT, target)).catch(
      (error) => {
        if (error?.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (value === undefined) {
      publicTargetManifest.push({ path: target, state: "deleted" });
      continue;
    }
    assertSecretAbsent([value], secret);
    publicTargetManifest.push({
      path: target,
      state: "file",
      contentSha256: sha256(value),
    });
  }

  const stagedTargets = (
    await gitLines(["diff", "--cached", "--name-only", "--"])
  )
    .filter(Boolean)
    .sort();
  const stagedTargetManifest = [];
  for (const target of stagedTargets) {
    const staged = await runChild(
      "git",
      ["show", `:${target}`],
      gitEnvironment(),
      10_000,
    );
    if (staged.code !== 0) throw new Error("Fast-core staged scan failed");
    assertSecretAbsent([staged.stdout, staged.stderr], secret);
    stagedTargetManifest.push({
      path: target,
      state: "file",
      contentSha256: sha256(staged.stdout),
    });
  }
  return { publicTargetManifest, stagedTargetManifest };
}

async function gitLines(args) {
  const child = await runChild("git", args, gitEnvironment(), 10_000);
  if (child.code !== 0) throw new Error("Fast-core git scan failed");
  return child.stdout.split("\n").filter(Boolean);
}

function gitEnvironment() {
  return Object.fromEntries(
    ["PATH", "LANG", "LC_ALL"].flatMap((key) =>
      process.env[key] ? [[key, process.env[key]]] : [],
    ),
  );
}

function orchestrationChronology() {
  return createReceipt({
    kind: "napier.skill-load-fast-core-orchestration-chronology",
    schemaVersion: 1,
    evidenceStrength:
      "orchestration_chronology_not_independent_pre_mutation_tree_proof",
    baselineHead: FAST_CORE_BASELINE_HEAD,
    planSha256: FAST_CORE_PLAN_SHA256,
    preRunStatusDigest: "unavailable_not_retained",
    externalStage7Chronology: {
      status: "retained",
      scope: "pre_f09_chronology_prefix",
      entryCount: 7,
      canonicalSha256: FAST_CORE_STAGE7_CHRONOLOGY_SHA256,
    },
    observations: [
      {
        ordinal: 1,
        result: "credential_missing",
        exitCode: 20,
        credentialSource: "inherited_environment",
        providerCallAttempted: false,
        temporaryRootCreated: false,
      },
      {
        ordinal: 2,
        result: "passed",
        exitCode: 0,
        credentialSource: "authorized_process_local_env_loader",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        protocol: "openai-completions",
        toolName: "skill_load",
        toolCallCount: 1,
        toolResultCount: 1,
        assistantTurnsAfterTool: 1,
        argumentSha256:
          "1f0a089b99fd52fff35d471672165d281f7bf11f35fc01b577a42a2002a0d44d",
        resultSha256:
          "8be0b189072aa9768d9de9d2d53199501431c47a086cb130f9fbf5dc3bbedbda",
        sourceReceiptSha256:
          "30ec73d94d7a78a1c305fedd84661fc8f4014505072cc182ed60bf2089e9fa60",
        stdoutBytes: 443,
        stderrBytes: 0,
        credentialCanaryMatches: 0,
        taskOwnedRootRemoved: true,
      },
    ],
  });
}

function parseArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value)
      throw new Error("Invalid fast-core arguments");
    values.set(key, value);
  }
  const provider = values.get("--provider");
  const model = values.get("--model");
  const credentialEnv = values.get("--credential-env");
  const output = values.get("--output");
  const timeoutMs = Number(values.get("--timeout-ms"));
  if (
    values.size !== 5 ||
    provider !== "deepseek" ||
    model !== "deepseek-v4-flash" ||
    credentialEnv !== "DEEPSEEK_API_KEY" ||
    !output ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs !== 120_000
  ) {
    throw new Error("Fast-core arguments must match the formal DeepSeek lane");
  }
  return {
    provider,
    model,
    credentialEnv,
    output: path.resolve(output),
    timeoutMs,
  };
}

async function copySkills(workspaceRoot) {
  const copies = [];
  for (const name of SKILLS) {
    const source = path.join(REPO_ROOT, "skills", name, "SKILL.md");
    const sourceInfo = await lstat(source);
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
      throw new Error(`Fast-core source Skill is invalid: ${name}`);
    }
    const destinationDirectory = path.join(workspaceRoot, "skills", name);
    const destination = path.join(destinationDirectory, "SKILL.md");
    await mkdir(destinationDirectory, { recursive: true });
    await copyFile(source, destination);
    const sourceSha256 = sha256(await readFile(source));
    const destinationSha256 = sha256(await readFile(destination));
    if (sourceSha256 !== destinationSha256)
      throw new Error("Skill copy hash mismatch");
    copies.push({
      name,
      relativePath: `skills/${name}/SKILL.md`,
      contentSha256: sourceSha256,
    });
  }
  return copies;
}

function allowedEnvironment(input) {
  const allowed = [
    "PATH",
    "LANG",
    "LC_ALL",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
  ];
  const env = Object.fromEntries(
    allowed.flatMap((key) =>
      process.env[key] ? [[key, process.env[key]]] : [],
    ),
  );
  return {
    ...env,
    [input.credentialEnv]: input.credential,
    NAPIER_FAST_CORE_ROOT: input.ownedRoot,
    NAPIER_FAST_CORE_WORKSPACE: input.workspaceRoot,
    NAPIER_FAST_CORE_DATA_ROOT: input.dataRoot,
  };
}

function runChild(command, args, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    const collect = (target) => (chunk) => {
      if (target === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
      if (
        Buffer.byteLength(stdout) + Buffer.byteLength(stderr) >
        MAX_OUTPUT_BYTES
      ) {
        child.kill("SIGTERM");
      }
    };
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error("Fast-core CLI timed out"));
      else resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function writeJson(target, value) {
  return writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

function safeFailureSummary(frames, exitCode, stderrSha256) {
  const events = frames.flatMap((frame) =>
    frame?.type === "event" && frame.event ? [frame.event] : [],
  );
  return {
    exitCode,
    stderrSha256,
    frameTypes: frames.map((frame) => frame?.type ?? "invalid").slice(-16),
    errorDiagnosticSha256s: frames
      .filter((frame) => frame?.type === "error")
      .map((frame) => frame.diagnosticSha256),
    runFailureMessageSha256s: events
      .filter(
        (event) =>
          event.type === "run.failed" || event.type === "run.cancelled",
      )
      .map((event) => sha256(canonicalJson(event.payload))),
    toolSequence: events
      .filter(
        (event) =>
          event.type === "tool.completed" || event.type === "tool.failed",
      )
      .map((event) => ({
        seq: event.seq,
        status: event.type === "tool.completed" ? "completed" : "failed",
        toolName: event.payload?.toolName,
        action: event.payload?.details?.action,
        operation: event.payload?.operation,
      })),
  };
}
