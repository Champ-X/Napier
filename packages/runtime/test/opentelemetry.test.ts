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
import { createModelContextEnvelopeReceipt } from "../src/model-context-envelope.js";
import {
  createOpenTelemetryTraceArtifact,
  hashOpenTelemetryTraceArtifact,
  validateOpenTelemetryTraceArtifact,
  verifyOpenTelemetryTraceArtifact,
} from "../src/opentelemetry.js";
import { exportThreadReplayBundle } from "../src/replay.js";
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

function setAttributeValue(
  attributes: OtlpKeyValue[],
  key: string,
  value: string | number | boolean,
): void {
  const attribute = attributes.find((item) => item.key === key);
  if (!attribute) throw new Error(`Missing OTLP attribute: ${key}`);
  if (typeof value === "string") {
    attribute.value = { stringValue: value };
    return;
  }
  if (typeof value === "boolean") {
    attribute.value = { boolValue: value };
    return;
  }
  attribute.value = Number.isInteger(value)
    ? { intValue: String(value) }
    : { doubleValue: value };
}

function rehashArtifact(artifact: OpenTelemetryTraceArtifact): void {
  const {
    generatedAt: _generatedAt,
    contentSha256: _contentSha256,
    ...content
  } = artifact;
  artifact.contentSha256 = hashOpenTelemetryTraceArtifact(content);
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
        modelContextEnvelopeSha256: "d".repeat(64),
        modelContextEnvelopeTurnIndex: 0,
        modelContextMessageSetSha256: "e".repeat(64),
        modelContextToolDefinitionSetSha256: "f".repeat(64),
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
    const advisorEnvelope = createModelContextEnvelopeReceipt({
      turnIndex: 0,
      systemPrompt: "TOP_SECRET_ADVISOR_SYSTEM_PROMPT",
      messages: [
        {
          role: "user",
          content: "TOP_SECRET_ADVISOR_REVIEW_INPUT",
        },
      ],
      tools: [],
    });
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
      modelContextEnvelope: advisorEnvelope,
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
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "context.prompt_variables",
      category: "system",
      visibility: "debug",
      payload: {
        kind: "napier.prompt-variable-snapshot",
        definitionCount: 2,
        referencedVariableCount: 2,
        referenceCount: 3,
        unresolvedReferenceCount: 1,
        skillCatalogInjected: true,
        catalogSha256: "4".repeat(64),
        renderedSystemPromptSha256: "5".repeat(64),
        contentSha256: "6".repeat(64),
        entries: [
          {
            name: "private_context",
            value: "TOP_SECRET_PROMPT_VARIABLE_VALUE",
          },
        ],
      },
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "model.tool_loop.detected",
      category: "system",
      visibility: "debug",
      payload: {
        kind: "napier.tool-loop-guard-trigger",
        toolName: "read_file",
        threshold: 3,
        attemptCount: 3,
        fromSeq: 10,
        toSeq: 20,
        callSha256: "7".repeat(64),
        resultSha256: "8".repeat(64),
        attemptSetSha256: "9".repeat(64),
        policySha256: "a".repeat(64),
        contentSha256: "b".repeat(64),
        arguments: "TOP_SECRET_LOOP_ARGUMENTS",
      },
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "evaluation.completed",
      category: "evaluation",
      visibility: "user",
      payload: {
        evaluationId: createId("evaluation"),
        leftRunId: run.id,
        rightRunId: createId("run"),
        verdict: "right_better",
        reason: "TOP_SECRET_EVALUATION_REASON",
        evidence: "TOP_SECRET_EVALUATION_EVIDENCE",
        comparisonGovernanceSha256: "c".repeat(64),
        contextCoverageStatus: "regressed",
        contextCoverageDiagnosticsSha256: "d".repeat(64),
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
    expect(
      attributeValue(
        modelSpan.attributes,
        "napier.model_context.envelope.sha256",
      ),
    ).toBe("d".repeat(64));
    expect(
      attributeValue(
        modelSpan.attributes,
        "napier.model_context.envelope.turn_index",
      ),
    ).toBe(0);
    expect(
      attributeValue(
        modelSpan.attributes,
        "napier.model_context.message_set.sha256",
      ),
    ).toBe("e".repeat(64));
    expect(
      attributeValue(
        modelSpan.attributes,
        "napier.model_context.tool_definition_set.sha256",
      ),
    ).toBe("f".repeat(64));
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
    expect(
      attributeValue(
        advisorEvent.attributes,
        "napier.event.payload.model_context_envelope_sha256",
      ),
    ).toBe(advisorEnvelope.contentSha256);
    const evaluationEvent = traceSpans
      .flatMap((span) => span.events)
      .find((event) => event.name === "evaluation.completed")!;
    expect(
      attributeValue(
        evaluationEvent.attributes,
        "napier.event.payload.comparison_governance_sha256",
      ),
    ).toBe("c".repeat(64));
    expect(
      attributeValue(
        evaluationEvent.attributes,
        "napier.event.payload.context_coverage_status",
      ),
    ).toBe("regressed");
    expect(
      attributeValue(
        evaluationEvent.attributes,
        "napier.event.payload.context_coverage_diagnostics_sha256",
      ),
    ).toBe("d".repeat(64));
    const promptVariableEvent = traceSpans
      .flatMap((span) => span.events)
      .find((event) => event.name === "context.prompt_variables")!;
    expect(
      attributeValue(
        promptVariableEvent.attributes,
        "napier.event.payload.definition_count",
      ),
    ).toBe(2);
    expect(
      attributeValue(
        promptVariableEvent.attributes,
        "napier.event.payload.unresolved_reference_count",
      ),
    ).toBe(1);
    expect(
      attributeValue(
        promptVariableEvent.attributes,
        "napier.event.payload.skill_catalog_injected",
      ),
    ).toBe(true);
    expect(
      attributeValue(
        promptVariableEvent.attributes,
        "napier.event.payload.catalog_sha256",
      ),
    ).toBe("4".repeat(64));
    const loopGuardEvent = traceSpans
      .flatMap((span) => span.events)
      .find((event) => event.name === "model.tool_loop.detected")!;
    expect(
      attributeValue(
        loopGuardEvent.attributes,
        "napier.event.payload.tool_name",
      ),
    ).toBe("read_file");
    expect(
      attributeValue(
        loopGuardEvent.attributes,
        "napier.event.payload.threshold",
      ),
    ).toBe(3);
    expect(
      attributeValue(
        loopGuardEvent.attributes,
        "napier.event.payload.call_sha256",
      ),
    ).toBe("7".repeat(64));

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
      "TOP_SECRET_PROMPT_VARIABLE_VALUE",
      "TOP_SECRET_LOOP_ARGUMENTS",
      "TOP_SECRET_EVALUATION_REASON",
      "TOP_SECRET_EVALUATION_EVIDENCE",
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
    const runOnlyRoot = spans(runOnly).find((span) => !span.parentSpanId)!;
    expect(attributeValue(runOnlyRoot.attributes, "napier.export.scope")).toBe(
      "run",
    );
    expect(attributeValue(runOnlyRoot.attributes, "napier.run.id")).toBe(
      run.id,
    );
    expect(
      spans(runOnly)
        .flatMap((span) => span.events)
        .some((event) => event.name === "credential.reference.created"),
    ).toBe(false);
    await expect(
      createOpenTelemetryTraceArtifact(store, thread.id, "run_missing"),
    ).rejects.toThrow("Run not found in thread");
  });

  it("projects imported lineage cutoff as metadata-only OTLP attributes", async () => {
    const store = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Imported OTLP lineage",
      agentId: agent.id,
      importProvenance: {
        sourceThreadId: "thread_source0000000001",
        sourceApiVersion: "2026-07-25",
        sourceContentSha256: "1".repeat(64),
        sourceEventStreamSha256: "2".repeat(64),
        sourceEventCount: 42,
        localImportedThroughSeq: 7,
        sourceModelContextEnvelopeCount: 3,
        sourceEmbeddedModelContextEnvelopeCount: 2,
        importedAt: "2026-07-25T00:00:00.000Z",
      },
    });

    const artifact = await createOpenTelemetryTraceArtifact(store, thread.id);
    const root = spans(artifact).find((span) => !span.parentSpanId)!;

    expect(
      attributeValue(
        root.attributes,
        "napier.thread.import.source_event_count",
      ),
    ).toBe(42);
    expect(
      attributeValue(
        root.attributes,
        "napier.thread.import.local_imported_through_seq",
      ),
    ).toBe(7);
    expect(
      attributeValue(
        root.attributes,
        "napier.thread.import.source_model_context_envelope_count",
      ),
    ).toBe(3);
    expect(
      attributeValue(
        root.attributes,
        "napier.thread.import.source_embedded_model_context_envelope_count",
      ),
    ).toBe(2);
    expect(
      attributeValue(
        root.attributes,
        "napier.thread.import.source_content_sha256",
      ),
    ).toBe("1".repeat(64));
    expect(
      attributeValue(root.attributes, "napier.thread.import.receipt_seq"),
    ).toBeUndefined();
    expect(
      attributeValue(root.attributes, "napier.thread.import.receipt_sha256"),
    ).toBeUndefined();
    expect(JSON.stringify(artifact)).not.toContain("Imported OTLP lineage");

    const source = store
      .listThreads()
      .find((candidate) => !candidate.importProvenance)!;
    const bundle = await exportThreadReplayBundle(store, source.id);
    const imported = await store.importThreadReplayBundle(
      bundle,
      "Imported OTLP receipt",
    );
    const importEvent = imported.events.find(
      (event) => event.type === "thread.imported",
    );
    if (!importEvent) throw new Error("Expected Thread import receipt event");
    const importedArtifact = await createOpenTelemetryTraceArtifact(
      store,
      imported.thread.id,
    );
    const importedRoot = spans(importedArtifact).find(
      (span) => !span.parentSpanId,
    )!;

    expect(
      attributeValue(
        importedRoot.attributes,
        "napier.thread.import.receipt_seq",
      ),
    ).toBe(importEvent.seq);
    expect(
      attributeValue(
        importedRoot.attributes,
        "napier.thread.import.receipt_sha256",
      ),
    ).toBe(sha256(canonicalJson(importEvent.payload)));
    const importedTraceEvent = importedRoot.events.find(
      (event) => event.name === "thread.imported",
    )!;
    expect(
      attributeValue(
        importedTraceEvent.attributes,
        "napier.event.payload_sha256",
      ),
    ).toBe(sha256(canonicalJson(importEvent.payload)));
    expect(
      attributeValue(
        importedTraceEvent.attributes,
        "napier.event.payload.source_thread_id",
      ),
    ).toBe(
      attributeValue(
        importedRoot.attributes,
        "napier.thread.import.source_thread_id",
      ),
    );
    expect(
      attributeValue(
        importedTraceEvent.attributes,
        "napier.event.payload.source_api_version",
      ),
    ).toBe(
      attributeValue(
        importedRoot.attributes,
        "napier.thread.import.source_api_version",
      ),
    );
    expect(
      attributeValue(
        importedTraceEvent.attributes,
        "napier.event.payload.imported_at",
      ),
    ).toBe(
      attributeValue(importedRoot.attributes, "napier.thread.import.imported_at"),
    );
    expect(
      attributeValue(
        importedTraceEvent.attributes,
        "napier.event.payload.source_model_context_envelope_count",
      ),
    ).toBe(
      attributeValue(
        importedRoot.attributes,
        "napier.thread.import.source_model_context_envelope_count",
      ),
    );
    expect(JSON.stringify(importedArtifact)).not.toContain(
      "Imported OTLP receipt",
    );
  });

  it("rejects import receipt trace binding drift", async () => {
    const store = await createStore();
    const source = store
      .listThreads()
      .find((candidate) => !candidate.importProvenance)!;
    const bundle = await exportThreadReplayBundle(store, source.id);
    const imported = await store.importThreadReplayBundle(
      bundle,
      "Imported OTLP receipt binding",
    );
    const artifact = await createOpenTelemetryTraceArtifact(
      store,
      imported.thread.id,
    );

    const forgedRootReceipt = structuredClone(artifact);
    const forgedRoot = spans(forgedRootReceipt).find(
      (span) => !span.parentSpanId,
    )!;
    setAttributeValue(
      forgedRoot.attributes,
      "napier.thread.import.receipt_sha256",
      "0".repeat(64),
    );
    rehashArtifact(forgedRootReceipt);
    expect(() =>
      validateOpenTelemetryTraceArtifact(forgedRootReceipt),
    ).toThrow("import receipt binding");
    expect(verifyOpenTelemetryTraceArtifact(forgedRootReceipt)).toEqual({
      status: "invalid",
      diagnostics: ["import_receipt_mismatch"],
      spanCount: 0,
      eventCount: 0,
    });

    const forgedEventReceipt = structuredClone(artifact);
    const forgedEventRoot = spans(forgedEventReceipt).find(
      (span) => !span.parentSpanId,
    )!;
    const receiptEvent = forgedEventRoot.events.find(
      (event) => event.name === "thread.imported",
    )!;
    setAttributeValue(
      receiptEvent.attributes,
      "napier.event.payload_sha256",
      "0".repeat(64),
    );
    rehashArtifact(forgedEventReceipt);
    expect(() =>
      validateOpenTelemetryTraceArtifact(forgedEventReceipt),
    ).toThrow("import receipt binding");

    const hiddenReceipt = structuredClone(artifact);
    const hiddenRoot = spans(hiddenReceipt).find((span) => !span.parentSpanId)!;
    hiddenRoot.attributes = hiddenRoot.attributes.filter(
      (attribute) => !attribute.key.startsWith("napier.thread.import.receipt_"),
    );
    rehashArtifact(hiddenReceipt);
    expect(() => validateOpenTelemetryTraceArtifact(hiddenReceipt)).toThrow(
      "import receipt binding",
    );

    const forgedRootProvenance = structuredClone(artifact);
    const forgedProvenanceRoot = spans(forgedRootProvenance).find(
      (span) => !span.parentSpanId,
    )!;
    setAttributeValue(
      forgedProvenanceRoot.attributes,
      "napier.thread.import.source_content_sha256",
      "9".repeat(64),
    );
    rehashArtifact(forgedRootProvenance);
    expect(() =>
      validateOpenTelemetryTraceArtifact(forgedRootProvenance),
    ).toThrow("import provenance binding");
    expect(verifyOpenTelemetryTraceArtifact(forgedRootProvenance)).toEqual({
      status: "invalid",
      diagnostics: ["import_provenance_mismatch"],
      spanCount: 0,
      eventCount: 0,
    });

    const forgedEventProvenance = structuredClone(artifact);
    const forgedProvenanceEventRoot = spans(forgedEventProvenance).find(
      (span) => !span.parentSpanId,
    )!;
    const provenanceEvent = forgedProvenanceEventRoot.events.find(
      (event) => event.name === "thread.imported",
    )!;
    setAttributeValue(
      provenanceEvent.attributes,
      "napier.event.payload.source_event_count",
      999,
    );
    rehashArtifact(forgedEventProvenance);
    expect(() =>
      validateOpenTelemetryTraceArtifact(forgedEventProvenance),
    ).toThrow("import provenance binding");
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

    const rootBindingTampered = structuredClone(artifact);
    const root = spans(rootBindingTampered).find((span) => !span.parentSpanId)!;
    setAttributeValue(
      root.attributes,
      "napier.event_stream.sha256",
      "0".repeat(64),
    );
    rehashArtifact(rootBindingTampered);
    expect(() =>
      validateOpenTelemetryTraceArtifact(rootBindingTampered),
    ).toThrow("root binding");
    expect(verifyOpenTelemetryTraceArtifact(rootBindingTampered)).toEqual({
      status: "invalid",
      diagnostics: ["root_binding_mismatch"],
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
