import type { RunEvent, StreamFrame } from "@napier/contracts";
import { expect, it } from "vitest";
import { harnessPolicyEvidence } from "../src/stream-harness-policy-evidence";
import { canonicalJson, sha256Canonical } from "../src/stable-digest";

it("requires a matching, intact binding before accepting a selected strategy", async () => {
  const check = harnessPolicyEvidence("/prompt", "coding-python.v1");
  await check(await binding());
  await expect(check(frame("run.started", {}))).resolves.toBeUndefined();
});

it("rejects missing, mismatched, duplicate and tampered strategy evidence", async () => {
  await expect(
    harnessPolicyEvidence(
      "/prompt",
      "coding-python.v1",
    )(frame("run.started", {})),
  ).rejects.toThrow();
  await expect(
    harnessPolicyEvidence("/prompt", "research.v1")(await binding()),
  ).rejects.toThrow();
  await expect(
    harnessPolicyEvidence("/prompt", undefined)(await binding()),
  ).rejects.toThrow();
  const check = harnessPolicyEvidence("/prompt", "coding-python.v1");
  await check(await binding());
  await expect(check(await binding())).rejects.toThrow();
  for (const field of [
    "profileJson",
    "profileSha256",
    "runId",
    "contentSha256",
  ]) {
    const changed = await binding();
    const payload = changed.event.payload as Record<string, unknown>;
    payload[field] = "tampered";
    await expect(
      harnessPolicyEvidence("/prompt", "coding-python.v1")(changed),
    ).rejects.toThrow();
  }
});

it("allows the unchanged default and errors before a Run is accepted", async () => {
  await expect(
    harnessPolicyEvidence("/prompt", undefined)(frame("run.started", {})),
  ).resolves.toBeUndefined();
  await expect(
    harnessPolicyEvidence(
      "/prompt",
      "coding-python.v1",
    )({
      type: "error",
      threadId: "thread_1",
      message: "Run failed while streaming.",
      code: "run_failed",
      diagnosticSha256: "a".repeat(64),
    }),
  ).resolves.toBeUndefined();
});

async function binding() {
  const policy = { id: "coding-python.v1", schemaVersion: 1, revision: 1 };
  const profile = {
    id: "napier.harness-preset.coding-python.v1",
    policies: { ...policy, contentSha256: await sha256Canonical(policy) },
  };
  const profileHash = await sha256Canonical(profile);
  const content = {
    kind: "napier.harness-policy-binding",
    schemaVersion: 1,
    runId: "run_1",
    profileSha256: profileHash,
    profileJson: canonicalJson({ ...profile, contentSha256: profileHash }),
  };
  return frame("harness.policy.bound", {
    ...content,
    contentSha256: await sha256Canonical(content),
  });
}

function frame(
  type: string,
  payload: unknown,
): Extract<StreamFrame, { type: "event" }> {
  return {
    type: "event",
    eventSha256: "a".repeat(64),
    event: {
      id: "event_1",
      runId: "run_1",
      threadId: "thread_1",
      seq: 1,
      category: "model",
      visibility: "debug",
      createdAt: "2026-09-13T00:00:00Z",
      type,
      payload,
    } as RunEvent,
  };
}
