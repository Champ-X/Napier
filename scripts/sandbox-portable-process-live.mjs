import { execFile as execFileWithCallback } from "node:child_process";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  CommandRunner,
  OciContainerSandboxAdapter,
  VerificationRunner,
  canonicalJson,
  sha256,
} from "../packages/runtime/dist/index.js";
import { createOciContainerPathMapping } from "../packages/runtime/dist/sandbox-container-path-mapping.js";
import {
  PORTABLE_CONTAINER_USER_IDS,
  resolveContainerImageIdentity,
} from "../packages/runtime/dist/sandbox-container-runtime.js";
import { runGitInspectProcess } from "../packages/runtime/dist/git-inspect-process.js";
import { buildOciContainerArgs } from "../packages/runtime/dist/sandbox-oci-launch-arguments.js";

const execFile = promisify(execFileWithCallback);
const CONTAINER_NAME = /^napier-[a-f0-9]{32}$/u;
const NETWORK_NAME = /^napier-network-[a-f0-9]{32}$/u;
const SCRATCH_NAME = /^napier-process-sandbox-[A-Za-z0-9]{6}$/u;
const SCRATCH_TOMBSTONE =
  /^napier-process-sandbox-[A-Za-z0-9]{6}\.[a-f0-9]{16}\.guardian-remove$/u;
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

export async function runSandboxPortableProcessAcceptance(input) {
  const dependencies = input.dependencies ?? {};
  const snapshot = dependencies.snapshot ?? snapshotResources;
  const baseline = await snapshot();
  const globalGitBefore = await gitGlobalConfigSnapshot();
  const temporaryRoot = await mkdtemp(
    path.join(homedir(), ".napier-portable-process-"),
  );
  let result;
  let failure;
  try {
    result = await runDogfood({
      ...input,
      temporaryRoot,
    });
  } catch (error) {
    failure = error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true }).catch((error) => {
      failure ??= error;
    });
  }
  const [finalSnapshot, globalGitAfter, temporaryRootRemoved] =
    await Promise.all([
      snapshot(),
      gitGlobalConfigSnapshot(),
      access(temporaryRoot).then(
        () => false,
        () => true,
      ),
    ]);
  const delta = resourceDelta(baseline, finalSnapshot);
  if (
    Object.values(delta).some((count) => count !== 0) ||
    !temporaryRootRemoved ||
    globalGitBefore !== globalGitAfter
  ) {
    failure ??= new Error(
      "Sandbox portable process acceptance did not restore its baseline",
    );
  }
  if (failure) throw failure;
  return {
    ...result,
    productionDogfood: {
      ...result.productionDogfood,
      git: {
        ...result.productionDogfood.git,
        hostGlobalConfigChanged: false,
      },
    },
    resourceClosure: {
      exactBaselineRestored: true,
      ...delta,
      temporaryRootRemoved,
    },
  };
}

