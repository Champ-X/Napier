import { spawn } from "node:child_process";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  canonicalJson,
  createReceipt,
  createUnverifiableRealProviderChronologyNotes,
  createVerifiedRealProviderAttemptLedger,
  FAST_CORE_BASELINE_HEAD,
  FAST_CORE_FINAL_CHECK_EXCLUSIONS,
  FAST_CORE_PLAN_SHA256,
  FAST_CORE_STAGE7_CHRONOLOGY_SHA256,
  sha256,
  verifyFastCoreEvidenceBundle,
} from "./skill-load-fast-core-evidence-lib.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT_ROOT = path.join(
  REPO_ROOT,
  "docs/artifacts/skill-load-fast-core-stage7",
);
const PROTECTED_PATHS = new Set([
  ".env",
  "goal.md",
  "docs/napier-interview-deep-dive.zh-CN.md",
]);
const mode = process.argv[2];
if (process.argv.length !== 3 || !["--prepare", "--finalize"].includes(mode)) {
  throw new Error(
    "Usage: refresh-skill-load-fast-core-evidence.mjs --prepare|--finalize",
  );
}

const realProvider = JSON.parse(
  await readFile(path.join(OUTPUT_ROOT, "real-provider-cli.json"), "utf8"),
);
delete realProvider.attemptLedger;
delete realProvider.verifiedAttemptLedger;
delete realProvider.unverifiableChronologyNotes;
realProvider.verifiedAttemptLedger =
  createVerifiedRealProviderAttemptLedger(realProvider);
realProvider.unverifiableChronologyNotes =
  createUnverifiableRealProviderChronologyNotes();

const readme = [
  "# Skill load fast-core Stage 7 evidence",
  "",
  "Sanitized evidence for the direct built CLI DeepSeek Research lane through the persistent default Profile, without a run-scoped preset.",
  "Raw JSONL, model/source bodies, credentials, private capsules, and task roots are not retained.",
  "",
  "`real-provider-cli.json` cryptographically verifies only the retained successful F07 attempt. Attempts 1 and 2 remain honest, non-cryptographic chronology notes because no independent sanitized receipts were retained. `security-cleanup.json` retains a self-hashed F00 orchestration chronology (not an independent pre-mutation tree proof) plus a path-and-content-bound public manifest; the original canaries were not retained, so the refreshed manifest does not claim a new secret rescan. `final-check.json` binds exact HEAD, the non-self-referential task-tree manifest, command result, suite counts, and output hashes. `evidence.json` becomes passed only after that final receipt exists and verifies.",
  "",
].join("\n");

const publicTargetManifest = await publicManifest(
  new Map([
    [
      "docs/artifacts/skill-load-fast-core-stage7/README.md",
      Buffer.from(readme),
    ],
    [
      "docs/artifacts/skill-load-fast-core-stage7/real-provider-cli.json",
      Buffer.from(`${JSON.stringify(realProvider, null, 2)}\n`),
    ],
  ]),
);
const stagedTargetManifest = await stagedManifest();
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
    scope: "original_stage7_sanitized_artifacts_before_f09",
    targetCount: 4,
    credentialCanaryMatches: 0,
    privatePayloadMatches: 0,
  }),
  publicWorkingTreeScan: createReceipt({
    scope: "current_task_owned_public_working_tree_content_manifest",
    targetCount: publicTargetManifest.length,
    targetManifest: publicTargetManifest,
    targetManifestSha256: sha256(canonicalJson(publicTargetManifest)),
    credentialCanaryVerification: "unavailable_credential_not_retained",
    privatePayloadVerification: "unavailable_private_payload_not_retained",
  }),
  stagedIndexScan: createReceipt({
    scope: "current_git_index_content_manifest",
    targetCount: stagedTargetManifest.length,
    targetManifest: stagedTargetManifest,
    targetManifestSha256: sha256(canonicalJson(stagedTargetManifest)),
    credentialCanaryVerification: "unavailable_credential_not_retained",
    privatePayloadVerification: "unavailable_private_payload_not_retained",
  }),
};

