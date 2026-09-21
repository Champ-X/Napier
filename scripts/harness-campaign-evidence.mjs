import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { environmentEvidenceEligible } from "./harness-environment-evidence.mjs";
import { dependencyEvidenceEligible } from "./harness-runtime-dependencies.mjs";
import { copyObservedWorkspace } from "./harness-observed-workspace.mjs";
import { apiRequestBudgetEvidenceEligible } from "./harness-api-request-budget.mjs";
import { evaluateSampleIdentity } from "./harness-sample-identity.mjs";
import { graderEvidenceIdentity } from "./harness-grader-evidence.mjs";
import { spendingTariffIdentity } from "./harness-spending-budget.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const spendingPolicyIdentity = (report) => {
  const state = report.spendingBudget?.before;
  return state
    ? JSON.stringify({
        maxFen: state.maxFen,
        priorSpendFen: state.priorSpendFen,
        policy: state.policy,
      })
    : undefined;
};

/** Outcome checks and evidence qualification are independent. Faster runs can
 * never compensate for a newly failed task, false completion or scope breach. */
export function evaluateCampaignQuality(
  reports,
  { minimumCases = 30, minimumTrials = 3 } = {},
) {
  if (
    !Number.isInteger(minimumCases) ||
    minimumCases < 1 ||
    !Number.isInteger(minimumTrials) ||
    minimumTrials < 1
  )
    throw new Error("Invalid campaign sample requirements");
  const pairs = new Map();
  const { blockers, invalidPairs } = evaluateSampleIdentity(reports);
  const armIdentities = new Map();
  for (const report of reports) {
    const key = `${report.caseId}:${report.trial}`;
    if (!["baseline", "candidate"].includes(report.arm))
      throw new Error("Invalid campaign arm");
    const identity = JSON.stringify({
      artifacts: report.runtimeArtifactSha256,
      source: report.sourceIdentity,
      profile: report.profile,
      experimentalTurnPipeline: report.experimentalTurnPipeline,
      dependencies: report.runtimeDependencyEvidence?.beforeSha256,
      // Cadence may change between settled pairs to reduce idle time. Keep the
      // request cap stable across the campaign and exact admission policies
      // equal within each pair; no latency/cache attribution is made here.
      maxApiRequests: report.apiRequestBudget?.before?.maxRequests,
      // A user may raise the campaign's cumulative ceiling between settled
      // pairs. Pricing stays fixed; the exact allowance must still match
      // within each pair below, and exhausted observations remain ineligible.
      spendingPricingPolicy: spendingTariffIdentity(
        report.spendingBudget?.before?.policy,
      ),
    });
    if (
      armIdentities.has(report.arm) &&
      armIdentities.get(report.arm) !== identity
    )
      blockers.push(`${report.arm}: source or profile changed within campaign`);
    armIdentities.set(report.arm, identity);
    const pair = pairs.get(key) ?? {};
    if (pair[report.arm])
      throw new Error(`Duplicate campaign observation: ${key}/${report.arm}`);
    pair[report.arm] = report;
    pairs.set(key, pair);
  }
  const counts = new Map();
  const regressions = [];
  let comparablePairs = 0;
  for (const [key, { baseline, candidate }] of pairs) {
    if (!baseline || !candidate) {
      blockers.push(`${key}: missing arm`);
      continue;
    }
    if (![baseline, candidate].every(qualified)) {
      blockers.push(`${key}: unqualified source/model evidence`);
      continue;
    }
    // Retain adverse outcomes even when an environment mismatch prevents
    // attributing them to the policy. They cannot be hidden by exclusion.
    if (baseline.taskSuccess && !candidate.taskSuccess)
      regressions.push(`${key}: task completion regressed`);
    // A baseline Run may fail after producing correct code (for example during
    // final-answer publication). Keep its independent behavior outcome so that
    // a candidate code regression cannot disappear behind two failed Runs.
    if (
      baseline.graderExitCode === 0 &&
      Number.isInteger(candidate.graderExitCode) &&
      candidate.graderExitCode !== 0
    )
      regressions.push(`${key}: external behavior regressed`);
    if (
      Object.hasOwn(candidate, "graderExitCode") &&
      candidate.graderExitCode !== 0
    )
      blockers.push(`${key}: candidate external behavior did not pass`);
    if (!candidate.allowedChanges)
      regressions.push(`${key}: workspace scope breached`);
    if (
      candidate.status === "completed" &&
      !candidate.taskSuccess &&
      baseline.taskSuccess
    )
      regressions.push(`${key}: new false completion`);
    if (
      [baseline, candidate].some(
        (report) =>
          Object.hasOwn(report, "graderExitCode") &&
          (!Number.isInteger(report.graderExitCode) ||
            report.graderExitCode < 0),
      )
    ) {
      blockers.push(`${key}: incomplete external behavior observation`);
      continue;
    }
    const baselineGrader = graderEvidenceIdentity(baseline);
    const candidateGrader = graderEvidenceIdentity(candidate);
    if (
      !baselineGrader ||
      !candidateGrader ||
      baselineGrader !== candidateGrader
    ) {
      blockers.push(`${key}: missing, invalid or mismatched grader evidence`);
      continue;
    }
    if (![baseline, candidate].every(environmentEvidenceEligible)) {
      blockers.push(
        `${key}: missing, invalid or degraded environment evidence`,
      );
      continue;
    }
    if (![baseline, candidate].every(dependencyEvidenceEligible)) {
      blockers.push(
        `${key}: missing, invalid or changed runtime dependency evidence`,
      );
      continue;
    }
    if (
      ![baseline, candidate].every(apiRequestBudgetEvidenceEligible) ||
      baseline.apiRequestBudget?.before?.policySha256 !==
        candidate.apiRequestBudget?.before?.policySha256 ||
      spendingPolicyIdentity(baseline) !== spendingPolicyIdentity(candidate)
    ) {
      blockers.push(
        `${key}: missing, changed or exhausted API request budget evidence`,
      );
      continue;
    }
    if (
      [
        "fixtureSha256",
        "promptSha256",
        "outcomeSha256",
        "acceptanceSha256",
        "memorySeedSha256",
        "campaignScriptSha256",
        "campaignHelperSha256",
        "sandbox",
      ].some((field) => baseline[field] !== candidate[field]) ||
      JSON.stringify(baseline.requestedModel) !==
        JSON.stringify(candidate.requestedModel) ||
      JSON.stringify(baseline.runLimits) !== JSON.stringify(candidate.runLimits)
    ) {
      blockers.push(`${key}: input/model/provider mismatch`);
      continue;
    }
    if (invalidPairs.has(key)) continue;
    comparablePairs++;
    counts.set(baseline.caseId, (counts.get(baseline.caseId) ?? 0) + 1);
  }
  const evidenceBlockers = [...blockers];
  if (counts.size < minimumCases)
    blockers.push(`Need ${minimumCases} cases; observed ${counts.size}`);
  for (const [id, count] of counts)
    if (count < minimumTrials)
      blockers.push(
        `${id}: need ${minimumTrials} paired trials; observed ${count}`,
      );
  const content = {
    kind: "napier.harness-campaign-quality",
    schemaVersion: 1,
    required: { minimumCases, minimumTrials },
    comparablePairs,
    cases: counts.size,
    regressions,
    evidenceBlockers,
    blockers,
    verdict: regressions.length
      ? "regressed"
      : blockers.length
        ? "insufficient_evidence"
        : "passed_scoped_gate",
    promotionReady: regressions.length === 0 && blockers.length === 0,
  };
  return { ...content, contentSha256: hash(JSON.stringify(content)) };
}

