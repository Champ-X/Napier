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

import { isSkillLifecycleProjectionV1 } from "@napier/contracts/skill-lifecycle";
import { isStandardSkillCatalogBindingV2 } from "@napier/contracts/skill-load-standard";
import {
  createLocalAgentRuntime,
  createThreadReplayBundle,
  verifyThreadReplayBundle,
} from "@napier/runtime";

import {
  assertSecretAbsent,
  canonicalJson,
  parseJsonlFrames,
  sha256,
} from "./skill-load-fast-core-evidence-lib.mjs";
import {
  allowedCredentialEnvironment,
  runBoundedChild,
} from "./skill-lifecycle-ab-process.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT = path.join(
  REPO_ROOT,
  "docs/artifacts/skill-lifecycle-stage0/ab-dogfood.json",
);
const ENTRYPOINT = path.join(REPO_ROOT, "apps/cli/dist/index.js");
const CREDENTIAL_ENV = "DEEPSEEK_API_KEY";
const PROVIDER = "deepseek";
const MODEL = "deepseek-v4-flash";
const TIMEOUT_MS = 240_000;
const MAX_OUTPUT_BYTES = 24 * 1024 * 1024;
const TASKS = [
  {
    id: "software_delivery",
    preset: "coding",
    skillName: "software-delivery",
    applicationMode: "software_change_observed",
    prompt:
      'First call skill_load for software-delivery; if it is unavailable, continue without it. Then use exactly this bounded workflow: read_file on config/discount.json; call apply_patch with operation replace, path config/discount.json, expectedSha256 3604e416d594495166e56f8690993b6452ebc0f5a49e6f60280523608c17a466, and one edit replacing the exact text `"discountOperator": "add"` with `"discountOperator": "subtract"`; finally read_file on config/discount.json again and confirm the changed value. Follow the loaded Skill when available. Finish only after the read-back shows subtract.',
  },
  {
    id: "research",
    preset: "research",
    skillName: "research-brief",
    applicationMode: "research_evidence_cited",
    prompt:
      "First call skill_load for research-brief; if it is unavailable, continue without it. Determine the release date of Node.js v24.0.0 from its official release page at https://nodejs.org/en/blog/release/v24.0.0. Use live tools, capture the official source, and put a citation immediately after the claim. Follow the loaded Skill when available. This is a bounded one-source task: do not create or update a plan; complete directly within five model turns.",
  },
];

const credential = process.env[CREDENTIAL_ENV]?.trim();
if (!credential) throw new Error(`${CREDENTIAL_ENV} is unavailable`);

let ownedRoot, result;
try {
  ownedRoot = await mkdtemp(path.join(tmpdir(), "napier-skill-ab."));
  const env = allowedCredentialEnvironment(CREDENTIAL_ENV, credential);
  const campaigns = [];
  for (const task of TASKS) {
    const withSkill = await runVariant(task, true, ownedRoot, env, credential);
    const withoutSkill = await runVariant(
      task,
      false,
      ownedRoot,
      env,
      credential,
    );
    campaigns.push({
      task: task.id,
      preset: task.preset,
      skillName: task.skillName,
      promptSha256: sha256(task.prompt),
      withSkill,
      withoutSkill,
      delta: {
        outcomePassed:
          Number(withSkill.outcomePassed) - Number(withoutSkill.outcomePassed),
        durationMs: withSkill.durationMs - withoutSkill.durationMs,
        inputTokens:
          withSkill.usage.inputTokens - withoutSkill.usage.inputTokens,
        outputTokens:
          withSkill.usage.outputTokens - withoutSkill.usage.outputTokens,
        totalTokens:
          withSkill.usage.totalTokens - withoutSkill.usage.totalTokens,
        costUsd: withSkill.usage.costUsd - withoutSkill.usage.costUsd,
        toolCallCount: withSkill.toolCallCount - withoutSkill.toolCallCount,
        modelTurnCount: withSkill.modelTurnCount - withoutSkill.modelTurnCount,
      },
      skillImpactObserved:
        withSkill.lifecycle.state === "applied" &&
        withoutSkill.lifecycle.state !== "applied",
    });
  }
  if (
    campaigns.some(
      (campaign) =>
        !campaign.withSkill.outcomePassed ||
        !campaign.withoutSkill.outcomePassed ||
        !campaign.skillImpactObserved,
    )
  ) {
    throw new Error(
      "Skill A/B campaign did not satisfy both outcomes and lifecycle contrast",
    );
  }
  const core = {
    kind: "napier.skill-lifecycle-ab-dogfood",
    schemaVersion: 1,
    result: "passed",
    provider: PROVIDER,
    model: MODEL,
    credentialLocator: CREDENTIAL_ENV,
    comparisonPolicy: {
      sameModel: true,
      samePromptWithinTask: true,
      samePresetWithinTask: true,
      isolatedWorkspaceAndState: true,
      productionCli: true,
      trialCountPerVariant: 1,
    },
    cliEntrypointSha256: sha256(await readFile(ENTRYPOINT)),
    campaigns,
    credentialCanaryMatches: 0,
    rawJsonlRetained: false,
    privateSkillContentRetained: false,
    taskRootRemoved: true,
  };
  result = { ...core, contentSha256: sha256(canonicalJson(core)) };
  assertSecretAbsent([canonicalJson(result)], credential);
} finally {
  if (ownedRoot) await rm(ownedRoot, { recursive: true, force: true });
}

