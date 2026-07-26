import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  EvaluationReviewerBallot,
  RunEvaluationRecord,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  consensusAdjudicationRequest,
  createEvaluationConsensusReport,
  createEvaluationConsensusResolution,
  hashEvaluationConsensusReport,
  submitEvaluationReviewerBallot,
  validateEvaluationConsensusReport,
  validateEvaluationConsensusResolution,
  validateEvaluationReviewerBallot,
} from "../src/evaluation-consensus.js";
import { reviewRunEvaluation } from "../src/evaluation-calibration.js";
import { LocalStore } from "../src/store.js";

const temporaryRoots: string[] = [];
const openStores: LocalStore[] = [];

afterEach(async () => {
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

function evaluation(id = "evaluation_consensus_protocol"): RunEvaluationRecord {
  return {
    id,
    threadId: "thread_consensus_protocol",
    leftRunId: "run_consensus_left",
    rightRunId: "run_consensus_right",
    leftSnapshotSha256: "a".repeat(64),
    rightSnapshotSha256: "b".repeat(64),
    rubric: {
      name: "Consensus rubric",
      criteria: [
        {
          id: "correctness",
          name: "Correctness",
          description: "The result is supported by evidence.",
        },
      ],
    },
    scores: [
      {
        criterionId: "correctness",
        leftScore: 3,
        rightScore: 4,
        reason: "The candidate records stronger evidence.",
      },
    ],
    verdict: "right_better",
    reason: "The candidate is better supported.",
    evidence: "Compared immutable snapshots.",
    evaluatorModel: { provider: "faux", id: "judge-1" },
    createdAt: "2026-07-25T15:00:00.000Z",
  };
}

function ballot(
  record: RunEvaluationRecord,
  reviewerId: string,
  expectedVerdict: RunEvaluationRecord["verdict"],
  reviewerName = reviewerId,
): EvaluationReviewerBallot {
  return submitEvaluationReviewerBallot(undefined, record, {
    reviewerId,
    reviewerName,
    expectedVerdict,
    note: `${reviewerName} reviewed the frozen evidence.`,
  });
}

async function createStore(): Promise<{
  store: LocalStore;
  options: { dataRoot: string; workspaceRoot: string };
  threadId: string;
  evaluation: RunEvaluationRecord;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-consensus-"));
  temporaryRoots.push(root);
  const options = {
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  };
  const store = new LocalStore(options);
  openStores.push(store);
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Multi-reviewer consensus",
    agentId: agent.id,
  });
  const left = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
  });
  await store.finishRun(left.id, "completed");
  const right = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
  });
  await store.finishRun(right.id, "completed");
  const record = await store.saveRunEvaluation({
    ...evaluation("evaluation_consensus_store"),
    threadId: thread.id,
    leftRunId: left.id,
    rightRunId: right.id,
  });
  return { store, options, threadId: thread.id, evaluation: record };
}

