import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseDocument } from "yaml";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const WORKFLOW_PATH = ".github/workflows/publish-sandbox.yml";
const SHA = /^[a-f0-9]{40}$/u;
const REQUIRED_PERMISSIONS = {
  contents: "read",
  packages: "write",
  "id-token": "write",
};
const REQUIRED_ACTIONS = new Map([
  ["actions/checkout", "d23441a48e516b6c34aea4fa41551a30e30af803"],
  ["actions/setup-node", "249970729cb0ef3589644e2896645e5dc5ba9c38"],
  ["docker/setup-qemu-action", "c7c53464625b32c7a7e944ae62b3e17d2b600130"],
  ["docker/setup-buildx-action", "8d2750c68a42422c14e847fe6c8ac0403b4cbd6f"],
  ["docker/login-action", "c94ce9fb468520275223c153574b00df6fe4bcc9"],
  ["docker/build-push-action", "10e90e3645eae34f1e60eeb005ba3a3d33f178e8"],
  ["sigstore/cosign-installer", "d7543c93d881b35a8faa02e8e3605f69b7a1ce62"],
  ["actions/upload-artifact", "ea165f8d65b6e75b540449e92b4886f43607fa02"],
]);

export async function auditSandboxExternalReleaseWorkflow(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const workflowPath = path.join(repoRoot, WORKFLOW_PATH);
  const source = await readFile(workflowPath, "utf8");
  const document = parseDocument(source, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  const errors = document.errors.map(() => "workflow_yaml_invalid");
  const workflow = document.toJS();
  if (!record(workflow)) {
    return result(errors.concat("workflow_shape_invalid"));
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
  if (
    !record(trigger) ||
    Object.keys(trigger).join("\n") !== "workflow_dispatch"
  ) {
    errors.push("workflow_must_be_manual_only");
    return;
  }
  const inputs = trigger.workflow_dispatch?.inputs;
  const mode = inputs?.mode;
  const sourceSha = inputs?.source_sha;
  if (
    !record(mode) ||
    mode.required !== true ||
    mode.default !== "bootstrap" ||
    mode.type !== "choice" ||
    !Array.isArray(mode.options) ||
    mode.options.join("\n") !== "bootstrap\nrelease"
  ) {
    errors.push("workflow_mode_input_invalid");
  }
  if (
    !record(sourceSha) ||
    sourceSha.required !== true ||
    sourceSha.type !== "string"
  ) {
    errors.push("workflow_source_sha_input_invalid");
  }
}

function validatePermissions(value, errors) {
  if (
    !record(value) ||
    Object.keys(value).length !== Object.keys(REQUIRED_PERMISSIONS).length ||
    Object.entries(REQUIRED_PERMISSIONS).some(
      ([name, permission]) => value[name] !== permission,
    )
  ) {
    errors.push("workflow_permissions_invalid");
  }
}

function validateJob(jobs, errors) {
  const publish = jobs?.publish;
  if (
    !record(jobs) ||
    Object.keys(jobs).join("\n") !== "publish" ||
    !record(publish) ||
    publish["runs-on"] !== "ubuntu-24.04" ||
    publish["timeout-minutes"] !== 90 ||
    publish.if !==
      "github.repository == 'Champ-X/Napier' && github.ref == 'refs/heads/main'" ||
    !Array.isArray(publish.steps)
  ) {
    errors.push("workflow_publish_job_invalid");
    return;
  }
  if (!record(publish.concurrency) && publish.concurrency !== undefined) {
    errors.push("workflow_publish_concurrency_invalid");
  }
  validateStepContracts(publish.steps, errors);
}

function validateActions(jobs, errors) {
  const steps = jobs?.publish?.steps;
  if (!Array.isArray(steps)) return;
  const observed = new Map();
  for (const step of steps) {
    if (!record(step) || typeof step.uses !== "string") continue;
    const match = /^([^@]+)@([a-f0-9]{40})$/u.exec(step.uses);
    if (!match || !SHA.test(match[2])) {
      errors.push("workflow_action_not_sha_pinned");
      continue;
    }
    observed.set(match[1], match[2]);
  }
  for (const [action, sha] of REQUIRED_ACTIONS) {
    if (observed.get(action) !== sha) {
      errors.push(`workflow_action_missing:${action}`);
    }
  }
  if (observed.size !== REQUIRED_ACTIONS.size) {
    errors.push("workflow_action_set_invalid");
  }
}

function validateStepContracts(steps, errors) {
  const byName = new Map(
    steps
      .filter((step) => record(step) && typeof step.name === "string")
      .map((step) => [step.name, step]),
  );
  const releaseOnly = [
    "Publish or verify the immutable version tag",
    "Prove anonymous pull and execution",
    "Install Cosign",
    "Sign the immutable index with GitHub OIDC",
    "Create and verify the external SLSA attestation",
    "Write the external release receipt",
    "Upload release evidence",
  ];
  for (const name of releaseOnly) {
    if (byName.get(name)?.if !== "inputs.mode == 'release'") {
      errors.push(`workflow_release_condition_invalid:${name}`);
    }
  }
  if (
    byName.get("Explain the bootstrap visibility gate")?.if !==
    "inputs.mode == 'bootstrap'"
  ) {
    errors.push("workflow_bootstrap_condition_invalid");
  }
  const build = byName.get("Build and push the dual-architecture image");
  if (
    build?.if !== "steps.prepare.outputs.build_required == 'true'" ||
    build?.with?.context !== "docker/napier-sandbox" ||
    build?.with?.file !== "docker/napier-sandbox/Dockerfile" ||
    build?.with?.platforms !== "linux/amd64,linux/arm64" ||
    build?.with?.push !== true ||
    build?.with?.pull !== true ||
    build?.with?.provenance !==
      "${{ inputs.mode == 'release' && 'mode=max' || 'false' }}" ||
    build?.with?.sbom !== "${{ inputs.mode == 'release' }}"
  ) {
    errors.push("workflow_build_contract_invalid");
  }
  const upload = byName.get("Upload release evidence");
  if (
    upload?.with?.path !== "release-evidence/" ||
    upload?.with?.["if-no-files-found"] !== "error" ||
    upload?.with?.["retention-days"] !== 90
  ) {
    errors.push("workflow_evidence_upload_contract_invalid");
  }
}

function validateCommandClosure(source, errors) {
  const required = [
    "Install the transaction-capable Git runtime",
    "version=2.46.4",
    "expected_sha256=90956cd1bb92472d498370819c8f5fae4bbc7f851b989240ec416b173a44f7cb",
    "sha256sum --check",
    "symref-update HEAD refs/heads/accepted oid",
    "update-ref --no-deref --stdin",
    "npm ci --no-audit --no-fund",
    "Install Chromium host dependencies",
    "node node_modules/playwright-core/cli.js install-deps chromium",
    "Install the pinned Browser",
    "installPinnedBrowserRuntime",
    "Admit the pinned Browser to the Ubuntu user-namespace sandbox",
    "profile napier-playwright-chromium ${BROWSER_PATH} flags=(unconfined)",
    "userns,",
    "apparmor_parser -r",
    "Verify the pinned Browser through Napier",
    "--component browser",
    "--expected-preview",
    "napier.browser-runtime-setup-result",
    ".chromiumSandbox == true",
    "npm run check",
    "platforms: linux/amd64,linux/arm64",
    "provenance: ${{ inputs.mode == 'release' && 'mode=max' || 'false' }}",
    "sbom: ${{ inputs.mode == 'release' }}",
    "docker buildx imagetools inspect",
    "docker buildx imagetools create",
    'test "${existing_digest}" = "${DIGEST}"',
    'digest="${BUILT_DIGEST:-${EXISTING_DIGEST}}"',
    "attestation_count",
    "Verify authenticated platform execution",
    'docker --config "${anonymous_config}" pull --platform',
    "cosign sign",
    "--bundle release-evidence/cosign.bundle.json",
    "cosign verify",
    '--certificate-oidc-issuer "https://token.actions.githubusercontent.com"',
    ".verificationMaterial.tlogEntries",
    "cosign attest",
    "--type slsaprovenance1",
    "--predicate release-evidence/slsa-provenance-v1.json",
    "--bundle release-evidence/cosign-attestation.bundle.json",
    "cosign verify-attestation",
    "release-evidence/cosign-attestation.verify.json",
    'writeSandboxExternalPublicationReceipt("release-evidence")',
    'verifySandboxExternalPublicationEvidence("release-evidence")',
    "No release signing, external attestation, anonymous-pull, or S1 completion claim was made",
  ];
  for (const fragment of required) {
    if (!source.includes(fragment)) {
      errors.push(`workflow_contract_missing:${fragment}`);
    }
  }
  const forbidden = [
    "pull_request:",
    "schedule:",
    "COSIGN_PASSWORD",
    "cosign.key",
    "continue-on-error",
    "--insecure-ignore-tlog",
    "--insecure-skip-verify",
  ];
  for (const fragment of forbidden) {
    if (source.includes(fragment)) {
      errors.push(`workflow_forbidden_contract:${fragment}`);
    }
  }
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function runCli() {
  const result = await auditSandboxExternalReleaseWorkflow();
  if (!result.valid) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(`Sandbox external release workflow verified: ${result.path}`);
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  await runCli();
}
