import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { campaignLimitOverrides } from "./harness-campaign-limits.mjs";
import {
  assertProfileFileSelection,
  freezeCampaignProfile,
  assertFrozenCampaignProfile,
} from "./harness-campaign-profile.mjs";
import {
  prepareHarnessSuite,
  executeSuiteJobs,
  inventorySuiteTree,
} from "./harness-suite.mjs";
import { evaluateCampaignQuality } from "./harness-campaign-evidence.mjs";
import {
  pairedSuiteJobs,
  executePairedSuiteJobs,
} from "./harness-paired-schedule.mjs";
import {
  openSpendingBudget,
  FLASH_SPENDING_POLICY,
} from "./harness-spending-budget.mjs";
import {
  createApiRequestBudget,
  openApiRequestBudget,
} from "./harness-api-request-budget.mjs";

const { values } = parseArgs({
  options: {
    suite: { type: "string" },
    output: { type: "string" },
    "baseline-runtime": { type: "string" },
    "candidate-runtime": { type: "string" },
    "baseline-profile-mode": { type: "string" },
    "baseline-profile-file": { type: "string" },
    "candidate-profile-file": { type: "string" },
    policy: { type: "string" },
    trials: { type: "string", default: "3" },
    concurrency: { type: "string", default: "1" },
    "schedule-mode": { type: "string", default: "paired-stop" },
    "prioritize-case": { type: "string", multiple: true, default: [] },
    "context-delivery": { type: "string" },
    finalization: { type: "string" },
    "max-api-requests": { type: "string" },
    "api-request-interval-ms": { type: "string" },
    "max-cost-usd": { type: "string" },
    "run-timeout-ms": { type: "string" },
    "spending-budget": { type: "string" },
    "grader-mode": { type: "string", default: "host" },
    "grader-runtimes": { type: "string", default: "node" },
  },
});
const limitOverrides = campaignLimitOverrides(values);
if (
  !["host", "sandbox"].includes(values["grader-mode"]) ||
  (values["grader-mode"] === "host" && values["grader-runtimes"] !== "node")
)
  throw new Error(
    "Explicit grader runtimes require sandbox mode; mode must be host or sandbox",
  );
if (
  !["suite", "output", "baseline-runtime", "candidate-runtime"].every(
    (k) => values[k],
  )
)
  throw new Error(
    "Specify suite, output, baseline-runtime and candidate-runtime",
  );
const trials = Number(values.trials),
  concurrency = Number(values.concurrency);
const scheduleMode = values["schedule-mode"];
if (scheduleMode === "batch" && values["prioritize-case"].length)
  throw new Error("Case priority requires paired-stop scheduling");
if (
  !["paired-stop", "batch"].includes(scheduleMode) ||
  (scheduleMode === "paired-stop" && concurrency !== 1)
)
  throw new Error(
    "paired-stop requires concurrency 1; batch must be explicitly selected for concurrent jobs",
  );
if (
  !Number.isSafeInteger(trials) ||
  trials < 1 ||
  trials > 100 ||
  !Number.isSafeInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 4
)
  throw new Error("Invalid suite trial count/concurrency");
if (
  values["baseline-profile-mode"] !== undefined &&
  !["default", "policy"].includes(values["baseline-profile-mode"])
)
  throw new Error("baseline-profile-mode must be default or policy");
if (
  values["max-api-requests"] === undefined ||
  values["api-request-interval-ms"] === undefined
)
  throw new Error(
    "Explicit --max-api-requests and --api-request-interval-ms are required for the entire suite",
  );
const output = path.resolve(values.output);
for (const arm of ["baseline", "candidate"])
  assertProfileFileSelection({
    ...values,
    "profile-file": values[`${arm}-profile-file`],
    "profile-mode":
      arm === "baseline" ? values["baseline-profile-mode"] : "policy",
  });
values["baseline-profile-mode"] ??= values["baseline-profile-file"]
  ? "policy"
  : "default";
