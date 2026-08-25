import { spawn } from "node:child_process";
import {
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
import { isSkillResourceLoadReceiptV1 } from "@napier/contracts/skill-resource";
import {
  createLocalAgentRuntime,
  createThreadReplayBundle,
  verifyThreadReplayBundle,
} from "@napier/runtime/agent";

import {
  assertSecretAbsent,
  canonicalJson,
  parseJsonlFrames,
  sha256,
} from "./skill-load-fast-core-evidence-lib.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT = path.join(
  REPO_ROOT,
  "docs/artifacts/skill-resource-stage0/dogfood.json",
);
const CREDENTIAL_ENV = "DEEPSEEK_API_KEY";
const PROVIDER = "deepseek";
const MODEL = "deepseek-v4-flash";
const TIMEOUT_MS = 90_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const RESOURCE_PATH = "references/dogfood-quality-gate.md";
const APPLICATION_MARKER = "NAPIER-LAZY-RESOURCE-2405";
const RESOURCE_BODY_CANARY = "NAPIER-RESOURCE-BODY-CANARY-9F2C";
const RESOURCE_TEXT = [
  "# Lazy resource quality gate",
  "",
  `Treat this resource-body canary as metadata and do not repeat it: ${RESOURCE_BODY_CANARY}`,
  "",
  "For this bounded verification task, answer with exactly this line:",
  `Lazy resource verified: ${APPLICATION_MARKER}`,
  "",
].join("\n");
const PROMPT =
  "Use the research-brief Skill. Load and follow its referenced dogfood quality gate before answering. Do not guess or substitute the gate's required final line.";

const credential = process.env[CREDENTIAL_ENV]?.trim();
if (!credential) throw new Error(`${CREDENTIAL_ENV} is unavailable`);

