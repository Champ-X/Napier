import { describe, expect, it } from "vitest";

import {
  initialConversationFollowState,
  reduceConversationFollow,
  type ConversationFollowState,
} from "../src/conversation-follow-model";

describe("Conversation follow model", () => {
  it("starts following with no pending items", () => {
    const state = initialConversationFollowState(3);
    expect(state).toEqual({
      following: true,
      pendingCount: 0,
      observedCount: 3,
    });
  });

  it("keeps clearing pending items while following", () => {
    let state = initialConversationFollowState(2);
    state = reduceConversationFollow(state, { type: "sync", count: 5 });
    expect(state).toMatchObject({ following: true, pendingCount: 0, observedCount: 5 });
  });

  it("counts arrivals after the reader scrolls away", () => {
    let state = initialConversationFollowState(2);
    state = reduceConversationFollow(state, {
      type: "proximity",
      nearBottom: false,
    });
    expect(state.following).toBe(false);
    state = reduceConversationFollow(state, { type: "sync", count: 4 });
    state = reduceConversationFollow(state, { type: "sync", count: 5 });
    expect(state).toMatchObject({
      following: false,
      pendingCount: 3,
      observedCount: 5,
    });
  });

  it("resumes following and clears pending items when returning to the bottom", () => {
    let state: ConversationFollowState = {
      following: false,
      pendingCount: 4,
      observedCount: 9,
    };
    state = reduceConversationFollow(state, {
      type: "proximity",
      nearBottom: true,
    });
    expect(state).toMatchObject({ following: true, pendingCount: 0 });
  });

  it("resumes following on an explicit jump", () => {
    let state: ConversationFollowState = {
      following: false,
      pendingCount: 7,
      observedCount: 12,
    };
    state = reduceConversationFollow(state, { type: "jump" });
    expect(state).toMatchObject({
      following: true,
      pendingCount: 0,
      observedCount: 12,
    });
  });

  it("does not allocate a new state when nothing changes", () => {
    const state = initialConversationFollowState(1);
    expect(
      reduceConversationFollow(state, { type: "proximity", nearBottom: true }),
    ).toBe(state);
  });
});
