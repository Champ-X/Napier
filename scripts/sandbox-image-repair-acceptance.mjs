import { execFile as execFileWithCallback } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import { resolveContainerLaunchExecutable } from "../packages/runtime/dist/sandbox-container.js";
import {
  createSandboxFirstUseEnvironment,
  currentDockerHost,
  firstUseResourceDelta,
  pathExists,
  requireFirstUseValue,
  runFirstUseSingleJsonCli,
  snapshotFirstUseResources,
  withFirstUseProcessEnvironment,
} from "./sandbox-first-use-coding-support.mjs";

const execFile = promisify(execFileWithCallback);
const OFFICIAL_IMAGE = "napier-sandbox:0.1.0";
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

export async function runSandboxImageRepairAcceptance(input) {
  const root = await mkdtemp(
    path.join(acceptanceRoot(), ".napier-image-repair-"),
  );
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "state");
  const temporary = path.join(root, "temp");
  const fakeContext = path.join(root, "fake-image");
  const executable = await resolveContainerLaunchExecutable(undefined);
  const dockerHost = await currentDockerHost(executable);
  const environment = await createSandboxFirstUseEnvironment(
    process.env,
    root,
    dockerHost,
  );
  let result;
  try {
    await Promise.all([
      mkdir(workspaceRoot, { recursive: true }),
      mkdir(temporary, { recursive: true }),
      mkdir(fakeContext, { recursive: true }),
    ]);
    result = await withFirstUseProcessEnvironment(environment, async () => {
      const baseline = await snapshotRepairResources(
        executable,
        temporary,
        environment,
      );
      const originalImageId = await imageId(executable, environment, OFFICIAL_IMAGE);
      const backupTag = `napier-sandbox:repair-backup-${randomBytes(8).toString("hex")}`;
      let receipt;
      try {
        await docker(executable, ["image", "tag", OFFICIAL_IMAGE, backupTag], environment);
        await writeFile(
          path.join(fakeContext, "Dockerfile"),
          [
            `FROM ${backupTag}`,
            "RUN rm -rf /opt/napier/node_modules/typescript-language-server",
            "",
          ].join("\n"),
          { flag: "wx", mode: 0o600 },
        );
        await docker(
          executable,
          [
            "build",
            "--pull=false",
            "--network=none",
            "--tag",
            OFFICIAL_IMAGE,
            fakeContext,
          ],
          environment,
          15 * 60_000,
          1024 * 1024,
        );
        const fakeImageId = await imageId(executable, environment, OFFICIAL_IMAGE);
        requireFirstUseValue(
          fakeImageId !== originalImageId,
          "Image repair fixture did not replace the official tag",
        );
        const preview = await runFirstUseSingleJsonCli(
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
          preview.code === 0 &&
            preview.value.status === "ready" &&
            preview.value.imageId === fakeImageId,
          "Image repair preview did not admit the mislabeled fixture",
        );
        const apply = await runFirstUseSingleJsonCli(
          [
            "setup",
            "--workspace",
            workspaceRoot,
            "--data-root",
            dataRoot,
            "--component",
            "sandbox",
            "--expected-preview",
            preview.value.contentSha256,
            "--apply",
            "--jsonl",
          ],
          input.repoRoot,
          environment,
        );
        const checkCodes = Object.values(apply.value.checks ?? {});
        requireFirstUseValue(
          apply.code === 0 &&
            apply.value.action === "repaired" &&
            apply.value.status === "ready" &&
            apply.value.imageId !== fakeImageId &&
            canonicalJson(checkCodes) === canonicalJson(CHECK_CODES),
          "Image repair exact apply did not rebuild and verify the toolchain",
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
        requireFirstUseValue(
          uninstall.code === 0 &&
            uninstall.value.status === "removed" &&
            uninstall.value.imageRetained === true &&
            !(await pathExists(path.join(dataRoot, "sandbox.json"))),
          "Image repair exact uninstall failed",
        );
        receipt = {
          preview: {
            status: preview.value.status,
            staticLabelAccepted: true,
            previewSha256: preview.value.contentSha256,
          },
          repair: {
            trigger: "image_toolchain_identity",
            action: apply.value.action,
            imageChanged: true,
            checkCount: checkCodes.length,
            checkCodes,
            installationSha256: apply.value.installationSha256,
            resultSha256: apply.value.contentSha256,
          },
          uninstall: {
            status: uninstall.value.status,
            imageRetained: uninstall.value.imageRetained,
            bindingRemoved: true,
            resultSha256: uninstall.value.contentSha256,
          },
        };
      } finally {
        await removeBindingIfPresent(
          input.repoRoot,
          workspaceRoot,
          dataRoot,
          environment,
        );
        await restoreImageState(
          executable,
          environment,
          baseline.imageIds,
          backupTag,
        );
      }
      const finalSnapshot = await snapshotRepairResources(
        executable,
        temporary,
        environment,
      );
      const processClosure = firstUseResourceDelta(baseline, finalSnapshot);
      const imageDeltaCount = symmetricDifference(
        baseline.imageIds,
        finalSnapshot.imageIds,
      );
      requireFirstUseValue(
        Object.values(processClosure).every((value) => value === 0) &&
          imageDeltaCount === 0 &&
          (await imageId(executable, environment, OFFICIAL_IMAGE)) ===
            originalImageId,
        "Image repair did not restore the Docker and Sandbox baseline",
      );
      return {
        ...receipt,
        resourceClosure: {
          exactBaselineRestored: true,
          ...processClosure,
          imageDeltaCount,
          originalTagRestored: true,
        },
      };
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  requireFirstUseValue(
    !(await pathExists(root)),
    "Image repair task root cleanup failed",
  );
  return { ...result, taskRootRemoved: true };
}

async function removeBindingIfPresent(repoRoot, workspaceRoot, dataRoot, env) {
  if (!(await pathExists(path.join(dataRoot, "sandbox.json")))) return;
  const preview = await runFirstUseSingleJsonCli(
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
    repoRoot,
    env,
  );
  await runFirstUseSingleJsonCli(
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
      preview.value.contentSha256,
      "--apply",
      "--jsonl",
    ],
    repoRoot,
    env,
  );
}

async function restoreImageState(executable, env, baselineIds, backupTag) {
  await docker(executable, ["image", "tag", backupTag, OFFICIAL_IMAGE], env);
  await docker(executable, ["image", "rm", backupTag], env);
  const currentIds = await imageIds(executable, env);
  for (const candidate of currentIds.filter(
    (imageIdValue) => !baselineIds.includes(imageIdValue),
  )) {
    await docker(executable, ["image", "rm", "--force", candidate], env);
  }
}

async function snapshotRepairResources(executable, scratchRoot, env) {
  return {
    ...(await snapshotFirstUseResources(executable, scratchRoot)),
    imageIds: await imageIds(executable, env),
  };
}

async function imageIds(executable, env) {
  return names(
    await docker(
      executable,
      ["image", "ls", "--all", "--no-trunc", "--quiet"],
      env,
    ),
  );
}

async function imageId(executable, env, reference) {
  return (
    await docker(
      executable,
      ["image", "inspect", "--format", "{{.Id}}", reference],
      env,
    )
  ).trim();
}

async function docker(
  executable,
  args,
  env,
  timeout = 10_000,
  maxBuffer = 128 * 1024,
) {
  return (
    await execFile(executable, args, {
      encoding: "utf8",
      env,
      timeout,
      maxBuffer,
      windowsHide: true,
    })
  ).stdout;
}

function names(text) {
  return [...new Set(text.trim().split("\n").filter(Boolean))].sort();
}

function symmetricDifference(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    left.filter((value) => !rightSet.has(value)).length +
    right.filter((value) => !leftSet.has(value)).length
  );
}

function acceptanceRoot() {
  return process.platform === "linux" ? tmpdir() : homedir();
}
