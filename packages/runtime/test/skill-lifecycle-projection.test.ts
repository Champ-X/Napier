import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { JsonValue, RunEvent } from "@napier/contracts";
import { isSkillLifecycleProjectionV1 } from "@napier/contracts/skill-lifecycle";
import { afterEach, describe, expect, it } from "vitest";

import { createSkillLoadTool } from "../src/skill-load-tool.js";
import {
  projectActiveSkillLifecycles,
  recordActiveSkillLifecycles,
} from "../src/skill-lifecycle-projection.js";
import { buildStandardSkillSnapshot } from "../src/standard-skill-snapshot.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];
const runId = "run_skill_lifecycle_12345678";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("active Skill lifecycle projection", () => {
  it("projects a default Skill from the bundled source in an empty workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-skill-bundled-"));
    roots.push(root);
    const fixture = {
      workspace: path.join(root, "workspace"),
      home: path.join(root, "home"),
    };
    await Promise.all([mkdir(fixture.workspace), mkdir(fixture.home)]);

    const lifecycle = await loadedLifecycle(fixture, "research-brief");

    expect(projectActiveSkillLifecycles(lifecycle, runId)[0]).toMatchObject({
      state: "loaded",
      source: "bundled",
      rootKind: "bundled_standard",
    });
  });

  it("proves software application only after a completed mutation and passed verification", async () => {
    const fixture = await setup("software-delivery");
    const lifecycle = await loadedLifecycle(fixture, "software-delivery");
    const loaded = projectActiveSkillLifecycles(lifecycle, runId)[0];
    expect(loaded).toMatchObject({ state: "loaded" });

    lifecycle.push(
      event(5, "tool.completed", {
        callId: "call_patch",
        toolName: "apply_patch",
        status: "completed",
        resultSha256: "4".repeat(64),
      }),
      event(6, "tool.completed", {
        callId: "call_verify",
        toolName: "verify_workspace",
        status: "completed",
        details: { status: "failed" },
      }),
    );
    expect(projectActiveSkillLifecycles(lifecycle, runId)[0]).toMatchObject({
      state: "loaded",
    });

    lifecycle.push(
      event(7, "tool.completed", {
        callId: "call_verify_passed",
        toolName: "verify_workspace",
        status: "completed",
        details: { status: "passed" },
      }),
    );
    const applied = projectActiveSkillLifecycles(lifecycle, runId)[0];
    expect(isSkillLifecycleProjectionV1(applied)).toBe(true);
    expect(applied).toMatchObject({
      state: "applied",
      applicationMode: "software_change_verified",
      proofEventSeqs: [5, 7],
      source: "project",
      rootKind: "project_standard",
    });
  });

  it("proves research application from ordered capture and citation evidence", async () => {
    const fixture = await setup("research-brief");
    const lifecycle = await loadedLifecycle(fixture, "research-brief");
    lifecycle.push(
      event(5, "tool.completed", {
        callId: "call_capture",
        toolName: "research_source",
        status: "completed",
        details: researchDetails("capture_fetch"),
      }),
      event(6, "tool.completed", {
        callId: "call_cite",
        toolName: "research_source",
        status: "completed",
        details: researchDetails("cite"),
      }),
    );
    expect(projectActiveSkillLifecycles(lifecycle, runId)[0]).toMatchObject({
      state: "applied",
      applicationMode: "research_evidence_cited",
      proofEventSeqs: [5, 6],
    });

    lifecycle[4] = event(6, "tool.completed", {
      callId: "call_cite",
      toolName: "research_source",
      status: "completed",
      details: researchDetails("cite", "f".repeat(64)),
    });
    expect(projectActiveSkillLifecycles(lifecycle, runId)[0]).toMatchObject({
      state: "loaded",
    });
  });

  it("proves data analysis from complete inspection and bound transform", async () => {
    const fixture = await setup("data-analysis");
    const lifecycle = await loadedLifecycle(fixture, "data-analysis");
    lifecycle.push(
      event(5, "tool.completed", {
        callId: "call_inspect",
        toolName: "inspect_data",
        status: "completed",
        details: {
          sha256: "1".repeat(64),
          truncated: false,
        },
      }),
      event(6, "tool.completed", {
        callId: "call_transform",
        toolName: "data_frame",
        status: "completed",
        details: {
          kind: "napier.data-frame",
          action: "transform",
          sourceSha256: "1".repeat(64),
          operationCount: 3,
          rowCount: 2,
          resultSha256: "2".repeat(64),
        },
      }),
    );
    expect(projectActiveSkillLifecycles(lifecycle, runId)[0]).toMatchObject({
      state: "applied",
      applicationMode: "data_analysis_transformed",
      proofEventSeqs: [5, 6],
    });

    lifecycle[4] = event(6, "tool.completed", {
      callId: "call_transform",
      toolName: "data_frame",
      status: "completed",
      details: {
        kind: "napier.data-frame",
        action: "transform",
        sourceSha256: "3".repeat(64),
        operationCount: 3,
        rowCount: 2,
        resultSha256: "2".repeat(64),
      },
    });
    expect(projectActiveSkillLifecycles(lifecycle, runId)[0]).toMatchObject({
      state: "loaded",
    });
  });

  it("proves an observed software change from write/read hash continuity", async () => {
    const fixture = await setup("software-delivery");
    const lifecycle = await loadedLifecycle(fixture, "software-delivery");
    lifecycle.push(
      event(5, "tool.completed", {
        callId: "call_patch",
        toolName: "apply_patch",
        status: "completed",
        afterSha256: "9".repeat(64),
      }),
      event(6, "tool.completed", {
        callId: "call_read_back",
        toolName: "read_file",
        status: "completed",
        details: { sha256: "9".repeat(64) },
      }),
    );

    expect(projectActiveSkillLifecycles(lifecycle, runId)[0]).toMatchObject({
      state: "applied",
      applicationMode: "software_change_observed",
      proofEventSeqs: [5, 6],
    });
  });

  it("retains selected when the load attempt has no terminal event", async () => {
    const fixture = await setup("software-delivery");
    const snapshot = await buildStandardSkillSnapshot(
      fixture.workspace,
      ["software-delivery"],
      undefined,
      { userHome: fixture.home },
    );
    const selection = createSkillLoadTool(snapshot).selection({
      name: "software-delivery",
    });
    const lifecycle = [
      event(2, "context.skills", snapshot.binding as unknown as JsonValue),
      event(3, "tool.started", {
        callId: "call_load",
        toolName: "skill_load",
        status: "started",
        details: selection,
      }),
    ];
    expect(projectActiveSkillLifecycles(lifecycle, runId)[0]).toMatchObject({
      state: "selected",
      selectedSeq: 3,
    });
  });

  it("projects an unavailable configured Skill from the bound catalog", async () => {
    const fixture = await setup("available-skill");
    const snapshot = await buildStandardSkillSnapshot(
      fixture.workspace,
      ["missing-skill"],
      undefined,
      { userHome: fixture.home },
    );
    const result = await createSkillLoadTool(snapshot).execute(
      "call_missing",
      { name: "missing-skill" },
      new AbortController().signal,
    );
    const lifecycle = [
      event(2, "context.skills", snapshot.binding as unknown as JsonValue),
      event(3, "tool.failed", {
        callId: "call_missing",
        toolName: "skill_load",
        status: "failed",
        details: result.details,
      }),
    ];

    const unavailable = projectActiveSkillLifecycles(lifecycle, runId)[0];
    expect(isSkillLifecycleProjectionV1(unavailable)).toBe(true);
    expect(unavailable).toMatchObject({
      skillName: "missing-skill",
      state: "unavailable",
      source: "composite",
      failureContentSha256:
        snapshot.binding.configuredSkillRequests[0]?.state === "unavailable"
          ? snapshot.binding.configuredSkillRequests[0].failureContentSha256
          : undefined,
    });
  });

  it("records lifecycle progress once per distinct content state", async () => {
    const fixture = await setup("software-delivery");
    const snapshot = await buildStandardSkillSnapshot(
      fixture.workspace,
      ["software-delivery"],
      undefined,
      { userHome: fixture.home },
    );
    const tool = createSkillLoadTool(snapshot);
    const selection = tool.selection({ name: "software-delivery" });
    const result = await tool.execute(
      "call_load",
      { name: "software-delivery" },
      new AbortController().signal,
    );
    const store = new LocalStore({
      workspaceRoot: fixture.workspace,
      dataRoot: path.join(roots.at(-1)!, "state"),
    });
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Lifecycle",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    await append(store, thread.id, run.id, "context.skills", snapshot.binding);
    await append(store, thread.id, run.id, "tool.started", {
      callId: "call_load",
      toolName: "skill_load",
      status: "started",
      details: selection,
    });
    await append(store, thread.id, run.id, "tool.completed", {
      callId: "call_load",
      toolName: "skill_load",
      status: "completed",
      details: result.details,
    });

    expect(
      (await recordActiveSkillLifecycles(store, thread.id, run.id))[0],
    ).toMatchObject({
      state: "loaded",
    });
    await append(store, thread.id, run.id, "tool.completed", {
      callId: "call_patch",
      toolName: "apply_patch",
      status: "completed",
      afterSha256: "9".repeat(64),
    });
    await append(store, thread.id, run.id, "tool.completed", {
      callId: "call_read_back",
      toolName: "read_file",
      status: "completed",
      details: { sha256: "9".repeat(64) },
    });
    expect(
      (await recordActiveSkillLifecycles(store, thread.id, run.id))[0],
    ).toMatchObject({
      state: "applied",
    });
    await recordActiveSkillLifecycles(store, thread.id, run.id);
    expect(
      (await store.listEvents(thread.id))
        .filter(
          (item) => item.runId === run.id && item.type === "skill.lifecycle",
        )
        .map((item) => (item.payload as { state?: string }).state),
    ).toEqual(["loaded", "applied"]);
  });
});

