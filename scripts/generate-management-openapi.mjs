import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultSourceDirectory = "apps/server/src";
const defaultArtifactPath = "docs/artifacts/management-openapi-0.1.0.json";
const PROMOTED_OPERATION_SCHEMAS = {
  "GET /api/health": {
    responses: {
      200: "#/components/schemas/HealthResponse",
    },
  },
  "GET /api/receipt-trust/anchors": {
    responses: {
      200: "#/components/schemas/ReceiptTrustAnchorList",
    },
  },
  "GET /api/receipt-trust/anchors/directory": {
    responses: {
      200: "#/components/schemas/ReceiptTrustAnchorDirectory",
    },
  },
  "POST /api/receipt-trust/anchors/directory/discover": {
    request: "#/components/schemas/DiscoverReceiptTrustAnchorDirectoryRequest",
    responses: {
      200: "#/components/schemas/ReceiptTrustAnchorDirectoryDiscovery",
    },
  },
  "POST /api/receipt-trust/anchors/directory/metadata/verify": {
    request:
      "#/components/schemas/VerifyReceiptTrustAnchorDirectoryMetadataRequest",
    responses: {
      200: "#/components/schemas/ReceiptTrustAnchorDirectoryMetadataVerification",
    },
  },
  "POST /api/receipt-trust/anchors/directory/signed-metadata": {
    request:
      "#/components/schemas/SignReceiptTrustAnchorDirectoryMetadataRequest",
    responses: {
      201: "#/components/schemas/ReceiptTrustAnchorDirectoryMetadataEnvelope",
    },
  },
  "GET /api/receipt-trust/anchors/directory/subscriptions": {
    responses: {
      200: "#/components/schemas/ReceiptTrustAnchorDirectorySubscriptionList",
    },
  },
  "POST /api/receipt-trust/anchors/directory/subscriptions": {
    request:
      "#/components/schemas/CreateReceiptTrustAnchorDirectorySubscriptionRequest",
    responses: {
      201: "#/components/schemas/ReceiptTrustAnchorDirectorySubscription",
      422: "#/components/schemas/ReceiptTrustAnchorDirectoryDiscovery",
    },
  },
  "POST /api/receipt-trust/anchors/directory/subscriptions/{subscriptionId}": {
    request:
      "#/components/schemas/UpdateReceiptTrustAnchorDirectorySubscriptionRequest",
    responses: {
      200: "#/components/schemas/ReceiptTrustAnchorDirectorySubscription",
    },
  },
  "POST /api/receipt-trust/anchors/directory/subscriptions/{subscriptionId}/refresh":
    {
      request:
        "#/components/schemas/RefreshReceiptTrustAnchorDirectorySubscriptionRequest",
      responses: {
        200: "#/components/schemas/ReceiptTrustAnchorDirectorySubscriptionRefreshResult",
      },
    },
  "POST /api/receipt-trust/anchors/directory/subscriptions/quorum": {
    request:
      "#/components/schemas/EvaluateReceiptTrustAnchorDirectoryQuorumRequest",
    responses: {
      200: "#/components/schemas/ReceiptTrustAnchorDirectoryQuorum",
    },
  },
  "POST /api/receipt-trust/anchors/directory/verify": {
    request: "#/components/schemas/VerifyReceiptTrustAnchorDirectoryRequest",
    responses: {
      200: "#/components/schemas/ReceiptTrustAnchorDirectoryVerification",
    },
  },
  "POST /api/receipt-trust/anchors": {
    request: "#/components/schemas/CreateReceiptTrustAnchorRequest",
    responses: {
      201: "#/components/schemas/ReceiptTrustAnchor",
    },
  },
  "POST /api/receipt-trust/anchors/{anchorId}/revoke": {
    request: "#/components/schemas/RevokeReceiptTrustAnchorRequest",
    responses: {
      200: "#/components/schemas/ReceiptTrustAnchor",
    },
  },
  "POST /api/receipt-trust/verify": {
    request: "#/components/schemas/VerifyTrustedReceiptRequest",
    responses: {
      200: "#/components/schemas/TrustedReceiptVerification",
    },
  },
  "POST /api/threads/{threadId}/subagents/{taskId}/outcome/verify": {
    request: false,
    responses: {
      200: "#/components/schemas/SubagentOutcomeEvidenceVerification",
    },
  },
  "POST /api/threads/{threadId}/subagents/{taskId}/outcome/review": {
    request: "#/components/schemas/ReviewSubagentOutcomeRequest",
    responses: {
      200: "#/components/schemas/SubagentOutcomeReview",
    },
  },
  "POST /api/threads/{threadId}/plans/{planId}/artifacts/{artifactId}/file/verify":
    {
      requestContentType: "application/octet-stream",
    },
  "GET /api/threads/{threadId}/runs/{runId}/control-messages": {
    responses: {
      200: "#/components/schemas/RunControlMessageList",
    },
  },
  "POST /api/threads/{threadId}/runs/{runId}/control-messages": {
    request: "#/components/schemas/QueueRunControlMessageRequest",
    responses: {
      202: "#/components/schemas/RunControlMessage",
    },
  },
  "POST /api/threads/{threadId}/runs/{runId}/control-messages/{controlMessageId}/cancel":
    {
      request: false,
      responses: {
        200: "#/components/schemas/RunControlMessage",
      },
    },
  "GET /api/threads/{threadId}/operator-decisions": {
    responses: {
      200: "#/components/schemas/OperatorDecisionList",
    },
  },
  "GET /api/threads/{threadId}/agent-milestones": {
    responses: {
      200: "#/components/schemas/AgentMilestoneList",
    },
  },
  "GET /api/threads/{threadId}/runs/{runId}/browser-live-view/stream": {
    responseContentTypes: {
      200: "text/event-stream",
    },
  },
  "POST /api/threads/{threadId}/operator-decisions/{decisionId}/answer": {
    request: "#/components/schemas/AnswerOperatorDecisionRequest",
    responses: {
      202: "#/components/schemas/OperatorDecision",
    },
  },
  "POST /api/threads/{threadId}/operator-decisions/{decisionId}/cancel": {
    request: false,
    responses: {
      200: "#/components/schemas/OperatorDecision",
    },
  },
};