async function runDogfood(input) {
  const workspace = path.join(input.temporaryRoot, "workspace");
  const nested = path.join(workspace, "nested");
  const generated = path.join(workspace, "generated");
  const gitWorkspace = path.join(input.temporaryRoot, "git-workspace");
  await Promise.all([
    mkdir(nested, { recursive: true }),
    mkdir(generated, { recursive: true }),
    mkdir(gitWorkspace, { recursive: true }),
  ]);
  await Promise.all(
    [input.temporaryRoot, workspace, nested, generated, gitWorkspace].map(
      (directory) => chmod(directory, 0o777),
    ),
  );
  await writeFile(path.join(nested, "input.txt"), "portable", "utf8");
  await initializeGitWorkspace(gitWorkspace);
  const identity = await resolveContainerImageIdentity(
    input.imageId,
    undefined,
    undefined,
    PORTABLE_CONTAINER_USER_IDS,
  );
  const sandbox = new OciContainerSandboxAdapter(input.imageId, {
    userIds: PORTABLE_CONTAINER_USER_IDS,
  });
  const runtime = await sandbox.resolveCommandRuntime("node");
  const command = await new CommandRunner({
    workspaceRoot: workspace,
    sandbox,
  }).run({
    runtime: "node",
    cwd: "nested",
    args: [
      "-e",
      'const fs=require("node:fs");process.stdout.write(`${process.cwd()}:${fs.readFileSync("input.txt","utf8")}`)',
    ],
  });
  requireValue(
    command.details.status === "succeeded" &&
      command.stdout === "/workspace/nested:portable",
    "Portable command execution failed",
  );
  const git = await runGitInspectProcess(
    { workspaceRoot: gitWorkspace, sandbox },
    ["status", "--porcelain=v2"],
    10_000,
  );
  requireValue(
    git.status === "succeeded" &&
      git.stderr === "" &&
      git.stdout.includes("file.txt"),
    "Portable Git inspection failed",
  );
  const verification = new VerificationRunner({
    workspaceRoot: input.repoRoot,
    sandbox,
  });
  const [typecheck, test] = await Promise.all([
    verification.run({
      kind: "typecheck",
      target: "packages/contracts/tsconfig.json",
      timeoutMs: 60_000,
    }),
    verification.run({
      kind: "test",
      target: "packages/contracts/test/agent-capability-contract.test.ts",
      timeoutMs: 60_000,
    }),
  ]);
  requireValue(
    typecheck.details.status === "passed" &&
      test.details.status === "passed" &&
      typecheck.details.runtimeIdentitySha256 &&
      test.details.runtimeIdentitySha256,
    "Portable Workspace verification failed",
  );
  const child = await sandbox.launch({
    command: "/usr/local/bin/node",
    args: ["-e", 'require("node:fs").writeFileSync("generated/out.txt","ok")'],
    cwd: workspace,
    env: {},
    workspaceRoot: workspace,
    workspaceWritePaths: [generated],
    approvedCapabilities: [
      "process.spawn",
      "workspace.read",
      "workspace.write",
    ],
  });
  const exit = await child.exit;
  const outputPath = path.join(generated, "out.txt");
  const [output, outputInfo] = await Promise.all([
    readFile(outputPath, "utf8"),
    stat(outputPath),
  ]);
  requireValue(
    exit.code === 0 &&
      exit.signal === null &&
      output === "ok" &&
      outputInfo.uid === process.getuid() &&
      outputInfo.gid === process.getgid(),
    "Portable scoped write failed",
  );
  const projection = controlledWindowsProjection(identity.user);
  return {
    portableIdentity: {
      mapping: identity.user.mapping,
      nonRoot: identity.user.userId !== 0 && identity.user.groupId !== 0,
      hostIdsRetained: false,
      userIdentitySha256: identity.user.identitySha256,
      runtimeIdentitySha256: runtime.runtimeIdentitySha256,
    },
    controlledWindowsProjection: projection,
    productionDogfood: {
      hostPlatform: process.platform,
      sandbox: sandbox.id,
      command: {
        status: command.details.status,
        containerCwdMapped: command.stdout.startsWith("/workspace/nested:"),
        inputRead: command.stdout.endsWith(":portable"),
        resultSha256: command.details.resultSha256,
      },
      git: {
        status: git.status,
        processLocalSafeDirectory: true,
        wildcardSafeDirectory: false,
        hostGlobalConfigChanged: false,
        resultSha256: sha256(
          canonicalJson({
            status: git.status,
            exitCode: git.exitCode,
            stdoutSha256: sha256(git.stdout),
            stderrSha256: sha256(git.stderr),
            runtimeIdentitySha256: git.runtimeIdentitySha256,
          }),
        ),
      },
      verification: {
        typecheckStatus: typecheck.details.status,
        testStatus: test.details.status,
        typecheckVersion: typecheck.details.verifierVersion,
        testVersion: test.details.verifierVersion,
        typecheckRuntimeIdentitySha256: typecheck.details.runtimeIdentitySha256,
        testRuntimeIdentitySha256: test.details.runtimeIdentitySha256,
        typecheckResultSha256: typecheck.details.resultSha256,
        testResultSha256: test.details.resultSha256,
      },
      scopedWrite: {
        status: "passed",
        containerUserNonRoot: true,
        hostOwnershipPreserved: true,
        contentVerified: true,
        resultSha256: sha256(
          canonicalJson({
            exitCode: exit.code,
            signal: exit.signal,
            outputSha256: sha256(output),
            hostOwnershipPreserved: true,
          }),
        ),
      },
    },
  };
}