async function append(
  store: LocalStore,
  threadId: string,
  targetRunId: string,
  type: string,
  payload: unknown,
) {
  const contextEvent = type === "context.skills";
  await store.appendEvent({
    threadId,
    runId: targetRunId,
    type,
    category: contextEvent ? "system" : "tool",
    visibility: contextEvent ? "debug" : "user",
    payload: payload as JsonValue,
  });
}

function researchDetails(
  action: "capture_fetch" | "cite",
  sourceContentSha256 = "1".repeat(64),
) {
  return {
    kind: "napier.research-source",
    schemaVersion: 1,
    action,
    sourceKind: "web_fetch",
    sourceId: "source_fixture12345678",
    sourceContentSha256,
    sourceUrlSha256: "2".repeat(64),
    sourceOriginSha256: "3".repeat(64),
    sourceTitleSha256: "4".repeat(64),
    sourceTextSha256: "5".repeat(64),
    sourceLineCount: 1,
    sourceTextChars: 48,
    sourceTruncated: false,
    sourceCount: 1,
    citationCount: action === "cite" ? 1 : 0,
    sourceSetSha256: "6".repeat(64),
    webSourceContentSha256: "7".repeat(64),
    webSourceBodySha256: "8".repeat(64),
    webSourceFormat: "text",
    webSourceLineCount: 1,
    webSourceRenderMode: "static",
    browserFallbackStatus: "not_needed",
    ...(action === "cite"
      ? {
          citationId: "citation_fixture12345678",
          citationTokenSha256: "9".repeat(64),
          citationStartLine: 1,
          citationEndLine: 1,
          citationQuoteSha256: "a".repeat(64),
          citationClaimSha256: "b".repeat(64),
        }
      : {}),
  };
}

