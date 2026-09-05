import type { ToolJsonSchema } from "@napier/contracts/tool-protocol";
import { Value } from "typebox/value";

export function genericToolResultSchema(
  surface: "canonical" | "model_visible",
): ToolJsonSchema {
  return resultSchema(surface, {});
}

export function readFileToolResultSchema(
  surface: "canonical" | "model_visible",
): ToolJsonSchema {
  return resultSchema(
    surface,
    objectSchema(
      [
        "startLine",
        "endLine",
        "totalLines",
        "pathSha256",
        "sha256",
        "sizeBytes",
        "truncated",
      ],
      {
        startLine: integerSchema(1),
        endLine: integerSchema(1),
        totalLines: integerSchema(1),
        path: { type: "string" },
        pathSha256: hashSchema(),
        sha256: hashSchema(),
        sizeBytes: integerSchema(0),
        truncated: { type: "boolean" },
        lineAnchors: { type: "array" },
        lineAnchorsTruncated: { type: "boolean" },
        lineAnchorSetSha256: hashSchema(),
      },
    ),
  );
}

export function workspaceFileToolResultSchema(
  surface: "canonical" | "model_visible",
): ToolJsonSchema {
  return resultSchema(surface, workspaceFileDetailsSchema());
}

export function browserToolResultSchema(
  surface: "canonical" | "model_visible",
): ToolJsonSchema {
  return resultSchema(surface, browserDetailsSchema());
}

export function toolUiProjectionSchema(toolId: string): ToolJsonSchema {
  return objectSchema(
    [
      "kind",
      "schemaVersion",
      "toolId",
      "semanticVersion",
      "definitionSha256",
      "failureDefinitionSha256",
      "implementationSha256",
      "status",
      "sideEffect",
      "concurrency",
      "progress",
      "compatibilityMode",
    ],
    {
      kind: { const: "napier.tool-ui-projection" },
      schemaVersion: { const: 2 },
      toolId: { const: toolId },
      semanticVersion: { type: "string" },
      definitionSha256: hashSchema(),
      failureDefinitionSha256: hashSchema(),
      implementationSha256: hashSchema(),
      status: { enum: ["started", "completed", "failed", "blocked"] },
      sideEffect: {
        enum: ["none", "reversible", "irreversible", "unknown"],
      },
      concurrency: { enum: ["safe", "serialized", "exclusive"] },
      progress: toolProgressReceiptSchema(),
      compatibilityMode: { enum: ["native", "compatibility"] },
    },
  );
}

function toolProgressReceiptSchema(): ToolJsonSchema {
  return objectSchema(
    [
      "kind",
      "schemaVersion",
      "availability",
      "coverage",
      "operation",
      "scope",
      "contribution",
    ],
    {
      kind: { const: "napier.tool-progress-semantics" },
      schemaVersion: { const: 1 },
      availability: { enum: ["declared", "unavailable"] },
      coverage: {
        enum: ["trusted_declared", "host_observed", "opaque"],
      },
      operation: {
        enum: [
          "acquire",
          "reuse",
          "observe",
          "mutate",
          "verify",
          "coordinate",
          "neutral",
        ],
      },
      scope: {
        enum: [
          "external",
          "run_source",
          "workspace",
          "session",
          "remote",
          "control",
          "neutral",
        ],
      },
      contribution: {
        enum: ["supporting", "product", "verification", "control", "neutral"],
      },
      modeId: { type: "string", pattern: "^[a-z][a-z0-9_.-]{0,63}$" },
      resourceKeySha256: hashSchema(),
      failureBindings: {
        type: "object",
        properties: {
          target: hashSchema(),
          origin: hashSchema(),
          route: hashSchema(),
          capability: hashSchema(),
          session: hashSchema(),
        },
        additionalProperties: false,
        minProperties: 1,
      },
      failureDomainKeySha256: hashSchema(),
      stateSha256: hashSchema(),
      classificationErrorSha256: hashSchema(),
    },
  );
}

export function jsonSchema(value: unknown): ToolJsonSchema {
  return JSON.parse(JSON.stringify(value)) as ToolJsonSchema;
}

export function assertToolProtocolSchema(
  schema: ToolJsonSchema,
  value: unknown,
  label: string,
): void {
  let valid = false;
  try {
    valid = Value.Check(schema as never, value);
  } catch {
    valid = false;
  }
  if (!valid) throw new Error(`${label} does not match Tool Protocol v2`);
}

function resultSchema(
  surface: "canonical" | "model_visible",
  details: ToolJsonSchema,
): ToolJsonSchema {
  return {
    type: "object",
    required: ["content", "details"],
    properties: {
      content: { type: "array" },
      details,
      usage: {},
      addedToolNames: { type: "array", items: { type: "string" } },
      terminate: { type: "boolean" },
    },
    additionalProperties: true,
    "x-napier-surface": surface,
  };
}

