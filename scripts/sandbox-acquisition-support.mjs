import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { Writable } from "node:stream";
import { promisify } from "node:util";

import { runCli } from "../apps/cli/dist/cli.js";
import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import {
  firstUseResourceDelta,
  pathExists,
  requireFirstUseValue,
  snapshotFirstUseResources,
} from "./sandbox-first-use-coding-support.mjs";

const execFile = promisify(execFileCallback);
const MAX_OUTPUT_BYTES = 1024 * 1024;
const OFFICIAL_IMAGE = "napier-sandbox:0.1.0";

export async function snapshotAcquisitionResources(
  executable,
  scratchRoot,
  environment,
) {
  const base = await snapshotFirstUseResources(executable, scratchRoot);
  const [imageIdsValue, imageReferences, containers, networks, volumes] =
    await Promise.all([
      acquisitionImageIds(executable, environment),
      dockerOutput(
        executable,
        [
          "image",
          "ls",
          "--all",
          "--digests",
          "--no-trunc",
          "--format",
          "{{.Repository}}:{{.Tag}}@{{.Digest}}={{.ID}}",
        ],
        environment,
      ).then(acquisitionNames),
      dockerOutput(
        executable,
        ["container", "ls", "--all", "--format", "{{.ID}}\t{{.Names}}"],
        environment,
      ).then(acquisitionNames),
      dockerOutput(
        executable,
        ["network", "ls", "--format", "{{.ID}}\t{{.Name}}"],
        environment,
      ).then(acquisitionNames),
      dockerOutput(
        executable,
        ["volume", "ls", "--format", "{{.Name}}"],
        environment,
      ).then(acquisitionNames),
    ]);
  return {
    ...base,
    imageIds: imageIdsValue,
    imageReferences,
    allContainers: containers,
    allNetworks: networks,
    allVolumes: volumes,
  };
}

export function acquisitionResourceClosure(before, after) {
  return {
    ...firstUseResourceDelta(before, after),
    imageDeltaCount: acquisitionSetDelta(before.imageIds, after.imageIds),
    imageReferenceDeltaCount: acquisitionSetDelta(
      before.imageReferences,
      after.imageReferences,
    ),
    allContainerDeltaCount: acquisitionSetDelta(
      before.allContainers,
      after.allContainers,
    ),
    allNetworkDeltaCount: acquisitionSetDelta(
      before.allNetworks,
      after.allNetworks,
    ),
    allVolumeDeltaCount: acquisitionSetDelta(
      before.allVolumes,
      after.allVolumes,
    ),
  };
}

export async function acquisitionImageIds(executable, environment) {
  return acquisitionNames(
    await dockerOutput(
      executable,
      ["image", "ls", "--all", "--no-trunc", "--quiet"],
      environment,
    ),
  );
}

export async function acquisitionImageId(executable, environment, reference) {
  return (
    await dockerOutput(
      executable,
      ["image", "inspect", "--format", "{{.Id}}", reference],
      environment,
    )
  ).trim();
}

export async function restoreAcquisitionImage(
  executable,
  environment,
  backupTag,
) {
  if (!backupTag) return;
  await dockerOutput(
    executable,
    ["image", "tag", backupTag, OFFICIAL_IMAGE],
    environment,
  );
  await dockerOutput(executable, ["image", "rm", backupTag], environment);
}

export async function removeAcquisitionResources(
  executable,
  environment,
  baseline,
  containerNames,
) {
  for (const name of containerNames) {
    await optionalDockerOutput(
      executable,
      ["container", "rm", "--force", name],
      environment,
    );
  }
  const currentIds = await acquisitionImageIds(executable, environment);
  for (const candidate of currentIds.filter(
    (imageIdValue) => !baseline.imageIds.includes(imageIdValue),
  )) {
    await optionalDockerOutput(
      executable,
      ["image", "rm", "--force", candidate],
      environment,
    );
  }
}

export async function dockerOutput(
  executable,
  args,
  environment,
  timeout = 30_000,
) {
  return (
    await execFile(executable, args, {
      encoding: "utf8",
      env: environment,
      timeout,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
    })
  ).stdout;
}

export async function optionalDockerOutput(executable, args, environment) {
  await dockerOutput(executable, args, environment).catch(() => "");
}

