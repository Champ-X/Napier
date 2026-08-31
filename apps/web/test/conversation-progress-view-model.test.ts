import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { conversationProgressNotes } from "../src/conversation-progress-view-model";

describe("conversation progress notes", () => {
  it("prefers the explicit user-visible progress event over its debug receipt", () => {
    const notes = conversationProgressNotes([
      event(1, {
        text: "模板结构已经读完，接下来开始生成页面。",
        model: "deepseek/deepseek-v4-flash",
        toolCalls: [{ id: "call_1", name: "apply_patch" }],
      }),
      progressEvent(2, {
        sourceEventId: "event_1",
        text: "模板结构已经读完，接下来开始生成页面。",
        model: "deepseek/deepseek-v4-flash",
        toolNames: ["apply_patch"],
      }),
    ]);

    expect(notes).toEqual([
      expect.objectContaining({
        id: "progress_2",
        seq: 2,
        text: "模板结构已经读完，接下来开始生成页面。",
      }),
    ]);
  });

  it("uses a deterministic safe stage when private-source text is redacted", () => {
    const notes = conversationProgressNotes([
      event(1, {
        model: "deepseek/deepseek-v4-flash",
        toolCalls: [{ id: "call_private", name: "web_fetch" }],
        contentRedacted: true,
      }),
      progressEvent(2, {
        sourceEventId: "event_1",
        model: "deepseek/deepseek-v4-flash",
        toolNames: ["web_fetch"],
        contentRedacted: true,
      }),
    ]);

    expect(notes[0]?.text).toMatch(/来源|source/iu);
    expect(JSON.stringify(notes)).not.toContain("private-source text");
  });

  it("collapses consecutive identical fallback receipts within one run", () => {
    const notes = conversationProgressNotes([
      event(1, {
        model: "faux/faux-1",
        toolCalls: [{ id: "call_1", name: "read_file" }],
      }),
      progressEvent(2, {
        sourceEventId: "event_1",
        model: "faux/faux-1",
        toolNames: ["read_file"],
      }),
      event(3, {
        model: "faux/faux-1",
        toolCalls: [{ id: "call_2", name: "read_file" }],
      }),
      progressEvent(4, {
        sourceEventId: "event_3",
        model: "faux/faux-1",
        toolNames: ["read_file"],
      }),
    ]);

    expect(notes).toHaveLength(1);
    expect(notes[0]).toEqual(expect.objectContaining({ fallback: true }));
  });

  it("retains explicit assistant progress without projecting reasoning", () => {
    const notes = conversationProgressNotes([
      event(1, {
        model: "deepseek/deepseek-v4-flash",
        toolCalls: [{ id: "call_1", name: "apply_patch" }],
      }),
      progressEvent(2, {
        sourceEventId: "event_1",
        text: "模板结构已经读完，接下来开始生成页面。",
        reasoning: "PRIVATE_REASONING",
        model: "deepseek/deepseek-v4-flash",
        toolNames: ["apply_patch"],
      }),
    ]);

    expect(notes).toEqual([
      expect.objectContaining({
        seq: 2,
        text: "模板结构已经读完，接下来开始生成页面。",
        model: "deepseek/deepseek-v4-flash",
      }),
    ]);
    expect(JSON.stringify(notes)).not.toContain("PRIVATE_REASONING");
  });

  it("never projects debug model receipts or malformed progress payloads", () => {
    expect(
      conversationProgressNotes([
        event(1, { text: "Final answer", toolCalls: [] }),
        event(2, {
          text: "Sensitive progress",
          toolCalls: [{ id: "call_2" }],
          contentRedacted: true,
        }),
        event(3, {
          reasoning: "Reasoning only",
          toolCalls: [{ id: "call_3" }],
        }),
        event(4, {
          text: "Auxiliary model text",
          modelCallPurpose: "context_compaction",
          toolCalls: [{ id: "call_4", name: "read_file" }],
        }),
        event(5, {
          text: "Malformed call",
          toolCalls: [{ id: "call_5" }],
        }),
        progressEvent(6, {
          sourceEventId: "event_6",
          model: "faux/faux-1",
          toolNames: [],
          text: "Malformed explicit progress",
        }),
      ]),
    ).toEqual([]);
  });

  it("keeps repeated milestones because distinct events may represent real stages", () => {
    const payload = {
      text: "继续核对数据来源。",
      model: "faux/faux-1",
      toolNames: ["search"],
    };
    const notes = conversationProgressNotes([
      event(1, {
        model: "faux/faux-1",
        toolCalls: [{ id: "call_1", name: "search" }],
      }),
      progressEvent(2, { ...payload, sourceEventId: "event_1" }),
      event(3, {
        model: "faux/faux-1",
        toolCalls: [{ id: "call_2", name: "search" }],
      }),
      progressEvent(4, { ...payload, sourceEventId: "event_3" }),
      event(
        5,
        {
          model: "faux/faux-1",
          toolCalls: [{ id: "call_3", name: "search" }],
        },
        "run_2",
      ),
      progressEvent(6, { ...payload, sourceEventId: "event_5" }, "run_2"),
    ]);

    expect(notes.map((note) => [note.runId, note.text])).toEqual([
      ["run_1", "继续核对数据来源。"],
      ["run_1", "继续核对数据来源。"],
      ["run_2", "继续核对数据来源。"],
    ]);
  });
});

function event(
  seq: number,
  payload: RunEvent["payload"],
  runId = "run_1",
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId,
    seq,
    type: "model.response",
    category: "model",
    visibility: "debug",
    createdAt: `2026-08-30T00:00:${String(seq).padStart(2, "0")}.000Z`,
    payload,
  };
}

function progressEvent(
  seq: number,
  payload: RunEvent["payload"],
  runId = "run_1",
): RunEvent {
  return {
    id: `progress_${String(seq)}`,
    threadId: "thread_1",
    runId,
    seq,
    type: "run.progress.message",
    category: "message",
    visibility: "user",
    createdAt: `2026-08-30T00:01:${String(seq).padStart(2, "0")}.000Z`,
    payload,
  };
}