function workspaceFileDetailsSchema(): ToolJsonSchema {
  return objectSchema(["action", "status", "resultSha256"], {
    action: { enum: ["list_trash", "preview", "apply"] },
    status: { enum: ["listed", "ready", "applied"] },
    operation: {
      enum: ["create_directory", "move", "trash", "restore"],
    },
    previewId: { type: "string" },
    trashId: { type: "string" },
    itemCount: integerSchema(0),
    entryKind: { enum: ["file", "directory"] },
    sourcePathSha256: hashSchema(),
    destinationPathSha256: hashSchema(),
    beforeSha256: hashSchema(),
    afterSha256: hashSchema(),
    fileCount: integerSchema(0),
    directoryCount: integerSchema(0),
    bytes: integerSchema(0),
    reversible: { type: "boolean" },
    postcondition: { enum: ["verified", "drifted", "indeterminate"] },
    resultSha256: hashSchema(),
  });
}

function browserDetailsSchema(): ToolJsonSchema {
  const required = [
    "kind",
    "schemaVersion",
    "action",
    "sessionMode",
    "sessionReused",
    "sessionOperation",
    "sessionIdSha256",
    "activeTabId",
    "tabCount",
    "tabSetSha256",
    "browserExecutableSha256",
    "browserVersionSha256",
    "limitsSha256",
    "currentUrlSha256",
    "currentOriginSha256",
    "titleSha256",
    "blockedRequestCount",
    "network",
    "crossOriginAuthorized",
  ];
  const properties = browserDetailsProperties();
  return {
    anyOf: [
      objectSchema(required, {
        ...properties,
        schemaVersion: { const: 2 },
      }),
      objectSchema([...required, "pageDiagnosis"], {
        ...properties,
        schemaVersion: { const: 3 },
      }),
    ],
  };
}

function browserDetailsProperties(): Record<string, unknown> {
  const count = integerSchema(0);
  return {
    kind: { const: "napier.browser-session-operation" },
    action: {
      enum: [
        "start",
        "preview_workspace",
        "navigate",
        "back",
        "forward",
        "tab_new",
        "tab_list",
        "tab_switch",
        "tab_close",
        "wait",
        "find",
        "scroll",
        "snapshot",
        "click",
        "type",
        "select",
        "upload",
        "download",
        "save_screenshot",
        "visual_click",
        "keypress",
        "screenshot",
        "console",
        "close",
      ],
    },
    sessionMode: { const: "run_persistent" },
    sessionReused: { type: "boolean" },
    sessionOperation: integerSchema(1),
    sessionIdSha256: hashSchema(),
    activeTabId: { type: "string" },
    tabCount: count,
    tabSetSha256: hashSchema(),
    browserExecutableSha256: hashSchema(),
    browserVersionSha256: hashSchema(),
    limitsSha256: hashSchema(),
    currentUrlSha256: hashSchema(),
    currentOriginSha256: hashSchema(),
    titleSha256: hashSchema(),
    pageDiagnosis: objectSchema(
      ["status", "signalCount", "signalsSha256", "takeoverRecommended"],
      {
        status: { enum: ["none", "login_required", "challenge_detected"] },
        signalCount: count,
        signalsSha256: hashSchema(),
        takeoverRecommended: { type: "boolean" },
      },
    ),
    snapshotSha256: hashSchema(),
    snapshotChars: count,
    snapshotTruncated: { type: "boolean" },
    findQuerySha256: hashSchema(),
    findQueryChars: count,
    findMatchCount: count,
    findMatchesSha256: hashSchema(),
    findScannedChars: count,
    findTruncated: { type: "boolean" },
    scrollDeltaY: { type: "integer" },
    scrollPositionY: { type: "integer" },
    scrollViewportHeight: count,
    scrollDocumentHeight: count,
    scrollAtStart: { type: "boolean" },
    scrollAtEnd: { type: "boolean" },
    viewportTextSha256: hashSchema(),
    viewportTextChars: count,
    viewportTextTruncated: { type: "boolean" },
    consoleEntryCount: count,
    consoleErrorCount: count,
    consoleWarningCount: count,
    consoleEntriesSha256: hashSchema(),
    consoleTruncated: { type: "boolean" },
    workspacePreviewEntryPathSha256: hashSchema(),
    workspacePreviewEntrySha256: hashSchema(),
    workspacePreviewEntryBytes: count,
    screenshotSha256: hashSchema(),
    screenshotBytes: count,
    file: objectSchema(["pathSha256", "fileSha256", "fileBytes"], {
      pathSha256: hashSchema(),
      fileSha256: hashSchema(),
      fileBytes: count,
    }),
    suggestedFilenameSha256: hashSchema(),
    blockedRequestCount: count,
    network: objectSchema(
      [
        "requestCount",
        "connectCount",
        "rejectedCount",
        "transferredBytes",
        "destinationCount",
        "destinationsSha256",
      ],
      {
        requestCount: count,
        connectCount: count,
        rejectedCount: count,
        transferredBytes: count,
        destinationCount: count,
        destinationsSha256: hashSchema(),
      },
    ),
    crossOriginAuthorized: { type: "boolean" },
  };
}

function objectSchema(
  required: string[],
  properties: Record<string, unknown>,
): ToolJsonSchema {
  return { type: "object", required, properties, additionalProperties: true };
}

function hashSchema(): ToolJsonSchema {
  return { type: "string", pattern: "^[a-f0-9]{64}$" };
}

function integerSchema(minimum: number): ToolJsonSchema {
  return { type: "integer", minimum };
}