async function setup(name: string) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-skill-lifecycle-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  const home = path.join(root, "home");
  const skill = path.join(workspace, ".agents", "skills", name);
  await mkdir(skill, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(skill, "SKILL.md"),
    `---\nname: ${name}\ndescription: Apply ${name}.\n---\n# ${name}\n`,
  );
  return { workspace, home };
}

async function loadedLifecycle(
  fixture: Awaited<ReturnType<typeof setup>>,
  name: string,
): Promise<RunEvent[]> {
  const snapshot = await buildStandardSkillSnapshot(
    fixture.workspace,
    [name],
    undefined,
    { userHome: fixture.home },
  );
  const tool = createSkillLoadTool(snapshot);
  const selection = tool.selection({ name });
  const result = await tool.execute(
    "call_load",
    { name },
    new AbortController().signal,
  );
  return [
    event(2, "context.skills", snapshot.binding as unknown as JsonValue),
    event(3, "tool.started", {
      callId: "call_load",
      toolName: "skill_load",
      status: "started",
      details: selection,
    }),
    event(4, "tool.completed", {
      callId: "call_load",
      toolName: "skill_load",
      status: "completed",
      details: result.details,
    }),
  ];
}

function event(seq: number, type: string, payload: JsonValue): RunEvent {
  return {
    id: `event_skill_lifecycle_${String(seq).padStart(8, "0")}`,
    threadId: "thread_skill_lifecycle_12345678",
    runId,
    seq,
    type,
    category: "skill",
    visibility: "user",
    createdAt: `2026-08-10T00:00:${String(seq).padStart(2, "0")}.000Z`,
    payload,
  };
}
