import type { RunEvent, StreamFrame } from "@napier/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { streamPrompt } from "../src/thread-run-api";
import { canonicalJson, sha256Canonical } from "../src/stable-digest";
import {
  sha256Text,
  NapierStreamResponseContractError,
} from "../src/api-error";
import { bindRunHarnessProfile } from "../../../packages/runtime/src/model-harness-experiment-profile";

afterEach(() => vi.unstubAllGlobals());

it.each(["missing", "foreign", "duplicate", "late", "tampered", "not_started"])(
  "rejects %s policy evidence in an otherwise valid terminal SSE snapshot",
  async (mode) => {
    const events = await policyEvents();
    if (mode === "missing")
      events[0] = {
        ...events[0]!,
        type: "model.text.delta",
        payload: { delta: "local" },
      };
    if (mode === "foreign") events[0]!.runId = "run_other";
    if (mode === "duplicate")
      events.push({ ...events[0]!, id: "duplicate", seq: 3 });
    if (mode === "late") {
      events.reverse();
      events.forEach((event, index) => (event.seq = index + 1));
    }
    if (mode === "tampered")
      (events[0]!.payload as Record<string, string>).profileSha256 = "a".repeat(
        64,
      );
    if (mode === "not_started")
      events[1] = {
        ...events[1]!,
        type: "model.text.delta",
        payload: { delta: "local" },
      };
    const frames = await terminalFrames(events);
    const accepted: StreamFrame[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(frames)),
    );
    await expect(
      streamPrompt(
        "thread_1",
        {
          text: "Inspect",
          harnessPolicyPreset: "coding-python.v1",
        },
        (frame) => accepted.push(frame),
      ),
    ).rejects.toBeInstanceOf(NapierStreamResponseContractError);
    expect(accepted.some((frame) => frame.type === "done")).toBe(false);
  },
);

it("rejects an unrequested policy and a hidden duplicate despite valid live binding events", async () => {
  const events = await policyEvents();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(await terminalFrames(events))),
  );
  await expect(
    streamPrompt("thread_1", { text: "Inspect" }, () => {}),
  ).rejects.toBeInstanceOf(NapierStreamResponseContractError);
  const prefix = await Promise.all(
    events.map(
      async (event) =>
        ({
          type: "event",
          event,
          eventSha256: await sha256Text(JSON.stringify(event)),
        }) as StreamFrame,
    ),
  );
  const terminal = await terminalFrames([
    ...events,
    { ...events[0]!, id: "duplicate", seq: 3 },
  ]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response([...prefix, ...terminal])),
  );
  await expect(
    streamPrompt(
      "thread_1",
      { text: "Inspect", harnessPolicyPreset: "coding-python.v1" },
      () => {},
    ),
  ).rejects.toBeInstanceOf(NapierStreamResponseContractError);
});

it("accepts a matching durable policy snapshot with or without live events", async () => {
  const events = await policyEvents();
  for (const live of [false, true]) {
    const terminal = await terminalFrames(events);
    const prefix = live
      ? await Promise.all(
          events.map(
            async (event) =>
              ({
                type: "event",
                event,
                eventSha256: await sha256Text(JSON.stringify(event)),
              }) as StreamFrame,
          ),
        )
      : [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response([...prefix, ...terminal])),
    );
    const accepted: StreamFrame[] = [];
    await streamPrompt(
      "thread_1",
      { text: "Inspect", harnessPolicyPreset: "coding-python.v1" },
      (frame) => accepted.push(frame),
    );
    expect(accepted.at(-1)?.type).toBe("done");
  }
});

it("does not borrow an older Run's binding and preserves the ordinary default", async () => {
  const older = (await policyEvents()).map((event) => ({
    ...event,
    runId: "run_old",
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(await terminalFrames(older))),
  );
  await expect(
    streamPrompt(
      "thread_1",
      { text: "Inspect", harnessPolicyPreset: "coding-python.v1" },
      () => {},
    ),
  ).rejects.toThrow();
  await expect(
    streamPrompt("thread_1", { text: "Inspect" }, () => {}),
  ).resolves.toBeUndefined();
});

async function policyEvents(): Promise<RunEvent[]> {
  const options: Parameters<typeof bindRunHarnessProfile>[0] = {
    harnessPolicyPreset: "coding-python.v1",
  };
  const profile = bindRunHarnessProfile(options).harnessExperimentProfile!;
  const content = {
    kind: "napier.harness-policy-binding",
    schemaVersion: 1,
    runId: "run_1",
    profileSha256: profile.contentSha256,
    profileJson: canonicalJson(profile),
  };
  const base = {
    runId: "run_1",
    threadId: "thread_1",
    category: "model",
    visibility: "debug",
    createdAt: "2026-09-14T00:00:00Z",
  } as const;
  return [
    {
      ...base,
      id: "binding",
      seq: 1,
      type: "harness.policy.bound",
      payload: { ...content, contentSha256: await sha256Canonical(content) },
    },
    { ...base, id: "started", seq: 2, type: "run.started", payload: {} },
  ];
}

async function terminalFrames(events: RunEvent[]): Promise<StreamFrame[]> {
  const detail = {
    thread: {
      id: "thread_1",
      agentId: "agent_napier",
      title: "Thread",
      status: "idle",
      createdAt: "2026-09-14T00:00:00Z",
      updatedAt: "2026-09-14T00:00:00Z",
      lastMessage: "",
      eventCount: events.length,
      runIds: ["run_1"],
    },
    agent: { id: "agent_napier" },
    runs: [
      {
        id: "run_1",
        threadId: "thread_1",
        agentId: "agent_napier",
        status: "completed",
        startedAt: "2026-09-14T00:00:00Z",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
        },
      },
    ],
    events,
    plans: [],
    evaluations: [],
    evaluationAdjudications: [],
    evaluationReviewerBallots: [],
    evaluationConsensusResolutions: [],
    evaluationSuites: [],
    evaluationSuiteExecutions: [],
    automaticRecoveryAssessments: [],
    automaticRecoveryAttempts: [],
    subagents: [],
    runControlMessages: [],
    operatorDecisions: [],
    contextCheckpointCalibration: {},
  };
  const text = JSON.stringify(detail),
    detailSha256 = await sha256Text(text);
  const detailBytes = Buffer.byteLength(text),
    eventBytes = Buffer.byteLength(JSON.stringify(events));
  return [
    { type: "snapshot", detail, detailSha256, detailBytes, eventBytes },
    {
      type: "done",
      threadId: "thread_1",
      runId: "run_1",
      status: "completed",
      snapshotSha256: detailSha256,
      snapshotBytes: detailBytes,
      eventCount: events.length,
      eventBytes,
      eventStreamSha256: await sha256Text(
        events.map((event) => JSON.stringify(event)).join("\n"),
      ),
    },
  ] as StreamFrame[];
}

async function response(frames: StreamFrame[]) {
  return new Response(
    frames
      .map(
        (frame) =>
          `${frame.type === "event" ? `id: ${frame.event.seq}\n` : ""}event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`,
      )
      .join(""),
    {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "x-napier-thread-id": "thread_1",
        "x-napier-prompt-requested": "true",
        "x-napier-stream-error-code": "run_failed",
        "x-napier-stream-error-diagnostic": "sha256",
        "x-napier-stream-error-message-sha256": await sha256Text(
          "Run failed while streaming.",
        ),
      },
    },
  );
}
