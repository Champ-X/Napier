import { describe, expect, it } from "vitest";

import { createJavascriptKernelTool } from "../src/javascript-kernel-tool.js";
import { createPythonKernelTool } from "../src/python-kernel-tool.js";

const MAX_KERNEL_TOOL_DEFINITION_BYTES = 2.75 * 1024;

describe("Provider Kernel tool definition budget", () => {
  it("keeps JavaScript and Python Kernel definitions within two and three quarters KiB", () => {
    const context = {
      threadId: "thread_kernel_schema_budget",
      runId: "run_kernel_schema_budget",
    };
    const tools = [
      createJavascriptKernelTool(undefined as never, context),
      createPythonKernelTool(undefined as never, context),
    ];
    const bytes = tools.reduce(
      (total, tool) =>
        total +
        Buffer.byteLength(
          JSON.stringify({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            constrainedSampling: tool.constrainedSampling ?? null,
          }),
          "utf8",
        ),
      0,
    );

    expect(bytes).toBeLessThanOrEqual(MAX_KERNEL_TOOL_DEFINITION_BYTES);
  });

  it("keeps state, path, timeout, isolation, and terminal-failure guidance", () => {
    const context = {
      threadId: "thread_kernel_schema_semantics",
      runId: "run_kernel_schema_semantics",
    };
    const javascript = createJavascriptKernelTool(
      undefined as never,
      context,
    ).description;
    const python = createPythonKernelTool(
      undefined as never,
      context,
    ).description;

    for (const description of [javascript, python]) {
      expect(description).toContain("workspace-relative cwd");
      expect(description).toContain("sessionTimeoutMs");
      expect(description).toContain("timeoutMs");
      expect(description).toContain("State persists");
      expect(description).toContain("read-only");
      expect(description).toContain("offline");
      expect(description).toContain("terminates");
    }
    expect(javascript).toContain("Promise");
    expect(python).toContain("imports");
  });
});