values.policy ??= "coding-python.v1";
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false });
const profiles = {};
for (const arm of ["baseline", "candidate"])
  if (values[`${arm}-profile-file`])
    profiles[arm] = await freezeCampaignProfile(
      values[`${arm}-profile-file`],
      values[`${arm}-runtime`],
      path.join(output, `${arm}-profile.json`),
    );
const apiBudgetFile = path.join(output, "api-budget.sqlite");
createApiRequestBudget(apiBudgetFile, {
  maxRequests: Number(values["max-api-requests"]),
  minIntervalMs: Number(values["api-request-interval-ms"]),
});
const apiBudget = openApiRequestBudget(apiBudgetFile);
const spendingBudget = values["spending-budget"]
  ? openSpendingBudget(path.resolve(values["spending-budget"]))
  : undefined;
const inputs = await prepareHarnessSuite(
  path.resolve(values.suite),
  path.join(output, "cases"),
);
const originalInventory = await inventorySuiteTree(path.join(output, "cases"));
const campaign = fileURLToPath(
  new URL("./run-harness-optimization-campaign.mjs", import.meta.url),
);
const sha = (v) => createHash("sha256").update(v).digest("hex");
const jobs =
  scheduleMode === "paired-stop"
    ? pairedSuiteJobs(inputs.cases, output, trials, values["prioritize-case"])
    : inputs.cases.flatMap((item, index) =>
        (index % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]).map(
          (arm) => ({
            caseId: item.id,
            caseRoot: item.path,
            arm,
            output: path.join(output, `${item.id}-${arm}`),
          }),
        ),
      );
await writeFile(
  path.join(output, "schedule.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      trials,
      concurrency,
      scheduleMode,
      prioritizedCases: values["prioritize-case"],
      limitOverrides,
      graderMode: values["grader-mode"],
      graderRuntimes: values["grader-runtimes"],
      ...(values["spending-budget"]
        ? {
            spendingBudgetFile: path.resolve(values["spending-budget"]),
            spendingBudgetBefore: spendingBudget.snapshot(),
          }
        : {}),
      profiles,
      apiRequestBudget: apiBudget.snapshot(),
      inputReceiptSha256: sha(JSON.stringify(inputs)),
      jobs,
      measurementScope:
        scheduleMode === "paired-stop"
          ? "Serial paired task-quality collection; cache/cost causality is not established"
          : "Concurrent jobs do not qualify latency or provider cache/cost attribution",
    },
    null,
    2,
  ),
  { flag: "wx" },
);
const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const execute = async (job, signal) => {
  if (apiBudget.snapshot().remaining === 0)
    return {
      exitCode: 1,
      reason: "api_request_budget_exhausted",
      spawned: false,
    };
  if (
    spendingBudget &&
    spendingBudget.snapshot().remainingFen <
      FLASH_SPENDING_POLICY.reservationFen
  )
    return {
      exitCode: 1,
      reason: "spending_budget_insufficient",
      spawned: false,
    };
  const args = [
    campaign,
    "--api-budget",
    apiBudgetFile,
    "--runtime-root",
    path.resolve(values[`${job.arm}-runtime`]),
    "--case-root",
    job.caseRoot,
    "--output",
    job.output,
    "--arm",
    job.arm,
    "--trials",
    String(job.trial === undefined ? trials : 1),
    "--trial-offset",
    String(job.trial ?? 0),
    "--profile-mode",
    job.arm === "candidate" ? "policy" : values["baseline-profile-mode"],
    "--max-cost-usd",
    String(limitOverrides.maxCostUsd),
    "--run-timeout-ms",
    String(limitOverrides.timeoutMs),
    "--grader-mode",
    values["grader-mode"],
    "--grader-runtimes",
    values["grader-runtimes"],
  ];
  if (values["spending-budget"])
    args.push("--spending-budget", path.resolve(values["spending-budget"]));
  if (profiles[job.arm]) {
    await assertFrozenCampaignProfile(profiles[job.arm]);
    args.push(
      "--profile-file",
      profiles[job.arm].path,
      "--profile-file-sha256",
      profiles[job.arm].fileSha256,
    );
  } else args.push("--policy", values.policy);
  if (job.arm === "candidate" || values["baseline-profile-mode"] === "policy")
    for (const name of ["context-delivery", "finalization"])
      if (values[name]) args.push(`--${name}`, values[name]);
  const log = await open(
    path.join(output, `${path.basename(job.output)}.log`),
    "wx",
  );
  console.log(
    JSON.stringify({
      caseId: job.caseId,
      arm: job.arm,
      trial: job.trial ?? null,
      status: "started",
    }),
  );
  try {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", log.fd, log.fd],
    });
    const abort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", abort, { once: true });
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, exitSignal) =>
        resolve({ exitCode, exitSignal }),
      );
      if (signal.aborted) abort();
    }).finally(() => signal.removeEventListener("abort", abort));
    console.log(
      JSON.stringify({
        caseId: job.caseId,
        arm: job.arm,
        trial: job.trial ?? null,
        status: "settled",
        ...result,
      }),
    );
    return result;
  } finally {
    await log.close();
  }
};
const execution =
  scheduleMode === "paired-stop"
    ? await executePairedSuiteJobs(
        jobs,
        execute,
        async (job) =>
          JSON.parse(
            await readFile(
              path.join(job.output, `trial-${job.trial + 1}`, "result.json"),
              "utf8",
            ),
          ),
        {
          signal: controller.signal,
          checkpoint: async (receipt) =>
            writeFile(
              path.join(output, `checkpoint-${receipt.completedJobs}.json`),
              JSON.stringify(receipt, null, 2),
              { flag: "wx" },
            ),
        },
      )
    : {
        statuses: await executeSuiteJobs(jobs, execute, {
          concurrency,
          signal: controller.signal,
        }),
        stop: null,
      };
