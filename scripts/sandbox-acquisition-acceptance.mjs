import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import { resolveContainerLaunchExecutable } from "../packages/runtime/dist/sandbox-container.js";
import { loadSandboxInstallation } from "../packages/runtime/dist/sandbox-installation.js";
import { inspectOfficialSandboxRuntime } from "../packages/runtime/dist/sandbox-runtime-setup.js";
import {
  createSandboxFirstUseEnvironment,
  currentDockerHost,
  pathExists,
  requireFirstUseValue,
  withFirstUseProcessEnvironment,
} from "./sandbox-first-use-coding-support.mjs";
import {
  acquisitionImageId,
  acquisitionRegistryPort,
  acquisitionResourceClosure,
  acquisitionRepoDigest,
  dockerOutput,
  exactAcquisitionUninstall,
  optionalDockerOutput,
  privateAcquisitionCandidate,
  removeAcquisitionResources,
  restoreAcquisitionImage,
  runAcquisitionSetupCli,
  snapshotAcquisitionResources,
} from "./sandbox-acquisition-support.mjs";

const OFFICIAL_IMAGE = "napier-sandbox:0.1.0";
const REGISTRY_IMAGE =
  "registry:2.8.3@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373";
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

export async function runSandboxAcquisitionAcceptance(input) {
  const privateCandidate = privateAcquisitionCandidate(input);
  const executable = await resolveContainerLaunchExecutable(undefined);
  const dockerHost = await currentDockerHost(executable);
  const taskRoot = await mkdtemp(
    path.join(homedir(), ".napier-sandbox-acquisition-"),
  );
  const workspaceRoot = path.join(taskRoot, "workspace");
  const dataRoot = path.join(taskRoot, "state");
  const temporary = path.join(taskRoot, "temp");
  const contextRoot = path.join(taskRoot, "release-image");
  const environment = await createSandboxFirstUseEnvironment(
    process.env,
    taskRoot,
    dockerHost,
  );
  let result;
  try {
    await Promise.all([
      mkdir(workspaceRoot, { recursive: true }),
      mkdir(dataRoot, { recursive: true }),
      mkdir(temporary, { recursive: true }),
      mkdir(contextRoot, { recursive: true }),
    ]);
    result = await withFirstUseProcessEnvironment(environment, async () => {
      const baseline = await snapshotAcquisitionResources(
        executable,
        temporary,
        environment,
      );
      const originalImageId = await acquisitionImageId(
        executable,
        environment,
        OFFICIAL_IMAGE,
      );
      let localBackupTag;
      let privateBackupTag;
      const ownedContainers = [];
      let localAnonymous;
      let privateFallback;
      try {
        localAnonymous = await runLocalAnonymousArm({
          repoRoot: input.repoRoot,
          executable,
          environment,
          workspaceRoot,
          dataRoot,
          contextRoot,
          setBackupTag: (value) => {
            localBackupTag = value;
          },
          registerContainer: (value) => {
            ownedContainers.push(value);
          },
        });
        await restoreAcquisitionImage(executable, environment, localBackupTag);
        localBackupTag = undefined;
        await removeAcquisitionResources(
          executable,
          environment,
          baseline,
          ownedContainers,
        );
        ownedContainers.length = 0;
        privateFallback = await runPrivateFallbackArm({
          repoRoot: input.repoRoot,
          executable,
          environment,
          workspaceRoot,
          dataRoot,
          release: privateCandidate.release,
          setBackupTag: (value) => {
            privateBackupTag = value;
          },
        });
        await restoreAcquisitionImage(
          executable,
          environment,
          privateBackupTag,
        );
        privateBackupTag = undefined;
      } finally {
        let cleanupFailure;
        for (const backupTag of [localBackupTag, privateBackupTag]) {
          await restoreAcquisitionImage(
            executable,
            environment,
            backupTag,
          ).catch((error) => {
            cleanupFailure ??= error;
          });
        }
        await removeAcquisitionResources(
          executable,
          environment,
          baseline,
          ownedContainers,
        ).catch((error) => {
          cleanupFailure ??= error;
        });
        if (cleanupFailure) throw cleanupFailure;
      }
      const finalSnapshot = await snapshotAcquisitionResources(
        executable,
        temporary,
        environment,
      );
      const resourceClosure = acquisitionResourceClosure(
        baseline,
        finalSnapshot,
      );
      requireFirstUseValue(
        Object.values(resourceClosure).every((value) => value === 0) &&
          (await acquisitionImageId(
            executable,
            environment,
            OFFICIAL_IMAGE,
          )) === originalImageId,
        "Sandbox acquisition did not restore the Docker baseline",
      );
      return {
        localAnonymous: localAnonymous.receipt,
        privateFallback: {
          ...privateFallback.receipt,
          candidateDigest: privateCandidate.release.digest,
          candidateSourceSha: privateCandidate.release.sourceSha,
          candidateContextSha256: privateCandidate.release.contextSha256,
          candidateSha256: privateCandidate.candidateSha256,
        },
        resourceClosure: {
          exactBaselineRestored: true,
          ...resourceClosure,
          originalTagRestored: true,
        },
      };
    });
  } finally {
    await rm(taskRoot, { recursive: true, force: true });
  }
  requireFirstUseValue(
    !(await pathExists(taskRoot)),
    "Sandbox acquisition task root cleanup failed",
  );
  return { ...result, taskRootRemoved: true };
}

