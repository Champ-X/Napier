import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it } from "vitest";
import type { LocalStore } from "../src/store.js";
import { createApprovalFixture } from "./fixtures/workflow-approval-recovery-setup.js";

const roots: string[] = [];
const stores: LocalStore[] = [];
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("reuses a timely durable answer after its deadline and after observer failure", async () => {
  const fixture = await create(1000);
  const controller = new AbortController();
  await expect(
    fixture.embedded.answerAndResume({
      ...fixture.request,
      signal: controller.signal,
      onEvent(event) {
        if (event.type === "operator.decision.answered") {
          controller.abort();
          throw new Error("response lost");
        }
      },
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  const saved = (
    await fixture.store.listOperatorDecisions(fixture.request.threadId)
  )[0]!;
  expect(saved.status).toBe("answered");
  await delay(1100);
  const result = await fixture.embedded.answerAndResume(fixture.request);
  expect(result.result.status).toBe("completed");
  expect(result.decision.answerSha256).toBe(saved.answerSha256);
  expect(result.decision.answeredAt).toBe(saved.answeredAt);
});

it("rejects an expired pending decision before saving an answer", async () => {
  const fixture = await create(1000);
  await delay(1100);
  const before = await fixture.store.listEvents(fixture.request.threadId);
  await expect(
    fixture.embedded.answerAndResume(fixture.request),
  ).rejects.toMatchObject({ code: "expired_decision" });
  expect(await fixture.store.listEvents(fixture.request.threadId)).toEqual(
    before,
  );
});

it("preserves the saved answer when a retry has a stale digest or different answer", async () => {
  const fixture = await create();
  const saved = await fixture.store.answerOperatorDecision(
    fixture.request.threadId,
    fixture.request.decisionId,
    fixture.request.answer,
  );
  const before = await fixture.store.listEvents(fixture.request.threadId);
  await expect(
    fixture.embedded.answerAndResume({
      ...fixture.request,
      expectedDecisionSha256: "0".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "stale_decision" });
  await expect(
    fixture.embedded.answerAndResume({
      ...fixture.request,
      answer: { selectedOptionIds: ["option_2"], customText: "changed" },
    }),
  ).rejects.toMatchObject({ code: "state_conflict" });
  expect(await fixture.store.listEvents(fixture.request.threadId)).toEqual(
    before,
  );
  const result = await fixture.embedded.answerAndResume({
    ...fixture.request,
    expectedDecisionSha256: saved.decision.contentSha256,
  });
  expect(result.result.status).toBe("completed");
  const completedEvents = await fixture.store.listEvents(
    fixture.request.threadId,
  );
  expect(
    (
      await fixture.embedded.answerAndResume({
        ...fixture.request,
        expectedDecisionSha256: saved.decision.contentSha256,
      })
    ).result.status,
  ).toBe("completed");
  expect(await fixture.store.listEvents(fixture.request.threadId)).toEqual(
    completedEvents,
  );
});

it.each([
  "requestedEventSeq",
  "decisionRequestSha256",
  "inputSha256",
  "nodeId",
])("rejects corrupt %s binding before saving an answer", async (field) => {
  const fixture = await create();
  const database = new DatabaseSync(
    path.join(fixture.store.dataRoot, "ledger.sqlite"),
  );
  try {
    database
      .prepare(
        `UPDATE ledger_events SET event_json = json_set(event_json, ?, ?)
      WHERE thread_id = ? AND event_type = 'workflow.approval.requested'`,
      )
      .run(
        `$.payload.${field}`,
        field === "requestedEventSeq" ? 1 : "0".repeat(64),
        fixture.request.threadId,
      );
  } finally {
    database.close();
  }
  const before = await fixture.store.listEvents(fixture.request.threadId);
  await expect(
    fixture.embedded.answerAndResume(fixture.request),
  ).rejects.toMatchObject({ code: "evidence_mismatch" });
  expect(await fixture.store.listEvents(fixture.request.threadId)).toEqual(
    before,
  );
  expect(
    (await fixture.store.listOperatorDecisions(fixture.request.threadId))[0]
      ?.status,
  ).toBe("pending");
});

it("serializes identical retries within one Runtime", async () => {
  const fixture = await create();
  const replies = await Promise.all([
    fixture.embedded.answerAndResume(fixture.request),
    fixture.embedded.answerAndResume(fixture.request),
  ]);
  expect(replies.map((reply) => reply.result.status)).toEqual([
    "completed",
    "completed",
  ]);
  const events = await fixture.store.listEvents(fixture.request.threadId);
  expect(events.filter((event) => event.type === "tool.started")).toHaveLength(
    1,
  );
  expect(fixture.store.listRuns(fixture.request.threadId)).toHaveLength(3);
});

it("cancels a waiting retry without disturbing the owner or another Thread", async () => {
  const fixture = await create();
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const owner = fixture.embedded.answerAndResume({
    ...fixture.request,
    async onEvent(event) {
      if (event.type === "run.started") {
        enter();
        await held;
      }
    },
  });
  try {
    await entered;
    const controller = new AbortController();
    const waiting = fixture.embedded.answerAndResume({
      ...fixture.request,
      signal: controller.signal,
    });
    const aborted = expect(waiting).rejects.toMatchObject({
      name: "AbortError",
    });
    await delay(50);
    controller.abort();
    await aborted;
    const independent = await fixture.embedded.run({
      manifest: fixture.request.manifest,
      input: {},
    });
    expect(independent.result.status).toBe("waiting");
    expect(independent.threadId).not.toBe(fixture.request.threadId);
  } finally {
    release();
  }
  expect((await owner).result.status).toBe("completed");
  expect(
    (await fixture.embedded.answerAndResume(fixture.request)).result.status,
  ).toBe("completed");
  expect(fixture.store.listRuns(fixture.request.threadId)).toHaveLength(3);
});

async function create(timeoutMs = 60000) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-approval-retry-"));
  roots.push(root);
  const fixture = await createApprovalFixture(root, false, timeoutMs);
  stores.push(fixture.store);
  return fixture;
}