if (!ownedRoot || (await lstat(ownedRoot).catch(() => undefined))) {
  throw new Error("Skill A/B dogfood cleanup failed");
}
if (!result) throw new Error("Skill A/B evidence is unavailable");
await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, {
  mode: 0o600,
});
process.stdout.write(`${canonicalJson(result)}\n`);

async function runVariant(task, withSkill, ownedRoot, env, credentialValue) {
  const label = withSkill ? "with-skill" : "without-skill";
  const root = path.join(ownedRoot, `${task.id}-${label}`);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "state");
  await prepareWorkspace(task, workspaceRoot, withSkill);

  const before = await createLocalAgentRuntime({
    workspaceRoot,
    dataRoot,
    env,
  });
  const agent = before.store.listAgents()[0];
  if (!agent) throw new Error("Default Agent is unavailable");
  const profileBeforeSha256 = sha256(canonicalJson(agent));
  const revisionCountBefore = before.store.listAgentRevisions(agent.id).length;
  await before.shutdown();

  const child = await runBoundedChild(
    process.execPath,
    [
      ENTRYPOINT,
      "run",
      "--workspace",
      workspaceRoot,
      "--data-root",
      dataRoot,
      "--prompt",
      task.prompt,
      "--model",
      `${PROVIDER}/${MODEL}`,
      "--credential-env",
      CREDENTIAL_ENV,
      "--preset",
      task.preset,
      "--timeout-ms",
      String(TIMEOUT_MS),
      "--jsonl",
    ],
    env,
    {
      cwd: REPO_ROOT,
      timeoutMs: TIMEOUT_MS + 15_000,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      label: "Skill A/B CLI",
    },
  );
  assertSecretAbsent([child.stdout, child.stderr], credentialValue);
  const verified = await verifyVariant(
    task,
    withSkill,
    workspaceRoot,
    parseJsonlFrames(child.stdout),
  );
  if (child.code !== 0) throw new Error(`${task.id}/${label} CLI failed`);

  const after = await createLocalAgentRuntime({ workspaceRoot, dataRoot, env });
  const profileAfterSha256 = sha256(
    canonicalJson(after.store.getAgent(agent.id)),
  );
  const revisions = after.store.listAgentRevisions(agent.id);
  const persisted = await after.store.listEvents(verified.detail.thread.id);
  const persistedLifecycle = persisted.find(
    (event) =>
      event.runId === verified.done.runId &&
      event.type === "skill.lifecycle" &&
      event.payload?.skillName === task.skillName,
  );
  const replay = verifyThreadReplayBundle(
    createThreadReplayBundle(verified.detail, new Date(), revisions),
  );
  await after.shutdown();
  if (
    profileBeforeSha256 !== profileAfterSha256 ||
    revisionCountBefore !== revisions.length ||
    replay.status !== "valid" ||
    !isSkillLifecycleProjectionV1(persistedLifecycle?.payload)
  ) {
    throw new Error(`${task.id}/${label} persistence invariant failed`);
  }

  return {
    variant: label,
    outcomePassed: true,
    durationMs: child.durationMs,
    exitCode: child.code,
    runIdSha256: sha256(verified.done.runId),
    stdoutBytes: Buffer.byteLength(child.stdout),
    stdoutSha256: sha256(child.stdout),
    stderrBytes: Buffer.byteLength(child.stderr),
    stderrSha256: sha256(child.stderr),
    usage: usage(verified.run.usage),
    toolCallCount: verified.tools.length,
    modelTurnCount: verified.modelTurnCount,
    catalogState: verified.catalogState,
    lifecycle: verified.lifecycle,
    toolSequence: verified.tools,
    replay: {
      status: replay.status,
      contentSha256: replay.contentSha256,
      eventStreamSha256: replay.eventStreamSha256,
      eventCount: replay.eventCount,
    },
    profileBeforeSha256,
    profileAfterSha256,
    revisionCountBefore,
    revisionCountAfter: revisions.length,
  };
}

