import { execFile as execFileWithCallback } from "node:child_process";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { Writable } from "node:stream";
import path from "node:path";
import { promisify } from "node:util";

import { runCli } from "../apps/cli/dist/cli.js";
import {
  createLocalAgentRuntime,
  sha256,
} from "../packages/runtime/dist/index.js";

const execFile = promisify(execFileWithCallback);
const CONTAINER_NAME = /^napier-[a-f0-9]{32}$/u;
const NETWORK_NAME = /^napier-network-[a-f0-9]{32}$/u;
const SCRATCH_NAME = /^napier-process-sandbox-[A-Za-z0-9]{6}$/u;
const SCRATCH_TOMBSTONE =
  /^napier-process-sandbox-[A-Za-z0-9]{6}\.[a-f0-9]{16}\.guardian-remove$/u;
const MAX_CLI_OUTPUT_BYTES = 4 * 1024 * 1024;

export async function createSandboxFirstUseEnvironment(
  environment,
  root,
  dockerHost,
) {
  const home = path.join(root, "home");
  const temporary = path.join(root, "temp");
  const dockerConfig = path.join(root, "docker");
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(temporary, { recursive: true }),
    mkdir(dockerConfig, { recursive: true }),
  ]);
  await writeFile(path.join(dockerConfig, "config.json"), '{"auths":{}}\n', {
    flag: "wx",
    mode: 0o600,
  });
  const inherited = [
    "ComSpec",
    "LANG",
    "LC_ALL",
    "NODE_EXTRA_CA_CERTS",
    "PATH",
    "PATHEXT",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "SystemRoot",
    "WINDIR",
  ];
  return {
    ...Object.fromEntries(
      inherited.flatMap((name) => {
        const value = environmentValue(environment, name);
        return value === undefined ? [] : [[name, value]];
      }),
    ),
    CI: "true",
    HOME: home,
    USERPROFILE: home,
    TMPDIR: temporary,
    TEMP: temporary,
    TMP: temporary,
    DOCKER_CONFIG: dockerConfig,
    DOCKER_HOST: dockerHost,
    NAPIER_CONTAINER_SANDBOX_SCRATCH_DIR: temporary,
  };
}

export async function inspectFirstUseState(workspaceRoot, dataRoot, env) {
  const services = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    env,
  });
  try {
    const agents = services.store.listAgents().map((agent) => ({
      agent,
      revisions: services.store.listAgentRevisions(agent.id),
    }));
    const threads = services.store.listThreads();
    return {
      agents,
      credentialCount: services.store.listCredentialReferences().length,
      runs: threads.flatMap((thread) => services.store.listRuns(thread.id)),
      events: (
        await Promise.all(
          threads.map((thread) => services.store.listEvents(thread.id)),
        )
      ).flat(),
    };
  } finally {
    await services.shutdown();
  }
}

export async function runFirstUseSingleJsonCli(args, cwd, env) {
  const result = await runCapturedCli(args, cwd, env);
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  requireFirstUseValue(
    result.stderr === "" && lines.length === 1,
    "First-use CLI emitted invalid single-object JSONL",
  );
  return { code: result.code, value: JSON.parse(lines[0]) };
}

export async function runFirstUseStreamJsonCli(args, cwd, env) {
  const result = await runCapturedCli(args, cwd, env);
  requireFirstUseValue(
    result.stderr === "",
    "First-use Coding CLI emitted stderr",
  );
  const frames = result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return {
    code: result.code,
    frames,
    stdoutBytes: Buffer.byteLength(result.stdout),
    stdoutSha256: sha256(result.stdout),
  };
}

export async function currentDockerHost(executable) {
  const configured = process.env["DOCKER_HOST"]?.trim();
  if (configured) return configured;
  const result = await execFile(
    executable,
    ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"],
    {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 16 * 1024,
      windowsHide: true,
    },
  );
  const value = JSON.parse(result.stdout.trim());
  requireFirstUseValue(
    typeof value === "string" && value.length > 0 && value.length <= 2_048,
    "First-use Docker endpoint is invalid",
  );
  return value;
}

export async function snapshotFirstUseResources(executable, scratchRoot) {
  const run = async (args) =>
    (
      await execFile(executable, args, {
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
      })
    ).stdout;
  const [containers, networks, scratch] = await Promise.all([
    run(["container", "ls", "--all", "--format", "{{.Names}}"]),
    run(["network", "ls", "--format", "{{.Name}}"]),
    readdir(scratchRoot).catch(() => []),
  ]);
  return {
    containers: names(containers, CONTAINER_NAME),
    networks: names(networks, NETWORK_NAME),
    scratch: scratch
      .filter((name) => SCRATCH_NAME.test(name) || SCRATCH_TOMBSTONE.test(name))
      .sort(),
  };
}

export function firstUseResourceDelta(before, after) {
  return {
    containerDeltaCount: difference(before.containers, after.containers),
    networkDeltaCount: difference(before.networks, after.networks),
    scratchDeltaCount: difference(before.scratch, after.scratch),
  };
}

export async function withFirstUseProcessEnvironment(environment, run) {
  const original = { ...process.env };
  try {
    replaceProcessEnvironment(environment);
    return await run();
  } finally {
    replaceProcessEnvironment(original);
  }
}

export async function pathExists(candidate) {
  return access(candidate).then(
    () => true,
    () => false,
  );
}

export function sameStringSet(left, right) {
  return (
    Array.isArray(left) &&
    [...new Set(left)].sort().join("\n") ===
      [...new Set(right)].sort().join("\n")
  );
}

export function requireFirstUseValue(condition, message) {
  if (!condition) throw new Error(message);
}

async function runCapturedCli(args, cwd, env) {
  const stdout = new CaptureWritable();
  const stderr = new CaptureWritable();
  const code = await runCli(args, { cwd, env, stdout, stderr });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

class CaptureWritable extends Writable {
  text = "";

  _write(chunk, _encoding, callback) {
    this.text += chunk.toString();
    callback(
      Buffer.byteLength(this.text) > MAX_CLI_OUTPUT_BYTES
        ? new Error("First-use CLI output exceeded its limit")
        : undefined,
    );
  }
}

function environmentValue(environment, name) {
  const exact = environment[name];
  if (exact !== undefined) return exact;
  const key = Object.keys(environment).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  );
  return key ? environment[key] : undefined;
}

function replaceProcessEnvironment(environment) {
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, environment);
}

function names(text, pattern) {
  return text
    .trim()
    .split("\n")
    .filter((name) => pattern.test(name))
    .sort();
}

function difference(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    left.filter((value) => !rightSet.has(value)).length +
    right.filter((value) => !leftSet.has(value)).length
  );
}
