import { describe, expect, it } from "vitest";

import {
  formatAgentToolDisplayInput,
  formatAgentToolDisplayOutput,
  sanitizeDisplayText,
} from "../src/agent-tool-display.js";

describe("Agent tool display projection", () => {
  it("retains readable tool input while removing credential values", () => {
    const display = formatAgentToolDisplayInput("run_command", {
      runtime: "node",
      args: [
        "script.mjs",
        "TAVILY_API_KEY=PRIVATE_KEY_VALUE",
        "--token",
        "PRIVATE_TOKEN_VALUE",
      ],
      authorization: "Bearer PRIVATE_BEARER_VALUE",
    });
    expect(display).toContain("script.mjs");
    expect(display).toContain("TAVILY_API_KEY=[redacted]");
    expect(display).toContain("--token");
    expect(display).toContain("[redacted]");
    expect(display).not.toContain("PRIVATE_KEY_VALUE");
    expect(display).not.toContain("PRIVATE_TOKEN_VALUE");
    expect(display).not.toContain("PRIVATE_BEARER_VALUE");
  });

  it("retains diagnostic output and masks common inline secrets", () => {
    const display = formatAgentToolDisplayOutput(
      "Request failed: Bearer SECRET_BEARER\nAPI_KEY=SECRET_KEY_VALUE",
    );

    expect(display).toBe(
      "Request failed: Bearer [redacted]\nAPI_KEY=[redacted]",
    );
  });

  it("masks browser typing while retaining navigation and selectors", () => {
    expect(
      formatAgentToolDisplayInput("browser", {
        action: "type",
        target: { selector: "#email" },
        text: "private@example.com",
      }),
    ).toEqual(
      JSON.stringify(
        {
          action: "type",
          target: { selector: "#email" },
          text: "[redacted]",
        },
        null,
        2,
      ),
    );
    const output = sanitizeDisplayText(
      "GET https://example.com/?api_key=SECRET&topic=browser token=SECOND_SECRET",
    );
    expect(output).toContain("api_key=[redacted]&topic=browser");
    expect(output).toContain("token=[redacted]");
    expect(output).not.toContain("SECRET");
  });

  it("masks secret-shaped JSON and HTTP headers in tool output", () => {
    const output = sanitizeDisplayText(
      'Authorization: Bearer PRIVATE\nCookie: session=PRIVATE\n{"api_key":"PRIVATE"}',
    );
    expect(output).toContain("Authorization: [redacted]");
    expect(output).toContain("Cookie: [redacted]");
    expect(output).toContain('{"api_key":"[redacted]"}');
    expect(output).not.toContain("PRIVATE");
  });
});
