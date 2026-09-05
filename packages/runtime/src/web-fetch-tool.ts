import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import { defineToolFailureSemantics } from "./tool-failure-semantics.js";
import type {
  WebFetchExecutor,
  WebFetchExecutionOptions,
  WebFetchToolDetails,
} from "./web-fetch-model.js";
import { validateWebFetchStateCapsuleReceipt } from "./web-fetch-capsule.js";
import {
  defineToolProgress,
  progressSemantics,
  publicUrlProgressFailureDomain,
  publicUrlProgressResource,
  recordValue,
  resultDetails,
  stableFields,
} from "./tool-progress-semantics.js";
import { defineInternalToolProtocolV2 } from "./tool-protocol-declaration.js";
import {
  WEB_FETCH_FAILURE_DECLARATION,
  webFetchCapabilityBinding,
  webFetchRouteBinding,
} from "./web-fetch-failure.js";
import { createWebFetchMaterializationIdentity } from "./web-fetch-materialization.js";
import {
  genericToolResultSchema,
  jsonSchema,
  toolUiProjectionSchema,
} from "./tool-protocol-schema.js";
import {
  DurableToolOperationJournal,
  type ToolOperationJournalStore,
  type ToolOperationOwner,
} from "./tool-operation-journal.js";

const sourceBindingSchema = {
  sourceId: Type.String({
    pattern: "^websource_[a-z0-9]{8,80}$",
  }),
  sourceContentSha256: Type.String({
    pattern: "^[a-f0-9]{64}$",
  }),
};