async function prepareWorkspace(task, workspaceRoot, withSkill) {
  await mkdir(workspaceRoot, { recursive: true });
  if (task.id === "software_delivery") {
    await mkdir(path.join(workspaceRoot, "config"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "config", "discount.json"),
      '{\n  "discountOperator": "add"\n}\n',
    );
  }
  if (!withSkill) return;
  const skillDirectory = path.join(
    workspaceRoot,
    ".agents",
    "skills",
    task.skillName,
  );
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    path.join(skillDirectory, "SKILL.md"),
    await readFile(
      path.join(REPO_ROOT, "skills", task.skillName, "SKILL.md"),
      "utf8",
    ),
  );
}

async function verifyVariant(task, withSkill, workspaceRoot, frames) {
  if (frames.some((frame) => frame?.type === "error")) {
    throw new Error(`${task.id} CLI emitted an error frame`);
  }
  const done = frames.at(-1);
  const snapshots = frames.filter((frame) => frame?.type === "snapshot");
  const detail = snapshots[0]?.detail;
  const events = Array.isArray(detail?.events) ? detail.events : [];
  const run = Array.isArray(detail?.runs)
    ? detail.runs.find((candidate) => candidate.id === done?.runId)
    : undefined;
  if (
    done?.type !== "done" ||
    done.status !== "completed" ||
    snapshots.length !== 1 ||
    run?.status !== "completed" ||
    run.configuration?.model?.provider !== PROVIDER ||
    run.configuration.model.id !== MODEL
  ) {
    const diagnostics = {
      doneType: done?.type,
      doneStatus: done?.status,
      snapshotCount: snapshots.length,
      runStatus: run?.status,
      runError: String(run?.error ?? "").slice(0, 240),
      provider: run?.configuration?.model?.provider,
      model: run?.configuration?.model?.id,
      finalEvents: events.slice(-8).map((event) => ({
        type: event.type,
        toolName: event.payload?.toolName,
        resultStatus: event.payload?.details?.status,
      })),
    };
    throw new Error(
      `${task.id} completion/model evidence is invalid: ${canonicalJson(diagnostics)}`,
    );
  }
  const runEvents = events.filter((event) => event.runId === done.runId);
  const binding = runEvents.find(
    (event) => event.type === "context.skills",
  )?.payload;
  const request = isStandardSkillCatalogBindingV2(binding)
    ? binding.configuredSkillRequests.find(
        (candidate) => candidate.canonicalName === task.skillName,
      )
    : undefined;
  const expectedCatalogState = withSkill ? "loadable" : "unavailable";
  if (!request || request.state !== expectedCatalogState) {
    throw new Error(`${task.id} catalog A/B state is invalid`);
  }
  const lifecycleEvent = runEvents.find(
    (event) =>
      event.type === "skill.lifecycle" &&
      event.payload?.skillName === task.skillName,
  );
  const lifecycleValid = isSkillLifecycleProjectionV1(lifecycleEvent?.payload);
  if (
    withSkill &&
    (!lifecycleValid ||
      lifecycleEvent.payload.skillName !== task.skillName ||
      lifecycleEvent.payload.state !== "applied" ||
      lifecycleEvent.payload.applicationMode !== task.applicationMode)
  ) {
    throw new Error(
      `${task.id} applied lifecycle evidence is invalid: ${canonicalJson({
        lifecycle: lifecycleValid ? lifecycleEvent.payload : undefined,
        tools: runEvents
          .filter(
            (event) =>
              event.type === "tool.completed" || event.type === "tool.failed",
          )
          .map((event) => ({
            type: event.type,
            toolName: event.payload?.toolName,
            resultStatus: event.payload?.details?.status,
          })),
      })}`,
    );
  }
  if (
    !withSkill &&
    (!lifecycleValid || lifecycleEvent.payload.state !== "unavailable")
  ) {
    throw new Error(`${task.id} unavailable Skill lifecycle is invalid`);
  }
  const tools = runEvents
    .filter(
      (event) =>
        event.type === "tool.completed" || event.type === "tool.failed",
    )
    .map((event) => ({
      seq: event.seq,
      toolName: event.payload?.toolName,
      status: event.type === "tool.completed" ? "completed" : "failed",
      ...(event.payload?.details?.action
        ? { action: event.payload.details.action }
        : {}),
      ...(event.payload?.details?.status
        ? { resultStatus: event.payload.details.status }
        : {}),
    }));
  requireOutcomeTools(task, tools);
  const assistantText =
    runEvents.findLast((event) => event.type === "message.assistant")?.payload
      ?.text ?? "";
  if (task.id === "research") {
    if (
      !/(?:May 6, 2025|2025-05-06|6 May 2025)/iu.test(assistantText) ||
      !/\[citation:citation_[a-z0-9]+\]/u.test(assistantText)
    ) {
      throw new Error("Research outcome is missing the date or citation");
    }
  } else {
    const configuration = JSON.parse(
      await readFile(
        path.join(workspaceRoot, "config", "discount.json"),
        "utf8",
      ),
    );
    if (configuration.discountOperator !== "subtract") {
      throw new Error("Software outcome did not contain the verified fix");
    }
  }
  if (JSON.stringify(runEvents).includes(workspaceRoot)) {
    throw new Error(`${task.id} durable evidence retained the workspace root`);
  }
  return {
    done,
    detail,
    run,
    catalogState: request.state,
    lifecycle: lifecycleValid
      ? {
          state: lifecycleEvent.payload.state,
          applicationMode: lifecycleEvent.payload.applicationMode,
          proofEventCount: lifecycleEvent.payload.proofEventSeqs?.length ?? 0,
          contentSha256: lifecycleEvent.payload.contentSha256,
        }
      : { state: "unavailable", proofEventCount: 0 },
    tools,
    modelTurnCount: runEvents.filter((event) => event.type === "model.response")
      .length,
  };
}

