import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AgentToolDisplayStore } from "../src/agent-tool-display-store.js";

describe("AgentToolDisplayStore", () => {
  it("keeps complete redacted tool surfaces in a private local file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-tool-display-"));
    const store = new AgentToolDisplayStore(root);
    const owner = {
      threadId: "thread_displaystore",
      runId: "run_display_store1",
      callId: "call_display_store",
      toolName: "run_command",
    };

    await store.recordInput(owner, {
      command: "npm test",
      authorization: "Bearer PRIVATE_TOKEN",
    });
    await store.recordOutput(owner, "42 tests passed", false);

    expect(await store.listThread(owner.threadId)).toEqual([
      expect.objectContaining({
        sourceThreadId: owner.threadId,
        sourceRunId: owner.runId,
        callId: owner.callId,
        toolName: owner.toolName,
        input: expect.stringContaining("npm test"),
        output: "42 tests passed",
      }),
    ]);
    const [name] = await import("node:fs/promises").then(({ readdir }) =>
      readdir(store.rootPath),
    );
    const stored = await readFile(path.join(store.rootPath, name!), "utf8");
    expect(stored).not.toContain("PRIVATE_TOKEN");
    expect((await stat(store.rootPath)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(store.rootPath, name!))).mode & 0o777).toBe(0o600);
  });

  it("separates records by owner and maps failures to error text", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-tool-display-"));
    const store = new AgentToolDisplayStore(root);
    const first = {
      threadId: "thread_displayfirst",
      runId: "run_display_first1",
      callId: "call_shared",
      toolName: "browser",
    };
    await store.recordInput(first, { action: "type", text: "PRIVATE_TEXT" });
    await store.recordOutput(first, "Cross-origin navigation requires allowCrossOrigin", true);
    await store.recordInput(
      { ...first, threadId: "thread_displaysecond", runId: "run_display_second1" },
      { action: "snapshot" },
    );

    const records = await store.listThread(first.threadId);
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(
      expect.objectContaining({
        input: expect.stringContaining("[redacted]"),
        error: "Cross-origin navigation requires allowCrossOrigin",
      }),
    );
    expect(JSON.stringify(records)).not.toContain("PRIVATE_TEXT");
  });
});
