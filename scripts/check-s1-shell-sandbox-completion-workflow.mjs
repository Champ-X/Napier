import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseDocument } from "yaml";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const WORKFLOW_PATH = ".github/workflows/s1-shell-sandbox-completion.yml";
const SHA = /^[a-f0-9]{40}$/u;
const REQUIRED_ACTIONS = new Map([
  ["actions/checkout", "d23441a48e516b6c34aea4fa41551a30e30af803"],
  ["actions/setup-node", "249970729cb0ef3589644e2896645e5dc5ba9c38"],
  ["actions/download-artifact", "d3f86a106a0bac45b974a628896c90dbdf5c8093"],
  ["actions/upload-artifact", "ea165f8d65b6e75b540449e92b4886f43607fa02"],
]);

export async function auditS1ShellSandboxCompletionWorkflow(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const source = await readFile(path.join(repoRoot, WORKFLOW_PATH), "utf8");
  const document = parseDocument(source, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  const errors = document.errors.map(
    () => "s1_completion_workflow_yaml_invalid",
  );
  const workflow = document.toJS();
  if (!record(workflow)) {
    return result(errors.concat("s1_completion_workflow_shape_invalid"));
  }
  validateTrigger(workflow, errors);
  validatePermissions(workflow.permissions, errors);
  validateJob(workflow.jobs, errors);
  validateActions(workflow.jobs, errors);
  validateCommandClosure(source, errors);
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
  if (
    !record(trigger) ||
    Object.keys(trigger).join("\n") !== "workflow_dispatch"
  ) {
    errors.push("s1_completion_workflow_must_be_manual_only");
    return;
  }
  for (const name of [
    "source_sha",
    "release_source_sha",
    "external_publication_run_id",
    "windows_host_run_id",
  ]) {
    const input = inputs?.[name];
    if (!record(input) || input.required !== true || input.type !== "string") {
      errors.push(`s1_completion_workflow_input_invalid:${name}`);
    }
  }
  if (
    !record(inputs) ||
    Object.keys(inputs).join("\n") !==
      "source_sha\nrelease_source_sha\nexternal_publication_run_id\nwindows_host_run_id"
  ) {
    errors.push("s1_completion_workflow_input_set_invalid");
  }
}

function validatePermissions(value, errors) {
  if (
    !record(value) ||
    Object.keys(value).join("\n") !== "actions\ncontents" ||
    value.actions !== "read" ||
    value.contents !== "read"
  ) {
    errors.push("s1_completion_workflow_permissions_invalid");
  }
}

function validateJob(jobs, errors) {
  const complete = jobs?.complete;
  if (
    !record(jobs) ||
    Object.keys(jobs).join("\n") !== "complete" ||
    !record(complete) ||
    complete.if !==
      "github.repository == 'Champ-X/Napier' && github.ref == 'refs/heads/main'" ||
    complete["runs-on"] !== "ubuntu-24.04" ||
    complete["timeout-minutes"] !== 20 ||
    !Array.isArray(complete.steps)
  ) {
    errors.push("s1_completion_workflow_job_invalid");
    return;
  }
  const byName = new Map(
    complete.steps
      .filter((step) => record(step) && typeof step.name === "string")
      .map((step) => [step.name, step]),
  );
  const checkout = byName.get("Check out the exact source");
  if (
    checkout?.with?.ref !== "${{ inputs.source_sha }}" ||
    checkout?.with?.["fetch-depth"] !== 0 ||
    checkout?.with?.["persist-credentials"] !== false
  ) {
    errors.push("s1_completion_workflow_checkout_invalid");
  }
  const external = byName.get(
    "Download the exact external publication evidence",
  );
  const windows = byName.get("Download the exact Windows host receipt");
  const authority = byName.get(
    "Verify exact upstream workflow run authorities",
  );
  if (
    authority?.env?.GITHUB_TOKEN !== "${{ github.token }}" ||
    authority?.env?.SOURCE_SHA !== "${{ inputs.source_sha }}" ||
    authority?.env?.RELEASE_SOURCE_SHA !== "${{ inputs.release_source_sha }}" ||
    authority?.env?.EXTERNAL_PUBLICATION_RUN_ID !==
      "${{ inputs.external_publication_run_id }}" ||
    authority?.env?.WINDOWS_HOST_RUN_ID !== "${{ inputs.windows_host_run_id }}"
  ) {
    errors.push("s1_completion_workflow_authority_env_invalid");
  }
  validateDownload(
    external,
    "sandbox-external-publication-${{ inputs.release_source_sha }}",
    "${{ inputs.external_publication_run_id }}",
    "upstream/external-publication",
    errors,
    "external",
  );
  validateDownload(
    windows,
    "napier-windows-host-product-acceptance-${{ inputs.source_sha }}",
    "${{ inputs.windows_host_run_id }}",
    "upstream/windows-host",
    errors,
    "windows",
  );
  const upload = byName.get("Upload the completed S1 receipt");
  if (
    upload?.with?.name !==
      "napier-s1-shell-sandbox-completion-${{ inputs.source_sha }}" ||
    upload?.with?.path !== "completion-output/" ||
    upload?.with?.["if-no-files-found"] !== "error" ||
    upload?.with?.["retention-days"] !== 90
  ) {
    errors.push("s1_completion_workflow_upload_invalid");
  }
  if (
    byName.get("Remove downloaded and generated evidence")?.if !== "always()"
  ) {
    errors.push("s1_completion_workflow_cleanup_invalid");
  }
}

function validateDownload(step, name, runId, artifactPath, errors, label) {
  if (
    step?.with?.name !== name ||
    step?.with?.path !== artifactPath ||
    step?.with?.repository !== "Champ-X/Napier" ||
    step?.with?.["run-id"] !== runId ||
    step?.with?.["github-token"] !== "${{ github.token }}"
  ) {
    errors.push(`s1_completion_workflow_${label}_download_invalid`);
  }
}

function validateActions(jobs, errors) {
  const steps = jobs?.complete?.steps;
  if (!Array.isArray(steps)) return;
  const observed = new Map();
  for (const step of steps) {
    if (!record(step) || typeof step.uses !== "string") continue;
    const match = /^([^@]+)@([a-f0-9]{40})$/u.exec(step.uses);
    if (!match || !SHA.test(match[2])) {
      errors.push("s1_completion_workflow_action_not_sha_pinned");
      continue;
    }
    if (observed.has(match[1]) && observed.get(match[1]) !== match[2]) {
      errors.push(`s1_completion_workflow_action_version_drift:${match[1]}`);
    }
    observed.set(match[1], match[2]);
  }
  for (const [action, sha] of REQUIRED_ACTIONS) {
    if (observed.get(action) !== sha) {
      errors.push(`s1_completion_workflow_action_missing:${action}`);
    }
  }
  if (observed.size !== REQUIRED_ACTIONS.size) {
    errors.push("s1_completion_workflow_action_set_invalid");
  }
}

function validateCommandClosure(source, errors) {
  const required = [
    '[[ "${SOURCE_SHA}" =~ ^[a-f0-9]{40}$ ]]',
    '[[ "${RELEASE_SOURCE_SHA}" =~ ^[a-f0-9]{40}$ ]]',
    '[[ "${EXTERNAL_PUBLICATION_RUN_ID}" =~ ^[1-9][0-9]*$ ]]',
    '[[ "${WINDOWS_HOST_RUN_ID}" =~ ^[1-9][0-9]*$ ]]',
    'test "${GITHUB_SHA}" = "${SOURCE_SHA}"',
    'test "$(git rev-parse HEAD)" = "${SOURCE_SHA}"',
    'test "$(git rev-parse origin/main)" = "${SOURCE_SHA}"',
    'git merge-base --is-ancestor "${RELEASE_SOURCE_SHA}" "${SOURCE_SHA}"',
    "npm ci --no-audit --no-fund",
    "npm run check:s1-shell-sandbox-completion",
    "Verify exact upstream workflow run authorities",
    "https://api.github.com/repos/Champ-X/Napier/actions/runs/${run_id}",
    "https://api.github.com/repos/Champ-X/Napier/actions/runs/${run_id}/artifacts?per_page=100",
    "printf 'header = \"Accept: application/vnd.github+json\"\\n'",
    'printf \'header = "Authorization: Bearer %s"\\n\' "${GITHUB_TOKEN}"',
    "printf 'header = \"X-GitHub-Api-Version: 2022-11-28\"\\n'",
    "--config -",
    "scripts/check-s1-upstream-run-authority.mjs",
    '--authority "${authority}"',
    'authority_source_sha="$3"',
    '--source-sha "${authority_source_sha}"',
    '--source-sha "${SOURCE_SHA}"',
    '--expected-run-id "${run_id}"',
    '--run-path "${run_path}"',
    '--artifacts-path "${artifacts_path}"',
    '--output-path "${output_path}"',
    "cleanup_raw_authority() {",
    "rm -f upstream/authority/*-run.json",
    "rm -f upstream/authority/*-artifacts.json",
    "trap cleanup_raw_authority EXIT",
    'rm -f "${run_path}" "${artifacts_path}"',
    "external_publication",
    "windows_host_product_acceptance",
    "sandbox-external-publication-${{ inputs.release_source_sha }}",
    "napier-windows-host-product-acceptance-${{ inputs.source_sha }}",
    "run-id: ${{ inputs.external_publication_run_id }}",
    "run-id: ${{ inputs.windows_host_run_id }}",
    "scripts/check-s1-shell-sandbox-completion.mjs",
    "Build the promoted Runtime package",
    "npm run build:core",
    '--source-sha "${SOURCE_SHA}"',
    '--release-source-sha "${RELEASE_SOURCE_SHA}"',
    '--external-publication-run-id "${{ inputs.external_publication_run_id }}"',
    '--windows-host-run-id "${{ inputs.windows_host_run_id }}"',
    "--external-publication-authority upstream/authority/external_publication.json",
    "--windows-host-authority upstream/authority/windows_host_product_acceptance.json",
    "--external-publication-dir upstream/external-publication",
    "--windows-receipt upstream/windows-host/napier-windows-host-product-acceptance.json",
    "--completion-path completion-output/s1-shell-sandbox-completion.json",
    "completion-output/external-publication-run-authority.json",
    "completion-output/windows-host-run-authority.json",
    '.status == "complete"',
    ".scope.s1Complete == true",
    "(.blockers | length) == 0",
    "rm -rf upstream completion-output",
  ];
  for (const fragment of required) {
    if (!source.includes(fragment)) {
      errors.push(`s1_completion_workflow_contract_missing:${fragment}`);
    }
  }
  const forbidden = [
    "push:",
    "pull_request:",
    "schedule:",
    "contents: write",
    "actions: write",
    "packages:",
    "id-token:",
    "continue-on-error",
    "workflow_run",
    "conclusion == 'success'",
    "api.github.com/graphql",
    "actions/runs?workflow",
    "secrets.",
    "echo ${GITHUB_TOKEN}",
    '--header "Authorization:',
    '-H "Authorization:',
  ];
  for (const fragment of forbidden) {
    if (source.includes(fragment)) {
      errors.push(`s1_completion_workflow_forbidden:${fragment}`);
    }
  }
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function runCli() {
  const result = await auditS1ShellSandboxCompletionWorkflow();
  if (!result.valid) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(`S1 Shell/Sandbox completion workflow verified: ${result.path}`);
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  await runCli();
}