export async function generateManagementOpenApi(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const sourcePaths = options.sourcePaths
    ? [...options.sourcePaths]
    : options.sourcePath
      ? [options.sourcePath]
      : await discoverManagementSourcePaths(repoRoot);
  const absoluteSourcePaths = sourcePaths.map((sourcePath) =>
    resolveRepoRelativePath(repoRoot, sourcePath, "sourcePath"),
  );
  const sourceTexts = await Promise.all(
    absoluteSourcePaths.map((sourcePath) => readFile(sourcePath, "utf8")),
  );
  const sourceText = sourceTexts.join("\n");
  const packageJson = parseJson(
    await readFile(path.join(repoRoot, "package.json"), "utf8"),
    "package.json",
  );
  const routes = extractManagementRoutes(sourceText);
  const routeSetSha256 = sha256Text(
    stableJson(
      routes.map((route) => ({
        method: route.method,
        path: route.openapiPath,
      })),
    ),
  );
  const paths = {};
  for (const route of routes) {
    paths[route.openapiPath] ??= {};
    paths[route.openapiPath][route.method] = createOperation(route);
  }
  const artifact = {
    openapi: "3.1.0",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: {
      title: "Napier Management API",
      version:
        isRecord(packageJson) && typeof packageJson.version === "string"
          ? packageJson.version
          : "0.0.0",
      description:
        "Generated route-level OpenAPI contract for Napier's local management plane. Request and response schemas are intentionally conservative until endpoint-level schemas are promoted.",
    },
    servers: [
      {
        url: "http://127.0.0.1:8787",
        description: "Local Napier API process",
      },
    ],
    paths,
    components: {
      schemas: {
        ErrorResponse: {
          type: "object",
          required: ["error"],
          additionalProperties: false,
          properties: {
            error: { type: "string" },
          },
        },
        HealthResponse: {
          type: "object",
          required: ["status", "service", "time", "runtime", "ledger"],
          additionalProperties: false,
          properties: {
            status: { $ref: "#/components/schemas/HealthStatus" },
            service: { const: "napier" },
            time: { type: "string", format: "date-time" },
            runtime: { $ref: "#/components/schemas/HealthRuntime" },
            ledger: { $ref: "#/components/schemas/HealthLedger" },
          },
        },
        HealthStatus: {
          type: "string",
          enum: ["ok", "degraded", "failed"],
        },
        HealthRuntime: {
          type: "object",
          required: ["node", "components"],
          additionalProperties: false,
          properties: {
            node: { $ref: "#/components/schemas/HealthRuntimeNode" },
            components: {
              $ref: "#/components/schemas/HealthRuntimeComponents",
            },
          },
        },
        HealthRuntimeNode: {
          type: "object",
          required: ["version", "platform", "arch"],
          additionalProperties: false,
          properties: {
            version: { type: "string" },
            platform: { type: "string" },
            arch: { type: "string" },
          },
        },
        HealthRuntimeComponents: {
          type: "object",
          required: ["sqlite", "openssl", "uv", "v8"],
          additionalProperties: false,
          properties: {
            sqlite: { type: "string" },
            openssl: { type: "string" },
            uv: { type: "string" },
            v8: { type: "string" },
          },
        },
        HealthLedger: {
          type: "object",
          required: ["schemaVersion", "quickCheck", "migrations"],
          additionalProperties: false,
          properties: {
            schemaVersion: { type: "integer", minimum: 0 },
            quickCheck: { type: "string" },
            migrations: {
              type: "array",
              items: { $ref: "#/components/schemas/HealthMigration" },
            },
          },
        },
        HealthMigration: {
          type: "object",
          required: ["version", "name", "appliedAt"],
          additionalProperties: false,
          properties: {
            version: { type: "integer", minimum: 0 },
            name: { type: "string" },
            appliedAt: { type: "string", format: "date-time" },
          },
        },
        ModelRef: {
          type: "object",
          required: ["provider", "id"],
          additionalProperties: false,
          properties: {
            provider: {
              type: "string",
              pattern: "^[a-z0-9][a-z0-9._-]{1,80}$",
            },
            id: {
              type: "string",
              pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$",
            },
          },
        },
        Usage: {
          type: "object",
          required: [
            "inputTokens",
            "outputTokens",
            "cacheReadTokens",
            "cacheWriteTokens",
            "costUsd",
          ],
          additionalProperties: false,
          properties: {
            inputTokens: { type: "number", minimum: 0 },
            outputTokens: { type: "number", minimum: 0 },
            cacheReadTokens: { type: "number", minimum: 0 },
            cacheWriteTokens: { type: "number", minimum: 0 },
            costUsd: { type: "number", minimum: 0 },
          },
        },
        ModelContextEnvelopeReceipt: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "turnIndex",
            "systemPromptSha256",
            "systemPromptBytes",
            "messageCount",
            "userMessageCount",
            "assistantMessageCount",
            "toolResultMessageCount",
            "otherMessageCount",
            "messageSetSha256",
            "toolCount",
            "toolNameSetSha256",
            "toolDefinitionSetSha256",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: { const: "napier.model-context-envelope" },
            schemaVersion: { const: 1 },
            turnIndex: { type: "integer", minimum: 0 },
            systemPromptSha256: { $ref: "#/components/schemas/Sha256Hex" },
            systemPromptBytes: { type: "integer", minimum: 0 },
            messageCount: { type: "integer", minimum: 0 },
            userMessageCount: { type: "integer", minimum: 0 },
            assistantMessageCount: { type: "integer", minimum: 0 },
            toolResultMessageCount: { type: "integer", minimum: 0 },
            otherMessageCount: { type: "integer", minimum: 0 },
            messageSetSha256: { $ref: "#/components/schemas/Sha256Hex" },
            toolCount: { type: "integer", minimum: 0 },
            toolNameSetSha256: { $ref: "#/components/schemas/Sha256Hex" },
            toolDefinitionSetSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReviewSubagentOutcomeRequest: {
          type: "object",
          required: ["model"],
          additionalProperties: false,
          properties: {
            model: { $ref: "#/components/schemas/ModelRef" },
          },
        },
        RunControlMessageMode: {
          type: "string",
          enum: ["steering", "follow_up"],
        },
        RunControlMessageStatus: {
          type: "string",
          enum: ["queued", "delivered", "cancelled"],
        },
        RunControlMessageCancellationReason: {
          type: "string",
          enum: [
            "operator_cancelled",
            "run_completed_before_delivery",
            "run_failed_before_delivery",
            "run_cancelled_before_delivery",
            "run_interrupted_before_delivery",
          ],
        },
        QueueRunControlMessageRequest: {
          type: "object",
          required: ["mode", "text"],
          additionalProperties: false,
          properties: {
            mode: { $ref: "#/components/schemas/RunControlMessageMode" },
            text: { type: "string", minLength: 1, maxLength: 16384 },
          },
        },
        RunControlMessage: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "id",
            "threadId",
            "runId",
            "mode",
            "status",
            "textSha256",
            "textBytes",
            "queuedAt",
            "queuedEventSeq",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: { const: "napier.run-control-message" },
            schemaVersion: { const: 1 },
            id: {
              type: "string",
              pattern: "^control_[a-z0-9]{8,80}$",
            },
            threadId: {
              type: "string",
              pattern: "^thread_[a-z0-9]{8,80}$",
            },
            runId: {
              type: "string",
              pattern: "^run_[a-z0-9]{8,80}$",
            },
            mode: { $ref: "#/components/schemas/RunControlMessageMode" },
            status: {
              $ref: "#/components/schemas/RunControlMessageStatus",
            },
            textSha256: { $ref: "#/components/schemas/Sha256Hex" },
            textBytes: { type: "integer", minimum: 1, maximum: 16384 },
            queuedAt: { type: "string", format: "date-time" },
            queuedEventSeq: { type: "integer", minimum: 1 },
            deliveredAt: { type: "string", format: "date-time" },
            deliveredEventSeq: { type: "integer", minimum: 1 },
            messageEventSeq: { type: "integer", minimum: 1 },
            cancelledAt: { type: "string", format: "date-time" },
            cancellationEventSeq: { type: "integer", minimum: 1 },
            cancellationReason: {
              $ref: "#/components/schemas/RunControlMessageCancellationReason",
            },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        RunControlMessageList: {
          type: "array",
          maxItems: 64,
          items: { $ref: "#/components/schemas/RunControlMessage" },
        },
        OperatorDecisionStatus: {
          type: "string",
          enum: ["pending", "answered", "continued", "cancelled"],
        },
        OperatorDecisionCancellationReason: {
          type: "string",
          enum: [
            "operator_cancelled",
            "run_completed_without_wait",
            "run_failed",
            "run_cancelled",
          ],
        },
        OperatorDecisionOption: {
          type: "object",
          required: ["id", "label", "description"],
          additionalProperties: false,
          properties: {
            id: {
              type: "string",
              pattern: "^option_[1-4]$",
            },
            label: { type: "string", minLength: 1, maxLength: 80 },
            description: {
              type: "string",
              minLength: 1,
              maxLength: 400,
            },
          },
        },
        AnswerOperatorDecisionRequest: {
          type: "object",
          required: ["selectedOptionIds"],
          additionalProperties: false,
          properties: {
            selectedOptionIds: {
              type: "array",
              maxItems: 4,
              uniqueItems: true,
              items: {
                type: "string",
                pattern: "^option_[1-4]$",
              },
            },
            customText: {
              type: "string",
              minLength: 1,
              maxLength: 4096,
            },
          },
        },
        OperatorDecision: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "id",
            "threadId",
            "runId",
            "status",
            "header",
            "question",
            "options",
            "multiSelect",
            "questionSha256",
            "requestedAt",
            "requestedEventSeq",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: { const: "napier.operator-decision" },
            schemaVersion: { const: 1 },
            id: {
              type: "string",
              pattern: "^decision_[a-z0-9]{8,80}$",
            },
            threadId: {
              type: "string",
              pattern: "^thread_[a-z0-9]{8,80}$",
            },
            runId: {
              type: "string",
              pattern: "^run_[a-z0-9]{8,80}$",
            },
            status: {
              $ref: "#/components/schemas/OperatorDecisionStatus",
            },
            header: { type: "string", minLength: 1, maxLength: 12 },
            question: { type: "string", minLength: 1, maxLength: 4096 },
            options: {
              type: "array",
              minItems: 2,
              maxItems: 4,
              items: {
                $ref: "#/components/schemas/OperatorDecisionOption",
              },
            },
            multiSelect: { type: "boolean" },
            questionSha256: { $ref: "#/components/schemas/Sha256Hex" },
            requestedAt: { type: "string", format: "date-time" },
            requestedEventSeq: { type: "integer", minimum: 1 },
            answeredAt: { type: "string", format: "date-time" },
            answeredEventSeq: { type: "integer", minimum: 1 },
            selectedOptionIds: {
              type: "array",
              maxItems: 4,
              uniqueItems: true,
              items: {
                type: "string",
                pattern: "^option_[1-4]$",
              },
            },
            customText: { type: "string", minLength: 1, maxLength: 4096 },
            answerSha256: { $ref: "#/components/schemas/Sha256Hex" },
            continuedAt: { type: "string", format: "date-time" },
            continuedEventSeq: { type: "integer", minimum: 1 },
            continuationRunId: {
              type: "string",
              pattern: "^run_[a-z0-9]{8,80}$",
            },
            cancelledAt: { type: "string", format: "date-time" },
            cancellationEventSeq: { type: "integer", minimum: 1 },
            cancellationReason: {
              $ref: "#/components/schemas/OperatorDecisionCancellationReason",
            },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        OperatorDecisionList: {
          type: "array",
          maxItems: 64,
          items: { $ref: "#/components/schemas/OperatorDecision" },
        },
        AgentMilestonePhase: {
          type: "string",
          enum: ["planning", "execution", "verification", "delivery"],
        },
        AgentMilestoneEvidenceRange: {
          type: "object",
          required: ["fromSeq", "toSeq", "eventCount", "eventStreamSha256"],
          additionalProperties: false,
          properties: {
            fromSeq: { type: "integer", minimum: 0 },
            toSeq: { type: "integer", minimum: 0 },
            eventCount: { type: "integer", minimum: 0 },
            eventStreamSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
          },
        },
        AgentMilestone: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "id",
            "threadId",
            "runId",
            "sequence",
            "phase",
            "title",
            "summary",
            "completedItems",
            "openLoops",
            "summarySha256",
            "completedItemSetSha256",
            "openLoopSetSha256",
            "evidence",
            "recordedAt",
            "eventSeq",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: { const: "napier.agent-milestone" },
            schemaVersion: { const: 1 },
            id: {
              type: "string",
              pattern: "^milestone_[a-z0-9]{8,80}$",
            },
            threadId: {
              type: "string",
              pattern: "^thread_[a-z0-9]{8,80}$",
            },
            runId: {
              type: "string",
              pattern: "^run_[a-z0-9]{8,80}$",
            },
            sequence: { type: "integer", minimum: 1, maximum: 32 },
            phase: { $ref: "#/components/schemas/AgentMilestonePhase" },
            title: { type: "string", minLength: 1, maxLength: 80 },
            summary: { type: "string", minLength: 1, maxLength: 4000 },
            completedItems: {
              type: "array",
              maxItems: 12,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 500 },
            },
            openLoops: {
              type: "array",
              maxItems: 12,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 500 },
            },
            summarySha256: { $ref: "#/components/schemas/Sha256Hex" },
            completedItemSetSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            openLoopSetSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            evidence: {
              $ref: "#/components/schemas/AgentMilestoneEvidenceRange",
            },
            predecessorMilestoneId: {
              type: "string",
              pattern: "^milestone_[a-z0-9]{8,80}$",
            },
            predecessorEventSeq: { type: "integer", minimum: 1 },
            recordedAt: { type: "string", format: "date-time" },
            eventSeq: { type: "integer", minimum: 1 },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        AgentMilestoneList: {
          type: "array",
          maxItems: 128,
          items: { $ref: "#/components/schemas/AgentMilestone" },
        },
        SubagentOutcomeReviewVerdict: {
          type: "string",
          enum: ["accept", "revise", "reject", "inconclusive"],
        },
        SubagentOutcomeReviewRisk: {
          type: "string",
          enum: ["low", "medium", "high"],
        },
        SubagentOutcomeReview: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "policyId",
            "taskId",
            "role",
            "outcomeSha256",
            "workerModel",
            "reviewerModel",
            "verdict",
            "score",
            "risk",
            "reason",
            "concerns",
            "criteria",
            "itemCount",
            "unknownCount",
            "evidenceCount",
            "usage",
            "criteriaSha256",
            "inputSha256",
            "promptSha256",
            "responseSha256",
            "reviewSchemaSha256",
            "createdAt",
            "reviewSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: { const: "napier.subagent-outcome-review" },
            schemaVersion: { const: 1 },
            policyId: { const: "napier.subagent-outcome-review.v1" },
            taskId: {
              type: "string",
              pattern: "^task_[a-z0-9]{8,80}$",
            },
            role: {
              type: "string",
              enum: ["researcher", "reviewer", "general", "coder"],
            },
            outcomeSha256: { $ref: "#/components/schemas/Sha256Hex" },
            workerModel: { $ref: "#/components/schemas/ModelRef" },
            reviewerModel: { $ref: "#/components/schemas/ModelRef" },
            verdict: {
              $ref: "#/components/schemas/SubagentOutcomeReviewVerdict",
            },
            score: { type: "integer", minimum: 0, maximum: 100 },
            risk: {
              $ref: "#/components/schemas/SubagentOutcomeReviewRisk",
            },
            reason: { type: "string", minLength: 1, maxLength: 1000 },
            concerns: {
              type: "array",
              maxItems: 8,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 200 },
            },
            criteria: {
              type: "array",
              minItems: 4,
              maxItems: 4,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 64 },
            },
            itemCount: { type: "integer", minimum: 0, maximum: 20 },
            unknownCount: { type: "integer", minimum: 0, maximum: 12 },
            evidenceCount: { type: "integer", minimum: 0, maximum: 200 },
            usage: { $ref: "#/components/schemas/Usage" },
            criteriaSha256: { $ref: "#/components/schemas/Sha256Hex" },
            inputSha256: { $ref: "#/components/schemas/Sha256Hex" },
            promptSha256: { $ref: "#/components/schemas/Sha256Hex" },
            responseSha256: { $ref: "#/components/schemas/Sha256Hex" },
            reviewSchemaSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            modelContextEnvelope: {
              $ref: "#/components/schemas/ModelContextEnvelopeReceipt",
            },
            createdAt: { type: "string", format: "date-time" },
            reviewSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        SubagentOutcomeEvidenceVerificationStatus: {
          type: "string",
          enum: ["aligned", "divergent", "unavailable"],
        },
        SubagentOutcomeEvidenceVerificationItemStatus: {
          type: "string",
          enum: ["aligned", "divergent", "missing"],
        },
        SubagentOutcomeEvidenceVerificationItem: {
          type: "object",
          required: [
            "path",
            "status",
            "expectedFileSha256",
            "expectedRangeSha256",
          ],
          additionalProperties: false,
          properties: {
            path: { type: "string", minLength: 1, maxLength: 500 },
            lineStart: { type: "integer", minimum: 1 },
            lineEnd: { type: "integer", minimum: 1 },
            status: {
              $ref: "#/components/schemas/SubagentOutcomeEvidenceVerificationItemStatus",
            },
            expectedFileSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            observedFileSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            expectedRangeSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            observedRangeSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            diagnosticSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
          },
        },
        SubagentOutcomeEvidenceVerification: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "status",
            "taskId",
            "outcomeSha256",
            "evidenceCount",
            "alignedCount",
            "divergentCount",
            "missingCount",
            "items",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: {
              const: "napier.subagent-outcome-evidence-verification",
            },
            schemaVersion: { const: 1 },
            status: {
              $ref: "#/components/schemas/SubagentOutcomeEvidenceVerificationStatus",
            },
            taskId: {
              type: "string",
              pattern: "^task_[a-z0-9]{8,80}$",
            },
            outcomeSha256: { $ref: "#/components/schemas/Sha256Hex" },
            evidenceCount: {
              type: "integer",
              minimum: 0,
              maximum: 200,
            },
            alignedCount: {
              type: "integer",
              minimum: 0,
              maximum: 200,
            },
            divergentCount: {
              type: "integer",
              minimum: 0,
              maximum: 200,
            },
            missingCount: {
              type: "integer",
              minimum: 0,
              maximum: 200,
            },
            items: {
              type: "array",
              maxItems: 200,
              items: {
                $ref: "#/components/schemas/SubagentOutcomeEvidenceVerificationItem",
              },
            },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorList: {
          type: "array",
          items: { $ref: "#/components/schemas/ReceiptTrustAnchor" },
        },
        ReceiptTrustAnchor: {
          type: "object",
          required: [
            "id",
            "label",
            "algorithm",
            "keyId",
            "publicKeySpki",
            "status",
            "createdAt",
            "updatedAt",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            id: { type: "string", pattern: "^trustkey_[a-z0-9]{8,80}$" },
            label: { type: "string", minLength: 1, maxLength: 100 },
            algorithm: { const: "Ed25519" },
            keyId: { $ref: "#/components/schemas/Sha256Hex" },
            publicKeySpki: { type: "string", minLength: 1 },
            signingSource: {
              $ref: "#/components/schemas/ReceiptTrustAnchorSigningSource",
            },
            status: { $ref: "#/components/schemas/ReceiptTrustAnchorStatus" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            revokedAt: { type: "string", format: "date-time" },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorStatus: {
          type: "string",
          enum: ["trusted", "revoked"],
        },
        ReceiptTrustAnchorDirectory: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "apiVersion",
            "generatedAt",
            "receiptKinds",
            "anchorCount",
            "trustedCount",
            "revokedCount",
            "anchorSetSha256",
            "anchors",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: { const: "napier.receipt-trust-anchor-directory" },
            schemaVersion: { const: 1 },
            apiVersion: { type: "string", minLength: 1 },
            generatedAt: { type: "string", format: "date-time" },
            receiptKinds: {
              type: "array",
              minItems: 11,
              maxItems: 11,
              items: { $ref: "#/components/schemas/TrustedReceiptKind" },
            },
            anchorCount: { type: "integer", minimum: 0 },
            trustedCount: { type: "integer", minimum: 0 },
            revokedCount: { type: "integer", minimum: 0 },
            anchorSetSha256: { $ref: "#/components/schemas/Sha256Hex" },
            anchors: {
              type: "array",
              items: {
                $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryEntry",
              },
            },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorDirectoryEntry: {
          type: "object",
          required: [
            "id",
            "label",
            "algorithm",
            "keyId",
            "publicKeySpki",
            "status",
            "createdAt",
            "updatedAt",
            "anchorSha256",
          ],
          additionalProperties: false,
          properties: {
            id: { type: "string", pattern: "^trustkey_[a-z0-9]{8,80}$" },
            label: { type: "string", minLength: 1, maxLength: 100 },
            algorithm: { const: "Ed25519" },
            keyId: { $ref: "#/components/schemas/Sha256Hex" },
            publicKeySpki: { type: "string", minLength: 1 },
            status: { $ref: "#/components/schemas/ReceiptTrustAnchorStatus" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            revokedAt: { type: "string", format: "date-time" },
            anchorSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorDirectoryVerificationPolicy: {
          type: "object",
          additionalProperties: false,
          properties: {
            maxAgeMs: { type: "integer", minimum: 0 },
            expectedAnchorSetSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            minimumTrustedCount: { type: "integer", minimum: 0 },
            requiredTrustedKeyIds: {
              type: "array",
              maxItems: 32,
              uniqueItems: true,
              items: { $ref: "#/components/schemas/Sha256Hex" },
            },
          },
        },
        ReceiptTrustAnchorDirectoryVerificationStatus: {
          type: "string",
          enum: ["valid", "invalid"],
        },
        ReceiptTrustAnchorDirectoryVerification: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "apiVersion",
            "generatedAt",
            "status",
            "diagnostics",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: {
              const: "napier.receipt-trust-anchor-directory-verification",
            },
            schemaVersion: { const: 1 },
            apiVersion: { type: "string", minLength: 1 },
            generatedAt: { type: "string", format: "date-time" },
            status: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerificationStatus",
            },
            diagnostics: {
              type: "array",
              items: { type: "string" },
            },
            policy: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerificationPolicy",
            },
            policySha256: { $ref: "#/components/schemas/Sha256Hex" },
            directoryGeneratedAt: { type: "string", format: "date-time" },
            directoryAgeMs: { type: "integer" },
            declaredContentSha256: { $ref: "#/components/schemas/Sha256Hex" },
            recomputedContentSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            declaredAnchorSetSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            recomputedAnchorSetSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            anchorCount: { type: "integer", minimum: 0 },
            trustedCount: { type: "integer", minimum: 0 },
            revokedCount: { type: "integer", minimum: 0 },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorDirectoryDiscovery: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "apiVersion",
            "generatedAt",
            "status",
            "sourceUrlSha256",
            "sourceOriginSha256",
            "httpStatus",
            "responseMediaType",
            "responseBytes",
            "responseBodySha256",
            "verification",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: {
              const: "napier.receipt-trust-anchor-directory-discovery",
            },
            schemaVersion: { const: 1 },
            apiVersion: { type: "string", minLength: 1 },
            generatedAt: { type: "string", format: "date-time" },
            status: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerificationStatus",
            },
            sourceUrlSha256: { $ref: "#/components/schemas/Sha256Hex" },
            sourceOriginSha256: { $ref: "#/components/schemas/Sha256Hex" },
            httpStatus: { type: "integer", minimum: 100, maximum: 599 },
            responseMediaType: { type: "string", minLength: 1 },
            responseBytes: { type: "integer", minimum: 0 },
            responseBodySha256: { $ref: "#/components/schemas/Sha256Hex" },
            verification: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerification",
            },
            directory: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectory",
            },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorDirectorySubscriptionStatus: {
          type: "string",
          enum: ["active", "paused"],
        },
        ReceiptTrustAnchorDirectorySubscriptionRefreshStatus: {
          type: "string",
          enum: [
            "promoted",
            "unchanged",
            "rollback_rejected",
            "rejected",
            "failed",
          ],
        },
        ReceiptTrustAnchorDirectorySubscriptionTransparencyStatus: {
          type: "string",
          enum: ["promoted", "unchanged"],
        },
        ReceiptTrustAnchorDirectorySubscriptionTransparencyEntry: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "apiVersion",
            "sequence",
            "status",
            "observedAt",
            "discoverySha256",
            "directorySha256",
            "anchorSetSha256",
            "trustedCount",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: {
              const:
                "napier.receipt-trust-anchor-directory-subscription-transparency-entry",
            },
            schemaVersion: { const: 1 },
            apiVersion: { type: "string", minLength: 1 },
            sequence: { type: "integer", minimum: 1 },
            status: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectorySubscriptionTransparencyStatus",
            },
            observedAt: { type: "string", format: "date-time" },
            discoverySha256: { $ref: "#/components/schemas/Sha256Hex" },
            directorySha256: { $ref: "#/components/schemas/Sha256Hex" },
            anchorSetSha256: { $ref: "#/components/schemas/Sha256Hex" },
            trustedCount: { type: "integer", minimum: 0 },
            previousEntrySha256: { $ref: "#/components/schemas/Sha256Hex" },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorDirectorySubscription: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "apiVersion",
            "id",
            "auditThreadId",
            "label",
            "status",
            "revision",
            "sourceUrlSha256",
            "sourceOriginSha256",
            "refreshIntervalMs",
            "nextRefreshAt",
            "policy",
            "policySha256",
            "transparencyEntryCount",
            "transparencyHistory",
            "createdAt",
            "updatedAt",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: {
              const: "napier.receipt-trust-anchor-directory-subscription",
            },
            schemaVersion: { const: 1 },
            apiVersion: { type: "string", minLength: 1 },
            id: { type: "string", pattern: "^trustdir_[a-z0-9]{8,80}$" },
            auditThreadId: {
              type: "string",
              pattern: "^thread_[a-z0-9]{8,80}$",
            },
            label: { type: "string", minLength: 1, maxLength: 100 },
            status: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectorySubscriptionStatus",
            },
            revision: { type: "integer", minimum: 1 },
            sourceUrlSha256: { $ref: "#/components/schemas/Sha256Hex" },
            sourceOriginSha256: { $ref: "#/components/schemas/Sha256Hex" },
            refreshIntervalMs: {
              type: "integer",
              minimum: 300000,
              maximum: 2592000000,
            },
            nextRefreshAt: { type: "string", format: "date-time" },
            policy: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerificationPolicy",
            },
            policySha256: { $ref: "#/components/schemas/Sha256Hex" },
            lastRefreshAt: { type: "string", format: "date-time" },
            lastRefreshStatus: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectorySubscriptionRefreshStatus",
            },
            lastDiscoverySha256: { $ref: "#/components/schemas/Sha256Hex" },
            lastFailureSha256: { $ref: "#/components/schemas/Sha256Hex" },
            lastGoodDiscovery: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryDiscovery",
            },
            transparencyEntryCount: { type: "integer", minimum: 0 },
            transparencyTailSha256: { $ref: "#/components/schemas/Sha256Hex" },
            transparencyHistory: {
              type: "array",
              items: {
                $ref: "#/components/schemas/ReceiptTrustAnchorDirectorySubscriptionTransparencyEntry",
              },
            },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorDirectorySubscriptionList: {
          type: "array",
          items: {
            $ref: "#/components/schemas/ReceiptTrustAnchorDirectorySubscription",
          },
        },
        ReceiptTrustAnchorDirectorySubscriptionRefreshResult: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "apiVersion",
            "status",
            "subscription",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: {
              const:
                "napier.receipt-trust-anchor-directory-subscription-refresh",
            },
            schemaVersion: { const: 1 },
            apiVersion: { type: "string", minLength: 1 },
            status: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectorySubscriptionRefreshStatus",
            },
            subscription: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectorySubscription",
            },
            discovery: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryDiscovery",
            },
            failureSha256: { $ref: "#/components/schemas/Sha256Hex" },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorDirectoryQuorumSourceWeight: {
          type: "object",
          required: ["sourceOriginSha256", "weight"],
          additionalProperties: false,
          properties: {
            sourceOriginSha256: { $ref: "#/components/schemas/Sha256Hex" },
            weight: { type: "integer", minimum: 1, maximum: 10 },
          },
        },
        ReceiptTrustAnchorDirectoryQuorumPolicy: {
          type: "object",
          additionalProperties: false,
          properties: {
            minimumSources: { type: "integer", minimum: 1, maximum: 20 },
            minimumAgreementCount: { type: "integer", minimum: 1, maximum: 20 },
            minimumDistinctSourceOrigins: {
              type: "integer",
              minimum: 1,
              maximum: 20,
            },
            minimumAgreementWeight: {
              type: "integer",
              minimum: 1,
              maximum: 200,
            },
            minimumMetadataPublisherCount: {
              type: "integer",
              minimum: 0,
              maximum: 20,
            },
            expectedAnchorSetSha256: {
              $ref: "#/components/schemas/Sha256HexOrEmpty",
            },
            requiredSourceOriginSha256s: {
              type: "array",
              maxItems: 20,
              uniqueItems: true,
              items: { $ref: "#/components/schemas/Sha256Hex" },
            },
            requiredMetadataPublisherSha256s: {
              type: "array",
              maxItems: 20,
              uniqueItems: true,
              items: { $ref: "#/components/schemas/Sha256Hex" },
            },
            sourceWeights: {
              type: "array",
              maxItems: 20,
              items: {
                $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryQuorumSourceWeight",
              },
            },
          },
        },
        ReceiptTrustAnchorDirectoryQuorumEffectivePolicy: {
          allOf: [
            {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryQuorumPolicy",
            },
            {
              type: "object",
              required: [
                "minimumSources",
                "minimumAgreementCount",
                "minimumDistinctSourceOrigins",
                "minimumAgreementWeight",
                "minimumMetadataPublisherCount",
                "expectedAnchorSetSha256",
                "requiredSourceOriginSha256s",
                "requiredMetadataPublisherSha256s",
                "sourceWeights",
              ],
            },
          ],
        },
        ReceiptTrustAnchorDirectoryQuorumMetadataInput: {
          type: "object",
          required: ["subscriptionId", "envelope"],
          additionalProperties: false,
          properties: {
            subscriptionId: {
              type: "string",
              pattern: "^trustdir_[a-f0-9]{20}$",
            },
            envelope: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryMetadataEnvelope",
            },
          },
        },
        ReceiptTrustAnchorDirectoryQuorumStatus: {
          type: "string",
          enum: ["agreed", "insufficient_sources", "split", "policy_failed"],
        },
        ReceiptTrustAnchorDirectoryQuorumSourceMetadata: {
          type: "object",
          required: [
            "status",
            "signatureValid",
            "integrityValid",
            "directoryBindingValid",
            "diagnosticCount",
            "diagnosticsSha256",
          ],
          additionalProperties: false,
          properties: {
            status: {
              $ref: "#/components/schemas/TrustedReceiptVerificationStatus",
            },
            signatureValid: { type: "boolean" },
            integrityValid: { type: "boolean" },
            directoryBindingValid: { type: "boolean" },
            diagnosticCount: { type: "integer", minimum: 0 },
            diagnosticsSha256: { $ref: "#/components/schemas/Sha256Hex" },
            publisherSha256: { $ref: "#/components/schemas/Sha256Hex" },
            signerKeyId: { $ref: "#/components/schemas/Sha256Hex" },
            envelopeSha256: { $ref: "#/components/schemas/Sha256Hex" },
            verificationSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorDirectoryQuorumSource: {
          type: "object",
          required: [
            "subscriptionId",
            "subscriptionSha256",
            "sourceUrlSha256",
            "sourceOriginSha256",
            "weight",
            "revision",
            "directorySha256",
            "anchorSetSha256",
            "discoverySha256",
            "transparencyTailSha256",
            "trustedCount",
            "observedAt",
          ],
          additionalProperties: false,
          properties: {
            subscriptionId: {
              type: "string",
              pattern: "^trustdir_[a-z0-9]{8,80}$",
            },
            subscriptionSha256: { $ref: "#/components/schemas/Sha256Hex" },
            sourceUrlSha256: { $ref: "#/components/schemas/Sha256Hex" },
            sourceOriginSha256: { $ref: "#/components/schemas/Sha256Hex" },
            weight: { type: "integer", minimum: 1, maximum: 10 },
            metadata: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryQuorumSourceMetadata",
            },
            revision: { type: "integer", minimum: 1 },
            directorySha256: { $ref: "#/components/schemas/Sha256Hex" },
            anchorSetSha256: { $ref: "#/components/schemas/Sha256Hex" },
            discoverySha256: { $ref: "#/components/schemas/Sha256Hex" },
            transparencyTailSha256: { $ref: "#/components/schemas/Sha256Hex" },
            trustedCount: { type: "integer", minimum: 0 },
            observedAt: { type: "string", format: "date-time" },
          },
        },
        ReceiptTrustAnchorDirectoryQuorumCandidate: {
          type: "object",
          required: [
            "anchorSetSha256",
            "sourceCount",
            "distinctSourceOriginCount",
            "weight",
            "metadataPublisherCount",
            "metadataPublisherSetSha256",
            "trustedCount",
            "subscriptionSetSha256",
            "directorySetSha256",
            "discoverySetSha256",
          ],
          additionalProperties: false,
          properties: {
            anchorSetSha256: { $ref: "#/components/schemas/Sha256Hex" },
            sourceCount: { type: "integer", minimum: 0 },
            distinctSourceOriginCount: { type: "integer", minimum: 0 },
            weight: { type: "integer", minimum: 0 },
            metadataPublisherCount: { type: "integer", minimum: 0 },
            metadataPublisherSetSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            trustedCount: { type: "integer", minimum: 0 },
            subscriptionSetSha256: { $ref: "#/components/schemas/Sha256Hex" },
            directorySetSha256: { $ref: "#/components/schemas/Sha256Hex" },
            discoverySetSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorDirectoryQuorum: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "apiVersion",
            "generatedAt",
            "status",
            "diagnostics",
            "policy",
            "policySha256",
            "sourceCount",
            "candidateCount",
            "agreementCount",
            "agreementWeight",
            "agreementDistinctSourceOriginCount",
            "agreementMetadataPublisherCount",
            "agreementMetadataPublisherSetSha256",
            "sources",
            "candidates",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: { const: "napier.receipt-trust-anchor-directory-quorum" },
            schemaVersion: { const: 1 },
            apiVersion: { type: "string", minLength: 1 },
            generatedAt: { type: "string", format: "date-time" },
            status: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryQuorumStatus",
            },
            diagnostics: {
              type: "array",
              items: { type: "string" },
            },
            policy: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryQuorumEffectivePolicy",
            },
            policySha256: { $ref: "#/components/schemas/Sha256Hex" },
            sourceCount: { type: "integer", minimum: 0 },
            candidateCount: { type: "integer", minimum: 0 },
            agreementCount: { type: "integer", minimum: 0 },
            agreementWeight: { type: "integer", minimum: 0 },
            agreementDistinctSourceOriginCount: { type: "integer", minimum: 0 },
            agreementMetadataPublisherCount: { type: "integer", minimum: 0 },
            agreementMetadataPublisherSetSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            selectedAnchorSetSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            selectedDirectorySha256: { $ref: "#/components/schemas/Sha256Hex" },
            selectedDirectory: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectory",
            },
            sources: {
              type: "array",
              items: {
                $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryQuorumSource",
              },
            },
            candidates: {
              type: "array",
              items: {
                $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryQuorumCandidate",
              },
            },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorDirectoryMetadataReceipt: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "apiVersion",
            "generatedAt",
            "publisher",
            "directorySha256",
            "anchorSetSha256",
            "anchorCount",
            "trustedCount",
            "revokedCount",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: {
              const: "napier.receipt-trust-anchor-directory-metadata-receipt",
            },
            schemaVersion: { const: 1 },
            apiVersion: { type: "string", minLength: 1 },
            generatedAt: { type: "string", format: "date-time" },
            publisher: { type: "string", minLength: 1, maxLength: 120 },
            directorySha256: { $ref: "#/components/schemas/Sha256Hex" },
            anchorSetSha256: { $ref: "#/components/schemas/Sha256Hex" },
            anchorCount: { type: "integer", minimum: 0 },
            trustedCount: { type: "integer", minimum: 0 },
            revokedCount: { type: "integer", minimum: 0 },
            sourceUrlSha256: { $ref: "#/components/schemas/Sha256Hex" },
            sourceOriginSha256: { $ref: "#/components/schemas/Sha256Hex" },
            expiresAt: { type: "string", format: "date-time" },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        TrustedReceiptSignature: {
          type: "object",
          required: [
            "algorithm",
            "keyId",
            "signedAt",
            "receiptArtifactSha256",
            "statementSha256",
            "value",
          ],
          additionalProperties: false,
          properties: {
            algorithm: { const: "Ed25519" },
            keyId: { $ref: "#/components/schemas/Sha256Hex" },
            signedAt: { type: "string", format: "date-time" },
            receiptArtifactSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            statementSha256: { $ref: "#/components/schemas/Sha256Hex" },
            value: {
              type: "string",
              minLength: 1,
              maxLength: 128,
              pattern: "^[A-Za-z0-9_-]+$",
            },
          },
        },
        ReceiptTrustAnchorDirectoryMetadataEnvelope: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "apiVersion",
            "receiptKind",
            "receipt",
            "signature",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: { const: "napier.trusted-receipt-envelope" },
            schemaVersion: { const: 1 },
            apiVersion: { type: "string", minLength: 1 },
            receiptKind: { const: "receipt_trust_anchor_directory_metadata" },
            receipt: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryMetadataReceipt",
            },
            signature: {
              $ref: "#/components/schemas/TrustedReceiptSignature",
            },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        TrustedReceiptEnvelope: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "apiVersion",
            "receiptKind",
            "receipt",
            "signature",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: { const: "napier.trusted-receipt-envelope" },
            schemaVersion: { const: 1 },
            apiVersion: { type: "string", minLength: 1 },
            receiptKind: { $ref: "#/components/schemas/TrustedReceiptKind" },
            receipt: true,
            signature: {
              $ref: "#/components/schemas/TrustedReceiptSignature",
            },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        TrustedReceiptVerificationStatus: {
          type: "string",
          enum: ["trusted", "revoked", "unknown_key", "invalid"],
        },
        TrustedReceiptAnchorDirectorySource: {
          type: "string",
          enum: ["uploaded", "active_selection"],
        },
        TrustedReceiptVerification: {
          type: "object",
          required: [
            "status",
            "verifiedAt",
            "signatureValid",
            "integrityValid",
            "reason",
          ],
          additionalProperties: false,
          properties: {
            status: {
              $ref: "#/components/schemas/TrustedReceiptVerificationStatus",
            },
            verifiedAt: { type: "string", format: "date-time" },
            receiptKind: { $ref: "#/components/schemas/TrustedReceiptKind" },
            receiptContentSha256: { $ref: "#/components/schemas/Sha256Hex" },
            receiptArtifactSha256: { $ref: "#/components/schemas/Sha256Hex" },
            keyId: { $ref: "#/components/schemas/Sha256Hex" },
            envelopeSha256: { $ref: "#/components/schemas/Sha256Hex" },
            anchorDirectorySha256: { $ref: "#/components/schemas/Sha256Hex" },
            anchorDirectoryVerificationSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            anchorDirectoryPolicySha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            anchorDirectoryGeneratedAt: {
              type: "string",
              format: "date-time",
            },
            anchorDirectoryAgeMs: { type: "integer" },
            anchorDirectoryAnchorCount: { type: "integer", minimum: 0 },
            anchorDirectorySource: {
              $ref: "#/components/schemas/TrustedReceiptAnchorDirectorySource",
            },
            anchorDirectorySelectionId: {
              type: "string",
              pattern: "^sel_[a-z0-9]{8,80}$",
            },
            anchorDirectorySelectionSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            anchorDirectorySelectionStateSha256: {
              $ref: "#/components/schemas/Sha256Hex",
            },
            signatureValid: { type: "boolean" },
            integrityValid: { type: "boolean" },
            reason: { type: "string" },
          },
        },
        ReceiptTrustAnchorDirectoryMetadataVerification: {
          type: "object",
          required: [
            "kind",
            "schemaVersion",
            "apiVersion",
            "generatedAt",
            "status",
            "diagnostics",
            "trustedReceiptVerification",
            "directoryVerification",
            "signatureValid",
            "integrityValid",
            "directoryBindingValid",
            "contentSha256",
          ],
          additionalProperties: false,
          properties: {
            kind: {
              const:
                "napier.receipt-trust-anchor-directory-metadata-verification",
            },
            schemaVersion: { const: 1 },
            apiVersion: { type: "string", minLength: 1 },
            generatedAt: { type: "string", format: "date-time" },
            status: {
              $ref: "#/components/schemas/TrustedReceiptVerificationStatus",
            },
            diagnostics: {
              type: "array",
              items: { type: "string" },
            },
            trustedReceiptVerification: {
              $ref: "#/components/schemas/TrustedReceiptVerification",
            },
            directoryVerification: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerification",
            },
            trustDirectoryVerification: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerification",
            },
            metadata: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryMetadataReceipt",
            },
            publisher: { type: "string", minLength: 1, maxLength: 120 },
            directorySha256: { $ref: "#/components/schemas/Sha256Hex" },
            anchorSetSha256: { $ref: "#/components/schemas/Sha256Hex" },
            signerKeyId: { $ref: "#/components/schemas/Sha256Hex" },
            envelopeSha256: { $ref: "#/components/schemas/Sha256Hex" },
            signatureValid: { type: "boolean" },
            integrityValid: { type: "boolean" },
            directoryBindingValid: { type: "boolean" },
            expiresAt: { type: "string", format: "date-time" },
            contentSha256: { $ref: "#/components/schemas/Sha256Hex" },
          },
        },
        ReceiptTrustAnchorSigningSource: {
          type: "object",
          required: ["type", "variable"],
          additionalProperties: false,
          properties: {
            type: { const: "environment" },
            variable: { $ref: "#/components/schemas/EnvironmentVariableName" },
          },
        },
        CreateReceiptTrustAnchorRequest: {
          type: "object",
          required: ["threadId", "label", "source"],
          additionalProperties: false,
          properties: {
            threadId: {
              type: "string",
              pattern: "^thread_[a-z0-9]{8,80}$",
            },
            label: { type: "string", minLength: 1, maxLength: 100 },
            source: {
              oneOf: [
                {
                  $ref: "#/components/schemas/CreateReceiptTrustAnchorEnvironmentSource",
                },
                {
                  $ref: "#/components/schemas/CreateReceiptTrustAnchorPublicKeySource",
                },
              ],
            },
          },
        },
        CreateReceiptTrustAnchorEnvironmentSource: {
          type: "object",
          required: ["type", "variable"],
          additionalProperties: false,
          properties: {
            type: { const: "environment" },
            variable: { $ref: "#/components/schemas/EnvironmentVariableName" },
          },
        },
        CreateReceiptTrustAnchorPublicKeySource: {
          type: "object",
          required: ["type", "publicKeySpki"],
          additionalProperties: false,
          properties: {
            type: { const: "public_key" },
            publicKeySpki: {
              type: "string",
              minLength: 1,
              maxLength: 4096,
            },
          },
        },
        RevokeReceiptTrustAnchorRequest: {
          type: "object",
          required: ["threadId"],
          additionalProperties: false,
          properties: {
            threadId: {
              type: "string",
              pattern: "^thread_[a-z0-9]{8,80}$",
            },
          },
        },
        VerifyReceiptTrustAnchorDirectoryRequest: {
          type: "object",
          required: ["directory"],
          additionalProperties: false,
          properties: {
            directory: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectory",
            },
            policy: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerificationPolicy",
            },
          },
        },
        DiscoverReceiptTrustAnchorDirectoryRequest: {
          type: "object",
          required: ["sourceUrl"],
          additionalProperties: false,
          properties: {
            sourceUrl: { type: "string", minLength: 1, maxLength: 2048 },
            policy: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerificationPolicy",
            },
          },
        },
        CreateReceiptTrustAnchorDirectorySubscriptionRequest: {
          type: "object",
          required: [
            "threadId",
            "label",
            "sourceUrl",
            "refreshIntervalMs",
            "policy",
          ],
          additionalProperties: false,
          properties: {
            threadId: {
              type: "string",
              pattern: "^thread_[a-z0-9]{8,80}$",
            },
            label: { type: "string", minLength: 1, maxLength: 100 },
            sourceUrl: { type: "string", minLength: 1, maxLength: 2048 },
            refreshIntervalMs: {
              type: "integer",
              minimum: 300000,
              maximum: 2592000000,
            },
            policy: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerificationPolicy",
            },
          },
        },
        RefreshReceiptTrustAnchorDirectorySubscriptionRequest: {
          type: "object",
          required: ["threadId", "expectedRevision"],
          additionalProperties: false,
          properties: {
            threadId: {
              type: "string",
              pattern: "^thread_[a-z0-9]{8,80}$",
            },
            expectedRevision: { type: "integer", minimum: 1 },
          },
        },
        UpdateReceiptTrustAnchorDirectorySubscriptionRequest: {
          type: "object",
          required: ["threadId", "expectedRevision", "status"],
          additionalProperties: false,
          properties: {
            threadId: {
              type: "string",
              pattern: "^thread_[a-z0-9]{8,80}$",
            },
            expectedRevision: { type: "integer", minimum: 1 },
            status: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectorySubscriptionStatus",
            },
          },
        },
        EvaluateReceiptTrustAnchorDirectoryQuorumRequest: {
          type: "object",
          additionalProperties: false,
          properties: {
            policy: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryQuorumPolicy",
            },
            metadata: {
              type: "array",
              maxItems: 20,
              items: {
                $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryQuorumMetadataInput",
              },
            },
            trustDirectory: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectory",
            },
            trustDirectoryPolicy: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerificationPolicy",
            },
          },
        },
        SignReceiptTrustAnchorDirectoryMetadataRequest: {
          type: "object",
          required: ["trustAnchorId", "threadId", "publisher"],
          additionalProperties: false,
          dependentRequired: {
            sourceUrlSha256: ["sourceOriginSha256"],
            sourceOriginSha256: ["sourceUrlSha256"],
          },
          properties: {
            trustAnchorId: {
              type: "string",
              pattern: "^trustkey_[a-z0-9]{8,80}$",
            },
            threadId: {
              type: "string",
              pattern: "^thread_[a-z0-9]{8,80}$",
            },
            publisher: { type: "string", minLength: 1, maxLength: 120 },
            sourceUrlSha256: { $ref: "#/components/schemas/Sha256Hex" },
            sourceOriginSha256: { $ref: "#/components/schemas/Sha256Hex" },
            expiresAt: { type: "string", format: "date-time" },
          },
        },
        VerifyReceiptTrustAnchorDirectoryMetadataRequest: {
          type: "object",
          required: ["envelope", "directory"],
          additionalProperties: false,
          properties: {
            envelope: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryMetadataEnvelope",
            },
            directory: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectory",
            },
            directoryPolicy: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerificationPolicy",
            },
            trustDirectory: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectory",
            },
            trustDirectoryPolicy: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerificationPolicy",
            },
          },
        },
        VerifyTrustedReceiptRequest: {
          type: "object",
          required: ["envelope"],
          additionalProperties: false,
          properties: {
            envelope: {
              $ref: "#/components/schemas/TrustedReceiptEnvelope",
            },
            directory: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectory",
            },
            directoryPolicy: {
              $ref: "#/components/schemas/ReceiptTrustAnchorDirectoryVerificationPolicy",
            },
          },
        },
        TrustedReceiptKind: {
          type: "string",
          enum: [
            "evaluation_gate",
            "casebook_qualification",
            "policy_retirement_proof_bundle",
            "receipt_trust_anchor_directory_metadata",
            "receipt_trust_anchor_directory_quorum_promotion",
            "receipt_trust_anchor_directory_quorum_activation_decision",
            "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal",
            "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval",
            "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval_policy_review",
            "receipt_trust_anchor_directory_quorum_activation_selection_checkpoint",
            "receipt_trust_anchor_directory_quorum_activation_selection_checkpoint_registry_quorum",
          ],
        },
        EnvironmentVariableName: {
          type: "string",
          pattern: "^[A-Z_][A-Z0-9_]{1,127}$",
        },
        Sha256Hex: {
          type: "string",
          pattern: "^[a-f0-9]{64}$",
        },
        Sha256HexOrEmpty: {
          type: "string",
          pattern: "^$|^[a-f0-9]{64}$",
        },
      },
      responses: {
        ErrorResponse: {
          description: "Fail-closed JSON error response",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
    "x-napier-artifact-kind": "management-openapi",
    "x-napier-source-path": toRepoRelativePath(
      repoRoot,
      absoluteSourcePaths[0],
    ),
    "x-napier-source-paths": absoluteSourcePaths.map((sourcePath) =>
      toRepoRelativePath(repoRoot, sourcePath),
    ),
    "x-napier-source-sha256": sha256Text(sourceText),
    "x-napier-route-count": routes.length,
    "x-napier-route-set-sha256": routeSetSha256,
  };
  return {
    artifact,
    artifactText: `${JSON.stringify(artifact, null, 2)}\n`,
    routeCount: routes.length,
    routeSetSha256,
    sourceSha256: artifact["x-napier-source-sha256"],
  };
}

