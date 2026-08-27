import { describe, expect, it } from "vitest";

import {
  parseCancelSubagentHubTaskRequest,
  parseReviveSubagentHubTaskRequest,
  parseSteerSubagentHubTaskRequest,
} from "../src/subagent-hub-http-validation.js";

describe("Subagent Hub HTTP validation", () => {
  it("accepts an exact versioned steer request and preserves newlines", () => {
    expect(
      parseSteerSubagentHubTaskRequest({
        kind: "napier.subagent-hub-steer-request",
        schemaVersion: 1,
        expectedTaskRevision: 4,
        messageKind: "steering",
        text: "  Inspect the boundary.\r\nReturn evidence.  ",
      }),
    ).toEqual({
      kind: "napier.subagent-hub-steer-request",
      schemaVersion: 1,
      expectedTaskRevision: 4,
      messageKind: "steering",
      text: "Inspect the boundary.\nReturn evidence.",
    });
  });

  it("rejects unknown keys, stale-shaped revisions, and control bytes", () => {
    expect(
      parseSteerSubagentHubTaskRequest({
        kind: "napier.subagent-hub-steer-request",
        schemaVersion: 1,
        expectedTaskRevision: 0,
        messageKind: "input",
        text: "continue",
      }),
    ).toBeUndefined();
    expect(
      parseSteerSubagentHubTaskRequest({
        kind: "napier.subagent-hub-steer-request",
        schemaVersion: 1,
        expectedTaskRevision: 1,
        messageKind: "input",
        text: "bad\u0000text",
      }),
    ).toBeUndefined();
    expect(
      parseSteerSubagentHubTaskRequest({
        kind: "napier.subagent-hub-steer-request",
        schemaVersion: 1,
        expectedTaskRevision: 1,
        messageKind: "input",
        text: "continue",
        extra: true,
      }),
    ).toBeUndefined();
  });

  it("normalizes cancel reasons and accepts exact revive requests", () => {
    expect(
      parseCancelSubagentHubTaskRequest({
        kind: "napier.subagent-hub-cancel-request",
        schemaVersion: 1,
        expectedTaskRevision: 7,
        reason: "  Scope  changed. ",
      }),
    ).toEqual({
      kind: "napier.subagent-hub-cancel-request",
      schemaVersion: 1,
      expectedTaskRevision: 7,
      reason: "Scope changed.",
    });
    expect(
      parseReviveSubagentHubTaskRequest({
        kind: "napier.subagent-hub-revive-request",
        schemaVersion: 1,
        expectedTaskRevision: 9,
      }),
    ).toEqual({
      kind: "napier.subagent-hub-revive-request",
      schemaVersion: 1,
      expectedTaskRevision: 9,
    });
    expect(
      parseReviveSubagentHubTaskRequest({
        kind: "napier.subagent-hub-revive-request",
        schemaVersion: 2,
        expectedTaskRevision: 9,
      }),
    ).toBeUndefined();
  });
});