let finalCheck;
if (mode === "--finalize") {
  finalCheck = JSON.parse(
    await readFile(path.join(OUTPUT_ROOT, "final-check.json"), "utf8"),
  );
}
const pendingDigest = "0".repeat(64);
const evidence = {
  kind: "napier.skill-load-fast-core-stage7-evidence",
  schemaVersion: 1,
  result: finalCheck ? "passed" : "pending_final_check",
  readmeSha256: sha256(readme),
  realProviderSha256: sha256(canonicalJson(realProvider)),
  verifiedAttemptLedgerSha256: sha256(
    canonicalJson(realProvider.verifiedAttemptLedger),
  ),
  unverifiableChronologyNotesSha256: sha256(
    canonicalJson(realProvider.unverifiableChronologyNotes),
  ),
  securityCleanupSha256: sha256(canonicalJson(securityCleanup)),
  finalCheckSha256: finalCheck
    ? sha256(canonicalJson(finalCheck))
    : pendingDigest,
  finalCheckReceiptSha256: finalCheck?.receiptSha256 ?? pendingDigest,
  retainedCanaryScanReceiptSha256:
    securityCleanup.retainedCanaryScan.receiptSha256,
  publicWorkingTreeScanReceiptSha256:
    securityCleanup.publicWorkingTreeScan.receiptSha256,
  stagedIndexScanReceiptSha256: securityCleanup.stagedIndexScan.receiptSha256,
};

if (finalCheck) {
  verifyFastCoreEvidenceBundle({
    readme: Buffer.from(readme),
    evidence,
    realProvider,
    securityCleanup,
    finalCheck,
  });
}
await Promise.all([
  writeFile(path.join(OUTPUT_ROOT, "README.md"), readme),
  writeJson(path.join(OUTPUT_ROOT, "real-provider-cli.json"), realProvider),
  writeJson(path.join(OUTPUT_ROOT, "security-cleanup.json"), securityCleanup),
  writeJson(path.join(OUTPUT_ROOT, "evidence.json"), evidence),
]);
process.stdout.write(
  `${canonicalJson({ result: evidence.result, publicManifestCount: publicTargetManifest.length, stagedManifestCount: stagedTargetManifest.length })}\n`,
);

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

async function publicManifest(contentOverrides) {
  const [changed, untracked] = await Promise.all([
    gitPaths(["diff", "--name-only", "-z", "HEAD", "--"]),
    gitPaths(["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const targets = [
    ...new Set([
      ...changed,
      ...untracked,
      ...FAST_CORE_FINAL_CHECK_EXCLUSIONS.map((entry) => entry.path),
    ]),
  ]
    .filter((targetPath) => !PROTECTED_PATHS.has(targetPath))
    .sort();
  const exclusions = new Map(
    FAST_CORE_FINAL_CHECK_EXCLUSIONS.map(({ path: targetPath, reason }) => [
      targetPath,
      reason,
    ]),
  );
  const entries = [];
  for (const targetPath of targets) {
    const exclusionReason = exclusions.get(targetPath);
    if (exclusionReason) {
      entries.push({
        path: targetPath,
        state: "content_excluded",
        exclusionReason,
      });
      continue;
    }
    const override = contentOverrides.get(targetPath);
    if (override) {
      entries.push({
        path: targetPath,
        state: "file",
        contentSha256: sha256(override),
      });
      continue;
    }
    const absolutePath = path.join(REPO_ROOT, targetPath);
    const info = await lstat(absolutePath).catch((error) => {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    });
    if (!info) {
      entries.push({ path: targetPath, state: "deleted" });
      continue;
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(
        `Public manifest path is not a regular file: ${targetPath}`,
      );
    }
    entries.push({
      path: targetPath,
      state: "file",
      contentSha256: sha256(await readFile(absolutePath)),
    });
  }
  return entries;
}

async function stagedManifest() {
  const targets = await gitPaths([
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--",
  ]);
  const entries = [];
  for (const targetPath of targets.sort()) {
    const child = await runGit(["show", `:${targetPath}`]);
    entries.push({
      path: targetPath,
      state: "file",
      contentSha256: sha256(child.stdout),
    });
  }
  return entries;
}

async function gitPaths(args) {
  const child = await runGit(args);
  return child.stdout.toString("utf8").split("\0").filter(Boolean);
}

function runGit(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: REPO_ROOT,
      env: Object.fromEntries(
        ["PATH", "LANG", "LC_ALL"].flatMap((key) =>
          process.env[key] ? [[key, process.env[key]]] : [],
        ),
      ),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Git manifest command failed: ${Buffer.concat(stderr).toString("utf8")}`,
          ),
        );
        return;
      }
      resolve({ stdout: Buffer.concat(stdout) });
    });
  });
}

function writeJson(target, value) {
  return writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}