export function extractManagementRoutes(sourceText) {
  const routePattern =
    /app\.(get|post|put|delete|patch)\(\s*(["'`])(\/api\/[^"'`]+)\2/g;
  const routes = [];
  const seen = new Set();
  for (const match of sourceText.matchAll(routePattern)) {
    const method = match[1].toLowerCase();
    const rawPath = match[3];
    const openapiPath = rawPath.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}");
    const key = `${method.toUpperCase()} ${openapiPath}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate management route: ${key}`);
    }
    seen.add(key);
    routes.push({
      method,
      rawPath,
      openapiPath,
      operationId: createOperationId(method, openapiPath),
      pathParams: Array.from(openapiPath.matchAll(/\{([^}]+)\}/g)).map(
        (paramMatch) => paramMatch[1],
      ),
      tag: createTag(openapiPath),
    });
  }
  routes.sort((left, right) => {
    const pathOrder = left.openapiPath.localeCompare(right.openapiPath);
    if (pathOrder !== 0) return pathOrder;
    return left.method.localeCompare(right.method);
  });
  const operationIds = new Set();
  for (const route of routes) {
    if (operationIds.has(route.operationId)) {
      throw new Error(`Duplicate management operationId: ${route.operationId}`);
    }
    operationIds.add(route.operationId);
  }
  if (routes.length === 0) {
    throw new Error("No /api management routes were found");
  }
  return routes;
}