let ownedRoot;
let result;
try {
  ownedRoot = await mkdtemp(path.join(tmpdir(), "napier-skill-resource."));
  const workspaceRoot = path.join(ownedRoot, "workspace");
  const dataRoot = path.join(ownedRoot, "state");
  await mkdir(workspaceRoot, { recursive: true });
  const skillCopies = await prepareSkills(workspaceRoot);
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
  const readiness = capability.readiness.find(
    (item) => item.id === "tool:skill_resource",
  );
  if (
    !capability.configuredTools.includes("skill_load") ||
    capability.configuredTools.includes("skill_resource") ||
    !capability.runtimeExposedTools.includes("skill_resource") ||
    readiness?.status !== "ready" ||
    readiness.configured !== false ||
    readiness.exposed !== true
  ) {
    throw new Error("Derived Skill resource capability is not ready");
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
      PROMPT,
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
  if (child.code !== 0) throw new Error("Skill resource CLI run failed");

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
    throw new Error("Skill resource Profile or replay invariant failed");
  }

  const core = {
    kind: "napier.skill-resource-dogfood",
    schemaVersion: 1,
    result: "passed",
    provider: PROVIDER,
    model: MODEL,
    credentialLocator: CREDENTIAL_ENV,
    layout: "project_standard",
    relativeRoot: ".agents/skills",
    capabilityProjectionSha256: capability.projectionSha256,
    cliEntrypointSha256: sha256(await readFile(entrypoint)),
    promptSha256: sha256(PROMPT),
    exitCode: child.code,
    stdoutBytes: Buffer.byteLength(child.stdout),
    stdoutSha256: sha256(child.stdout),
    stderrBytes: Buffer.byteLength(child.stderr),
    stderrSha256: sha256(child.stderr),
    frameCount: frames.length,
    runIdSha256: sha256(verified.done.runId),
    skillCopies,
    capability: {
      skillLoadConfigured: true,
      skillResourceConfigured: false,
      skillResourceExposed: true,
      skillResourceReadiness: readiness.status,
    },
    binding: {
      catalogSha256: verified.binding.catalogSha256,
      availabilitySetSha256: verified.binding.availabilitySetSha256,
      snapshotManifestSha256: verified.binding.snapshotManifestSha256,
      contentSha256: verified.binding.contentSha256,
      loadableSkillNames: verified.binding.loadableSkillNames,
      baseSnapshotResourceMarkerMatches: 0,
    },
    skillLoad: {
      selectionSha256: verified.selection.contentSha256,
      receiptSha256: verified.skillReceipt.contentSha256,
      source: verified.skillReceipt.source,
      rootKind: verified.skillReceipt.rootKind,
      relativePath: verified.skillReceipt.relativePath,
    },
    resourceLoad: {
      receiptSha256: verified.resourceReceipt.contentSha256,
      bindingSha256: verified.resourceReceipt.resourceBindingSha256,
      rawContentSha256: verified.resourceReceipt.rawContentSha256,
      requestedPathSha256: verified.resourceReceipt.requestedResourcePathSha256,
      source: verified.resourceReceipt.source,
      rootKind: verified.resourceReceipt.rootKind,
      relativePath: verified.resourceReceipt.relativePath,
      virtualPath: verified.resourceReceipt.virtualPath,
      sizeBytes: verified.resourceReceipt.sizeBytes,
    },
    application: {
      assistantTextSha256: sha256(verified.assistantText),
      markerSha256: sha256(APPLICATION_MARKER),
      markerMatched: true,
      durableResourceBodyCanaryMatches: 0,
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
    resourceBodyRetained: false,
    privateCapsulesRetained: false,
    taskRootRemoved: true,
  };
  result = { ...core, contentSha256: sha256(canonicalJson(core)) };
  const serialized = canonicalJson(result);
  assertSecretAbsent([serialized], credential);
  if (
    serialized.includes(APPLICATION_MARKER) ||
    serialized.includes(RESOURCE_BODY_CANARY)
  ) {
    throw new Error("Skill resource evidence retained private model content");
  }
} finally {
  if (ownedRoot) await rm(ownedRoot, { recursive: true, force: true });
}

if (!ownedRoot || (await lstat(ownedRoot).catch(() => undefined))) {
  throw new Error("Skill resource dogfood cleanup failed");
}
if (!result) throw new Error("Skill resource dogfood evidence is unavailable");
await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, {
  mode: 0o600,
});
process.stdout.write(`${canonicalJson(result)}\n`);