function controlledWindowsProjection(user) {
  const request = {
    command: "/usr/local/bin/node",
    args: [
      "/opt/napier/node_modules/typescript/bin/tsc",
      "-p",
      "C:\\repo\\packages\\example\\tsconfig.json",
    ],
    cwd: "C:\\repo\\packages\\example",
    env: { GIT_INDEX_FILE: "C:\\repo\\.napier\\index" },
    workspaceRoot: "C:\\repo",
    approvedCapabilities: [
      "process.spawn",
      "workspace.read",
      "workspace.write",
    ],
    workspaceWritePaths: ["C:\\repo\\generated"],
    runtimeReadPaths: ["C:\\toolchain\\node_modules"],
  };
  const mapping = createOciContainerPathMapping(request, user, "win32");
  const args = buildOciContainerArgs(
    request,
    "C:\\scratch",
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    `napier-${"b".repeat(32)}`,
    user,
    undefined,
    "linux/amd64",
    mapping,
    "win32",
  );
  let outsideDriveRejected = false;
  try {
    createOciContainerPathMapping(
      { ...request, args: ["D:\\outside\\secret.txt"] },
      user,
      "win32",
    );
  } catch {
    outsideDriveRejected = true;
  }
  const serialized = args.join("\0");
  const content = {
    workspaceMapped: serialized.includes(
      "source=C:\\repo,target=/workspace,readonly",
    ),
    nestedCwdMapped: serialized.includes(
      "--workdir\0/workspace/packages/example",
    ),
    verifierTargetMapped: serialized.endsWith(
      "-p\0/workspace/packages/example/tsconfig.json",
    ),
    gitPrivatePathMapped:
      mapping.environment.GIT_INDEX_FILE === "/workspace/.napier/index",
    runtimePathMapped: serialized.includes(
      "source=C:\\toolchain\\node_modules,target=/opt/napier-host-runtime/0,readonly",
    ),
    imageRuntimePathsPreserved:
      mapping.command === "/usr/local/bin/node" &&
      mapping.args[0] === "/opt/napier/node_modules/typescript/bin/tsc",
    outsideDriveRejected,
    explicitPlatformLaunch: serialized.includes("--platform\0linux/amd64"),
    windowsHostExecuted: false,
  };
  requireValue(
    Object.entries(content).every(([name, value]) =>
      name === "windowsHostExecuted" ? value === false : value === true,
    ),
    "Controlled Windows path projection failed",
  );
  return {
    ...content,
    projectionSha256: sha256(canonicalJson(content)),
  };
}

async function initializeGitWorkspace(workspace) {
  await runHostGit(workspace, ["init", "--quiet"]);
  await runHostGit(workspace, ["config", "user.name", "Napier Portable"]);
  await runHostGit(workspace, ["config", "user.email", "portable@localhost"]);
  await writeFile(path.join(workspace, "file.txt"), "one\n", "utf8");
  await runHostGit(workspace, ["add", "file.txt"]);
  await runHostGit(workspace, ["commit", "--quiet", "-m", "init"]);
  await writeFile(path.join(workspace, "file.txt"), "one\ntwo\n", "utf8");
}

async function runHostGit(cwd, args) {
  await execFile("git", args, {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: "C",
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    windowsHide: true,
  });
}

async function gitGlobalConfigSnapshot() {
  const candidates = [
    path.join(homedir(), ".gitconfig"),
    path.join(
      process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"),
      "git/config",
    ),
  ];
  const entries = [];
  for (const candidate of candidates) {
    try {
      const info = await lstat(candidate);
      if (!info.isFile() || info.size > 1024 * 1024) {
        entries.push({ present: true, regular: false });
      } else {
        entries.push({
          present: true,
          regular: true,
          mode: info.mode & 0o777,
          bytes: info.size,
          sha256: sha256(await readFile(candidate)),
        });
      }
    } catch {
      entries.push({ present: false });
    }
  }
  return sha256(canonicalJson(entries));
}

async function snapshotResources() {
  const [containers, networks, scratch] = await Promise.all([
    runDocker(["container", "ls", "--all", "--format", "{{.Names}}"]),
    runDocker(["network", "ls", "--format", "{{.Name}}"]),
    readdir(scratchBaseDirectory()).catch(() => []),
  ]);
  return {
    containers: names(containers, CONTAINER_NAME),
    networks: names(networks, NETWORK_NAME),
    scratch: scratch
      .filter((name) => SCRATCH_NAME.test(name) || SCRATCH_TOMBSTONE.test(name))
      .sort(),
  };
}

async function runDocker(args) {
  const result = await execFile("docker", args, {
    encoding: "utf8",
    env: dockerEnvironment(),
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    windowsHide: true,
  });
  if (result.stderr !== "") {
    throw new Error("Docker resource snapshot emitted diagnostics");
  }
  return result.stdout;
}

function resourceDelta(before, after) {
  return {
    containerDeltaCount: symmetricDifference(
      before.containers,
      after.containers,
    ),
    networkDeltaCount: symmetricDifference(before.networks, after.networks),
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

function scratchBaseDirectory() {
  const configured = process.env.NAPIER_CONTAINER_SANDBOX_SCRATCH_DIR?.trim();
  return configured && path.isAbsolute(configured) ? configured : tmpdir();
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

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
