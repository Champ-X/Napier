import { execFile as execFileWithCallback } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  OciContainerSandboxAdapter,
  VerificationRunner,
  canonicalJson,
  sha256,
} from "../packages/runtime/dist/index.js";
import {
  probeDapRuntime,
  probeGitRuntime,
  probeLocalServiceRuntime,
  probeLspRuntime,
  probePythonRuntime,
  probeSandboxProcessRuntime,
  probeSandboxResourceRuntime,
  probeShellRuntime,
  probeVerificationRuntime,
} from "../packages/runtime/dist/doctor-runtime-probes.js";
import {
  probeContainerRuntimeIdentity,
  resolveContainerImageIdentity,
} from "../packages/runtime/dist/sandbox-container-runtime.js";

const execFile = promisify(execFileWithCallback);
const PLATFORMS = ["linux/amd64", "linux/arm64"];
const CHECKS = [
  ["node", "sandbox_process_ready", probeSandboxProcessRuntime],
  ["resources", "sandbox_resources_ready", probeSandboxResourceRuntime],
  ["verification", "verification_ready", probeVerificationRuntime],
  ["shell", "shell_ready", probeShellRuntime],
  ["python", "python_ready", probePythonRuntime],
  ["git", "git_ready", probeGitRuntime],
  ["lsp", "lsp_ready", probeLspRuntime],
  ["dap", "dap_ready", probeDapRuntime],
  ["service", "service_ready", probeLocalServiceRuntime],
];
const CONTAINER_NAME = /^napier-[a-f0-9]{32}$/u;
const NETWORK_NAME = /^napier-network-[a-f0-9]{32}$/u;
const SCRATCH_NAME = /^napier-process-sandbox-[A-Za-z0-9]{6}$/u;
const SCRATCH_TOMBSTONE =
  /^napier-process-sandbox-[A-Za-z0-9]{6}\.[a-f0-9]{16}\.guardian-remove$/u;
const BUILD_TIMEOUT_MS = 15 * 60 * 1_000;
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_BUILD_OUTPUT_BYTES = 64 * 1024;
const MAX_DOCKER_OUTPUT_BYTES = 128 * 1024;

export async function runSandboxMultiArchitectureAcceptance(input) {
  const dependencies = input.dependencies ?? {};
  const docker = dependencies.docker ?? runDocker;
  const snapshot = dependencies.snapshot ?? snapshotResources;
  const baseline = await snapshot(docker);
  const builder = await inspectBuilder(docker);
  const temporaryTags = [];
  const platforms = [];
  let failure;
  try {
    for (const platform of PLATFORMS) {
      const tag = temporaryTag(platform);
      temporaryTags.push(tag);
      platforms.push(
        await buildAndVerifyPlatform({
          repoRoot: input.repoRoot,
          source: input.source,
          platform,
          tag,
          builder,
          docker,
        }),
      );
    }
  } catch (error) {
    failure = error;
  } finally {
    for (const tag of temporaryTags.reverse()) {
      try {
        await docker(["image", "rm", "--force", tag], {
          timeoutMs: COMMAND_TIMEOUT_MS,
          maxBuffer: MAX_DOCKER_OUTPUT_BYTES,
          allowStderr: true,
        });
      } catch (error) {
        failure ??= error;
      }
    }
  }
  const [finalSnapshot, temporaryTagDeltaCount] = await Promise.all([
    snapshot(docker),
    countExistingTags(temporaryTags, docker),
  ]);
  const delta = resourceDelta(baseline, finalSnapshot);
  if (
    Object.values(delta).some((count) => count !== 0) ||
    temporaryTagDeltaCount !== 0
  ) {
    failure ??= new Error(
      "Sandbox multi-architecture acceptance did not restore resources",
    );
  }
  if (failure) throw failure;
  const parity = platformParity(platforms);
  return {
    builder,
    platforms,
    parity,
    resourceClosure: {
      exactBaselineRestored: true,
      ...delta,
      temporaryTagDeltaCount,
    },
  };
}

