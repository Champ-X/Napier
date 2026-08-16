import { describe, expect, it, vi } from "vitest";

import {
  clearInvalidConversationArtifactAnchor,
  conversationArtifactAnchorId,
  type ConversationArtifactAnchorBinding,
} from "../src/conversation-artifact-anchor";

describe("Conversation artifact anchors", () => {
  it("binds thread, Run, Plan, Artifact, and event sequence without collisions", () => {
    const binding = anchorBinding();
    const targetId = conversationArtifactAnchorId(binding);

    expect(targetId).toMatch(/^conversation-artifact-v1-[A-Za-z0-9_-]+$/u);
    for (const changed of [
      { threadId: "thread_other0001" },
      { runId: "run_other0001" },
      { planId: "plan_other0001" },
      { artifactId: "artifact_other0001" },
      { eventSeq: 8 },
    ]) {
      expect(conversationArtifactAnchorId({ ...binding, ...changed })).not.toBe(
        targetId,
      );
    }
  });

  it("keeps exact current-thread evidence and clears invalid cross-thread hashes", () => {
    const valid = conversationArtifactAnchorId(anchorBinding());
    const crossThread = conversationArtifactAnchorId({
      ...anchorBinding(),
      threadId: "thread_other0001",
    });
    const replaceState = vi.fn();

    expect(
      clearInvalidConversationArtifactAnchor(
        new Set([valid]),
        { href: `http://127.0.0.1:8787/?thread=thread_fixture01#${valid}` },
        { replaceState },
      ),
    ).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();

    expect(
      clearInvalidConversationArtifactAnchor(
        new Set([valid]),
        {
          href: `http://127.0.0.1:8787/?thread=thread_fixture01#${crossThread}`,
        },
        { replaceState },
      ),
    ).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/?thread=thread_fixture01",
    );

    replaceState.mockClear();
    expect(
      clearInvalidConversationArtifactAnchor(
        new Set([valid]),
        {
          href: "http://127.0.0.1:8787/?thread=thread_fixture01#conversation-artifact-plan_old-artifact_old-2",
        },
        { replaceState },
      ),
    ).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/?thread=thread_fixture01",
    );
  });

  it("leaves unrelated application fragments untouched", () => {
    const replaceState = vi.fn();
    expect(
      clearInvalidConversationArtifactAnchor(
        new Set(),
        { href: "http://127.0.0.1:8787/?view=plan#evidence" },
        { replaceState },
      ),
    ).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });
});

function anchorBinding(): ConversationArtifactAnchorBinding {
  return {
    threadId: "thread_fixture01",
    runId: "run_fixture0001",
    planId: "plan_fixture0001",
    artifactId: "artifact_report0001",
    eventSeq: 7,
  };
}
