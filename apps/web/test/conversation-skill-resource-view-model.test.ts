import type { JsonValue, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { conversationSkillResourceLinks } from "../src/conversation-skill-resource-view-model";

describe("conversationSkillResourceLinks", () => {
  it("projects only validated Skill resource receipts", () => {
    const receipt = {
      kind: "napier.skill-resource-load-receipt",
      schemaVersion: 1,
      operation: "skill.resource.load",
      agentToolName: "skill_resource",
      state: "loaded",
      skillName: "frontend-design",
      requestedNameSha256:
        "7429eb2e51b7dc87b330ea49667c58234ee4326ad3bfb64e60fc6afb13149f8b",
      source: "bundled",
      rootKind: "bundled_standard",
      resourcePath: "references/visual-quality-gate.md",
      requestedResourcePathSha256:
        "3e0f15554e9b0623d1426a455ea49291f7a85589b92d42ebfcd2e38dc726c88d",
      relativePath: "skills/frontend-design/references/visual-quality-gate.md",
      virtualPath:
        "/bundled/skills/frontend-design/references/visual-quality-gate.md",
      sizeBytes: 1012,
      lineCount: 22,
      rawContentSha256:
        "3d89edf96acd6c96c9fc4d61d1505f44037d7cb310d57d4dc2c857ce773b5174",
      catalogSha256:
        "f2f20bb6d04c3bc8f0cc90dc92f2efed7a4c1f4cf6aaa805f89ecbada6145c30",
      snapshotManifestSha256:
        "261ce3e98ba51b32dfe44ffc8fdfbbddd20fef7f6bd7a7baa75f32f0bcffc413",
      resourceBindingSha256:
        "5f3f99622878711395f0a1f0e299b98efd4faeecb0ec16ea0a1d304c46f0912c",
      contentSha256:
        "c83c68b382ba49dbcbb17af85d92256da16dc8f201b171812ad1d1264f6f8ba0",
    };
    const valid = event("event_valid", receipt);
    const invalid = event("event_invalid", {
      ...receipt,
      rawContentSha256: "0".repeat(64),
    });

    expect(conversationSkillResourceLinks([invalid, valid])).toEqual([
      {
        skillName: receipt.skillName,
        resourcePath: receipt.resourcePath,
        relativePath: receipt.relativePath,
        virtualPath: receipt.virtualPath,
        rootKind: receipt.rootKind,
        rawContentSha256: receipt.rawContentSha256,
      },
    ]);
  });
});

function event(id: string, details: JsonValue): RunEvent {
  return {
    id,
    threadId: "thread_skill_resource_12345678",
    runId: "run_skill_resource_12345678",
    seq: 1,
    type: "tool.completed",
    category: "tool",
    visibility: "user",
    createdAt: "2026-09-02T00:00:00.000Z",
    payload: {
      callId: "call_skill_resource_12345678",
      toolName: "skill_resource",
      status: "completed",
      effect: "read",
      details,
    },
  };
}