export async function discoverManagementSourcePaths(repoRoot) {
  const sourceRoot = resolveRepoRelativePath(
    repoRoot,
    defaultSourceDirectory,
    "sourceDirectory",
  );
  const candidates = [];
  await collectTypeScriptSources(sourceRoot, candidates);
  const discovered = [];
  for (const candidate of candidates.sort()) {
    const source = await readFile(candidate, "utf8");
    if (
      /app\.(?:get|post|put|delete|patch)\(\s*(?:["'`])\/api\//u.test(source)
    ) {
      discovered.push(toRepoRelativePath(repoRoot, candidate));
    }
  }
  if (discovered.length === 0) {
    throw new Error("No management API source modules were found");
  }
  return discovered;
}

async function collectTypeScriptSources(directory, output) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "dist" || entry.name.startsWith(".")) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectTypeScriptSources(absolutePath, output);
    } else if (entry.isFile() && /\.tsx?$/u.test(entry.name)) {
      output.push(absolutePath);
    }
  }
}

async function runCli() {
  const options = parseCliOptions(process.argv.slice(2));
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const artifactPath = resolveRepoRelativePath(
    repoRoot,
    options.artifactPath ?? defaultArtifactPath,
    "artifactPath",
  );
  const generated = await generateManagementOpenApi(options);
  if (options.check) {
    const current = await readFile(artifactPath, "utf8").catch(() => "");
    if (current !== generated.artifactText) {
      console.error(
        `${toRepoRelativePath(repoRoot, artifactPath)} is stale; run npm run write:management-openapi.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `Management OpenAPI artifact is current: ${generated.routeCount} routes set ${generated.routeSetSha256.slice(0, 16)}`,
    );
    return;
  }
  if (options.json) {
    console.log(generated.artifactText.trimEnd());
    return;
  }
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, generated.artifactText);
  console.log(
    `Wrote ${toRepoRelativePath(repoRoot, artifactPath)}: ${generated.routeCount} routes set ${generated.routeSetSha256.slice(0, 16)}`,
  );
}

function createOperation(route) {
  const operation = {
    operationId: route.operationId,
    tags: [route.tag],
    summary: `${route.method.toUpperCase()} ${route.openapiPath}`,
    ...(route.pathParams.length > 0
      ? {
          parameters: route.pathParams.map((name) => ({
            name,
            in: "path",
            required: true,
            schema: { type: "string" },
          })),
        }
      : {}),
    ...(route.method === "post" ||
    route.method === "put" ||
    route.method === "patch"
      ? {
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: true,
              },
            },
          },
        }
      : {}),
    responses: {
      200: {
        description: "Successful no-store JSON response",
        content: {
          "application/json": {
            schema: true,
          },
        },
      },
      400: { $ref: "#/components/responses/ErrorResponse" },
      404: { $ref: "#/components/responses/ErrorResponse" },
      409: { $ref: "#/components/responses/ErrorResponse" },
      413: { $ref: "#/components/responses/ErrorResponse" },
    },
    "x-napier-source-route": `${route.method.toUpperCase()} ${route.rawPath}`,
  };
  return applyPromotedOperationSchemas(route, operation);
}

function applyPromotedOperationSchemas(route, operation) {
  const overlay =
    PROMOTED_OPERATION_SCHEMAS[
      `${route.method.toUpperCase()} ${route.openapiPath}`
    ];
  if (!overlay) return operation;
  let promotedRequestSchemaRef;
  if (overlay.request === false) {
    delete operation.requestBody;
  } else if (overlay.requestContentType) {
    operation.requestBody ??= {
      required: true,
      content: {},
    };
    operation.requestBody.content = {
      [overlay.requestContentType]: {
        schema: { type: "string", format: "binary" },
      },
    };
    operation.requestBody.required = true;
  } else if (overlay.request) {
    operation.requestBody ??= {
      required: true,
      content: {
        "application/json": {},
      },
    };
    operation.requestBody.content ??= {};
    operation.requestBody.required = true;
    operation.requestBody.content["application/json"] ??= {};
    operation.requestBody.content["application/json"].schema = {
      $ref: overlay.request,
    };
    promotedRequestSchemaRef = overlay.request;
  }
  const promotedResponseSchemaRefs = {};
  for (const [status, schemaRef] of Object.entries(overlay.responses ?? {})) {
    operation.responses[status] ??= {
      description: `Successful ${status} no-store JSON response`,
      content: {
        "application/json": {},
      },
    };
    const response = operation.responses[status];
    if (!isRecord(response)) continue;
    response.content ??= {};
    response.content["application/json"] ??= {};
    response.content["application/json"].schema = { $ref: schemaRef };
    promotedResponseSchemaRefs[status] = schemaRef;
  }
  for (const [status, contentType] of Object.entries(
    overlay.responseContentTypes ?? {},
  )) {
    const response = operation.responses[status];
    if (!response) continue;
    response.description = "Successful no-store event stream";
    response.content = {
      [contentType]: {
        schema: { type: "string" },
      },
    };
  }
  return {
    ...operation,
    ...(promotedRequestSchemaRef
      ? { "x-napier-promoted-request-schema-ref": promotedRequestSchemaRef }
      : {}),
    "x-napier-promoted-response-schema-refs": promotedResponseSchemaRefs,
  };
}

function createOperationId(method, openapiPath) {
  const suffix = openapiPath
    .replace(/^\/api\/?/, "")
    .replace(/\{([^}]+)\}/g, "by-$1")
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/[^A-Za-z0-9]+/g, "-"))
    .filter(Boolean)
    .join("-");
  return `${method}-${suffix || "root"}`;
}

function createTag(openapiPath) {
  const parts = openapiPath.split("/").filter(Boolean);
  if (parts[1] === "receipt-trust") return "receipt-trust";
  if (parts[1] === "threads") return "threads";
  if (parts[1] === "plan-blueprints") return "plan-blueprints";
  return parts[1] ?? "management";
}

function parseCliOptions(args) {
  const options = { check: false, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--repo-root") {
      options.repoRoot = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--source-path") {
      options.sourcePath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--artifact-path") {
      options.artifactPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function readCliValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function resolveRepoRelativePath(repoRoot, inputPath, label) {
  const absolutePath = path.resolve(repoRoot, inputPath);
  const relativePath = path.relative(repoRoot, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must stay inside the repository`);
  }
  return absolutePath;
}

function toRepoRelativePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