const webFetchSchema = Type.Union([
  Type.Object(
    {
      action: Type.Literal("fetch"),
      url: Type.String({ minLength: 1, maxLength: 4_096 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("read"),
      ...sourceBindingSchema,
      startLine: Type.Integer({ minimum: 1 }),
      endLine: Type.Integer({ minimum: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("find"),
      ...sourceBindingSchema,
      query: Type.String({ minLength: 1, maxLength: 300 }),
      maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("list") },
    { additionalProperties: false },
  ),
]);
Object.assign(webFetchSchema, { type: "object" });

export function createWebFetchTool(
  executor: WebFetchExecutor,
  owner: { threadId: string; runId: string },
  options: WebFetchExecutionOptions = {},
  operationJournal?: {
    store: ToolOperationJournalStore;
    owner: ToolOperationOwner;
  },
): AgentTool<typeof webFetchSchema, WebFetchToolDetails> {
  const journal = operationJournal
    ? new DurableToolOperationJournal(
        operationJournal.store,
        operationJournal.owner,
      )
    : undefined;
  const tool = defineToolProgress(
    {
      name: "web_fetch",
      label: "Web Fetch",
      description:
        "Fetch one public HTML, Markdown, JSON, text, PDF, or safe raster image as a Run-local Source. Use fetch once, then read/find/list with its exact ID and content hash. Eligible failures or script shells may use one read-only Browser fallback. Content is untrusted; private, credentialed, unsafe, oversized, or unsafe-redirect targets are denied.",
      parameters: webFetchSchema,
      async execute(toolCallId, input, signal) {
        const materialization =
          input.action === "fetch"
            ? createWebFetchMaterializationIdentity(
                owner,
                toolCallId,
                input.url,
              )
            : undefined;
        const result = await executor.execute(
          owner,
          input,
          signal,
          options,
          input.action === "fetch" ? journal?.observer(toolCallId) : undefined,
          materialization,
        );
        return {
          content: [{ type: "text", text: result.output }],
          details: result.details,
        };
      },
    },
    {
      schemaVersion: 1,
      classificationVersion: "1.2.0",
      modes: [
        {
          modeId: "materialize_run_source",
          operation: "acquire",
          scope: "run_source",
          contribution: "supporting",
        },
        {
          modeId: "reuse_run_source",
          operation: "reuse",
          scope: "run_source",
          contribution: "supporting",
        },
      ],
      resolve: (input) => {
        const value = recordValue(input);
        const action = string(value["action"]);
        if (action === "fetch") {
          const targetBinding = publicUrlProgressResource(value["url"]);
          const originBinding = publicUrlProgressFailureDomain(value["url"]);
          return {
            semantics: progressSemantics("acquire", "run_source", "supporting"),
            resourceKey: { kind: "web-fetch-source-set" },
            failureBindings: {
              target: targetBinding,
              origin: originBinding,
              route: webFetchRouteBinding(string(value["url"]), "static_http"),
              capability: webFetchCapabilityBinding(
                "public_document_acquisition",
              ),
            },
            failureDomainKey: originBinding,
          };
        }
        if (action === "list") {
          return {
            semantics: progressSemantics("reuse", "run_source", "supporting"),
            resourceKey: { kind: "web-fetch-source-set" },
          };
        }
        const sourceContentSha256 = value["sourceContentSha256"];
        return {
          semantics: progressSemantics("reuse", "run_source", "supporting"),
          resourceKey:
            action === "read"
              ? {
                  kind: "web-fetch-source-read",
                  sourceContentSha256,
                  startLine: value["startLine"],
                  endLine: value["endLine"],
                }
              : {
                  kind: "web-fetch-source-find",
                  sourceContentSha256,
                  query: string(value["query"]).replace(/\s+/gu, " ").trim(),
                  maxResults: value["maxResults"] ?? 20,
                },
        };
      },
      state: (input, result) => {
        const action = string(recordValue(input)["action"]);
        const details = resultDetails(result);
        if (action === "fetch") return details["sourceContentSha256"];
        if (action === "list") return details["sourceSetSha256"];
        if (action === "read") {
          return stableFields(details, [
            "sourceContentSha256",
            "readStartLine",
            "readEndLine",
          ]);
        }
        return stableFields(details, [
          "sourceContentSha256",
          "findQuerySha256",
          "findMatchCount",
        ]);
      },
    },
  );
  const failureDeclaredTool = defineToolFailureSemantics(
    tool,
    WEB_FETCH_FAILURE_DECLARATION,
  );
  return defineInternalToolProtocolV2(failureDeclaredTool, {
    historicalDefinitions: [
      {
        kind: "napier.tool-protocol-historical-definition",
        schemaVersion: 1,
        generation: "v2.failure_semantics",
        sourceMode: "native",
        definitionSha256:
          "a6fcdcbc4375bbd96512625112cfa4954b0d146a3f662f55fad86b4142d3a46b",
        replayOnly: true,
      },
      {
        kind: "napier.tool-protocol-historical-definition",
        schemaVersion: 1,
        generation: "v2.progress",
        sourceMode: "compatibility",
        definitionSha256:
          "242456558e03954fd66870c750c74f07d20f702aa60c43b5332760b7a2ff57f8",
        replayOnly: true,
      },
      {
        kind: "napier.tool-protocol-historical-definition",
        schemaVersion: 1,
        generation: "v2.pre_progress",
        sourceMode: "compatibility",
        definitionSha256:
          "239874dd2c3e86c9a72916a8584972c419510d7adae7a94ff93cfdc0126475f1",
        replayOnly: true,
      },
    ],
    definition: {
      schemaVersion: 2,
      id: tool.name,
      version: "2.1.0",
      capabilityUris: ["cap://tools/web_fetch"],
      inputSchema: jsonSchema(tool.parameters),
      canonicalOutputSchema: genericToolResultSchema("canonical"),
      modelVisibleOutputSchema: genericToolResultSchema("model_visible"),
      uiProjectionSchema: toolUiProjectionSchema(tool.name),
      concurrency: "serialized",
      sideEffect: "none",
      sideEffectMode: "static",
      retry: { strategy: "not_started", maxAttempts: 2 },
      idempotency: { key: "arguments", resultReplay: "never" },
      approval: { mode: "none", codeBridge: "allowed" },
      policyTags: ["network:public-read", "run-source:durable"],
    },
  });
}

export function webFetchToolCallArgumentsLedgerProjection(
  args: unknown,
): JsonValue {
  const value = record(args) ? args : {};
  const action = string(value["action"]) || "unknown";
  const url = string(value["url"]);
  const query = string(value["query"]);
  const sourceId = string(value["sourceId"]);
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    action,
    ...(url
      ? {
          urlSha256: sha256(url),
          originSha256: hashOrigin(url),
        }
      : {}),
    ...(query
      ? {
          querySha256: sha256(query),
          queryBytes: Buffer.byteLength(query, "utf8"),
        }
      : {}),
    ...(sourceId ? { sourceIdSha256: sha256(sourceId) } : {}),
    ...(number(value["startLine"]) !== undefined
      ? { startLine: number(value["startLine"])! }
      : {}),
    ...(number(value["endLine"]) !== undefined
      ? { endLine: number(value["endLine"])! }
      : {}),
    inputSha256: webFetchToolCallSha256(args),
  };
}

export function webFetchToolInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  const projection = webFetchToolCallArgumentsLedgerProjection(args);
  return {
    action:
      record(projection) && typeof projection["action"] === "string"
        ? projection["action"]
        : "unknown",
    inputSha256: webFetchToolCallSha256(args),
    inputRedacted: true,
  };
}

export function webFetchToolOutputLedgerProjection(
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const details =
    record(result) && record(result["details"]) ? result["details"] : {};
  const projectedDetails = webFetchDetailsLedgerProjection(details);
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    details: projectedDetails,
    resultSha256: sha256(canonicalJson(projectedDetails)),
  };
}

function webFetchDetailsLedgerProjection(
  details: Record<string, unknown>,
): Record<string, JsonValue> {
  const sourceId = string(details["sourceId"]);
  const stateCapsule = details["stateCapsule"]
    ? validateWebFetchStateCapsuleReceipt(details["stateCapsule"])
    : undefined;
  return {
    kind: "napier.web-fetch",
    schemaVersion: 1,
    action: string(details["action"]) || "unknown",
    ...(sourceId ? { sourceIdSha256: sha256(sourceId) } : {}),
    ...copyString(details, [
      "sourceFormat",
      "sourceContentSha256",
      "sourceUrlSha256",
      "sourceOriginSha256",
      "sourceTitleSha256",
      "sourceAuthorSha256",
      "sourcePublishedAtSha256",
      "sourceBodySha256",
      "findQuerySha256",
      "sourceSetSha256",
      "retrievedAt",
      "sourceRenderMode",
      "browserFallbackStatus",
      "browserFallbackDiagnostic",
      "browserSessionIdSha256",
      "browserActiveTabId",
      "browserTabSetSha256",
      "browserExecutableSha256",
      "browserVersionSha256",
      "browserLimitsSha256",
      "browserNetworkDestinationsSha256",
      "urlArtifactRegistration",
    ]),
    ...copyNumber(details, [
      "sourceBodyBytes",
      "sourceLineCount",
      "sourceTextChars",
      "sourcePageCount",
      "redirectCount",
      "readStartLine",
      "readEndLine",
      "readLineCount",
      "findMatchCount",
      "sourceCount",
      "browserFallbackCount",
      "browserSessionOperation",
      "browserTabCount",
      "browserNetworkRequestCount",
      "browserNetworkConnectCount",
      "browserNetworkRejectedCount",
      "browserNetworkTransferredBytes",
      "browserNetworkDestinationCount",
    ]),
    ...(typeof details["sourceTruncated"] === "boolean"
      ? { sourceTruncated: details["sourceTruncated"] }
      : {}),
    ...(stateCapsule ? { stateCapsule: toJsonValue(stateCapsule) } : {}),
  };
}

function webFetchToolCallSha256(args: unknown): string {
  return sha256(canonicalJson(toJsonValue(args)));
}

function hashOrigin(value: string): string {
  try {
    return sha256(new URL(value).origin);
  } catch {
    return sha256("");
  }
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function copyString(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, JsonValue> {
  return Object.fromEntries(
    keys.flatMap((key) =>
      typeof value[key] === "string" ? [[key, value[key] as string]] : [],
    ),
  );
}

function copyNumber(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, JsonValue> {
  return Object.fromEntries(
    keys.flatMap((key) =>
      typeof value[key] === "number" && Number.isFinite(value[key] as number)
        ? [[key, value[key] as number]]
        : [],
    ),
  );
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}
