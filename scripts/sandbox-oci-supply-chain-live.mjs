import { execFile as execFileWithCallback } from "node:child_process";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";
import { inspectSandboxOciLayout } from "./sandbox-oci-layout-verification.mjs";
import {
  attestSandboxOciPublication,
  signSandboxOciPublication,
} from "./sandbox-oci-signing.mjs";

const execFile = promisify(execFileWithCallback);
const PLATFORMS = ["linux/amd64", "linux/arm64"];
const BUILD_TIMEOUT_MS = 15 * 60 * 1_000;
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 128 * 1024;

export async function runSandboxOciSupplyChainAcceptance(input) {
  const docker = input.dependencies?.docker ?? runDocker;
  const snapshot = input.dependencies?.snapshot ?? snapshotResources;
  const baseline = await snapshot(docker);
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "napier-oci-supply-chain-"),
  );
  let result;
  let failure;
  try {
    const layoutRoot = path.join(temporaryRoot, "layout");
    const builder = await inspectBuilder(docker);
    const startedAt = new Date();
    const build = await docker(
      [
        "buildx",
        "build",
        "--platform",
        PLATFORMS.join(","),
        "--output",
        `type=oci,dest=${layoutRoot},tar=false`,
        "--provenance=false",
        "--sbom=false",
        "--quiet",
        "--label",
        `io.napier.sandbox.context-sha256=${input.source.contextSha256}`,
        path.join(input.repoRoot, "docker/napier-sandbox"),
      ],
      {
        timeoutMs: BUILD_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        allowStderr: true,
      },
    );
    const finishedAt = new Date();
    const publication = await inspectSandboxOciLayout(layoutRoot, input.source);
    const signing = signSandboxOciPublication(publication, input.source);
    const attestation = attestSandboxOciPublication({
      publication,
      source: input.source,
      builder,
      startedAt,
      finishedAt,
      signing,
    });
    result = {
      builder,
      publication: {
        ...publication,
        buildStatus: "passed",
        buildOutputSha256: sha256(build.output),
        buildOutputBytes: Buffer.byteLength(build.output, "utf8"),
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      },
      signing,
      attestation,
    };
  } catch (error) {
    failure = error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true }).catch((error) => {
      failure ??= error;
    });
  }
  const [finalSnapshot, temporaryRootRemoved] = await Promise.all([
    snapshot(docker),
    access(temporaryRoot).then(
      () => false,
      () => true,
    ),
  ]);
  const delta = resourceDelta(baseline, finalSnapshot);
  if (
    Object.values(delta).some((count) => count !== 0) ||
    !temporaryRootRemoved
  ) {
    failure ??= new Error(
      "Sandbox OCI supply-chain acceptance did not restore resources",
    );
  }
  if (failure) throw failure;
  return {
    ...result,
    resourceClosure: {
      exactBaselineRestored: true,
      ...delta,
      temporaryRootRemoved,
    },
  };
}

async function inspectBuilder(docker) {
  const [version, inspect] = await Promise.all([
    docker(["buildx", "version"], {
      timeoutMs: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      requireStdout: true,
    }),
    docker(["buildx", "inspect"], {
      timeoutMs: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      requireStdout: true,
    }),
  ]);
  const buildxVersion = version.output.match(
    /\b(v[0-9]+\.[0-9]+\.[0-9]+(?:[-.][A-Za-z0-9]+)*)/u,
  )?.[1];
  const driver = inspect.output.match(/^Driver:\s+(\S+)$/mu)?.[1];
  const buildkitVersion = inspect.output.match(
    /^BuildKit version:\s+(\S+)$/mu,
  )?.[1];
  const supported = (inspect.output.match(/^Platforms:\s+(.+)$/mu)?.[1] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    !buildxVersion ||
    !buildkitVersion ||
    !["docker", "docker-container"].includes(driver ?? "") ||
    PLATFORMS.some((platform) => !supported.includes(platform))
  ) {
    throw new Error("Local BuildKit cannot publish the required OCI layout");
  }
  const content = {
    driver,
    buildxVersion,
    buildkitVersion,
    supportedPlatforms: [...PLATFORMS],
    outputType: "oci-layout",
    externalRegistryPublished: false,
  };
  return {
    ...content,
    identitySha256: sha256(canonicalJson(content)),
  };
}

async function snapshotResources(docker) {
  const [containers, networks, images, scratch] = await Promise.all([
    docker(["container", "ls", "--all", "--format", "{{.Names}}"], {
      timeoutMs: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    }),
    docker(["network", "ls", "--format", "{{.Name}}"], {
      timeoutMs: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    }),
    docker(["image", "ls", "--format", "{{.Repository}}:{{.Tag}}"], {
      timeoutMs: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    }),
    readdir(tmpdir()).catch(() => []),
  ]);
  return {
    containers: names(containers.output, /^napier-[a-f0-9]{32}$/u),
    networks: names(networks.output, /^napier-network-[a-f0-9]{32}$/u),
    images: names(images.output, /^napier-sandbox-stage[0-9]+-/u),
    scratch: scratch
      .filter((name) => /^napier-process-sandbox-/u.test(name))
      .sort(),
  };
}

function resourceDelta(before, after) {
  return {
    containerDeltaCount: symmetricDifference(
      before.containers,
      after.containers,
    ),
    networkDeltaCount: symmetricDifference(before.networks, after.networks),
    imageDeltaCount: symmetricDifference(before.images, after.images),
    scratchDeltaCount: symmetricDifference(before.scratch, after.scratch),
  };
}

function names(text, pattern) {
  return text
    .trim()
    .split("\n")
    .filter((name) => pattern.test(name))
    .sort();
}

function symmetricDifference(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    left.filter((value) => !rightSet.has(value)).length +
    right.filter((value) => !leftSet.has(value)).length
  );
}

async function runDocker(args, options = {}) {
  const result = await execFile("docker", args, {
    encoding: "utf8",
    env: dockerEnvironment(),
    timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    maxBuffer: options.maxBuffer ?? MAX_OUTPUT_BYTES,
    windowsHide: true,
  });
  if (!options.allowStderr && result.stderr !== "") {
    throw new Error("Docker command emitted diagnostics");
  }
  const output = `${result.stdout}${result.stderr}`;
  if (options.requireStdout && result.stdout.trim() === "") {
    throw new Error("Docker command returned no identity output");
  }
  return { output, stdout: result.stdout, stderr: result.stderr };
}

function dockerEnvironment() {
  const names = [
    "DOCKER_CERT_PATH",
    "DOCKER_CONFIG",
    "DOCKER_CONTEXT",
    "DOCKER_HOST",
    "DOCKER_TLS_VERIFY",
    "HOME",
    "PATH",
  ];
  return Object.fromEntries(
    names.flatMap((name) =>
      process.env[name] === undefined ? [] : [[name, process.env[name]]],
    ),
  );
}
