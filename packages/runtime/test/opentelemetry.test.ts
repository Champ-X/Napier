import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  OpenTelemetryTraceArtifact,
  OtlpKeyValue,
  OtlpSpan,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import { createId } from "../src/ids.js";
import {
  createOpenTelemetryTraceArtifact,
  hashOpenTelemetryTraceArtifact,
  validateOpenTelemetryTraceArtifact,
  verifyOpenTelemetryTraceArtifact,
} from "../src/opentelemetry.js";
import { LocalStore } from "../src/store.js";

const temporaryRoots: string[] = [];
const openStores: LocalStore[] = [];

afterEach(async () => {
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createStore(): Promise<LocalStore> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-otel-"));
  temporaryRoots.push(root);
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  });
  openStores.push(store);
  await store.initialize();
  return store;
}

function spans(artifact: OpenTelemetryTraceArtifact): OtlpSpan[] {
  return artifact.otlp.resourceSpans[0]!.scopeSpans[0]!.spans;
}

function attributeValue(
  attributes: OtlpKeyValue[],
  key: string,
): string | number | boolean | undefined {
  const value = attributes.find((item) => item.key === key)?.value;
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("boolValue" in value) return value.boolValue;
  if ("intValue" in value) return Number(value.intValue);
  return value.doubleValue;
}