describe("multi-reviewer evaluation consensus", () => {
  it("keeps independent append-only reviewer lanes", () => {
    const record = evaluation();
    const first = ballot(record, "reviewer_a", "right_better", "Reviewer A");
    expect(
      submitEvaluationReviewerBallot(first, record, {
        reviewerId: "REVIEWER_A",
        reviewerName: "Reviewer   A",
        expectedVerdict: "right_better",
        note: "Reviewer A reviewed the frozen evidence.",
      }),
    ).toEqual(first);

    const revised = submitEvaluationReviewerBallot(first, record, {
      reviewerId: "reviewer_a",
      reviewerName: "Reviewer A",
      expectedVerdict: "tie",
      note: "A second pass found equivalent evidence.",
    });
    expect(revised).toEqual(
      expect.objectContaining({
        reviewerId: "reviewer_a",
        currentRevision: 2,
        revisions: [
          expect.objectContaining({ expectedVerdict: "right_better" }),
          expect.objectContaining({
            expectedVerdict: "tie",
            contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        ],
      }),
    );
    expect(validateEvaluationReviewerBallot(revised, record)).toEqual(revised);

    const tampered = structuredClone(revised);
    tampered.revisions[0]!.reviewerName = "Tampered reviewer";
    expect(() => validateEvaluationReviewerBallot(tampered, record)).toThrow(
      "hash mismatch",
    );
  });

  it("enforces quorum, tie, agreement, and inconclusive semantics", () => {
    const record = evaluation();
    const rightA = ballot(record, "reviewer_a", "right_better", "Reviewer A");
    const leftB = ballot(record, "reviewer_b", "left_better", "Reviewer B");
    expect(createEvaluationConsensusReport(record, [rightA]).status).toBe(
      "insufficient_reviewers",
    );
    expect(
      createEvaluationConsensusReport(record, [rightA, leftB]).status,
    ).toBe("no_consensus");

    const rightC = ballot(record, "reviewer_c", "right_better", "Reviewer C");
    const ready = createEvaluationConsensusReport(
      record,
      [rightC, leftB, rightA],
      undefined,
      new Date("2026-07-25T15:10:00.000Z"),
    );
    expect(ready).toEqual(
      expect.objectContaining({
        status: "ready",
        reviewerCount: 3,
        consensusVerdict: "right_better",
        consensusCount: 2,
        agreementRate: 0.6667,
      }),
    );
    expect(
      validateEvaluationConsensusReport(ready, record, [rightA, leftB, rightC]),
    ).toEqual(ready);
    expect(
      createEvaluationConsensusReport(record, [rightA, leftB, rightC], {
        minimumAgreementRate: 0.75,
      }).status,
    ).toBe("no_consensus");

    const inconclusive = [
      ballot(record, "reviewer_d", "inconclusive", "Reviewer D"),
      ballot(record, "reviewer_e", "inconclusive", "Reviewer E"),
    ];
    expect(createEvaluationConsensusReport(record, inconclusive).status).toBe(
      "inconclusive",
    );
    expect(
      createEvaluationConsensusReport(record, inconclusive, {
        allowInconclusive: true,
      }).status,
    ).toBe("ready");

    const tampered = structuredClone(ready);
    tampered.votes[0]!.reviewerName = "Forged reviewer";
    const {
      generatedAt: _generatedAt,
      contentSha256: _contentSha256,
      ...content
    } = tampered;
    tampered.contentSha256 = hashEvaluationConsensusReport(content);
    expect(() =>
      validateEvaluationConsensusReport(tampered, record, [
        rightA,
        leftB,
        rightC,
      ]),
    ).toThrow("vote is invalid");
  });

  it("atomically resolves consensus into hash-bound Human Truth", async () => {
    const {
      store,
      options,
      threadId,
      evaluation: record,
    } = await createStore();
    const first = await store.submitEvaluationReviewerBallot(
      threadId,
      record.id,
      {
        reviewerId: "release_owner",
        reviewerName: "Release Owner",
        expectedVerdict: "right_better",
        note: "The candidate satisfies the release evidence.",
      },
    );
    expect(
      await store.submitEvaluationReviewerBallot(threadId, record.id, {
        reviewerId: "release_owner",
        reviewerName: "Release Owner",
        expectedVerdict: "right_better",
        note: "The candidate satisfies the release evidence.",
      }),
    ).toEqual(first);
    await store.submitEvaluationReviewerBallot(threadId, record.id, {
      reviewerId: "quality_owner",
      reviewerName: "Quality Owner",
      expectedVerdict: "right_better",
      note: "The replay hashes support the candidate.",
    });

    const result = await store.resolveEvaluationConsensus(
      threadId,
      record.id,
      {},
    );
    expect(result).toEqual(
      expect.objectContaining({
        created: true,
        report: expect.objectContaining({
          status: "ready",
          reviewerCount: 2,
          agreementRate: 1,
        }),
        resolution: expect.objectContaining({
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        adjudication: expect.objectContaining({ currentRevision: 1 }),
      }),
    );
    expect(result.adjudication.revisions[0]).toEqual(
      expect.objectContaining({
        expectedVerdict: "right_better",
        source: "reviewer_consensus",
        sourceSha256: result.report.contentSha256,
      }),
    );
    expect(
      validateEvaluationConsensusResolution(
        result.resolution,
        record,
        store.listEvaluationReviewerBallots(threadId, record.id),
        result.adjudication,
      ),
    ).toEqual(result.resolution);
    expect(
      await store.resolveEvaluationConsensus(threadId, record.id, {}),
    ).toEqual(expect.objectContaining({ created: false }));
    expect(
      store.listEvaluationConsensusResolutions(threadId, record.id),
    ).toHaveLength(1);
    const casebook = await store.createEvaluationCasebook({
      threadId,
      name: "Consensus gold set",
    });
    const curated = await store.curateEvaluationCasebookCase(casebook.id, {
      threadId,
      evaluationId: record.id,
    });
    expect(curated.cases).toEqual([
      expect.objectContaining({
        adjudicationRevision: expect.objectContaining({
          source: "reviewer_consensus",
          sourceSha256: result.report.contentSha256,
        }),
        reviewerBallots: expect.arrayContaining([
          expect.objectContaining({ reviewerId: "quality_owner" }),
          expect.objectContaining({ reviewerId: "release_owner" }),
        ]),
        consensusResolution: result.resolution,
      }),
    ]);
    expect(store.exportEvaluationCasebook(casebook.id)).toEqual(
      expect.objectContaining({
        casebook: curated,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );

    const standaloneAdjudication = reviewRunEvaluation(
      undefined,
      record,
      consensusAdjudicationRequest(result.report),
    );
    expect(
      validateEvaluationConsensusResolution(
        createEvaluationConsensusResolution(
          record,
          result.report,
          standaloneAdjudication,
        ),
        record,
        store.listEvaluationReviewerBallots(threadId, record.id),
        standaloneAdjudication,
      ),
    ).toEqual(expect.objectContaining({ evaluationId: record.id }));

    store.close();
    openStores.splice(openStores.indexOf(store), 1);
    const reopened = new LocalStore(options);
    openStores.push(reopened);
    await reopened.initialize();
    expect(reopened.listEvaluationReviewerBallots(threadId)).toHaveLength(2);
    expect(reopened.listEvaluationConsensusResolutions(threadId)).toEqual([
      result.resolution,
    ]);
  });
});