function requireOutcomeTools(task, tools) {
  if (
    task.id === "research" &&
    !tools.some(
      (tool) =>
        tool.status === "completed" &&
        (tool.toolName === "web_fetch" || tool.toolName === "browser"),
    )
  ) {
    throw new Error("research outcome is missing a live source tool");
  }
  const required =
    task.id === "research"
      ? [
          ["research_source", "capture*"],
          ["research_source", "cite"],
        ]
      : [["apply_patch"], ["read_file"]];
  let cursor = -1;
  for (const [toolName, action, resultStatus] of required) {
    cursor = tools.findIndex(
      (tool, index) =>
        index > cursor &&
        tool.status === "completed" &&
        tool.toolName === toolName &&
        (action === undefined ||
          (action === "capture*"
            ? tool.action?.startsWith("capture")
            : tool.action === action)) &&
        (resultStatus === undefined || tool.resultStatus === resultStatus),
    );
    if (cursor < 0)
      throw new Error(`${task.id} outcome is missing ${toolName}`);
  }
}

function usage(value = {}) {
  const inputTokens = Number(value.inputTokens ?? 0);
  const outputTokens = Number(value.outputTokens ?? 0);
  const cacheReadTokens = Number(value.cacheReadTokens ?? 0);
  const cacheWriteTokens = Number(value.cacheWriteTokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens:
      inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    costUsd: Number(value.costUsd ?? 0),
  };
}
