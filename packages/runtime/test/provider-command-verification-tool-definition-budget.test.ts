import { describe, expect, it } from "vitest";

import { createCommandTool } from "../src/command-tool.js";
import { createVerificationTool } from "../src/verification.js";

const MAX_COMMAND_VERIFICATION_TOOL_DEFINITION_BYTES = 1.5 * 1024;

describe("Provider Command and Verification tool definition budget", () => {
  it("keeps command and verification definitions within one and a half KiB", () => {
    const options = {
      workspaceRoot: "/workspace",
      sandbox: undefined as never,
    };
    const tools = [createCommandTool(options), createVerificationTool(options)];
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

    expect(bytes).toBeLessThanOrEqual(
      MAX_COMMAND_VERIFICATION_TOOL_DEFINITION_BYTES,
    );
  });

  it("keeps argv, sandbox, target-default, toolchain, and no-shell guidance", () => {
    const options = {
      workspaceRoot: "/workspace",
      sandbox: undefined as never,
    };
    const command = createCommandTool(options).description;
    const verification = createVerificationTool(options).description;

    expect(command).toContain("literal argv");
    expect(command).toContain("no shell");
    expect(command).toContain("workspace-relative cwd");
    expect(command).toContain("read-only");
    expect(command).toContain("offline");
    expect(verification).toContain("typecheck/test/format");
    expect(verification).toContain("target defaults");
    expect(verification).toContain("toolchain");
    expect(verification).toContain("No package script/shell");
  });
});