function verifyFrames(frames) {
  if (frames.some((frame) => frame?.type === "error")) {
    throw new Error("Skill resource CLI emitted an error frame");
  }
  const done = frames.at(-1);
  const snapshots = frames.filter((frame) => frame?.type === "snapshot");
  if (
    done?.type !== "done" ||
    done.status !== "completed" ||
    typeof done.runId !== "string" ||
    snapshots.length !== 1
  ) {
    throw new Error("Skill resource CLI completion evidence is invalid");
  }
  const detail = snapshots[0]?.detail;
  const events = Array.isArray(detail?.events) ? detail.events : [];
  const run = Array.isArray(detail?.runs)
    ? detail.runs.find((item) => item.id === done.runId)
    : undefined;
  if (
    run?.configuration?.model?.provider !== PROVIDER ||
    run.configuration.model.id !== MODEL ||
    !run.configuration.enabledTools?.includes("skill_load") ||
    run.configuration.enabledTools.includes("skill_resource")
  ) {
    throw new Error("Skill resource Run configuration is invalid");
  }
  const bindingEvents = events.filter(
    (event) => event.runId === done.runId && event.type === "context.skills",
  );
  const binding = bindingEvents[0]?.payload;
  if (
    bindingEvents.length !== 1 ||
    !isStandardSkillCatalogBindingV2(binding) ||
    JSON.stringify(binding).includes(APPLICATION_MARKER)
  ) {
    throw new Error("Skill resource base snapshot evidence is invalid");
  }
  const skillStarts = toolEvents(
    events,
    done.runId,
    "tool.started",
    "skill_load",
  );
  const skillTerminals = toolEvents(
    events,
    done.runId,
    "tool.completed",
    "skill_load",
  );
  const resourceTerminals = toolEvents(
    events,
    done.runId,
    "tool.completed",
    "skill_resource",
  );
  const resourceFailures = toolEvents(
    events,
    done.runId,
    "tool.failed",
    "skill_resource",
  );
  const selection = skillStarts[0]?.payload?.details;
  const skillReceipt = skillTerminals[0]?.payload?.details;
  const resourceReceipt = resourceTerminals[0]?.payload?.details;
  if (
    skillStarts.length !== 1 ||
    skillTerminals.length !== 1 ||
    resourceTerminals.length !== 1 ||
    resourceFailures.length !== 0 ||
    !isStandardSkillLoadSelectionV2(selection) ||
    !isStandardSkillLoadReceiptV2(skillReceipt) ||
    !isSkillResourceLoadReceiptV1(resourceReceipt) ||
    resourceReceipt.skillName !== "research-brief" ||
    resourceReceipt.resourcePath !== RESOURCE_PATH ||
    resourceReceipt.rawContentSha256 !== sha256(RESOURCE_TEXT) ||
    resourceReceipt.rootKind !== "project_standard"
  ) {
    throw new Error("Skill resource lifecycle evidence is invalid");
  }
  const assistantText = latestAssistantText(events, done.runId);
  if (!assistantText.includes(APPLICATION_MARKER)) {
    throw new Error("Real model did not apply the lazy resource");
  }
  if (JSON.stringify(events).includes(RESOURCE_BODY_CANARY)) {
    throw new Error("Durable events retained the resource-body canary");
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
      ...(event.payload?.operation
        ? { operation: event.payload.operation }
        : {}),
    }));
  requireOrderedTools(toolSequence);
  return {
    done,
    detail,
    binding,
    selection,
    skillReceipt,
    resourceReceipt,
    assistantText,
    toolSequence,
  };
}

function toolEvents(events, runId, eventType, toolName) {
  return events.filter(
    (event) =>
      event.runId === runId &&
      event.type === eventType &&
      event.payload?.toolName === toolName,
  );
}

function latestAssistantText(events, runId) {
  return (
    events.findLast(
      (event) => event.runId === runId && event.type === "message.assistant",
    )?.payload?.text ?? ""
  );
}

function requireOrderedTools(tools) {
  let cursor = -1;
  for (const toolName of ["skill_load", "skill_resource"]) {
    cursor = tools.findIndex(
      (tool, index) =>
        index > cursor &&
        tool.status === "completed" &&
        tool.toolName === toolName,
    );
    if (cursor < 0) throw new Error(`Dogfood evidence is missing ${toolName}`);
  }
}

async function prepareSkills(workspaceRoot) {
  const copies = [];
  for (const name of ["research-brief", "data-analysis"]) {
    const source = path.join(REPO_ROOT, "skills", name, "SKILL.md");
    const directory = path.join(workspaceRoot, ".agents", "skills", name);
    await mkdir(directory, { recursive: true });
    const original = await readFile(source, "utf8");
    const content =
      name === "research-brief"
        ? `${original.trimEnd()}\n\n## Dogfood quality gate\n\nBefore answering this bounded task, call \`skill_resource\` with \`name\` set to \`research-brief\` and \`path\` set to \`${RESOURCE_PATH}\`. Follow that resource's final-answer requirement.\n`
        : original;
    const target = path.join(directory, "SKILL.md");
    await writeFile(target, content);
    copies.push({
      name,
      relativePath: `.agents/skills/${name}/SKILL.md`,
      contentSha256: sha256(content),
    });
  }
  const resource = path.join(
    workspaceRoot,
    ".agents",
    "skills",
    "research-brief",
    RESOURCE_PATH,
  );
  await mkdir(path.dirname(resource), { recursive: true });
  await writeFile(resource, RESOURCE_TEXT);
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
      if (timedOut) reject(new Error("Skill resource CLI timed out"));
      else resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