async function buildAndVerifyPlatform(input) {
  const startedAt = Date.now();
  const build = await input.docker(
    [
      "buildx",
      "build",
      "--platform",
      input.platform,
      "--load",
      "--provenance=false",
      "--quiet",
      "--tag",
      input.tag,
      "--label",
      `io.napier.sandbox.context-sha256=${input.source.contextSha256}`,
      path.join(input.repoRoot, "docker/napier-sandbox"),
    ],
    {
      timeoutMs: BUILD_TIMEOUT_MS,
      maxBuffer: MAX_BUILD_OUTPUT_BYTES,
      requireStdout: true,
    },
  );
  const identity = await resolveContainerImageIdentity(input.tag);
  if (identity.imagePlatform !== input.platform) {
    throw new Error("Sandbox build returned the wrong image platform");
  }
  const observed = await probeContainerRuntimeIdentity(identity);
  requireToolchain(observed);
  const sandbox = new OciContainerSandboxAdapter(input.tag);
  const checkCodes = [];
  for (const [, expectedCode, probe] of CHECKS) {
    const result = await probe(input.repoRoot, undefined, sandbox);
    if (result.status !== "ready" || result.code !== expectedCode) {
      throw new Error(
        `Sandbox ${input.platform} production check failed: ${expectedCode}`,
      );
    }
    checkCodes.push(result.code);
  }
  const runner = new VerificationRunner({
    workspaceRoot: input.repoRoot,
    sandbox,
  });
  const typecheck = await runner.run({
    kind: "typecheck",
    target: "packages/contracts/tsconfig.json",
    timeoutMs: 60_000,
  });
  const test = await runner.run({
    kind: "test",
    target: "packages/contracts/test/agent-capability-contract.test.ts",
    timeoutMs: 60_000,
  });
  if (
    typecheck.details.status !== "passed" ||
    test.details.status !== "passed"
  ) {
    throw new Error(
      `Sandbox ${input.platform} workspace verification failed (${typecheck.details.status}:${String(typecheck.details.durationMs)},${test.details.status}:${String(test.details.durationMs)})`,
    );
  }
  const runtimeIdentities = await Promise.all([
    sandbox.resolveCommandRuntime("node"),
    sandbox.resolveCommandRuntime("shell"),
    sandbox.resolveCommandRuntime("python"),
    sandbox.resolveCommandRuntime("git"),
    sandbox.resolveLspRuntime(),
    sandbox.resolveNodeDebuggerRuntime(),
    sandbox.resolveVerificationRuntime(),
  ]);
  const toolchain = {
    node: observed.debugger.nodeVersion,
    shellSha256: observed.shell.executableSha256,
    python: observed.python.version,
    pythonSha256: observed.python.executableSha256,
    git: observed.git.version,
    gitSha256: observed.git.executableSha256,
    typescript: observed.lsp.typescriptVersion,
    typescriptLanguageServer: observed.lsp.languageServerVersion,
    vitest: observed.verification.test.version,
    prettier: observed.verification.format.version,
    packageJsonSha256: observed.verification.packageJsonSha256,
    packageLockSha256: observed.verification.packageLockSha256,
    runtimeIdentitySha256: sha256(
      canonicalJson(
        runtimeIdentities.map((value) => value.runtimeIdentitySha256),
      ),
    ),
  };
  const verification = {
    typecheckStatus: typecheck.details.status,
    testStatus: test.details.status,
    typecheckVersion: typecheck.details.verifierVersion,
    testVersion: test.details.verifierVersion,
    typecheckResultSha256: typecheck.details.resultSha256,
    testResultSha256: test.details.resultSha256,
  };
  const evidence = {
    platform: input.platform,
    imageId: identity.imageId,
    imageIdentitySha256: identity.identitySha256,
    checkCodes,
    toolchain,
    verification,
  };
  return {
    platform: input.platform,
    imageId: identity.imageId,
    imageIdentitySha256: identity.identitySha256,
    buildStatus: "passed",
    buildOutputSha256: sha256(build.output),
    buildOutputBytes: Buffer.byteLength(build.output, "utf8"),
    durationMs: Math.max(0, Date.now() - startedAt),
    checkCodes,
    toolchain,
    verification,
    evidenceSha256: sha256(canonicalJson(evidence)),
  };
}

