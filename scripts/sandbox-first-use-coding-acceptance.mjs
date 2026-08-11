import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import {
  agentCapabilityPresetUpdate,
  agentCapabilityStatus,
} from "../packages/contracts/dist/agent-capabilities.js";
import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import { resolveContainerLaunchExecutable } from "../packages/runtime/dist/sandbox-container.js";
import {
  createSandboxFirstUseEnvironment,
  currentDockerHost,
  firstUseResourceDelta,
  inspectFirstUseState,
  pathExists,
  requireFirstUseValue,
  runFirstUseSingleJsonCli,
  runFirstUseStreamJsonCli,
  sameStringSet,
  snapshotFirstUseResources,
  withFirstUseProcessEnvironment,
} from "./sandbox-first-use-coding-support.mjs";

const PROMPT =
  "Inspect the workspace boundary and summarize what a Coding run may do.";
const CHECK_CODES = [
  "sandbox_process_ready",
  "sandbox_resources_ready",
  "verification_ready",
  "shell_ready",
  "python_ready",
  "git_ready",
  "lsp_ready",
  "dap_ready",
  "service_ready",
];
const PROCESS_CHECKS = {
  lsp: "lsp_ready",
  dap: "dap_ready",
  python: "python_ready",
  shell: "shell_ready",
  verification: "verification_ready",
  service: "service_ready",
  sandbox: "sandbox_ready",
};
export async function runSandboxFirstUseCodingAcceptance(input) {
  const root = await mkdtemp(path.join(acceptanceRoot(), ".napier-first-use-"));
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "state");
  const home = path.join(root, "home");
  const temporary = path.join(root, "temp");
  let result;
  try {
    await Promise.all([
      mkdir(workspaceRoot, { recursive: true }),
      mkdir(home, { recursive: true }),
      mkdir(temporary, { recursive: true }),
    ]);
    const fixture = Buffer.from("fresh Napier workspace\n", "utf8");
    await writeFile(path.join(workspaceRoot, "README.md"), fixture, {
      flag: "wx",
      mode: 0o600,
    });
    const executable = await resolveContainerLaunchExecutable(undefined);
    const dockerHost = await currentDockerHost(executable);
    const environment = await createSandboxFirstUseEnvironment(
      process.env,
      root,
      dockerHost,
    );
    result = await withFirstUseProcessEnvironment(environment, async () => {
      const baseline = await snapshotFirstUseResources(executable, temporary);
      requireFirstUseValue(
        !(await pathExists(dataRoot)),
        "First-use state existed before Sandbox setup",
      );
      const setupPreview = await runFirstUseSingleJsonCli(
        [
          "setup",
          "--workspace",
          workspaceRoot,
          "--data-root",
          dataRoot,
          "--component",
          "sandbox",
          "--jsonl",
        ],
        input.repoRoot,
        environment,
      );
      requireFirstUseValue(
        setupPreview.code === 0 &&
          setupPreview.value.status === "ready" &&
          setupPreview.value.active === false,
        "First-use Sandbox preview failed",
      );
      const setupApply = await runFirstUseSingleJsonCli(
        [
          "setup",
          "--workspace",
          workspaceRoot,
          "--data-root",
          dataRoot,
          "--component",
          "sandbox",
          "--expected-preview",
          setupPreview.value.contentSha256,
          "--apply",
          "--jsonl",
        ],
        input.repoRoot,
        environment,
      );
      requireFirstUseValue(
        setupApply.code === 0 &&
          setupApply.value.status === "ready" &&
          setupApply.value.action === "reused" &&
          canonicalJson(Object.values(setupApply.value.checks ?? {})) ===
            canonicalJson(CHECK_CODES),
        "First-use Sandbox apply failed",
      );
      requireFirstUseValue(
        canonicalJson((await readdir(dataRoot)).sort()) ===
          canonicalJson(["sandbox.json"]),
        "First-use Setup created Agent state",
      );

      const capabilitiesBefore = await capabilityStatus(
        input.repoRoot,
        workspaceRoot,
        dataRoot,
        environment,
      );
      const before = await inspectFirstUseState(
        workspaceRoot,
        dataRoot,
        environment,
      );
      const run = await runFirstUseStreamJsonCli(
        [
          "run",
          "--workspace",
          workspaceRoot,
          "--data-root",
          dataRoot,
          "--model",
          "napier/demo",
          "--preset",
          "coding",
          "--prompt",
          PROMPT,
          "--timeout-ms",
          "120000",
          "--jsonl",
        ],
        input.repoRoot,
        environment,
      );
      const after = await inspectFirstUseState(
        workspaceRoot,
        dataRoot,
        environment,
      );
      const capabilitiesAfter = await capabilityStatus(
        input.repoRoot,
        workspaceRoot,
        dataRoot,
        environment,
      );
      const coding = verifyCodingRun(
        run,
        before,
        after,
        capabilitiesBefore,
        capabilitiesAfter,
      );

      const doctor = await runFirstUseSingleJsonCli(
        [
          "doctor",
          "--workspace",
          workspaceRoot,
          "--data-root",
          dataRoot,
          "--model",
          "napier/demo",
          "--offline",
          "--jsonl",
        ],
        input.repoRoot,
        environment,
      );
      const doctorEvidence = verifyDoctor(doctor);

      const uninstallPreview = await runFirstUseSingleJsonCli(
        [
          "setup",
          "--workspace",
          workspaceRoot,
          "--data-root",
          dataRoot,
          "--component",
          "sandbox",
          "--uninstall",
          "--jsonl",
        ],
        input.repoRoot,
        environment,
      );
      requireFirstUseValue(
        uninstallPreview.code === 0 &&
          uninstallPreview.value.status === "installed" &&
          uninstallPreview.value.active === true,
        "First-use Sandbox uninstall preview failed",
      );
      const uninstall = await runFirstUseSingleJsonCli(
        [
          "setup",
          "--workspace",
          workspaceRoot,
          "--data-root",
          dataRoot,
          "--component",
          "sandbox",
          "--uninstall",
          "--expected-preview",
          uninstallPreview.value.contentSha256,
          "--apply",
          "--jsonl",
        ],
        input.repoRoot,
        environment,
      );
      const finalPreview = await runFirstUseSingleJsonCli(
        [
          "setup",
          "--workspace",
          workspaceRoot,
          "--data-root",
          dataRoot,
          "--component",
          "sandbox",
          "--uninstall",
          "--jsonl",
        ],
        input.repoRoot,
        environment,
      );
      const bindingRemoved = !(await pathExists(
        path.join(dataRoot, "sandbox.json"),
      ));
      requireFirstUseValue(
        uninstall.code === 0 &&
          uninstall.value.status === "removed" &&
          uninstall.value.imageRetained === true &&
          bindingRemoved &&
          finalPreview.value.status === "not_installed" &&
          finalPreview.value.active === false,
        "First-use Sandbox uninstall failed",
      );
      const finalResources = await snapshotFirstUseResources(
        executable,
        temporary,
      );
      const closure = firstUseResourceDelta(baseline, finalResources);
      requireFirstUseValue(
        Object.values(closure).every((value) => value === 0),
        "First-use resources did not return to baseline",
      );
      return {
        freshWorkspace: true,
        freshDataRoot: true,
        workspaceFixtureSha256: sha256(fixture),
        setup: {
          previewStatus: setupPreview.value.status,
          previewActive: setupPreview.value.active,
          previewSha256: setupPreview.value.contentSha256,
          applyAction: setupApply.value.action,
          status: setupApply.value.status,
          checkCount: CHECK_CODES.length,
          checkCodes: CHECK_CODES,
          installationSha256: setupApply.value.installationSha256,
          resultSha256: setupApply.value.contentSha256,
        },
        profile: coding.profile,
        run: coding.run,
        doctor: doctorEvidence,
        uninstall: {
          previewStatus: uninstallPreview.value.status,
          active: uninstallPreview.value.active,
          previewSha256: uninstallPreview.value.contentSha256,
          status: uninstall.value.status,
          imageRetained: uninstall.value.imageRetained,
          bindingRemoved,
          finalStatus: finalPreview.value.status,
          resultSha256: uninstall.value.contentSha256,
        },
        resourceClosure: {
          exactBaselineRestored: true,
          ...closure,
        },
      };
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  requireFirstUseValue(
    !(await pathExists(root)),
    "First-use task root cleanup failed",
  );
  return { ...result, taskRootRemoved: true };
}

function verifyCodingRun(
  run,
  before,
  after,
  capabilityBefore,
  capabilityAfter,
) {
  requireFirstUseValue(run.code === 0, "First-use Coding CLI failed");
  const errorFrames = run.frames.filter((frame) => frame?.type === "error");
  const snapshots = run.frames.filter((frame) => frame?.type === "snapshot");
  const done = run.frames.at(-1);
  requireFirstUseValue(
    errorFrames.length === 0 &&
      snapshots.length === 1 &&
      done?.type === "done" &&
      done.status === "completed",
    "First-use Coding stream is invalid",
  );
  const agentBefore = before.agents[0];
  const agentAfter = after.agents.find(
    (candidate) => candidate.agent.id === agentBefore?.agent.id,
  );
  requireFirstUseValue(
    before.agents.length === 1 &&
      agentAfter &&
      canonicalJson(agentAfter) === canonicalJson(agentBefore) &&
      before.credentialCount === 0 &&
      after.credentialCount === 0 &&
      canonicalJson(capabilityAfter) === canonicalJson(capabilityBefore),
    "First-use Coding mutated persisted Agent state",
  );
  const runRecord = after.runs.find((candidate) => candidate.id === done.runId);
  const events = after.events.filter((event) => event.runId === done.runId);
  const started = events.filter((event) => event.type === "run.started");
  const expected = agentCapabilityPresetUpdate("coding");
  const configuration = runRecord?.configuration;
  const status = configuration && agentCapabilityStatus(configuration);
  requireFirstUseValue(
    runRecord?.status === "completed" &&
      runRecord.source === "user" &&
      runRecord.agentRevision === agentBefore.agent.revision &&
      configuration?.toolPolicy === expected.toolPolicy &&
      sameStringSet(configuration.enabledTools, expected.enabledTools) &&
      sameStringSet(configuration.enabledSkills, expected.enabledSkills) &&
      sameStringSet(
        configuration.enabledSubagents,
        expected.enabledSubagents,
      ) &&
      status?.workspaceWrite === true &&
      status.processExecution === true &&
      started.length === 1 &&
      started[0].payload?.capabilityPreset === "coding" &&
      started[0].payload?.configurationSha256 === configuration.contentSha256,
    "First-use Coding Run evidence is invalid",
  );
  requireFirstUseValue(
    capabilityBefore.action === "status" &&
      capabilityBefore.agentRevision === 1 &&
      capabilityBefore.status.toolPolicy === "observe" &&
      capabilityBefore.status.processExecution === false,
    "First-use persisted capability baseline is invalid",
  );
  return {
    profile: {
      agentRevision: agentBefore.agent.revision,
      profileSha256Before: sha256(canonicalJson(agentBefore.agent)),
      profileSha256After: sha256(canonicalJson(agentAfter.agent)),
      revisionSetSha256Before: sha256(canonicalJson(agentBefore.revisions)),
      revisionSetSha256After: sha256(canonicalJson(agentAfter.revisions)),
      revisionCountBefore: agentBefore.revisions.length,
      revisionCountAfter: agentAfter.revisions.length,
      credentialCountBefore: before.credentialCount,
      credentialCountAfter: after.credentialCount,
      persistedToolPolicy: capabilityAfter.status.toolPolicy,
      persistedProcessExecution: capabilityAfter.status.processExecution,
      projectionSha256: capabilityAfter.projection.projectionSha256,
    },
    run: {
      status: runRecord.status,
      source: runRecord.source,
      model: "napier/demo",
      capabilityPreset: started[0].payload.capabilityPreset,
      agentRevision: runRecord.agentRevision,
      toolPolicy: configuration.toolPolicy,
      workspaceWrite: status.workspaceWrite,
      processExecution: status.processExecution,
      configurationSha256: configuration.contentSha256,
      promptSha256: sha256(PROMPT),
      frameCount: run.frames.length,
      stdoutBytes: run.stdoutBytes,
      stdoutSha256: run.stdoutSha256,
      threadIdSha256: sha256(runRecord.threadId),
      runIdSha256: sha256(runRecord.id),
    },
  };
}

function verifyDoctor(doctor) {
  const value = doctor.value;
  const check = (id) => value.checks.find((candidate) => candidate.id === id);
  requireFirstUseValue(
    doctor.code === 0 &&
      value.status === "degraded" &&
      value.checkCount === 14 &&
      value.passedCount === 11 &&
      value.warningCount === 0 &&
      value.failedCount === 0 &&
      value.skippedCount === 3 &&
      check("skills")?.status === "passed" &&
      check("skills")?.code === "skills_empty" &&
      Object.entries(PROCESS_CHECKS).every(
        ([id, code]) =>
          check(id)?.status === "passed" && check(id)?.code === code,
      ) &&
      check("sandbox")?.evidence?.adapter === "oci-container" &&
      check("sandbox")?.evidence?.gitProductionCall === true &&
      check("sandbox")?.evidence?.resourceProductionCall === true,
    "First-use Doctor result is invalid",
  );
  return {
    status: value.status,
    checkCount: value.checkCount,
    passedCount: value.passedCount,
    warningCount: value.warningCount,
    failedCount: value.failedCount,
    skippedCount: value.skippedCount,
    skillsCode: check("skills").code,
    sandboxCode: check("sandbox").code,
    shellCode: check("shell").code,
    pythonCode: check("python").code,
    lspCode: check("lsp").code,
    dapCode: check("dap").code,
    verificationCode: check("verification").code,
    serviceCode: check("service").code,
    reportSha256: value.contentSha256,
  };
}

async function capabilityStatus(repoRoot, workspaceRoot, dataRoot, env) {
  const result = await runFirstUseSingleJsonCli(
    [
      "capabilities",
      "--workspace",
      workspaceRoot,
      "--data-root",
      dataRoot,
      "--jsonl",
    ],
    repoRoot,
    env,
  );
  requireFirstUseValue(result.code === 0, "First-use capability status failed");
  return result.value;
}

function acceptanceRoot() {
  return process.platform === "linux" ? tmpdir() : homedir();
}
