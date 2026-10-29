import {
  fauxAssistantMessage,
  fauxProvider,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
} from "@earendil-works/pi-ai";
import type {
  ModelCallAttributionV1,
  ModelUsageOwner,
} from "@napier/contracts/model-accounting";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { modelAdapterReceipt } from "../src/model-adapter-receipt.js";
import { modelInputAllowance } from "../src/model-call-budget-allowance.js";
import { createModelContextEnvelopeReceipt } from "../src/model-context-envelope.js";
import {
  freezeModelAccountingBasis,
  validateModelCallAttribution,
} from "../src/model-usage-observation.js";
import {
  issueModelUndispatchedDriverProof,
  issueModelUsagePreparationAuthority,
  issuePreparedModelCall,
} from "../src/model-call-attribution.js";

export function modelUsageFixture(
  options: {
    sourceId?: string;
    physicalId?: string;
    workspaceLedgerId?: string;
    hostWorkspaceId?: string;
    model?: Model<Api>;
    owner?: ModelUsageOwner;
    createdAt?: string;
    declaredZeroCost?: boolean;
  } = {},
) {
  const model = options.model ?? {
    ...fauxProvider({
      provider: "usage-test",
      models: [{ id: "local", maxTokens: 100 }],
    }).getModel(),
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
  };
  const context: Context = {
    systemPrompt: "Local accounting fixture.",
    messages: [{ role: "user", content: "fixture input", timestamp: 1 }],
  };
  const generation = { maxTokens: 100 };
  const content: Omit<ModelCallAttributionV1, "contentSha256"> = {
    kind: "napier.model-call-attribution",
    schemaVersion: 1,
    physicalId: options.physicalId ?? "physical-fixture-1",
    workspaceLedgerId: options.workspaceLedgerId ?? "workspace-ledger-fixture",
    receiptSourceId: options.sourceId ?? "source-fixture",
    ...(options.hostWorkspaceId
      ? { hostWorkspaceId: options.hostWorkspaceId }
      : {}),
    owner: options.owner ?? {
      kind: "run",
      threadId: "thread-fixture",
      runId: "run-fixture",
    },
    phase: "agent_turn",
    method: "completeSimple",
    logicalCallId: "logical-fixture-1",
    model: { provider: model.provider, id: model.id, api: model.api },
    capture: {
      inputAllowance: modelInputAllowance(model, context),
      envelope: createModelContextEnvelopeReceipt({
        turnIndex: 0,
        systemPrompt: context.systemPrompt ?? "",
        messages: context.messages,
        tools: [],
      }),
      adapter: modelAdapterReceipt(model, generation),
      contextSha256: sha256(canonicalJson(context)),
      generationOptionsSha256: sha256(canonicalJson(generation)),
      admittedModelSha256: sha256(canonicalJson(model)),
      requestSha256: sha256(canonicalJson({ model, context, generation })),
      requestScope: "admitted_input_v1",
      privateCapsule: { status: "not_requested" },
    },
    accountingBasis: freezeModelAccountingBasis(model, {
      declaredZeroCost: options.declaredZeroCost ?? false,
    }),
    createdAt: options.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
  const attribution = validateModelCallAttribution({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
  const message: AssistantMessage = {
    ...fauxAssistantMessage(
      "Private fixture response; never stored in usage spool.",
    ),
    provider: model.provider,
    model: model.id,
    api: model.api,
    usage: {
      input: 100,
      output: 20,
      cacheRead: 10,
      cacheWrite: 5,
      totalTokens: 135,
      cost: {
        input: 0.01,
        output: 0.02,
        cacheRead: 0.001,
        cacheWrite: 0.002,
        total: 0.033,
      },
    },
  };
  return { model, context, generation, attribution, message };
}

export function modelUsageUndispatchedProof(
  attribution: ModelCallAttributionV1,
) {
  const repository = {};
  const authority = issueModelUsagePreparationAuthority({
    repository,
    owner: {
      kind: "operation",
      operationId: "fixture-operation",
      operation: "standalone_model_call",
    },
  });
  return issueModelUndispatchedDriverProof(
    issuePreparedModelCall({ repository, authority, attribution }),
  );
}