async function runLocalAnonymousArm(input) {
  const backupTag = backupReference("local");
  input.setBackupTag(backupTag);
  const registryName = `napier-acquisition-registry-${randomBytes(8).toString("hex")}`;
  input.registerContainer(registryName);
  const localSourceSha = sha256(
    canonicalJson({
      kind: "napier.local-anonymous-sandbox-release",
      contextSha256: (
        await inspectOfficialSandboxRuntime({
          loadRelease: async () => undefined,
        })
      ).target.contextSha256,
    }),
  ).slice(0, 40);
  const contextSha256 = (
    await inspectOfficialSandboxRuntime({ loadRelease: async () => undefined })
  ).target.contextSha256;
  await dockerOutput(
    input.executable,
    ["image", "tag", OFFICIAL_IMAGE, backupTag],
    input.environment,
  );
  await ensurePinnedRegistryImage(input.executable, input.environment);
  await dockerOutput(
    input.executable,
    [
      "run",
      "--detach",
      "--name",
      registryName,
      "--publish",
      "127.0.0.1::5000",
      "--tmpfs",
      "/var/lib/registry:rw,noexec,nosuid,nodev,size=256m",
      REGISTRY_IMAGE,
    ],
    input.environment,
  );
  const port = await acquisitionRegistryPort(
    input.executable,
    input.environment,
    registryName,
  );
  const tag = `127.0.0.1:${port}/napier-sandbox:stage20`;
  await writeFile(
    path.join(input.contextRoot, "Dockerfile"),
    [
      `FROM ${backupTag}`,
      `LABEL io.napier.sandbox.context-sha256="${contextSha256}"`,
      `LABEL org.opencontainers.image.revision="${localSourceSha}"`,
      "",
    ].join("\n"),
    { mode: 0o600, flag: "wx" },
  );
  await dockerOutput(
    input.executable,
    [
      "build",
      "--pull=false",
      "--network=none",
      "--tag",
      tag,
      input.contextRoot,
    ],
    input.environment,
    15 * 60_000,
  );
  await dockerOutput(
    input.executable,
    ["push", tag],
    input.environment,
    5 * 60_000,
  );
  const pushed = await acquisitionRepoDigest(
    input.executable,
    input.environment,
    tag,
  );
  const digest = pushed.slice(pushed.indexOf("@") + 1);
  const release = {
    image: "ghcr.io/champ-x/napier-sandbox",
    version: "0.1.0",
    digest,
    reference: `127.0.0.1:${port}/napier-sandbox@${digest}`,
    sourceSha: localSourceSha,
    contextSha256,
    receiptSha256: sha256(
      canonicalJson({ digest, localSourceSha, contextSha256 }),
    ),
    platforms: ["linux/amd64", "linux/arm64"],
  };
  await optionalDockerOutput(
    input.executable,
    ["image", "rm", release.reference],
    input.environment,
  );
  await dockerOutput(
    input.executable,
    ["image", "rm", "--force", tag],
    input.environment,
  );
  await dockerOutput(
    input.executable,
    ["image", "rm", OFFICIAL_IMAGE],
    input.environment,
  );
  const preview = await runAcquisitionSetupCli({
    ...input,
    release,
    args: [],
  });
  requireFirstUseValue(
    preview.code === 0 &&
      preview.value.status === "pullable" &&
      preview.value.acquisition === "external_release" &&
      preview.value.releaseDigest === digest,
    "Sandbox local release preview was not pullable",
  );
  const apply = await runAcquisitionSetupCli({
    ...input,
    release,
    args: ["--expected-preview", preview.value.contentSha256, "--apply"],
  });
  const installation = await loadSandboxInstallation(input.dataRoot);
  const checkCodes = Object.values(apply.value.checks ?? {});
  requireFirstUseValue(
    apply.code === 0 &&
      apply.value.action === "pulled" &&
      apply.value.acquisition === "external_release" &&
      canonicalJson(checkCodes) === canonicalJson(CHECK_CODES) &&
      installation?.schemaVersion === 2 &&
      installation.acquisition === "external_release" &&
      installation.releaseDigest === digest,
    "Sandbox local anonymous release did not pass production verification",
  );
  const uninstall = await exactAcquisitionUninstall(input);
  return {
    receipt: {
      transport: "loopback_registry",
      anonymousPull: true,
      action: apply.value.action,
      acquisition: apply.value.acquisition,
      immutableDigest: true,
      sourceLabelVerified: true,
      contextLabelVerified: true,
      checkCount: checkCodes.length,
      checkCodes,
      bindingSchemaVersion: installation.schemaVersion,
      installationSha256: apply.value.installationSha256,
      resultSha256: apply.value.contentSha256,
      uninstallStatus: uninstall.value.status,
      bindingRemoved: true,
    },
  };
}

