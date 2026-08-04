import { AGENT_TOOL_NAMES } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { contextCopy } from "../src/context-copy";

describe("Context tool labels", () => {
  it("labels every public Agent tool, including default web search", () => {
    expect(Object.keys(contextCopy.toolLabels).sort()).toEqual(
      [...AGENT_TOOL_NAMES].sort(),
    );
    expect(contextCopy.toolLabels.web_search).toBe("Web Search");
  });
});
