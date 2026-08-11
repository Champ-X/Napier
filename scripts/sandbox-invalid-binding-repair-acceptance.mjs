import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import { resolveContainerLaunchExecutable } from "../packages/runtime/dist/sandbox-container.js";
import {
  createSandboxFirstUseEnvironment,
  currentDockerHost,
  firstUseResourceDelta,
  inspectFirstUseState,
  pathExists,
  requireFirstUseValue,
  runFirstUseCapturedCli,
  runFirstUseSingleJsonCli,
  runFirstUseStreamJsonCli,
  snapshotFirstUseResources,
  withFirstUseProcessEnvironment,
} from "./sandbox-first-use-coding-support.mjs";

const INVALID_BINDING = Buffer.from('{"broken":true}\n', "utf8");
const PROMPT = "Inspect this repaired legacy workspace.";
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

export async function runSandboxInvalidBindingRepairAcceptance(input) {
  const root = await mkdtemp(
    path.join(acceptanceRoot(), ".napier-invalid-binding-repair-"),
  );
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "state");
  const temporary = path.join(root, "temp");
  let result;
  try {
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "README.md"),
      "legacy Napier workspace\n",
      { flag: "wx", mode: 0o600 },
    );
    const executable = await resolveContainerLaunchExecutable(undefined);
    const dockerHost = await currentDockerHost(executable);
    const environment = await createSandboxFirstUseEnvironment(
      process.env,
      root,
      dockerHost,
    );
    result = await withFirstUseProcessEnvironment(environment, async () => {
      const baseline = await snapshotFirstUseResources(executable, temporary);
      const profileApplied = await runFirstUseSingleJsonCli(
        [
          "capabilities",
          "--workspace",
          workspaceRoot,
          "--data-root",
          dataRoot,
          "--preset",
          "browser",
          "--apply",
          "--jsonl",
        ],
        input.repoRoot,
        environment,
      );
      requireFirstUseValue(
        profileApplied.code === 0 &&
          profileApplied.value.action === "applied" &&
          profileApplied.value.agentRevision === 2,
        "Invalid-binding acceptance legacy Profile setup failed",
      );
      const before = await inspectFirstUseState(
        workspaceRoot,
        dataRoot,
        environment,
      );
      const agentBefore = before.agents[0];
      requireFirstUseValue(
        before.agents.length === 1 &&
          agentBefore.agent.revision === 2 &&
          before.credentialCount === 0,
        "Invalid-binding acceptance legacy state is invalid",
      );

      await writeFile(path.join(dataRoot, "sandbox.json"), INVALID_BINDING);
      await chmod(path.join(dataRoot, "sandbox.json"), 0o600);
      const doctorInvalid = await runFirstUseSingleJsonCli(
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
      const invalidCheck = doctorInvalid.value.checks?.[0];
      requireFirstUseValue(
        doctorInvalid.code === 0 &&
          doctorInvalid.value.status === "degraded" &&
          doctorInvalid.value.checkCount === 1 &&
          invalidCheck?.code === "sandbox_configured_invalid" &&
          doctorInvalid.value.remediations?.[0]?.id ===
            "repair_invalid_sandbox" &&
          doctorInvalid.value.remediations?.[0]?.instruction.includes(
            "--component sandbox --uninstall",
          ),
        "Invalid-binding Doctor recovery is invalid",
      );

      const blocked = await runFirstUseCapturedCli(
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
          "Do not create this Run.",
          "--jsonl",
          "--timeout-ms",
          "30000",
        ],
        input.repoRoot,
        environment,
      );
      const blockedFrame = singleJsonLine(blocked.stdout);
      requireFirstUseValue(
        blocked.code === 1 &&
          blocked.stderr === "" &&
          blockedFrame.type === "error" &&
          blockedFrame.message.includes("--component sandbox --uninstall") &&
          blockedFrame.message.includes("remove only that binding"),
        "Invalid-binding Run did not expose exact recovery",
      );
      const blockedState = await inspectFirstUseState(
        workspaceRoot,
        dataRoot,
        environment,
      );
      requireFirstUseValue(
        canonicalState(blockedState) === canonicalState(before),
        "Invalid-binding Run mutated state before repair",
      );

      const unsafeSetup = await runFirstUseCapturedCli(
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
        unsafeSetup.code === 1 &&
          unsafeSetup.stdout === "" &&
          /^Napier Sandbox setup failed \([a-f0-9]{16}\)\n$/u.test(
            unsafeSetup.stderr,
          ),
        "Invalid binding did not block ordinary Setup",
      );

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
          uninstallPreview.value.status === "invalid" &&
          uninstallPreview.value.active === false &&
          /^[a-f0-9]{64}$/u.test(uninstallPreview.value.bindingSha256 ?? ""),
        "Invalid-binding uninstall preview is invalid",
      );
      const removed = await runFirstUseSingleJsonCli(
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
      requireFirstUseValue(
        removed.code === 0 &&
          removed.value.status === "removed" &&
          removed.value.imageRetained === true &&
          !(await pathExists(path.join(dataRoot, "sandbox.json"))),
        "Invalid-binding exact removal failed",
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
      const setup = await runFirstUseSingleJsonCli(
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
        setup.code === 0 &&
          setup.value.status === "ready" &&
          canonicalJson(Object.values(setup.value.checks ?? {})) ===
            canonicalJson(CHECK_CODES),
        "Invalid-binding repaired Setup failed",
      );
      const doctorRepaired = await runFirstUseSingleJsonCli(
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
      requireFirstUseValue(
        doctorRepaired.code === 0 &&
          doctorRepaired.value.passedCount === 11 &&
          doctorRepaired.value.warningCount === 0 &&
          doctorRepaired.value.skippedCount === 3,
        "Invalid-binding repaired Doctor failed",
      );

      const coding = await runFirstUseStreamJsonCli(
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
          "--jsonl",
          "--timeout-ms",
          "120000",
        ],
        input.repoRoot,
        environment,
      );
      const done = coding.frames.at(-1);
      requireFirstUseValue(
        coding.code === 0 &&
          done?.type === "done" &&
          done.status === "completed",
        "Invalid-binding repaired Coding Run failed",
      );
      const after = await inspectFirstUseState(
        workspaceRoot,
        dataRoot,
        environment,
      );
      const agentAfter = after.agents[0];
      const repairedRun = after.runs.find(
        (candidate) => candidate.id === done.runId,
      );
      const started = after.events.find(
        (event) => event.runId === done.runId && event.type === "run.started",
      );
      requireFirstUseValue(
        canonicalJson(agentAfter) === canonicalJson(agentBefore) &&
          before.credentialCount === after.credentialCount &&
          repairedRun?.configuration?.toolPolicy === "workspace" &&
          repairedRun.configuration.enabledTools.includes("run_command") &&
          started?.payload?.capabilityPreset === "coding" &&
          started.payload.configurationSha256 ===
            repairedRun.configuration.contentSha256,
        "Invalid-binding repair changed Profile or Run authority",
      );

      const finalUninstallPreview = await runFirstUseSingleJsonCli(
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
      const finalUninstall = await runFirstUseSingleJsonCli(
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
          finalUninstallPreview.value.contentSha256,
          "--apply",
          "--jsonl",
        ],
        input.repoRoot,
        environment,
      );
      const finalResources = await snapshotFirstUseResources(
        executable,
        temporary,
      );
      const closure = firstUseResourceDelta(baseline, finalResources);
      requireFirstUseValue(
        finalUninstall.value.status === "removed" &&
          Object.values(closure).every((value) => value === 0),
        "Invalid-binding repair did not restore the resource baseline",
      );

      return {
        legacyAgentRevision: agentBefore.agent.revision,
        invalidBindingSha256: sha256(INVALID_BINDING),
        doctor: {
          invalidCode: invalidCheck.code,
          remediationId: doctorInvalid.value.remediations[0].id,
          exactUninstallGuidance: true,
          invalidReportSha256: doctorInvalid.value.contentSha256,
          repairedPassedCount: doctorRepaired.value.passedCount,
          repairedWarningCount: doctorRepaired.value.warningCount,
          repairedSkippedCount: doctorRepaired.value.skippedCount,
          repairedReportSha256: doctorRepaired.value.contentSha256,
        },
        blockedRun: {
          status: "blocked",
          exactUninstallGuidance: true,
          stateUnchanged: true,
          diagnosticSha256: blockedFrame.diagnosticSha256,
        },
        unsafeSetup: {
          blocked: true,
          diagnosticSha256: sha256(unsafeSetup.stderr),
        },
        removal: {
          previewStatus: uninstallPreview.value.status,
          active: uninstallPreview.value.active,
          previewSha256: uninstallPreview.value.contentSha256,
          bindingSha256: uninstallPreview.value.bindingSha256,
          status: removed.value.status,
          imageRetained: removed.value.imageRetained,
          resultSha256: removed.value.contentSha256,
        },
        setup: {
          previewStatus: setupPreview.value.status,
          applyAction: setup.value.action,
          status: setup.value.status,
          checkCount: CHECK_CODES.length,
          checkCodes: CHECK_CODES,
          installationSha256: setup.value.installationSha256,
          resultSha256: setup.value.contentSha256,
        },
        profile: {
          profileSha256Before: sha256(canonicalJson(agentBefore.agent)),
          profileSha256After: sha256(canonicalJson(agentAfter.agent)),
          revisionSetSha256Before: sha256(canonicalJson(agentBefore.revisions)),
          revisionSetSha256After: sha256(canonicalJson(agentAfter.revisions)),
          revisionCountBefore: agentBefore.revisions.length,
          revisionCountAfter: agentAfter.revisions.length,
          credentialCountBefore: before.credentialCount,
          credentialCountAfter: after.credentialCount,
        },
        run: {
          status: repairedRun.status,
          capabilityPreset: started.payload.capabilityPreset,
          toolPolicy: repairedRun.configuration.toolPolicy,
          processExecution:
            repairedRun.configuration.enabledTools.includes("run_command"),
          configurationSha256: repairedRun.configuration.contentSha256,
          promptSha256: sha256(PROMPT),
          runIdSha256: sha256(repairedRun.id),
          threadIdSha256: sha256(repairedRun.threadId),
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
    "Invalid-binding repair task root cleanup failed",
  );
  return { ...result, taskRootRemoved: true };
}

function canonicalState(value) {
  return canonicalJson({
    agents: value.agents,
    credentialCount: value.credentialCount,
    runs: value.runs,
    events: value.events,
  });
}

function singleJsonLine(output) {
  const lines = output.trim().split("\n").filter(Boolean);
  requireFirstUseValue(
    lines.length === 1,
    "Invalid-binding CLI emitted invalid JSONL",
  );
  return JSON.parse(lines[0]);
}

function acceptanceRoot() {
  return process.platform === "linux" ? tmpdir() : homedir();
}