async function inspectBuilder(docker) {
  const [version, inspect] = await Promise.all([
    docker(["buildx", "version"], {
      timeoutMs: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_DOCKER_OUTPUT_BYTES,
      requireStdout: true,
    }),
    docker(["buildx", "inspect"], {
      timeoutMs: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_DOCKER_OUTPUT_BYTES,
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
    throw new Error("Local BuildKit does not support the required platforms");
  }
  const content = {
    driver,
    buildxVersion,
    buildkitVersion,
    supportedPlatforms: [...PLATFORMS],
    explicitPlatformBuild: true,
    localLoadOnly: true,
    registryPublished: false,
    signed: false,
    attested: false,
  };
  return {
    ...content,
    identitySha256: sha256(canonicalJson(content)),
  };
}

function requireToolchain(observed) {
  if (
    !observed.shell ||
    !observed.python ||
    !observed.git ||
    !observed.lsp ||
    !observed.debugger ||
    !observed.verification
  ) {
    throw new Error(
      "Sandbox multi-architecture toolchain identity is incomplete",
    );
  }
}

function platformParity(platforms) {
  const versions = (value) => ({
    node: value.toolchain.node,
    python: value.toolchain.python,
    git: value.toolchain.git,
    typescript: value.toolchain.typescript,
    typescriptLanguageServer: value.toolchain.typescriptLanguageServer,
    vitest: value.toolchain.vitest,
    prettier: value.toolchain.prettier,
  });
  const manifests = (value) => ({
    packageJsonSha256: value.toolchain.packageJsonSha256,
    packageLockSha256: value.toolchain.packageLockSha256,
  });
  const content = {
    distinctImageIds: platforms[0].imageId !== platforms[1].imageId,
    toolchainVersionsEqual:
      canonicalJson(versions(platforms[0])) ===
      canonicalJson(versions(platforms[1])),
    manifestHashesEqual:
      canonicalJson(manifests(platforms[0])) ===
      canonicalJson(manifests(platforms[1])),
    allProductionChecksReady: platforms.every(
      (value) => value.checkCodes.length === CHECKS.length,
    ),
    explicitPlatformLaunch: true,
  };
  if (Object.values(content).some((value) => value !== true)) {
    throw new Error("Sandbox multi-architecture parity is invalid");
  }
  return {
    ...content,
    evidenceSha256: sha256(
      canonicalJson({
        ...content,
        platforms: platforms.map((value) => ({
          platform: value.platform,
          imageId: value.imageId,
          evidenceSha256: value.evidenceSha256,
        })),
      }),
    ),
  };
}

async function snapshotResources(docker) {
  const [containers, networks, images, scratch] = await Promise.all([
    docker(["container", "ls", "--all", "--format", "{{.Names}}"], {
      timeoutMs: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_DOCKER_OUTPUT_BYTES,
    }),
    docker(["network", "ls", "--format", "{{.Name}}"], {
      timeoutMs: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_DOCKER_OUTPUT_BYTES,
    }),
    docker(["image", "ls", "--all", "--no-trunc", "--quiet"], {
      timeoutMs: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_DOCKER_OUTPUT_BYTES,
    }),
    readdir(scratchBaseDirectory()).catch(() => []),
  ]);
  return {
    containers: names(containers.output, CONTAINER_NAME),
    networks: names(networks.output, NETWORK_NAME),
    images: [
      ...new Set(
        images.output
          .trim()
          .split("\n")
          .filter((value) => /^sha256:[a-f0-9]{64}$/u.test(value)),
      ),
    ].sort(),
    scratch: scratch
      .filter((name) => SCRATCH_NAME.test(name) || SCRATCH_TOMBSTONE.test(name))
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

async function countExistingTags(tags, docker) {
  let count = 0;
  for (const tag of tags) {
    const result = await docker(
      [
        "image",
        "ls",
        "--filter",
        `reference=${tag}`,
        "--format",
        "{{.Repository}}:{{.Tag}}",
      ],
      {
        timeoutMs: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_DOCKER_OUTPUT_BYTES,
      },
    );
    count += result.output
      .trim()
      .split("\n")
      .filter((value) => value === tag).length;
  }
  return count;
}

function temporaryTag(platform) {
  const arch = platform.slice("linux/".length);
  return `napier-sandbox:stage14-${arch}-${randomBytes(8).toString("hex")}`;
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

function scratchBaseDirectory() {
  const configured =
    process.env["NAPIER_CONTAINER_SANDBOX_SCRATCH_DIR"]?.trim();
  return configured && path.isAbsolute(configured) ? configured : tmpdir();
}

export async function runDocker(args, options = {}) {
  const result = await execFile("docker", args, {
    encoding: "utf8",
    env: dockerEnvironment(),
    timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    killSignal: "SIGKILL",
    maxBuffer: options.maxBuffer ?? MAX_DOCKER_OUTPUT_BYTES,
    windowsHide: true,
  });
  if (!options.allowStderr && result.stderr !== "") {
    throw new Error("Docker command emitted unexpected diagnostics");
  }
  if (options.requireStdout && result.stdout.trim() === "") {
    throw new Error("Docker command returned no output");
  }
  return { output: `${result.stdout}${result.stderr}` };
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
