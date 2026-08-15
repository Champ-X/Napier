import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseDocument } from "yaml";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const WORKFLOW_PATH = ".github/workflows/windows-host-product-acceptance.yml";
const SHA = /^[a-f0-9]{40}$/u;
const REQUIRED_ACTIONS = new Map([
  ["actions/checkout", "d23441a48e516b6c34aea4fa41551a30e30af803"],
  ["actions/setup-node", "249970729cb0ef3589644e2896645e5dc5ba9c38"],
  ["actions/upload-artifact", "ea165f8d65b6e75b540449e92b4886f43607fa02"],
]);
const RUNNER_IMAGE = "windows-2025";

export async function auditWindowsHostProductAcceptanceWorkflow(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const [source, liveSource, supportSource] = await Promise.all([
    readFile(path.join(repoRoot, WORKFLOW_PATH), "utf8"),
    readFile(
      path.join(repoRoot, "scripts/windows-host-product-acceptance-live.mjs"),
      "utf8",
    ),
    readFile(
      path.join(
        repoRoot,
        "scripts/windows-host-product-acceptance-support.mjs",
      ),
      "utf8",
    ),
  ]);
  const document = parseDocument(source, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  const errors = document.errors.map(
    () => "windows_acceptance_workflow_yaml_invalid",
  );
  const workflow = document.toJS();
  if (!record(workflow)) {
    return result(errors.concat("windows_acceptance_workflow_shape_invalid"));
  }
  validateTrigger(workflow, errors);
  validatePermissions(workflow.permissions, errors);
  validateJob(workflow.jobs, errors);
  validateActions(workflow.jobs, errors);
  validateCommandClosure(source, errors);
  validateLiveClosure(liveSource, errors);
  validateSupportClosure(supportSource, errors);
  return result(errors);

  function result(found) {
    return {
      valid: found.length === 0,
      errors: found,
      path: WORKFLOW_PATH,
    };
  }
}

function validateTrigger(workflow, errors) {
  const trigger = workflow.on;
  const inputs = trigger?.workflow_dispatch?.inputs;
  const sourceSha = inputs?.source_sha;
  if (
    !record(trigger) ||
    Object.keys(trigger).join("\n") !== "workflow_dispatch" ||
    !record(sourceSha) ||
    sourceSha.required !== true ||
    sourceSha.type !== "string"
  ) {
    errors.push("windows_acceptance_workflow_trigger_invalid");
  }
}

function validatePermissions(value, errors) {
  if (
    !record(value) ||
    Object.keys(value).join("\n") !== "contents" ||
    value.contents !== "read"
  ) {
    errors.push("windows_acceptance_workflow_permissions_invalid");
  }
}

function validateJob(jobs, errors) {
  const accept = jobs?.accept;
  if (
    !record(jobs) ||
    Object.keys(jobs).join("\n") !== "accept" ||
    !record(accept) ||
    accept.if !==
      "github.repository == 'Champ-X/Napier' && github.ref == 'refs/heads/main'" ||
    accept["timeout-minutes"] !== 60 ||
    accept["runs-on"] !== RUNNER_IMAGE ||
    accept.defaults?.run?.shell !== "pwsh" ||
    !Array.isArray(accept.steps)
  ) {
    errors.push("windows_acceptance_workflow_job_invalid");
    return;
  }
  const byName = new Map(
    accept.steps
      .filter((step) => record(step) && typeof step.name === "string")
      .map((step) => [step.name, step]),
  );
  const checkout = byName.get("Check out the exact source");
  if (
    checkout?.with?.ref !== "${{ inputs.source_sha }}" ||
    checkout?.with?.["fetch-depth"] !== 0 ||
    checkout?.with?.clean !== true ||
    checkout?.with?.["persist-credentials"] !== false
  ) {
    errors.push("windows_acceptance_workflow_checkout_invalid");
  }
  const setupNode = byName.get("Set up Node");
  if (
    !record(setupNode?.with) ||
    Object.keys(setupNode.with).join("\n") !== "node-version" ||
    setupNode.with["node-version"] !== "24.16.0"
  ) {
    errors.push("windows_acceptance_workflow_node_invalid");
  }
  const upload = byName.get("Upload the sanitized Windows receipt");
  if (
    upload?.with?.path !==
      "${{ runner.temp }}\\napier-windows-host-product-acceptance.json" ||
    upload?.with?.["if-no-files-found"] !== "error" ||
    upload?.with?.["retention-days"] !== 90
  ) {
    errors.push("windows_acceptance_workflow_upload_invalid");
  }
  if (byName.get("Remove acceptance output")?.if !== "always()") {
    errors.push("windows_acceptance_workflow_cleanup_invalid");
  }
  const dockerStep = byName.get("Start isolated WSL2 Linux Docker");
  const baselineStep = byName.get("Capture hosted runner baseline");
  const cleanupStep = byName.get("Remove acceptance output");
  const baseline = baselineStep?.run;
  const cleanup = cleanupStep?.run;
  if (
    typeof dockerStep?.run !== "string" ||
    !dockerStep.run.includes("wsl.exe --install Ubuntu --no-launch") ||
    !dockerStep.run.includes("apt-get install -y -qq docker.io") ||
    !dockerStep.run.includes("[Convert]::ToBase64String(") ||
    !dockerStep.run.includes("base64 -d | bash") ||
    !dockerStep.run.includes("tcp://127.0.0.1:2375")
  ) {
    errors.push("windows_acceptance_workflow_wsl_docker_invalid");
  }
  for (const step of [baselineStep, cleanupStep]) {
    if (
      step?.env?.DOCKER_HOST !== "tcp://127.0.0.1:2375" ||
      step?.env?.CONTROL_DOCKER_CONFIG !==
        "${{ runner.temp }}\\napier-windows-control-docker"
    ) {
      errors.push("windows_acceptance_workflow_control_docker_env_invalid");
    }
  }
  for (const fragment of cleanupFragments()) {
    if (typeof baseline !== "string" || !baseline.includes(fragment)) {
      errors.push(`windows_acceptance_workflow_baseline_missing:${fragment}`);
    }
    if (typeof cleanup !== "string" || !cleanup.includes(fragment)) {
      errors.push(`windows_acceptance_workflow_cleanup_missing:${fragment}`);
    }
  }
}

function validateActions(jobs, errors) {
  const steps = jobs?.accept?.steps;
  if (!Array.isArray(steps)) return;
  const observed = new Map();
  for (const step of steps) {
    if (!record(step) || typeof step.uses !== "string") continue;
    const match = /^([^@]+)@([a-f0-9]{40})$/u.exec(step.uses);
    if (!match || !SHA.test(match[2])) {
      errors.push("windows_acceptance_workflow_action_not_sha_pinned");
      continue;
    }
    observed.set(match[1], match[2]);
  }
  for (const [action, sha] of REQUIRED_ACTIONS) {
    if (observed.get(action) !== sha) {
      errors.push(`windows_acceptance_workflow_action_missing:${action}`);
    }
  }
  if (observed.size !== REQUIRED_ACTIONS.size) {
    errors.push("windows_acceptance_workflow_action_set_invalid");
  }
}

function validateCommandClosure(source, errors) {
  const required = [
    "workflow_dispatch:",
    "github.ref == 'refs/heads/main'",
    "runs-on: windows-2025",
    "Start isolated WSL2 Linux Docker",
    "wsl.exe --install Ubuntu --no-launch",
    "apt-get install -y -qq docker.io",
    "[Convert]::ToBase64String(",
    "base64 -d | bash",
    "tcp://127.0.0.1:2375",
    "shell: pwsh",
    "node-version: 24.16.0",
    "persist-credentials: false",
    "git.exe rev-parse refs/remotes/origin/main",
    "git.exe status --porcelain=v1 --untracked-files=all",
    "Capture hosted runner baseline",
    'name=napier-"',
    'name=napier-network-"',
    "reference=napier-windows-acceptance:*",
    "^napier-process-sandbox-",
    "^napier-product-acceptance-",
    "^napier-windows-host-environment-",
    "git.exe clean -ffdx",
    "scripts/windows-host-product-acceptance-live.mjs",
    "RUNNER_ENVIRONMENT: ${{ runner.environment }}",
    "RUNNER_OS: ${{ runner.os }}",
    "RUNNER_ARCH: ${{ runner.arch }}",
    "--source-sha $env:SOURCE_SHA",
    "--output $env:RECEIPT_PATH",
    "scripts/check-windows-host-product-acceptance.mjs",
    "--artifact-path $env:RECEIPT_PATH",
    "Upload the sanitized Windows receipt",
    "if-no-files-found: error",
    "retention-days: 90",
    "Remove acceptance output",
    "if: always()",
    "Napier containers remain after cleanup",
    "Napier networks remain after cleanup",
    "Napier acceptance images remain after cleanup",
    "Napier official image tag remains after cleanup",
    "Windows receipt remains after cleanup",
    "Checkout remains dirty after cleanup",
    "IMAGE_BASELINE_PATH: ${{ runner.temp }}",
    "CONTROL_DOCKER_CONFIG: ${{ runner.temp }}",
    "DOCKER_HOST: tcp://127.0.0.1:2375",
    "Remove-Item Env:DOCKER_AUTH_CONFIG",
    'Set-Content -LiteralPath "$env:CONTROL_DOCKER_CONFIG\\config.json"',
    "-Value '{\"auths\":{}}'",
    "$env:DOCKER_CONFIG = $env:CONTROL_DOCKER_CONFIG",
    'docker.exe image ls --all --no-trunc --format "{{.ID}}"',
    "[System.IO.File]::WriteAllLines(",
    "Docker image baseline is invalid during cleanup",
    "Where-Object { $_ -notin $baseline }",
    "if (Compare-Object $expected $observed) {",
    "Docker image baseline was not restored",
    "Remove-Item -LiteralPath $env:IMAGE_BASELINE_PATH -Force",
    'NAPIER_CONTAINER_WINDOWS_WSL_MOUNTS: "1"',
  ];
  for (const fragment of required) {
    if (!source.includes(fragment)) {
      errors.push(`windows_acceptance_workflow_contract_missing:${fragment}`);
    }
  }
  const forbidden = [
    "pull_request:",
    "push:",
    "schedule:",
    "ubuntu-",
    "self-hosted",
    "napier-windows-docker",
    "packages: write",
    "id-token: write",
    "secrets.",
    "continue-on-error",
    "--no-sandbox",
    "cache: npm",
  ];
  for (const fragment of forbidden) {
    if (source.includes(fragment)) {
      errors.push(`windows_acceptance_workflow_forbidden:${fragment}`);
    }
  }
}

function validateLiveClosure(source, errors) {
  const required = [
    'const DOCKER_ENDPOINT = "tcp://127.0.0.1:2375"',
    'process.platform !== "win32"',
    'process.arch !== "x64"',
    'requiredEnvironment("RUNNER_ENVIRONMENT")',
    'requiredEnvironment("RUNNER_OS")',
    'requiredEnvironment("RUNNER_ARCH")',
    'requiredEnvironment("DOCKER_HOST")',
    'identity.runnerEnvironment !== "github-hosted"',
    'identity.runnerOs !== "Windows"',
    'identity.runnerArch !== "X64"',
    'docker.os !== "linux"',
    'docker.arch !== "amd64"',
    "path.dirname(process.execPath)",
    '"node_modules/npm/bin/npm-cli.js"',
    "runWindowsAcceptanceCommand(",
    "process.execPath,",
    '"node_modules/@lydell/node-pty-win32-x64"',
    'const binaryRelative = "prebuilds/win32-x64/conpty.node"',
    'await import("@lydell/node-pty")',
    'await import("./check-sandbox-product-acceptance.mjs")',
    "collectSandboxProductAcceptance({ repoRoot })",
    "restoreWindowsOfficialImage(",
    "restoreWindowsImageEvidence(",
    "removeWindowsWorkspaceOutput(",
    "cleanupWindowsDockerDelta(",
    "windowsSourceStatus(repoRoot) ===",
    "createWindowsHostProductAcceptanceReceipt({",
    "runWindowsAcceptanceCli({",
  ];
  for (const fragment of required) {
    if (!source.includes(fragment)) {
      errors.push(`windows_acceptance_live_contract_missing:${fragment}`);
    }
  }
  const forbidden = [
    "windowsHostProductAcceptance: false",
    "--no-sandbox",
    "rawCommandOutput: true",
  ];
  for (const fragment of forbidden) {
    if (source.includes(fragment)) {
      errors.push(`windows_acceptance_live_forbidden:${fragment}`);
    }
  }
}

function validateSupportClosure(source, errors) {
  const required = [
    '"docker.exe"',
    '"git.exe"',
    "withWindowsAcceptanceEnvironment",
    "createWindowsAcceptanceEnvironment",
    "runWindowsAcceptanceCli",
    'flag: "wx"',
    "receipt must be written outside the checkout",
    'environment.DOCKER_HOST ?? "npipe:////./pipe/docker_engine"',
    '"https://registry.npmjs.org/"',
    `writeFile(path.join(dockerConfig, "config.json"), '{"auths":{}}\\n'`,
    "NPM_CONFIG_USERCONFIG:",
    "NPM_CONFIG_GLOBALCONFIG:",
    "NPM_CONFIG_CACHE:",
    "await rm(root, { recursive: true, force: true })",
    'command: "taskkill.exe"',
    'args: ["/PID", String(pid), "/T", "/F"]',
    'child.kill("SIGKILL")',
    "killWindowsAcceptanceProcess(child)",
  ];
  for (const fragment of required) {
    if (!source.includes(fragment)) {
      errors.push(`windows_acceptance_support_contract_missing:${fragment}`);
    }
  }
}

function cleanupFragments() {
  return [
    'name=napier-"',
    'name=napier-network-"',
    "reference=napier-windows-acceptance:*",
    "napier-sandbox:0.1.0",
    "^napier-process-sandbox-",
    "^napier-product-acceptance-",
    "^napier-windows-host-environment-",
    "git.exe reset --hard HEAD",
    "git.exe clean -ffdx",
    "IMAGE_BASELINE_PATH",
    "CONTROL_DOCKER_CONFIG",
    "Remove-Item Env:DOCKER_AUTH_CONFIG",
    "$env:DOCKER_CONFIG = $env:CONTROL_DOCKER_CONFIG",
    'docker.exe image ls --all --no-trunc --format "{{.ID}}"',
  ];
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function runCli() {
  const result = await auditWindowsHostProductAcceptanceWorkflow();
  if (!result.valid) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Windows host product acceptance workflow verified: ${result.path}`,
  );
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  await runCli();
}