const { statuses } = execution;
process.removeListener("SIGINT", stop);
process.removeListener("SIGTERM", stop);
const reports = [],
  missing = [];
for (const job of jobs)
  for (const i of job.trial === undefined
    ? Array.from({ length: trials }, (_, index) => index + 1)
    : [job.trial + 1]) {
    const file = path.join(job.output, `trial-${i}`, "result.json");
    try {
      reports.push(JSON.parse(await readFile(file, "utf8")));
    } catch {
      missing.push({ caseId: job.caseId, arm: job.arm, trial: i - 1 });
    }
  }
const inputsStable =
  JSON.stringify(originalInventory) ===
  JSON.stringify(await inventorySuiteTree(path.join(output, "cases")));
const quality = evaluateCampaignQuality(reports);
const result = {
  kind: "napier.harness-suite-result",
  schemaVersion: 1,
  suiteId: inputs.id,
  trials,
  concurrency,
  scheduleMode,
  stop: execution.stop,
  apiRequestBudget: apiBudget.snapshot(),
  ...(spendingBudget ? { spendingBudget: spendingBudget.snapshot() } : {}),
  inputsStable,
  statuses,
  missing,
  quality,
  collectionComplete:
    inputsStable &&
    !missing.length &&
    statuses.every((s) => s.status === "settled" && s.result.exitCode === 0),
  observations: reports.map((r) => ({
    caseId: r.caseId,
    arm: r.arm,
    trial: r.trial,
    runId: r.runId,
    taskSuccess: r.taskSuccess,
    qualifyingEvidence: r.qualifyingEvidence,
    allowedChanges: r.allowedChanges,
    environmentEligible: r.environmentEvidence?.eligible,
    toolFailures: r.toolFailures,
    reportSha256: sha(JSON.stringify(r)),
    usage: r.usage,
  })),
};
result.promotionReady = result.collectionComplete && quality.promotionReady;
await writeFile(
  path.join(output, "suite-result.json"),
  JSON.stringify(result, null, 2),
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    output,
    quality,
    collectionComplete: result.collectionComplete,
    promotionReady: result.promotionReady,
  }),
);
if (!result.collectionComplete || quality.verdict === "regressed")
  process.exitCode = 1;
apiBudget.close();
spendingBudget?.close();
