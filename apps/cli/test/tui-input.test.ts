import { describe, expect, it } from "vitest";

import { TuiInputController } from "../src/tui-input.js";

describe("TUI raw input controller", () => {
  it("edits by code point and submits one bounded prompt", () => {
    const input = new TuiInputController();
    input.feed("abc");
    input.feed("\u001b[D");
    input.feed("X");
    input.feed("\u001b[H");
    input.feed("\u001b[3~");
    input.feed("\u001b[F");
    input.feed("\u007f");
    expect(input.snapshot()).toEqual(
      expect.objectContaining({ text: "bX", cursor: 2 }),
    );

    expect(input.feed("\r")).toEqual(
      expect.arrayContaining([{ kind: "submit", value: "bX" }]),
    );
    expect(input.snapshot().text).toBe("");
    input.feed("\u001b[A");
    expect(input.snapshot().text).toBe("bX");
    input.feed("\u001b[B");
    expect(input.snapshot().text).toBe("");
  });

  it("handles split UTF-8, split keys, and bracketed paste as literal data", () => {
    const input = new TuiInputController();
    const utf8 = Buffer.from("你好", "utf8");
    input.feed(utf8.subarray(0, 2));
    input.feed(utf8.subarray(2));
    input.feed("\u001b[");
    input.feed("D");
    input.feed("!");
    expect(input.snapshot().text).toBe("你!好");

    input.clear();
    input.feed("\u001b[200~line one\n\u001b]52;c;");
    input.feed("PRIVATE\u0007\u001b[201");
    input.feed("~");
    const submitted = input
      .feed("\r")
      .find((action) => action.kind === "submit");
    expect(submitted).toEqual({
      kind: "submit",
      value: "line one\n\\u001b]52;c;PRIVATE\\u0007",
    });
  });

  it("emits control and scroll actions without inserting them", () => {
    const input = new TuiInputController();
    expect(input.feed("\u001b[5~\u001b[6~\u0003\u0004")).toEqual(
      expect.arrayContaining([
        { kind: "scroll", direction: "up" },
        { kind: "scroll", direction: "down" },
        { kind: "interrupt" },
        { kind: "exit" },
      ]),
    );
    expect(input.snapshot().text).toBe("");
  });

  it("enforces the complete UTF-8 input budget", () => {
    const input = new TuiInputController();
    input.feed("x".repeat(64 * 1024));
    expect(input.snapshot().byteLength).toBe(64 * 1024);
    expect(input.feed("y")).toContainEqual({ kind: "overflow" });
    expect(input.snapshot().byteLength).toBe(64 * 1024);
  });
});