async function runPrivateFallbackArm(input) {
  const backupTag = backupReference("private");
  input.setBackupTag(backupTag);
  await dockerOutput(
    input.executable,
    ["image", "tag", OFFICIAL_IMAGE, backupTag],
    input.environment,
  );
  await dockerOutput(
    input.executable,
    ["image", "rm", OFFICIAL_IMAGE],
    input.environment,
  );
  const preview = await runAcquisitionSetupCli({
    ...input,
    args: [],
  });
  requireFirstUseValue(
    preview.code === 0 &&
      preview.value.status === "pullable" &&
      preview.value.acquisition === "external_release",
    "Sandbox private release preview was not pullable",
  );
  const apply = await runAcquisitionSetupCli({
    ...input,
    args: ["--expected-preview", preview.value.contentSha256, "--apply"],
  });
  const installation = await loadSandboxInstallation(input.dataRoot);
  const checkCodes = Object.values(apply.value.checks ?? {});
  requireFirstUseValue(
    apply.code === 0 &&
      apply.value.action === "built" &&
      apply.value.acquisition === "packaged_source" &&
      !("releaseDigest" in apply.value) &&
      canonicalJson(checkCodes) === canonicalJson(CHECK_CODES) &&
      installation?.schemaVersion === 2 &&
      installation.acquisition === "packaged_source" &&
      installation.releaseDigest === undefined,
    "Sandbox private release did not fall back to verified source",
  );
  const uninstall = await exactAcquisitionUninstall(input);
  return {
    receipt: {
      transport: "private_ghcr",
      anonymousPullUnavailable: true,
      action: apply.value.action,
      acquisition: apply.value.acquisition,
      releaseProvenanceRetained: false,
      checkCount: checkCodes.length,
      checkCodes,
      bindingSchemaVersion: installation.schemaVersion,
      installationSha256: apply.value.installationSha256,
      resultSha256: apply.value.contentSha256,
      uninstallStatus: uninstall.value.status,
      bindingRemoved: true,
    },
  };
}

function backupReference(label) {
  return `napier-sandbox:stage20-${label}-${randomBytes(8).toString("hex")}`;
}

export async function ensurePinnedRegistryImage(
  executable,
  environment,
  runDocker = dockerOutput,
) {
  try {
    await runDocker(
      executable,
      ["image", "inspect", REGISTRY_IMAGE],
      environment,
    );
  } catch {
    await runDocker(
      executable,
      ["pull", REGISTRY_IMAGE],
      environment,
      5 * 60_000,
    );
  }
}