export async function runAcquisitionSetupCli(input) {
  const stdout = new CaptureWritable();
  const stderr = new CaptureWritable();
  const code = await runCli(
    [
      "setup",
      "--workspace",
      input.workspaceRoot,
      "--data-root",
      input.dataRoot,
      "--component",
      "sandbox",
      ...input.args,
      "--jsonl",
    ],
    {
      cwd: input.repoRoot,
      env: input.environment,
      stdout,
      stderr,
    },
    {
      sandboxSetup: {
        loadRelease: async (contextSha256) => {
          requireFirstUseValue(
            contextSha256 === input.release.contextSha256,
            "Sandbox release context changed during setup",
          );
          return input.release;
        },
      },
    },
  );
  const lines = stdout.text.trim().split("\n").filter(Boolean);
  requireFirstUseValue(
    stderr.text === "" && lines.length === 1,
    "Sandbox acquisition CLI output was invalid",
  );
  return { code, value: JSON.parse(lines[0]) };
}

export async function exactAcquisitionUninstall(input) {
  const release = { contextSha256: "", reference: "", digest: "" };
  const preview = await runAcquisitionSetupCli({
    ...input,
    release,
    args: ["--uninstall"],
  });
  const result = await runAcquisitionSetupCli({
    ...input,
    release,
    args: [
      "--uninstall",
      "--expected-preview",
      preview.value.contentSha256,
      "--apply",
    ],
  });
  requireFirstUseValue(
    result.code === 0 &&
      result.value.status === "removed" &&
      !(await pathExists(path.join(input.dataRoot, "sandbox.json"))),
    "Sandbox acquisition exact uninstall failed",
  );
  return result;
}

export async function acquisitionRegistryPort(executable, environment, name) {
  const output = await dockerOutput(
    executable,
    ["port", name, "5000/tcp"],
    environment,
  );
  const match = /:([0-9]{2,5})$/u.exec(output.trim());
  requireFirstUseValue(
    Boolean(match),
    "Sandbox local registry port is invalid",
  );
  return match[1];
}

export async function acquisitionRepoDigest(
  executable,
  environment,
  reference,
) {
  const output = await dockerOutput(
    executable,
    ["image", "inspect", "--format", "{{index .RepoDigests 0}}", reference],
    environment,
  );
  requireFirstUseValue(
    /^127\.0\.0\.1:[0-9]+\/napier-sandbox@sha256:[a-f0-9]{64}$/u.test(
      output.trim(),
    ),
    "Sandbox local registry digest is invalid",
  );
  return output.trim();
}

export function privateAcquisitionCandidate(input) {
  const reference = input.privateReference;
  const match =
    /^ghcr\.io\/champ-x\/napier-sandbox@(sha256:[a-f0-9]{64})$/u.exec(
      reference ?? "",
    );
  requireFirstUseValue(
    Boolean(match) && /^[a-f0-9]{40}$/u.test(input.privateSourceSha ?? ""),
    "Sandbox private release candidate is invalid",
  );
  const release = {
    image: "ghcr.io/champ-x/napier-sandbox",
    version: "0.1.0",
    digest: match[1],
    reference,
    sourceSha: input.privateSourceSha,
    contextSha256: input.contextSha256,
    receiptSha256: sha256(
      canonicalJson({
        kind: "napier.private-bootstrap-candidate",
        reference,
        sourceSha: input.privateSourceSha,
        contextSha256: input.contextSha256,
      }),
    ),
    platforms: ["linux/amd64", "linux/arm64"],
  };
  return {
    release,
    candidateSha256: sha256(
      canonicalJson({
        reference,
        sourceSha: input.privateSourceSha,
        contextSha256: input.contextSha256,
      }),
    ),
  };
}

export function acquisitionNames(value) {
  return [...new Set(value.trim().split("\n").filter(Boolean))].sort();
}

function acquisitionSetDelta(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    left.filter((value) => !rightSet.has(value)).length +
    right.filter((value) => !leftSet.has(value)).length
  );
}

class CaptureWritable extends Writable {
  text = "";

  _write(chunk, _encoding, callback) {
    this.text += chunk.toString();
    callback(
      Buffer.byteLength(this.text) > MAX_OUTPUT_BYTES
        ? new Error("Sandbox acquisition CLI output exceeded its limit")
        : undefined,
    );
  }
}
