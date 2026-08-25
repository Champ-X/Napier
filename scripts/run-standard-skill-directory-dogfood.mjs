import { spawn } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  isStandardSkillCatalogBindingV2,
  isStandardSkillLoadReceiptV2,
  isStandardSkillLoadSelectionV2,
} from "@napier/contracts/skill-load-standard";
import {
  createLocalAgentRuntime,
  createThreadReplayBundle,
  verifyThreadReplayBundle,
} from "@napier/runtime/agent";

import {
  assertSecretAbsent,
  canonicalJson,
  FAST_CORE_PROMPT,
  parseJsonlFrames,
  sha256,
} from "./skill-load-fast-core-evidence-lib.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT = path.join(
  REPO_ROOT,
  "docs/artifacts/skill-load-standard-stage1/dogfood.json",
);
const CREDENTIAL_ENV = "DEEPSEEK_API_KEY";
const PROVIDER = "deepseek";
const MODEL = "deepseek-v4-flash";
const TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

const credential = process.env[CREDENTIAL_ENV]?.trim();
if (!credential) throw new Error(`${CREDENTIAL_ENV} is unavailable`);

let ownedRoot;
let result;
try {
  ownedRoot = await mkdtemp(path.join(tmpdir(), "napier-standard-skill."));
  const workspaceRoot = path.join(ownedRoot, "workspace");
  const dataRoot = path.join(ownedRoot, "state");
  await mkdir(workspaceRoot, { recursive: true });
  const skillCopies = await copyStandardSkills(workspaceRoot);
  const env = allowedEnvironment(credential);

  const before = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    env,
  });
  const agent = before.store.listAgents()[0];
  if (!agent) throw new Error("Default Agent is unavailable");
  const profileBeforeSha256 = sha256(canonicalJson(agent));
  const revisionCountBefore = before.store.listAgentRevisions(agent.id).length;
  const capability = await before.agentCapabilities.project(agent.id);
  if (
    !capability.configuredTools.includes("skill_load") ||
    !capability.runtimeExposedTools.includes("skill_load")
  ) {
    throw new Error(
      "Standard Skill loader is not exposed by the default Profile",
    );
  }
  await before.shutdown();

  const entrypoint = path.join(REPO_ROOT, "apps/cli/dist/index.js");
  const child = await runChild(
    process.execPath,
    [
      entrypoint,
      "run",
      "--workspace",
      workspaceRoot,
      "--data-root",
      dataRoot,
      "--prompt",
      FAST_CORE_PROMPT,
      "--model",
      `${PROVIDER}/${MODEL}`,
      "--credential-env",
      CREDENTIAL_ENV,
      "--timeout-ms",
      String(TIMEOUT_MS),
      "--jsonl",
    ],
    env,
    TIMEOUT_MS + 10_000,
  );
  assertSecretAbsent([child.stdout, child.stderr], credential);
  const frames = parseJsonlFrames(child.stdout);
  const verified = verifyFrames(frames);
  if (child.code !== 0) throw new Error("Standard Skill CLI run failed");

  const after = await createLocalAgentRuntime({ workspaceRoot, dataRoot, env });
  const profileAfterSha256 = sha256(
    canonicalJson(after.store.getAgent(agent.id)),
  );
  const revisions = after.store.listAgentRevisions(agent.id);
  const replay = verifyThreadReplayBundle(
    createThreadReplayBundle(verified.detail, new Date(), revisions),
  );
  await after.shutdown();
  if (
    profileBeforeSha256 !== profileAfterSha256 ||
    revisionCountBefore !== revisions.length ||
    replay.status !== "valid"
  ) {
    throw new Error("Standard Skill profile or replay invariant failed");
  }

  const core = {
    kind: "napier.standard-skill-directory-dogfood",
    schemaVersion: 1,
    result: "passed",
    provider: PROVIDER,
    model: MODEL,
    credentialLocator: CREDENTIAL_ENV,
    layout: "project_standard",
    relativeRoot: ".agents/skills",
    capabilityProjectionSha256: capability.projectionSha256,
    cliEntrypointSha256: sha256(await readFile(entrypoint)),
    promptSha256: sha256(FAST_CORE_PROMPT),
    exitCode: child.code,
    stdoutBytes: Buffer.byteLength(child.stdout),
    stdoutSha256: sha256(child.stdout),
    stderrBytes: Buffer.byteLength(child.stderr),
    stderrSha256: sha256(child.stderr),
    frameCount: frames.length,
    runIdSha256: sha256(verified.done.runId),
    skillCopies,
    binding: {
      catalogSha256: verified.binding.catalogSha256,
      availabilitySetSha256: verified.binding.availabilitySetSha256,
      snapshotManifestSha256: verified.binding.snapshotManifestSha256,
      contentSha256: verified.binding.contentSha256,
      loadableSkillNames: verified.binding.loadableSkillNames,
      researchSource: "project",
      researchRootKind: "project_standard",
    },
    lifecycle: {
      selectionSha256: verified.selection.contentSha256,
      receiptSha256: verified.receipt.contentSha256,
      source: verified.receipt.source,
      rootKind: verified.receipt.rootKind,
      relativePath: verified.receipt.relativePath,
    },
    toolSequence: verified.toolSequence,
    replay: {
      status: replay.status,
      contentSha256: replay.contentSha256,
      eventStreamSha256: replay.eventStreamSha256,
      eventCount: replay.eventCount,
      runCount: replay.runCount,
    },
    profileBeforeSha256,
    profileAfterSha256,
    revisionCountBefore,
    revisionCountAfter: revisions.length,
    credentialCanaryMatches: 0,
    rawJsonlRetained: false,
    privateCapsulesRetained: false,
    taskRootRemoved: true,
  };
  result = { ...core, contentSha256: sha256(canonicalJson(core)) };
  assertSecretAbsent([canonicalJson(result)], credential);
} finally {
  if (ownedRoot) await rm(ownedRoot, { recursive: true, force: true });
}