describe("OpenTelemetry trace export", () => {
  it("maps the Ledger into deterministic privacy-safe OTLP spans", async () => {
    const store = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "OTLP privacy regression",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "faux-secure", id: "faux-1" },
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "run.started",
      category: "lifecycle",
      visibility: "debug",
      payload: {
        agentId: agent.id,
        model: "faux-secure/faux-1",
        source: "user",
      },
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "message.user",
      category: "message",
      visibility: "user",
      payload: {
        role: "user",
        text: "TOP_SECRET_PROMPT",
      },
    });
    const usage = {
      inputTokens: 42,
      outputTokens: 13,
      cacheReadTokens: 7,
      cacheWriteTokens: 2,
      costUsd: 0.0125,
    };
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "model.response",
      category: "model",
      visibility: "debug",
      payload: {
        text: "TOP_SECRET_COMPLETION",
        reasoning: "TOP_SECRET_REASONING",
        model: "faux-secure/faux-1",
        stopReason: "toolUse",
        usage,
        toolCalls: [
          {
            id: "call_read",
            name: "read_file",
            arguments: { path: "TOP_SECRET_PATH" },
          },
        ],
      },
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "tool.started",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_read",
        toolName: "read_file",
        status: "started",
        input: { path: "TOP_SECRET_PATH" },
      },
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_read",
        toolName: "read_file",
        status: "completed",
        output: "TOP_SECRET_TOOL_OUTPUT",
      },
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "tool.started",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_unknown",
        toolName: "write_file",
        status: "started",
        input: { path: "TOP_SECRET_UNKNOWN_PATH" },
      },
    });
    const task = await store.createSubagentTask({
      threadId: thread.id,
      runId: run.id,
      role: "reviewer",
      description: "TOP_SECRET_DESCRIPTION",
      prompt: "TOP_SECRET_SUBAGENT_PROMPT",
      model: { provider: "faux-secure", id: "faux-1" },
    });
    await store.startSubagentTask(task.id);
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "subagent.step",
      category: "subagent",
      visibility: "user",
      payload: {
        taskId: task.id,
        role: "reviewer",
        status: "running",
        text: "TOP_SECRET_SUBAGENT_RESULT",
        messageIndex: 1,
      },
    });
    await store.finishSubagentTask(task.id, {
      status: "completed",
      stopReason: "completed",
      result: "TOP_SECRET_SUBAGENT_RESULT",
      usage: {
        inputTokens: 8,
        outputTokens: 3,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.001,
      },
    });
    await store.queueRunControlMessage({
      threadId: thread.id,
      runId: run.id,
      mode: "steering",
      text: "TOP_SECRET_RUN_CONTROL_MESSAGE",
    });
    await store.recordAgentMilestone({
      threadId: thread.id,
      runId: run.id,
      phase: "execution",
      title: "TOP_SECRET_MILESTONE_TITLE",
      summary: "TOP_SECRET_MILESTONE_SUMMARY",
      completedItems: ["TOP_SECRET_MILESTONE_COMPLETED"],
      openLoops: ["TOP_SECRET_MILESTONE_OPEN_LOOP"],
    });
    const advisorIssues = [
      {
        code: "evidence" as const,
        severity: "warning" as const,
        guidanceSha256: "a".repeat(64),
      },
    ];
    const advisorReviewContent = {
      kind: "napier.independent-model-advisor-review" as const,
      schemaVersion: 1 as const,
      policyId: "napier.independent-model-advisor.v1" as const,
      turnSource: "user",
      candidateModel: { provider: "faux-secure", id: "faux-1" },
      reviewerModel: { provider: "faux-reviewer", id: "faux-2" },
      verdict: "revise" as const,
      score: 61,
      risk: "medium" as const,
      issues: advisorIssues,
      diagnosticCodes: [],
      candidateTextSha256: "b".repeat(64),
      candidateTextBytes: 128,
      turnPromptSha256: "c".repeat(64),
      evidenceSha256: "d".repeat(64),
      criteriaSha256: "e".repeat(64),
      inputSha256: "f".repeat(64),
      promptSha256: "1".repeat(64),
      responseSha256: "2".repeat(64),
      reviewSchemaSha256: "3".repeat(64),
      issueSetSha256: sha256(canonicalJson(advisorIssues)),
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.002,
      },
    };
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "model.advisor.independent.reviewed",
      category: "system",
      visibility: "debug",
      payload: {
        ...advisorReviewContent,
        contentSha256: sha256(canonicalJson(advisorReviewContent)),
      },
    });
    await store.requestOperatorDecision({
      threadId: thread.id,
      runId: run.id,
      header: "Secret",
      question: "TOP_SECRET_OPERATOR_QUESTION",
      options: [
        {
          label: "Private A",
          description: "TOP_SECRET_OPERATOR_OPTION_A",
        },
        {
          label: "Private B",
          description: "TOP_SECRET_OPERATOR_OPTION_B",
        },
      ],
      multiSelect: false,
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "run.completed",
      category: "lifecycle",
      visibility: "debug",
      payload: { status: "completed" },
    });
    await store.finishRun(run.id, "completed", { usage });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "run.settlement.recorded",
      category: "lifecycle",
      visibility: "debug",
      payload: { status: "completed" },
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: createId("runctl"),
      type: "credential.reference.created",
      category: "credential",
      visibility: "user",
      payload: {
        referenceId: createId("credential"),
        providerId: "faux-secure",
        label: "TOP_SECRET_CREDENTIAL_LABEL",
        userId: "TOP_SECRET_USER_ID",
        status: "active",
      },
    });

    const first = await createOpenTelemetryTraceArtifact(
      store,
      thread.id,
      undefined,
      new Date("2026-07-25T12:00:00.000Z"),
    );
    expect(validateOpenTelemetryTraceArtifact(first)).toEqual(first);
    expect(verifyOpenTelemetryTraceArtifact(first)).toEqual({
      status: "valid",
      diagnostics: [],
      threadId: thread.id,
      traceId: first.traceId,
      contentSha256: first.contentSha256,
      eventStreamSha256: first.eventRange.eventStreamSha256,
      spanCount: first.spanCount,
      eventCount: first.eventRange.eventCount,
    });
    const traceSpans = spans(first);
    expect(traceSpans.map((span) => span.name)).toEqual(
      expect.arrayContaining([
        "napier.thread",
        "invoke_agent napier",
        "chat faux-1",
        "execute_tool read_file",
        "execute_tool write_file",
        "invoke_agent reviewer",
      ]),
    );
    expect(new Set(traceSpans.map((span) => span.traceId))).toEqual(
      new Set([first.traceId]),
    );
    expect(
      traceSpans.filter((span) => span.parentSpanId === undefined),
    ).toHaveLength(1);
    const modelSpan = traceSpans.find((span) => span.name === "chat faux-1")!;
    expect(modelSpan.kind).toBe(3);
    expect(attributeValue(modelSpan.attributes, "gen_ai.provider.name")).toBe(
      "faux-secure",
    );
    expect(
      attributeValue(modelSpan.attributes, "gen_ai.usage.input_tokens"),
    ).toBe(42);
    const unknownTool = traceSpans.find(
      (span) => span.name === "execute_tool write_file",
    )!;
    expect(unknownTool.status.code).toBe(0);
    expect(attributeValue(unknownTool.attributes, "napier.outcome.known")).toBe(
      false,
    );
    const advisorEvent = traceSpans
      .flatMap((span) => span.events)
      .find((event) => event.name === "model.advisor.independent.reviewed")!;
    expect(
      attributeValue(
        advisorEvent.attributes,
        "napier.event.payload.reviewer_model",
      ),
    ).toBe("faux-reviewer/faux-2");
    expect(
      attributeValue(advisorEvent.attributes, "napier.event.payload.verdict"),
    ).toBe("revise");
    expect(
      attributeValue(advisorEvent.attributes, "napier.event.payload.risk"),
    ).toBe("medium");
    expect(
      attributeValue(advisorEvent.attributes, "napier.event.payload.score"),
    ).toBe(61);

    const serialized = JSON.stringify(first);
    for (const secret of [
      "TOP_SECRET_PROMPT",
      "TOP_SECRET_COMPLETION",
      "TOP_SECRET_REASONING",
      "TOP_SECRET_PATH",
      "TOP_SECRET_TOOL_OUTPUT",
      "TOP_SECRET_DESCRIPTION",
      "TOP_SECRET_SUBAGENT_PROMPT",
      "TOP_SECRET_SUBAGENT_RESULT",
      "TOP_SECRET_RUN_CONTROL_MESSAGE",
      "TOP_SECRET_MILESTONE_TITLE",
      "TOP_SECRET_MILESTONE_SUMMARY",
      "TOP_SECRET_MILESTONE_COMPLETED",
      "TOP_SECRET_MILESTONE_OPEN_LOOP",
      "TOP_SECRET_OPERATOR_QUESTION",
      "TOP_SECRET_OPERATOR_OPTION_A",
      "TOP_SECRET_OPERATOR_OPTION_B",
      "TOP_SECRET_CREDENTIAL_LABEL",
      "TOP_SECRET_USER_ID",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(first.redaction).toEqual(
      expect.objectContaining({
        mode: "metadata_only",
        contentCapture: false,
      }),
    );

    await store.appendEvent({
      threadId: thread.id,
      runId: createId("runctl"),
      type: "trace.otlp.exported",
      category: "system",
      visibility: "user",
      payload: {
        traceId: first.traceId,
        contentSha256: first.contentSha256,
      },
    });
    const repeated = await createOpenTelemetryTraceArtifact(
      store,
      thread.id,
      undefined,
      new Date("2026-07-25T13:00:00.000Z"),
    );
    expect(repeated.contentSha256).toBe(first.contentSha256);
    expect(repeated.otlp).toEqual(first.otlp);
    expect(repeated.generatedAt).not.toBe(first.generatedAt);

    const runOnly = await createOpenTelemetryTraceArtifact(
      store,
      thread.id,
      run.id,
    );
    expect(runOnly.runId).toBe(run.id);
    expect(
      spans(runOnly)
        .flatMap((span) => span.events)
        .some((event) => event.name === "credential.reference.created"),
    ).toBe(false);
    await expect(
      createOpenTelemetryTraceArtifact(store, thread.id, "run_missing"),
    ).rejects.toThrow("Run not found in thread");
  });

  it("rejects structural, graph, and content-hash tampering", async () => {
    const store = await createStore();
    const thread = store.listThreads()[0]!;
    const artifact = await createOpenTelemetryTraceArtifact(store, thread.id);

    const missingParent = structuredClone(artifact);
    const child = spans(missingParent).find(
      (span) => span.parentSpanId !== undefined,
    )!;
    child.parentSpanId = "f".repeat(16);
    const {
      generatedAt: _generatedAt,
      contentSha256: _contentSha256,
      ...missingParentContent
    } = missingParent;
    missingParent.contentSha256 =
      hashOpenTelemetryTraceArtifact(missingParentContent);
    expect(() => validateOpenTelemetryTraceArtifact(missingParent)).toThrow(
      "parent is missing",
    );

    const duplicate = structuredClone(artifact);
    if (spans(duplicate).length > 1) {
      spans(duplicate)[1]!.spanId = spans(duplicate)[0]!.spanId;
      const {
        generatedAt: _generatedAt2,
        contentSha256: _contentSha2562,
        ...duplicateContent
      } = duplicate;
      duplicate.contentSha256 =
        hashOpenTelemetryTraceArtifact(duplicateContent);
      expect(() => validateOpenTelemetryTraceArtifact(duplicate)).toThrow(
        "Duplicate OTLP span ID",
      );
    }

    const hashTampered = structuredClone(artifact);
    hashTampered.spanCount += 1;
    expect(() => validateOpenTelemetryTraceArtifact(hashTampered)).toThrow(
      "span count mismatch",
    );
    expect(verifyOpenTelemetryTraceArtifact(hashTampered)).toEqual({
      status: "invalid",
      diagnostics: ["span_count_mismatch"],
      spanCount: 0,
      eventCount: 0,
    });

    const contentInjected = structuredClone(artifact);
    spans(contentInjected)[0]!.attributes.push({
      key: "gen_ai.prompt",
      value: { stringValue: "FORGED_PROMPT_CONTENT" },
    });
    const {
      generatedAt: _generatedAt3,
      contentSha256: _contentSha2563,
      ...contentInjectedHashInput
    } = contentInjected;
    contentInjected.contentSha256 = hashOpenTelemetryTraceArtifact(
      contentInjectedHashInput,
    );
    expect(() => validateOpenTelemetryTraceArtifact(contentInjected)).toThrow(
      "attribute key is invalid",
    );
    expect(verifyOpenTelemetryTraceArtifact(contentInjected)).toEqual({
      status: "invalid",
      diagnostics: ["invalid_attribute"],
      spanCount: 0,
      eventCount: 0,
    });
  });
});
