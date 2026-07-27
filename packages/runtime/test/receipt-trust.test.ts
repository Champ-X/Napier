import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  EvaluationCasebookQualificationCaseResult,
  EvaluationCasebookQualificationExecution,
  RunRecord,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_EVALUATION_RUBRIC } from "../src/evaluation.js";
import {
  createEvaluationCasebookQualificationReceipt,
  hashEvaluationCasebookQualificationExecution,
} from "../src/evaluation-casebook-qualification.js";
import {
  createEvaluationSuiteGateReceipt,
  hashRunEvaluation,
} from "../src/evaluation-suites.js";
import { createId } from "../src/ids.js";
import {
  createReceiptTrustAnchorDirectory,
  createReceiptTrustAnchor,
  hashTrustedReceiptEnvelope,
  receiptTrustAnchorsFromDirectory,
  revokeReceiptTrustAnchor,
  signTrustedReceipt,
  validateReceiptTrustAnchorDirectory,
  validateTrustedReceiptEnvelope,
  verifyReceiptTrustAnchorDirectory,
  verifyTrustedReceiptEnvelope,
} from "../src/receipt-trust.js";
import { createRunReplaySnapshot } from "../src/replay.js";
import { LocalStore } from "../src/store.js";

const SIGNING_ENV = "NAPIER_TEST_RECEIPT_SIGNING_KEY";
const temporaryRoots: string[] = [];
const openStores: LocalStore[] = [];