function qualified(report) {
  return (
    report.componentProbe === undefined &&
    report.qualifyingEvidence === true &&
    report.runtimeArtifactStable === true &&
    report.sourceStable === true &&
    report.servingIdentityMatched === true &&
    /^[a-f0-9]{64}$/u.test(report.runtimeArtifactSha256) &&
    typeof report.taskSuccess === "boolean" &&
    typeof report.allowedChanges === "boolean"
  );
}

/** Build only from an explicitly supplied original fixture. A final workspace
 * is never substituted for missing initial state. Raw ledger/tool outputs and
 * credentials are deliberately absent; local evidence is bound by hash/id. */
export async function buildFailureCase({
  report,
  caseRoot,
  output,
  observedWorkspaceRoot,
}) {
  if (!qualified(report))
    throw new Error(
      "Failure reproduction requires qualified source/model evidence",
    );
  if (report.taskSuccess && report.toolFailures === 0)
    throw new Error("Run has no observed failure to reproduce");
  const manifest = JSON.parse(
    await readFile(path.join(caseRoot, "manifest.json"), "utf8"),
  );
  assertFailureAcceptance(report, manifest);
  const prompt = await safeRead(caseRoot, manifest.promptPath);
  const outcome = await safeRead(caseRoot, manifest.outcomeTestPath);
  const memorySeed = manifest.memorySeedPath
    ? await safeRead(caseRoot, manifest.memorySeedPath)
    : undefined;
  if (memorySeed && hash(memorySeed) !== report.memorySeedSha256)
    throw new Error("Original memory seed does not match the recorded run");
  if (!memorySeed && report.memorySeedSha256)
    throw new Error("Original memory seed is missing");
  const fixture = safePath(caseRoot, manifest.fixturePath);
  const files = await inventoryFailureFixture(fixture);
  if (
    manifest.id !== report.caseId ||
    hash(prompt) !== report.promptSha256 ||
    hash(outcome) !== report.outcomeSha256 ||
    hash(JSON.stringify(files)) !== report.fixtureSha256
  )
    throw new Error("Original failure inputs do not match the recorded run");
  const parent = path.dirname(path.resolve(output));
  await mkdir(parent, { recursive: true });
  try {
    await lstat(output);
    throw new Error("Failure case output already exists");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temp = `${path.resolve(output)}.partial-${randomUUID()}`;
  await mkdir(temp, { mode: 0o700 });
  try {
    await cp(fixture, path.join(temp, "fixture"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    // Validate the copied bytes as well, closing a changing-source export race.
    if (
      JSON.stringify(
        await inventoryFailureFixture(path.join(temp, "fixture")),
      ) !== JSON.stringify(files)
    )
      throw new Error("Failure fixture changed during export");
    await writeFile(path.join(temp, "prompt.md"), prompt, { flag: "wx" });
    await writeFile(path.join(temp, "outcome.mjs"), outcome, { flag: "wx" });
    if (memorySeed)
      await writeFile(path.join(temp, "memory.json"), memorySeed, {
        flag: "wx",
      });
    const observedWorkspace =
      observedWorkspaceRoot === undefined
        ? undefined
        : await copyObservedWorkspace({
            root: observedWorkspaceRoot,
            output: path.join(temp, "observed"),
            receipt: report.observedWorkspace,
            runId: report.runId,
          });
    const evidence = {
      kind: "napier.failure-reproduction",
      schemaVersion: 1,
      originalRunId: report.runId,
      originalCaseId: report.caseId,
      failure: report.taskSuccess ? "recovered_tool_failure" : "task_failure",
      toolFailures: report.toolFailures,
      servingModel: report.requestedModel,
      sandbox: report.sandbox,
      ...(report.environmentEvidence
        ? { environmentEvidence: report.environmentEvidence }
        : {}),
      ...(report.runtimeDependencyEvidence
        ? { runtimeDependencyEvidence: report.runtimeDependencyEvidence }
        : {}),
      ...(report.usageEvidence ? { usageEvidence: report.usageEvidence } : {}),
      ...(report.apiRequestBudget
        ? { apiRequestBudget: report.apiRequestBudget }
        : {}),
      profile: report.profile,
      ...(report.experimentalTurnPipeline
        ? {
            experimentalTurnPipeline: report.experimentalTurnPipeline,
            turnPipelineReplayScope:
              "Adapter identity is preserved; executable external adapters must be supplied separately for a matching fresh run.",
          }
        : {}),
      runtimeArtifactSha256: report.runtimeArtifactSha256,
      sourceIdentity: report.sourceIdentity,
      reportSha256: hash(JSON.stringify(report)),
      fixtureSha256: report.fixtureSha256,
      promptSha256: report.promptSha256,
      outcomeSha256: report.outcomeSha256,
      ...(report.acceptanceSha256
        ? { acceptanceSha256: report.acceptanceSha256 }
        : {}),
      ...(report.runLimits ? { runLimits: report.runLimits } : {}),
      ...(report.serviceObservationRequired !== undefined
        ? {
            serviceObservationRequired: report.serviceObservationRequired,
            serviceReplayScope:
              "The original external observer is not restored by this file bundle; a required observation must be supplied separately for fresh-run qualification.",
          }
        : {}),
      ...(memorySeed ? { memorySeedSha256: hash(memorySeed) } : {}),
      files,
      ...(observedWorkspace ? { observedWorkspace } : {}),
      replayMode: "fresh_real_model_run",
      failureRecurrenceGuaranteed: false,
    };
    await writeFile(
      path.join(temp, "reproduction.json"),
      JSON.stringify(evidence, null, 2),
      { flag: "wx" },
    );
    await writeFile(
      path.join(temp, "manifest.json"),
      JSON.stringify(
        {
          ...manifest,
          promptPath: "prompt.md",
          fixturePath: "fixture",
          outcomeTestPath: "outcome.mjs",
          ...(memorySeed ? { memorySeedPath: "memory.json" } : {}),
        },
        null,
        2,
      ),
      { flag: "wx" },
    );
    await rename(temp, path.resolve(output));
    return evidence;
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
}

function assertFailureAcceptance(report, manifest) {
  if (
    !report.acceptanceSha256 &&
    report.serviceObservationRequired === undefined
  )
    return; // Historical reports predate this binding.
  const fields = {
    allowedChangedPaths: manifest.allowedChangedPaths,
    requiredTools: manifest.requiredTools,
    requiredCompletedTools: manifest.requiredCompletedTools ?? [],
    processAcceptance: manifest.processAcceptance ?? null,
  };
  const maxTurns = manifest.maxTurns ?? 24;
  if (report.serviceObservationRequired !== undefined) {
    const serviceBound = hash(
      JSON.stringify({
        maxTurns,
        ...fields,
        debuggerAcceptance: manifest.debuggerAcceptance ?? null,
        serviceObservationRequired: report.serviceObservationRequired,
      }),
    );
    if (
      typeof report.serviceObservationRequired !== "boolean" ||
      serviceBound !== report.acceptanceSha256 ||
      (report.runLimits && report.runLimits.maxTurns !== maxTurns)
    )
      throw new Error(
        "Original failure acceptance/budget does not match the recorded run",
      );
    return;
  }
  const current = hash(JSON.stringify({ maxTurns, ...fields }));
  const debuggerBound = hash(
    JSON.stringify({
      maxTurns,
      ...fields,
      debuggerAcceptance: manifest.debuggerAcceptance ?? null,
    }),
  );
  // First-generation process reports used the fixed 24-turn campaign budget.
  const legacy =
    !report.caseManifest &&
    manifest.maxTurns === undefined &&
    hash(JSON.stringify(fields)) === report.acceptanceSha256;
  if (
    (debuggerBound !== report.acceptanceSha256 &&
      (manifest.debuggerAcceptance !== undefined ||
        (current !== report.acceptanceSha256 && !legacy))) ||
    (report.runLimits && report.runLimits.maxTurns !== maxTurns)
  )
    throw new Error(
      "Original failure acceptance/budget does not match the recorded run",
    );
}

async function inventoryFailureFixture(root, prefix = "") {
  if ((await lstat(path.join(root, prefix))).isSymbolicLink())
    throw new Error("Failure fixture symlinks are unsupported");
  const files = {};
  for (const entry of (
    await readdir(path.join(root, prefix), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(prefix, entry.name);
    if (
      /^(?:\.env(?:\..*)?|\.git|\.napier|node_modules|.*\.(?:pem|key))$/iu.test(
        entry.name,
      )
    )
      throw new Error(
        "Failure fixture contains an excluded private/runtime path",
      );
    if (entry.isDirectory())
      Object.assign(files, await inventoryFailureFixture(root, relative));
    else if (entry.isFile())
      files[relative] = hash(await readFile(path.join(root, relative)));
    else throw new Error("Failure fixture must contain regular files");
  }
  return files;
}

async function safeRead(root, relative) {
  const target = safePath(root, relative);
  if (!(await lstat(target)).isFile())
    throw new Error("Failure case input must be a regular file");
  const canonicalRoot = await realpath(root);
  const canonical = await realpath(target);
  const scope = path.relative(canonicalRoot, canonical);
  if (
    scope.startsWith(`..${path.sep}`) ||
    scope === ".." ||
    path.isAbsolute(scope)
  )
    throw new Error("Failure case input escapes the source root");
  return readFile(target);
}

function safePath(root, relative) {
  if (
    typeof relative !== "string" ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/u).includes("..")
  )
    throw new Error("Failure case path must be relative");
  return path.join(root, relative);
}
