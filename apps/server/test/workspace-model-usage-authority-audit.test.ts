import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createUndispatchedModelObservation } from "../../../packages/runtime/dist/model-usage-observation.js";
import { modelUsageFixture } from "../../../packages/runtime/test/model-usage-fixture.js";
import {
  issueModelUndispatchedDriverProof,
  issueModelUsagePreparationAuthority,
  issuePreparedModelCall,
} from "../../../packages/runtime/dist/model-call-attribution.js";
import { WorkspaceModelAdmission } from "../src/workspace-model-admission.js";
import {
  admissionModel,
  workspaceA,
} from "./workspace-model-admission-fixture.js";

it("does not let copied undispatched data release an active host reservation", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "napier-zero-authority-audit-"),
  );
  const host = await WorkspaceModelAdmission.open(root, { maxConcurrent: 1 });
  const admission = host.forWorkspace(workspaceA),
    source = admission.usageSource!;
  const fixture = modelUsageFixture({
    sourceId: source.sourceId,
    physicalId: randomUUID(),
    hostWorkspaceId: workspaceA,
    model: admissionModel,
  });
  const repository = {};
  const authority = issueModelUsagePreparationAuthority({
    repository,
    owner: {
      kind: "operation",
      operationId: "audit",
      operation: "standalone_model_call",
    },
  });
  const proof = issueModelUndispatchedDriverProof(
    issuePreparedModelCall({
      repository,
      authority,
      attribution: fixture.attribution,
    }),
  );
  const trustedZero = createUndispatchedModelObservation(
    fixture.attribution,
    proof,
  );
  admission.reserve({
    method: "completeSimple",
    model: fixture.model,
    attribution: fixture.attribution,
  });
  try {
    // Serialized DTOs retain a valid digest but have no private driver proof.
    const copiedZero = JSON.parse(JSON.stringify(trustedZero));
    expect(() => source.record(copiedZero)).toThrow(/authority|proof/);
    expect(host.snapshot()).toMatchObject({
      activeInvocations: 1,
      chargedTokens: 120,
      usageProjectionPending: false,
    });
  } finally {
    source.record(trustedZero);
    for (const delivery of source.pending()) source.acknowledge(delivery);
    host.close();
    await rm(root, { recursive: true, force: true });
  }
});
