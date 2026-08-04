import { Writable } from "node:stream";

import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { TuiSessionState } from "../src/tui-state.js";
import { TuiTerminal } from "../src/tui-terminal.js";

describe("TUI terminal projection", () => {
  it("uses fixed terminal controls and renders dynamic text as visible data", async () => {
    const output = new TerminalCapture(72, 18);
    const terminal = new TuiTerminal(output);
    const state = new TuiSessionState({
      title: "unsafe\u001b]52;c;TITLE\u0007\u202e",
      model: { provider: "safe", id: "model" },
    });
    state.beginPrompt("prompt\u001b[2J\u0007");
    state.applyEvent(
      event("model.text.delta", {
        delta: "answer\t\u001b]52;c;PRIVATE\u0007\u202e",
      }),
    );
    state.applyEvent(
      event("tool.started", {
        callId: "call_1",
        toolName: "read_file",
        effect: "read",
        input: { path: "PRIVATE_TOOL_ARGUMENT" },
        output: "PRIVATE_TOOL_OUTPUT",
      }),
    );
    state.applyEvent(
      event("tool.started", {
        callId: "call_2",
        toolName: "web_search",
        effect: "read",
        query: "PRIVATE_SEARCH_QUERY",
        output: "PRIVATE_SEARCH_RESULT",
      }),
    );

    await terminal.enter();
    await terminal.render(state.snapshot(), {
      text: "input\u001b[31m",
      cursor: 12,
      byteLength: 16,
      pasting: false,
    });
    await terminal.restore();

    const rendered = output.text();
    expect(rendered).toContain("\u001b[?1049h");
    expect(rendered).toContain("\u001b[?2004h");
    expect(rendered).toContain("answer\\u0009");
    expect(rendered).toContain("\\u001b]52;c;PRIVATE\\u0007\\u202e");
    expect(rendered).toContain("tool read_file · running · read");
    expect(rendered).toContain("tool web_search · running · read");
    expect(rendered).not.toContain("PRIVATE_TOOL_ARGUMENT");
    expect(rendered).not.toContain("PRIVATE_TOOL_OUTPUT");
    expect(rendered).not.toContain("PRIVATE_SEARCH_QUERY");
    expect(rendered).not.toContain("PRIVATE_SEARCH_RESULT");
    expect(rendered).toContain("\u001b[?2004l");
    expect(rendered).toContain("\u001b[?1049l");

    const withoutFixedCsi = rendered.replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, "");
    expect(withoutFixedCsi).not.toContain("\u001b");
    expect(withoutFixedCsi).not.toContain("\u0007");
    expect(withoutFixedCsi).not.toContain("\t");
    expect(withoutFixedCsi).not.toContain("\u202e");
  });

  it("bounds terminal dimensions and resets waiting state on Thread changes", async () => {
    const output = new TerminalCapture(10_000, 10_000);
    const terminal = new TuiTerminal(output);
    expect(terminal.size()).toEqual({ columns: 400, rows: 200 });

    const state = new TuiSessionState({});
    state.applyEvent(event("operator.decision.requested", {}));
    expect(state.snapshot().waiting).toBe(true);
    state.setThread("thread_1234567890");
    expect(state.snapshot()).toEqual(
      expect.objectContaining({ waiting: false, tools: [] }),
    );
    state.applyEvent(event("operator.decision.requested", {}));
    state.setNewThread("fresh");
    expect(state.snapshot()).toEqual(
      expect.objectContaining({ waiting: false, tools: [] }),
    );

    await terminal.enter();
    await terminal.render(state.snapshot(), {
      text: "",
      cursor: 0,
      byteLength: 0,
      pasting: false,
    });
    await terminal.restore();
    expect(Buffer.byteLength(output.text(), "utf8")).toBeLessThanOrEqual(
      128 * 1024,
    );
  });

  it("coalesces rapid updates to one bounded pending frame", async () => {
    const output = new TerminalCapture(80, 24, 5);
    const terminal = new TuiTerminal(output);
    const state = new TuiSessionState({});
    const input = {
      text: "",
      cursor: 0,
      byteLength: 0,
      pasting: false,
    };

    await terminal.enter();
    const renders: Array<Promise<void>> = [];
    for (let index = 0; index < 100; index += 1) {
      state.setNotice(`update ${String(index)}`);
      renders.push(terminal.render(state.snapshot(), input));
    }
    await Promise.all(renders);
    await terminal.restore();

    expect(output.text()).toContain("update 99");
    expect(output.writeCount).toBeLessThanOrEqual(4);
  });
});

function event(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type}`,
    threadId: "thread_1234567890",
    runId: "run_1234567890",
    seq: 1,
    type,
    category: "system",
    visibility: "user",
    createdAt: "2026-08-02T00:00:00.000Z",
    payload,
  };
}

class TerminalCapture extends Writable {
  readonly isTTY = true;
  writeCount = 0;
  private readonly chunks: string[] = [];

  constructor(
    readonly columns: number,
    readonly rows: number,
    private readonly delayMs = 0,
  ) {
    super();
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.writeCount += 1;
    this.chunks.push(chunk.toString("utf8"));
    if (this.delayMs > 0) setTimeout(callback, this.delayMs);
    else callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}
