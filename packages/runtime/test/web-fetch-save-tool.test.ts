import { describe, expect, it } from "vitest";

import { builtInToolEffect } from "../src/agent-tool-effects.js";
import { TOOL_INVOCATION_EXPERIMENT_TOOLS } from "../src/tool-invocation-capsule.js";
import { webFetchSaveToolCallArgumentsLedgerProjection } from "../src/web-fetch-save-tool.js";

describe("Web Fetch save tool policy evidence", () => {
  it("classifies raw Source delivery as a write", () => {
    expect(
      builtInToolEffect("web_fetch_save", {
        url: "https://example.com/report.pdf",
        path: "artifacts/report.pdf",
      }),
    ).toBe("write");
    expect(
      builtInToolEffect("web_fetch", {
        action: "fetch",
        url: "https://example.com/report.pdf",
      }),
    ).toBe("read");
    expect(TOOL_INVOCATION_EXPERIMENT_TOOLS.has("web_fetch_save")).toBe(false);
  });

  it("redacts URL and workspace path from durable arguments", () => {
    const url = "https://example.com/report.pdf?private=URL_MARKER";
    const path = "artifacts/private-report.pdf";
    const projection = webFetchSaveToolCallArgumentsLedgerProjection({
      url,
      path,
    });
    const serialized = JSON.stringify(projection);

    expect(projection).toEqual(
      expect.objectContaining({
        redacted: true,
        urlSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        originSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        pathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(serialized).not.toContain(url);
    expect(serialized).not.toContain(path);
    expect(serialized).not.toContain("URL_MARKER");
  });
});
