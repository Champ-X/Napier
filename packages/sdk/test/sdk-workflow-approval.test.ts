import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA,
  type WorkflowObjectSchema,
} from "@napier/contracts";
import {
  exportThreadReplayBundle,
  LocalStore,
  UnsupportedSandboxAdapter,
  verifyThreadReplayBundle,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  createNapierClient,
  type DefineNapierWorkflowInput,
} from "../src/index.js";

const temporaryRoots: string[] = [];

type ApprovalRequest = {
  request: string;
};

type ApprovalResult = {
  approved: boolean;
  decisionId: string;
  selectedOptionId: string;
  answerSha256: string;
  customText: string;
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Napier TypeScript SDK Workflow Approvals", () => {
  it("fails stale answers closed and admits one concurrent answer", async () => {
    const fixture = await createFixture("freshness");
    const client = await createNapierClient({
      ...fixture,
      sandbox: new UnsupportedSandboxAdapter("sdk-approval-freshness"),
    });
    const workflow = await client.defineWorkflow<
      ApprovalRequest,
      ApprovalResult
    >(approvalWorkflowDefinition());
    const waiting = await client.runWorkflow({
      workflow,
      input: { request: "Approve exactly once." },
    });
    expect(waiting).toEqual(
      expect.objectContaining({
        status: "waiting",
        pendingDecision: expect.objectContaining({
          status: "pending",
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    const pending = waiting.pendingDecision!;
    const unrelatedWorkflow = await client.defineWorkflow<
      ApprovalRequest,
      ApprovalResult
    >(
      approvalWorkflowDefinition({
        name: "Unrelated SDK Approval",
      }),
    );
    await expect(
      client.answerWorkflowApproval({
        workflow: unrelatedWorkflow,
        threadId: waiting.threadId,
        planId: waiting.planId,
        decisionId: pending.id,
        expectedDecisionSha256: pending.contentSha256,
        selectedOptionIds: ["option_1"],
      }),
    ).rejects.toThrow("start evidence is unavailable");
    await expect(
      client.answerWorkflowApproval({
        workflow,
        threadId: waiting.threadId,
        planId: waiting.planId,
        decisionId: pending.id,
        expectedDecisionSha256: "0".repeat(64),
        selectedOptionIds: ["option_1"],
      }),
    ).rejects.toThrow("has changed");
    const invalidEvents: string[] = [];
    await expect(
      client.answerWorkflowApproval({
        workflow,
        threadId: waiting.threadId,
        planId: waiting.planId,
        decisionId: pending.id,
        expectedDecisionSha256: pending.contentSha256,
        selectedOptionIds: [] as unknown as ["option_1" | "option_2"],
        customText: "Do not consume a Decision without a selection.",
        onEvent: (event) => {
          invalidEvents.push(event.type);
        },
      }),
    ).rejects.toThrow("requires exactly one approve or reject selection");
    expect(invalidEvents).toEqual([]);

    const attempts = await Promise.allSettled([
      client.answerWorkflowApproval({
        workflow,
        threadId: waiting.threadId,
        planId: waiting.planId,
        decisionId: pending.id,
        expectedDecisionSha256: pending.contentSha256,
        selectedOptionIds: ["option_1"],
        customText: "First concurrent answer.",
      }),
      client.answerWorkflowApproval({
        workflow,
        threadId: waiting.threadId,
        planId: waiting.planId,
        decisionId: pending.id,
        expectedDecisionSha256: pending.contentSha256,
        selectedOptionIds: ["option_1"],
        customText: "Second concurrent answer.",
      }),
    ]);
    const fulfilled = attempts.filter(
      (attempt) => attempt.status === "fulfilled",
    );
    const rejected = attempts.filter(
      (attempt) => attempt.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fulfilled[0]).toEqual(
      expect.objectContaining({
        value: expect.objectContaining({
          status: "completed",
          output: expect.objectContaining({
            approved: true,
            selectedOptionId: "option_1",
          }),
          decision: expect.objectContaining({ status: "continued" }),
        }),
      }),
    );

    const rejectedWaiting = await client.runWorkflow({
      workflow,
      input: { request: "Reject the second delivery." },
    });
    const rejectedDecision = rejectedWaiting.pendingDecision!;
    const blocked = await client.answerWorkflowApproval({
      workflow,
      threadId: rejectedWaiting.threadId,
      planId: rejectedWaiting.planId,
      decisionId: rejectedDecision.id,
      expectedDecisionSha256: rejectedDecision.contentSha256,
      selectedOptionIds: ["option_2"],
      customText: "Evidence is incomplete.",
    });
    expect(blocked).toEqual(
      expect.objectContaining({
        status: "blocked",
        result: expect.objectContaining({
          nodeResults: [
            expect.objectContaining({ errorCode: "approval_rejected" }),
          ],
        }),
      }),
    );
    await client.close();

    const store = await openStore(fixture);
    expect(
      (await store.listEvents(waiting.threadId)).filter(
        (event) => event.type === "operator.decision.answered",
      ),
    ).toHaveLength(1);
    expect(
      verifyThreadReplayBundle(
        await exportThreadReplayBundle(store, waiting.threadId),
      ).status,
    ).toBe("valid");
    store.close();
  });

  it("rejects an expired answer before persisting it", async () => {
    const fixture = await createFixture("answer-expired");
    const client = await createNapierClient({
      ...fixture,
      sandbox: new UnsupportedSandboxAdapter("sdk-approval-expired"),
    });
    const workflow = await client.defineWorkflow<
      ApprovalRequest,
      ApprovalResult
    >(approvalWorkflowDefinition({ timeoutMs: 1_000 }));
    const waiting = await client.runWorkflow({
      workflow,
      input: { request: "Let this Approval expire." },
    });
    const pending = waiting.pendingDecision!;
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    await expect(
      client.answerWorkflowApproval({
        workflow,
        threadId: waiting.threadId,
        planId: waiting.planId,
        decisionId: pending.id,
        expectedDecisionSha256: pending.contentSha256,
        selectedOptionIds: ["option_1"],
      }),
    ).rejects.toThrow("has expired");
    const resumed = await client.resumeWorkflow({
      workflow,
      threadId: waiting.threadId,
      planId: waiting.planId,
    });
    expect(resumed.status).toBe("blocked");
    await client.close();

    const store = await openStore(fixture);
    expect(
      (await store.listEvents(waiting.threadId)).filter(
        (event) => event.type === "operator.decision.answered",
      ),
    ).toHaveLength(0);
    store.close();
  });

  it("recovers after cancellation immediately after durable answer", async () => {
    const fixture = await createFixture("answer-cancel");
    const client = await createNapierClient({
      ...fixture,
      sandbox: new UnsupportedSandboxAdapter("sdk-approval-cancel"),
    });
    const workflow = await client.defineWorkflow<
      ApprovalRequest,
      ApprovalResult
    >(approvalWorkflowDefinition());
    const waiting = await client.runWorkflow({
      workflow,
      input: { request: "Persist then cancel." },
    });
    const pending = waiting.pendingDecision!;
    const controller = new AbortController();
    await expect(
      client.answerWorkflowApproval({
        workflow,
        threadId: waiting.threadId,
        planId: waiting.planId,
        decisionId: pending.id,
        expectedDecisionSha256: pending.contentSha256,
        selectedOptionIds: ["option_1"],
        customText: "Durable before cancellation.",
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "operator.decision.answered") controller.abort();
        },
      }),
    ).rejects.toThrow();

    const resumed = await client.resumeWorkflow({
      workflow,
      threadId: waiting.threadId,
      planId: waiting.planId,
    });
    expect(resumed).toEqual(
      expect.objectContaining({
        status: "completed",
        output: expect.objectContaining({
          approved: true,
          customText: "Durable before cancellation.",
        }),
      }),
    );
    await client.close();

    const store = await openStore(fixture);
    expect(
      (await store.listEvents(waiting.threadId)).filter(
        (event) => event.type === "operator.decision.answered",
      ),
    ).toHaveLength(1);
    store.close();
  });
});

function approvalWorkflowDefinition(
  options: {
    name?: string;
    timeoutMs?: number;
  } = {},
): DefineNapierWorkflowInput<ApprovalRequest, ApprovalResult> {
  const inputSchema = objectSchema({
    request: { type: "string", minLength: 1, maxLength: 200 },
  });
  const outputSchema = structuredClone(
    EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA,
  );
  return {
    name: options.name ?? "SDK Approval",
    version: 1,
    description: "Answer one fresh Approval and resume its Workflow.",
    plan: {
      objective: "Approve one SDK delivery.",
      steps: [
        {
          id: "approve",
          title: "Approve delivery",
          description: "Wait for one fresh operator answer.",
          verification: "Return the typed Approval receipt.",
        },
      ],
    },
    inputSchema,
    outputSchema,
    outputNodeId: "approve",
    nodes: [
      {
        id: "approve",
        type: "approval",
        header: "Release",
        question: "Approve this SDK Workflow delivery?",
        approve: {
          label: "Approve",
          description: "Complete the typed Workflow.",
        },
        reject: {
          label: "Reject",
          description: "Block the typed Workflow.",
        },
        inputBindings: {
          workflow: { source: "workflow" },
        },
        inputSchema: objectSchema({ workflow: inputSchema }),
        outputSchema,
        timeoutMs: options.timeoutMs ?? 60_000,
        maxAttempts: 2,
      },
    ],
  };
}

function objectSchema(
  properties: WorkflowObjectSchema["properties"],
): WorkflowObjectSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

async function createFixture(label: string) {
  const root = await mkdtemp(path.join(tmpdir(), `napier-sdk-${label}-`));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  return { workspaceRoot, dataRoot };
}

async function openStore(fixture: {
  workspaceRoot: string;
  dataRoot: string;
}): Promise<LocalStore> {
  const store = new LocalStore(fixture);
  await store.initialize();
  return store;
}