if (!ownedRoot || (await lstat(ownedRoot).catch(() => undefined))) {
  throw new Error("Standard Skill dogfood cleanup failed");
}
if (!result) throw new Error("Standard Skill dogfood evidence is unavailable");
await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, {
  mode: 0o600,
});
process.stdout.write(`${canonicalJson(result)}\n`);

function verifyFrames(frames) {
  if (frames.some((frame) => frame?.type === "error")) {
    throw new Error("Standard Skill CLI emitted an error frame");
  }
  const done = frames.at(-1);
  const snapshots = frames.filter((frame) => frame?.type === "snapshot");
  if (
    done?.type !== "done" ||
    done.status !== "completed" ||
    typeof done.runId !== "string" ||
    snapshots.length !== 1
  ) {
    throw new Error("Standard Skill CLI completion evidence is invalid");
  }
  const detail = snapshots[0]?.detail;
  const events = Array.isArray(detail?.events) ? detail.events : [];
  const bindings = events.filter(
    (event) => event.runId === done.runId && event.type === "context.skills",
  );
  const binding = bindings[0]?.payload;
  if (bindings.length !== 1 || !isStandardSkillCatalogBindingV2(binding)) {
    throw new Error("Standard Skill V2 binding evidence is invalid");
  }
  const research = binding.configuredSkillRequests.find(
    (request) => request.canonicalName === "research-brief",
  );
  if (
    research?.state !== "loadable" ||
    research.source !== "project" ||
    research.rootKind !== "project_standard"
  ) {
    throw new Error("Standard Skill research source evidence is invalid");
  }
  const starts = events.filter(
    (event) =>
      event.runId === done.runId &&
      event.type === "tool.started" &&
      event.payload?.toolName === "skill_load",
  );
  const terminals = events.filter(
    (event) =>
      event.runId === done.runId &&
      event.type === "tool.completed" &&
      event.payload?.toolName === "skill_load",
  );
  const selection = starts[0]?.payload?.details;
  const receipt = terminals[0]?.payload?.details;
  if (
    starts.length !== 1 ||
    terminals.length !== 1 ||
    !isStandardSkillLoadSelectionV2(selection) ||
    !isStandardSkillLoadReceiptV2(receipt) ||
    selection.source !== "project" ||
    selection.rootKind !== "project_standard" ||
    receipt.source !== "project" ||
    receipt.rootKind !== "project_standard"
  ) {
    throw new Error("Standard Skill lifecycle evidence is invalid");
  }
  const toolSequence = events
    .filter(
      (event) =>
        event.runId === done.runId &&
        (event.type === "tool.completed" || event.type === "tool.failed"),
    )
    .map((event) => ({
      seq: event.seq,
      status: event.type === "tool.completed" ? "completed" : "failed",
      toolName: event.payload?.toolName,
      ...(event.payload?.details?.action
        ? { action: event.payload.details.action }
        : {}),
      ...(event.payload?.operation
        ? { operation: event.payload.operation }
        : {}),
    }));
  requireOrderedTools(toolSequence);
  return { done, detail, binding, selection, receipt, toolSequence };
}

function requireOrderedTools(tools) {
  const required = [
    ["skill_load"],
    ["web_search"],
    ["web_fetch"],
    ["research_source", "capture_fetch"],
    ["research_source", "cite"],
  ];
  let cursor = -1;
  for (const [toolName, action] of required) {
    cursor = tools.findIndex(
      (tool, index) =>
        index > cursor &&
        tool.status === "completed" &&
        tool.toolName === toolName &&
        (action === undefined || tool.action === action),
    );
    if (cursor < 0)
      throw new Error(`Dogfood tool evidence is missing ${toolName}`);
  }
}

async function copyStandardSkills(workspaceRoot) {
  const copies = [];
  for (const name of ["research-brief", "data-analysis"]) {
    const source = path.join(REPO_ROOT, "skills", name, "SKILL.md");
    const directory = path.join(workspaceRoot, ".agents", "skills", name);
    const target = path.join(directory, "SKILL.md");
    await mkdir(directory, { recursive: true });
    await copyFile(source, target);
    const contentSha256 = sha256(await readFile(source));
    if (contentSha256 !== sha256(await readFile(target))) {
      throw new Error("Standard Skill copy hash mismatch");
    }
    copies.push({
      name,
      relativePath: `.agents/skills/${name}/SKILL.md`,
      contentSha256,
    });
  }
  return copies;
}

function allowedEnvironment(credentialValue) {
  const inherited = [
    "PATH",
    "LANG",
    "LC_ALL",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
  ];
  return {
    ...Object.fromEntries(
      inherited.flatMap((key) =>
        process.env[key] ? [[key, process.env[key]]] : [],
      ),
    ),
    [CREDENTIAL_ENV]: credentialValue,
  };
}

function runChild(command, args, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    const collect = (target) => (chunk) => {
      if (target === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
      if (
        Buffer.byteLength(stdout) + Buffer.byteLength(stderr) >
        MAX_OUTPUT_BYTES
      ) {
        child.kill("SIGTERM");
      }
    };
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error("Standard Skill CLI timed out"));
      else resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