afterEach(async () => {
  delete process.env[SIGNING_ENV];
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createStore(): Promise<{
  store: LocalStore;
  options: { dataRoot: string; workspaceRoot: string };
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-receipt-trust-"));
  temporaryRoots.push(root);
  const options = {
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  };
  const store = new LocalStore(options);
  openStores.push(store);
  await store.initialize();
  return { store, options };
}

async function terminalRun(
  store: LocalStore,
  threadId: string,
  agentId: string,
  text: string,
): Promise<RunRecord> {
  const run = await store.createRun({ threadId, agentId });
  await store.appendEvent({
    threadId,
    runId: run.id,
    type: "message.assistant",
    category: "message",
    visibility: "user",
    payload: { role: "assistant", text },
  });
  return store.finishRun(run.id, "completed");
}

function installSigningKey(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
  process.env[SIGNING_ENV] = privatePem;
  return privatePem;
}

describe("trusted receipt provenance", () => {
  it("signs deep receipt evidence and fails closed on tampering or key drift", async () => {
    installSigningKey();
    const { store } = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Trusted gate receipt",
      agentId: agent.id,
    });
    const left = await terminalRun(
      store,
      thread.id,
      agent.id,
      "Baseline evidence.",
    );
    const right = await terminalRun(
      store,
      thread.id,
      agent.id,
      "Candidate evidence.",
    );
    const suite = await store.createEvaluationSuite(thread.id, {
      name: "Signed release gate",
      baselineRunId: left.id,
      candidateRunIds: [right.id],
    });
    const receipt = createEvaluationSuiteGateReceipt(
      store,
      thread.id,
      suite.id,
    );
    const anchor = createReceiptTrustAnchor({
      threadId: thread.id,
      label: "Release signer",
      source: { type: "environment", variable: SIGNING_ENV },
    });
    const envelope = signTrustedReceipt(receipt, anchor);

    expect(validateTrustedReceiptEnvelope(envelope)).toEqual(envelope);
    expect(verifyTrustedReceiptEnvelope(envelope, [anchor])).toEqual(
      expect.objectContaining({
        status: "trusted",
        signatureValid: true,
        integrityValid: true,
        keyId: anchor.keyId,
        receiptContentSha256: receipt.contentSha256,
      }),
    );
    expect(JSON.stringify(anchor)).not.toContain(
      process.env[SIGNING_ENV]!.slice(0, 24),
    );

    const importedAnchor = createReceiptTrustAnchor({
      threadId: thread.id,
      label: "Imported release verifier",
      source: { type: "public_key", publicKeySpki: anchor.publicKeySpki },
    });
    expect(importedAnchor).not.toHaveProperty("signingSource");
    expect(
      verifyTrustedReceiptEnvelope(envelope, [importedAnchor]).status,
    ).toBe("trusted");
    expect(verifyTrustedReceiptEnvelope(envelope, []).status).toBe(
      "unknown_key",
    );
    expect(() => signTrustedReceipt(receipt, importedAnchor)).toThrow(
      "verify-only",
    );

    const directory = createReceiptTrustAnchorDirectory([anchor]);
    expect(validateReceiptTrustAnchorDirectory(directory)).toEqual(directory);
    expect(verifyReceiptTrustAnchorDirectory(directory)).toEqual(
      expect.objectContaining({
        status: "valid",
        diagnostics: [],
        declaredContentSha256: directory.contentSha256,
        recomputedContentSha256: directory.contentSha256,
        declaredAnchorSetSha256: directory.anchorSetSha256,
        recomputedAnchorSetSha256: directory.anchorSetSha256,
        anchorCount: 1,
        trustedCount: 1,
        revokedCount: 0,
      }),
    );
    const directoryPolicy = {
      maxAgeMs: 60_000,
      expectedAnchorSetSha256: directory.anchorSetSha256,
      minimumTrustedCount: 1,
      requiredTrustedKeyIds: [anchor.keyId],
    };
    expect(verifyReceiptTrustAnchorDirectory(directory, directoryPolicy)).toEqual(
      expect.objectContaining({
        status: "valid",
        diagnostics: [],
        policy: directoryPolicy,
        policySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        directoryGeneratedAt: directory.generatedAt,
        directoryAgeMs: expect.any(Number),
      }),
    );
    expect(
      verifyReceiptTrustAnchorDirectory(
        { ...directory, generatedAt: "2000-01-01T00:00:00.000Z" },
        { maxAgeMs: 1 },
      ),
    ).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: expect.arrayContaining(["directory_expired"]),
      }),
    );
    expect(
      verifyReceiptTrustAnchorDirectory(directory, {
        expectedAnchorSetSha256: "f".repeat(64),
        minimumTrustedCount: 2,
        requiredTrustedKeyIds: ["e".repeat(64)],
      }),
    ).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: expect.arrayContaining([
          "anchor_set_unexpected",
          "trusted_count_below_minimum",
          "required_trusted_key_missing",
        ]),
      }),
    );
    expect(JSON.stringify(directory)).not.toContain(SIGNING_ENV);
    expect(JSON.stringify(directory)).not.toContain("BEGIN PRIVATE KEY");
    const directoryAnchors = receiptTrustAnchorsFromDirectory(directory);
    expect(directoryAnchors).toEqual([
      expect.objectContaining({
        id: anchor.id,
        keyId: anchor.keyId,
        publicKeySpki: anchor.publicKeySpki,
      }),
    ]);
    expect(directoryAnchors[0]).not.toHaveProperty("signingSource");
    expect(() => signTrustedReceipt(receipt, directoryAnchors[0]!)).toThrow(
      "verify-only",
    );
    expect(verifyTrustedReceiptEnvelope(envelope, directoryAnchors)).toEqual(
      expect.objectContaining({
        status: "trusted",
        signatureValid: true,
        integrityValid: true,
        keyId: anchor.keyId,
      }),
    );
    expect(
      verifyReceiptTrustAnchorDirectory({
        ...directory,
        anchors: [{ ...directory.anchors[0]!, label: "Forged directory" }],
      }),
    ).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: expect.arrayContaining([
          "content_hash_mismatch",
          "anchors_invalid",
        ]),
      }),
    );

    const payloadTampered = structuredClone(envelope);
    payloadTampered.receipt.suite.name = "Forged gate";
    expect(verifyTrustedReceiptEnvelope(payloadTampered, [anchor])).toEqual(
      expect.objectContaining({
        status: "invalid",
        signatureValid: false,
        integrityValid: false,
      }),
    );

    const signatureTampered = structuredClone(envelope);
    signatureTampered.signature.value = `${
      signatureTampered.signature.value.startsWith("A") ? "B" : "A"
    }${signatureTampered.signature.value.slice(1)}`;
    const { contentSha256: _contentSha256, ...tamperedEnvelopeContent } =
      signatureTampered;
    signatureTampered.contentSha256 = hashTrustedReceiptEnvelope(
      tamperedEnvelopeContent,
    );
    expect(verifyTrustedReceiptEnvelope(signatureTampered, [anchor])).toEqual(
      expect.objectContaining({
        status: "invalid",
        signatureValid: false,
        integrityValid: true,
      }),
    );

    expect(
      verifyTrustedReceiptEnvelope(envelope, [
        revokeReceiptTrustAnchor(anchor),
      ]),
    ).toEqual(
      expect.objectContaining({
        status: "revoked",
        signatureValid: true,
        integrityValid: true,
      }),
    );

    const replacement = installSigningKey();
    expect(replacement).not.toBe("");
    expect(() => signTrustedReceipt(receipt, anchor)).toThrow(
      "does not match the trust anchor",
    );
  });

  it("signs policy retirement proof bundles with the shared receipt trust root", async () => {
    installSigningKey();
    const { store } = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Signed policy retirement proof bundle",
      agentId: agent.id,
    });
    const history =
      await store.listExecutionPlanBlueprintRecommendationPolicyOverrideRetirements();
    const proofBundle =
      store.verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle(
        [history, history],
      );
    expect(proofBundle).toEqual(
      expect.objectContaining({
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history-proof-bundle",
        status: "aligned",
        historyCount: 2,
        validHistoryCount: 2,
        invalidHistoryCount: 0,
        distinctHistoryCount: 1,
      }),
    );

    const anchor = await store.createReceiptTrustAnchor({
      threadId: thread.id,
      label: "Policy retirement signer",
      source: { type: "environment", variable: SIGNING_ENV },
    });
    const envelope = signTrustedReceipt(proofBundle, anchor);
    expect(envelope).toEqual(
      expect.objectContaining({
        receiptKind: "policy_retirement_proof_bundle",
        receipt: expect.objectContaining({
          contentSha256: proofBundle.contentSha256,
        }),
        signature: expect.objectContaining({ keyId: anchor.keyId }),
      }),
    );
    expect(validateTrustedReceiptEnvelope(envelope)).toEqual(envelope);
    expect(verifyTrustedReceiptEnvelope(envelope, [anchor])).toEqual(
      expect.objectContaining({
        status: "trusted",
        receiptKind: "policy_retirement_proof_bundle",
        receiptContentSha256: proofBundle.contentSha256,
        receiptArtifactSha256: envelope.signature.receiptArtifactSha256,
        keyId: anchor.keyId,
        envelopeSha256: envelope.contentSha256,
        signatureValid: true,
        integrityValid: true,
      }),
    );

    const payloadTampered = structuredClone(envelope);
    payloadTampered.receipt.histories[0]!.diagnostics = ["tampered"];
    expect(verifyTrustedReceiptEnvelope(payloadTampered, [anchor])).toEqual(
      expect.objectContaining({
        status: "invalid",
        signatureValid: false,
        integrityValid: false,
      }),
    );
  });

  it("pins only current passing qualification evidence and survives restart", async () => {
    installSigningKey();
    const { store, options } = await createStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Signed qualification baseline",
      agentId: agent.id,
    });
    const left = await terminalRun(
      store,
      thread.id,
      agent.id,
      "Qualification baseline.",
    );
    const right = await terminalRun(
      store,
      thread.id,
      agent.id,
      "Qualification candidate.",
    );
    const [leftSnapshot, rightSnapshot] = await Promise.all([
      createRunReplaySnapshot(store, thread.id, left.id),
      createRunReplaySnapshot(store, thread.id, right.id),
    ]);
    const evaluation = await store.saveRunEvaluation({
      id: createId("evaluation"),
      threadId: thread.id,
      leftRunId: left.id,
      rightRunId: right.id,
      leftSnapshotSha256: leftSnapshot.eventStreamSha256,
      rightSnapshotSha256: rightSnapshot.eventStreamSha256,
      rubric: structuredClone(DEFAULT_EVALUATION_RUBRIC),
      scores: DEFAULT_EVALUATION_RUBRIC.criteria.map((criterion) => ({
        criterionId: criterion.id,
        leftScore: 3,
        rightScore: 4,
        reason: "Candidate evidence is stronger.",
      })),
      verdict: "right_better",
      reason: "Candidate evidence is stronger.",
      evidence: "Compared both immutable snapshots.",
      evaluatorModel: { provider: "napier", id: "demo" },
      createdAt: "2026-07-25T12:00:00.000Z",
    });
    const adjudication = await store.reviewRunEvaluation(
      thread.id,
      evaluation.id,
      {
        expectedVerdict: "right_better",
        note: "Reviewed release truth.",
      },
    );
    const created = await store.createEvaluationCasebook({
      threadId: thread.id,
      name: "Trusted evaluator baseline",
    });
    const casebook = await store.curateEvaluationCasebookCase(created.id, {
      threadId: thread.id,
      evaluationId: evaluation.id,
    });
    const revision = casebook.revisions.at(-1)!;
    const item = casebook.cases.find(
      (candidate) => candidate.id === revision.caseIds[0],
    )!;
    const result: EvaluationCasebookQualificationCaseResult = {
      caseId: item.id,
      sourceThreadId: item.sourceThreadId,
      sourceEvaluationId: item.sourceEvaluationId,
      caseSha256: item.contentSha256,
      evaluationSha256: hashRunEvaluation(evaluation),
      rubricSha256: item.rubricSha256,
      expectedVerdict: adjudication.revisions.at(-1)!.expectedVerdict,
      actualVerdict: "right_better",
      agreement: true,
      evidenceState: "verified",
      reason: "The candidate matches reviewed truth.",
      evidence: "Rebuilt both source snapshots.",
      scores: DEFAULT_EVALUATION_RUBRIC.criteria.map((criterion) => ({
        criterionId: criterion.id,
        leftScore: 3,
        rightScore: 4,
        reason: "Candidate evidence is stronger.",
      })),
      expectedLeftSnapshotSha256: evaluation.leftSnapshotSha256,
      expectedRightSnapshotSha256: evaluation.rightSnapshotSha256,
      observedLeftSnapshotSha256: evaluation.leftSnapshotSha256,
      observedRightSnapshotSha256: evaluation.rightSnapshotSha256,
      status: "agreed",
    };
    const evidence = {
      casebookId: casebook.id,
      casebookRevision: casebook.currentRevision,
      casebookRevisionSha256: revision.contentSha256,
      auditThreadId: thread.id,
      name: revision.name,
      evaluatorModel: { provider: "napier", id: "demo" },
      gate: { minimumAgreementRate: 1, allowInconclusive: false },
      caseIds: revision.caseIds,
      results: [result],
      sampleCount: 1,
      agreementCount: 1,
      inconclusiveCount: 0,
      unverifiedCount: 0,
      agreementRate: 1,
      status: "passed" as const,
    };
    const execution: EvaluationCasebookQualificationExecution = {
      id: createId("casequal"),
      ...evidence,
      contentSha256: hashEvaluationCasebookQualificationExecution(evidence),
      startedAt: "2026-07-25T12:01:00.000Z",
      finishedAt: "2026-07-25T12:01:01.000Z",
    };
    await store.saveEvaluationCasebookQualificationExecution(execution);
    const anchor = await store.createReceiptTrustAnchor({
      threadId: thread.id,
      label: "Qualification signer",
      source: { type: "environment", variable: SIGNING_ENV },
    });
    const receipt = createEvaluationCasebookQualificationReceipt(
      store,
      casebook.id,
    );
    const envelope = signTrustedReceipt(receipt, anchor);
    const promoted = await store.promoteEvaluationQualificationBaseline(
      casebook.id,
      thread.id,
      envelope,
    );
    expect(promoted).toEqual(
      expect.objectContaining({
        created: true,
        baseline: expect.objectContaining({
          casebookRevision: casebook.currentRevision,
          qualificationExecutionId: execution.id,
          envelope,
        }),
      }),
    );
    expect(
      await store.promoteEvaluationQualificationBaseline(
        casebook.id,
        thread.id,
        signTrustedReceipt(receipt, anchor),
      ),
    ).toEqual({
      baseline: promoted.baseline,
      created: false,
    });

    store.close();
    openStores.splice(openStores.indexOf(store), 1);
    const reopened = new LocalStore(options);
    openStores.push(reopened);
    await reopened.initialize();
    expect(reopened.listReceiptTrustAnchors()).toEqual([anchor]);
    expect(reopened.listEvaluationQualificationBaselines(casebook.id)).toEqual([
      promoted.baseline,
    ]);

    await reopened.updateEvaluationCasebook(casebook.id, {
      threadId: thread.id,
      description: "A newer unqualified revision.",
    });
    await expect(
      reopened.promoteEvaluationQualificationBaseline(
        casebook.id,
        thread.id,
        envelope,
      ),
    ).rejects.toThrow("current passing receipt");
    const revoked = await reopened.revokeReceiptTrustAnchor(anchor.id);
    expect(
      verifyTrustedReceiptEnvelope(promoted.baseline.envelope, [revoked]),
    ).toEqual(
      expect.objectContaining({
        status: "revoked",
        signatureValid: true,
      }),
    );
  });
});
