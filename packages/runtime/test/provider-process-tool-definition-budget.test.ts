import { describe, expect, it, vi } from "vitest";

import { createWorkspaceProcessTool } from "../src/workspace-process-tool.js";

const MAX_PROCESS_TOOL_DEFINITION_BYTES = 4 * 1024;

describe("Provider Process tool definition budget", () => {
  it("keeps the Process definition within four KiB", () => {
    const tool = createWorkspaceProcessTool(undefined as never, {
      threadId: "thread_process_schema_budget",
      runId: "run_process_schema_budget",
    });
    const bytes = Buffer.byteLength(
      JSON.stringify({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        constrainedSampling: tool.constrainedSampling ?? null,
      }),
      "utf8",
    );

    expect(bytes).toBeLessThanOrEqual(MAX_PROCESS_TOOL_DEFINITION_BYTES);
  });

  it("keeps write isolation, settlement, and redaction in the merged guidance", () => {
    const tool = createWorkspaceProcessTool(undefined as never, {
      threadId: "thread_process_schema_semantics",
      runId: "run_process_schema_semantics",
    });

    expect(tool.description).toContain("preview_write");
    expect(tool.description).toContain("start_write");
    expect(tool.description).toContain("1-8");
    expect(tool.description).toContain("read-only");
    expect(tool.description).toContain("Delta");
    expect(tool.description).toContain("redacted");
  });

  it("rejects conflicting pipe and PTY modes before launch", async () => {
    const start = vi.fn();
    const previewWrite = vi.fn();
    const tool = createWorkspaceProcessTool({ start, previewWrite } as never, {
      threadId: "thread_process_schema_modes",
      runId: "run_process_schema_modes",
    });

    await expect(
      tool.execute("call-start-conflict", {
        action: "start",
        runtime: "node",
        args: ["--version"],
        interactive: true,
        terminal: { columns: 80, rows: 24 },
      } as never),
    ).rejects.toThrow("either interactive pipe mode or terminal PTY mode");
    await expect(
      tool.execute("call-preview-conflict", {
        action: "preview_write",
        runtime: "node",
        args: ["--version"],
        writePaths: ["generated"],
        interactive: true,
        terminal: { columns: 80, rows: 24 },
      } as never),
    ).rejects.toThrow("either interactive pipe mode or terminal PTY mode");
    expect(start).not.toHaveBeenCalled();
    expect(previewWrite).not.toHaveBeenCalled();
  });
});
