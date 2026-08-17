import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@napier/contracts";
import type { BrowserInteractionConfirmationPreview } from "@napier/contracts/browser-interaction-confirmation";
import { Type } from "typebox";

import {
  type BrowserSessionDetails,
  type BrowserSessionOwner,
  MAX_BROWSER_FIND_QUERY_CHARS,
  MAX_BROWSER_SCROLL_PIXELS,
  MAX_BROWSER_WAIT_MS,
} from "./browser-session.js";
import type { BrowserSessionPort } from "./browser-session-port.js";
import type { BrowserConfirmedActionManager } from "./browser-confirmed-action.js";
import type { BrowserOutputArtifactRegistrar } from "./browser-output-artifact.js";
import { executeBrowserTool } from "./browser-tool-execution.js";
import type { BrowserUploadAuthorizationManager } from "./browser-upload-authorization.js";
import { canonicalJson, sha256 } from "./ed25519.js";

const targetSchema = Type.Object(
  {
    ref: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 40,
        pattern: "^[a-z0-9]+$",
      }),
    ),
    selector: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 1_000,
      }),
    ),
  },
  {
    additionalProperties: false,
  },
);

const crossOriginSchema = Type.Optional(Type.Boolean());

const startSchema = Type.Object(
  {
    action: Type.Literal("start"),
    url: Type.String({ minLength: 1, maxLength: 4_096 }),
    allowCrossOrigin: crossOriginSchema,
  },
  { additionalProperties: false },
);
const previewWorkspaceSchema = Type.Object(
  {
    action: Type.Literal("preview_workspace"),
    path: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);
const navigateSchema = Type.Object(
  {
    action: Type.Literal("navigate"),
    url: Type.String({ minLength: 1, maxLength: 4_096 }),
    allowCrossOrigin: crossOriginSchema,
  },
  { additionalProperties: false },
);
const backSchema = Type.Object(
  {
    action: Type.Literal("back"),
    allowCrossOrigin: crossOriginSchema,
  },
  { additionalProperties: false },
);
const forwardSchema = Type.Object(
  {
    action: Type.Literal("forward"),
    allowCrossOrigin: crossOriginSchema,
  },
  { additionalProperties: false },
);
const tabIdSchema = Type.String({
  pattern: "^tab_[1-9][0-9]{0,3}$",
  maxLength: 8,
});
const tabNewSchema = Type.Object(
  {
    action: Type.Literal("tab_new"),
    url: Type.String({ minLength: 1, maxLength: 4_096 }),
    allowCrossOrigin: crossOriginSchema,
  },
  {
    additionalProperties: false,
  },
);
const tabListSchema = Type.Object(
  { action: Type.Literal("tab_list") },
  { additionalProperties: false },
);
const tabSwitchSchema = Type.Object(
  { action: Type.Literal("tab_switch"), tabId: tabIdSchema },
  { additionalProperties: false },
);
const tabCloseSchema = Type.Object(
  { action: Type.Literal("tab_close"), tabId: tabIdSchema },
  { additionalProperties: false },
);
const waitSchema = Type.Object(
  {
    action: Type.Literal("wait"),
    durationMs: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: MAX_BROWSER_WAIT_MS,
      }),
    ),
  },
  { additionalProperties: false },
);
const findSchema = Type.Object(
  {
    action: Type.Literal("find"),
    query: Type.String({
      minLength: 1,
      maxLength: MAX_BROWSER_FIND_QUERY_CHARS,
    }),
  },
  { additionalProperties: false },
);
const scrollSchema = Type.Object(
  {
    action: Type.Literal("scroll"),
    direction: Type.Union([Type.Literal("up"), Type.Literal("down")]),
    pixels: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: MAX_BROWSER_SCROLL_PIXELS,
      }),
    ),
  },
  { additionalProperties: false },
);
const snapshotSchema = Type.Object(
  { action: Type.Literal("snapshot") },
  { additionalProperties: false },
);
const screenshotSchema = Type.Object(
  { action: Type.Literal("screenshot") },
  { additionalProperties: false },
);
const consoleSchema = Type.Object(
  { action: Type.Literal("console") },
  { additionalProperties: false },
);
const saveScreenshotSchema = Type.Object(
  {
    action: Type.Literal("save_screenshot"),
    path: Type.String({
      minLength: 1,
      maxLength: 500,
    }),
    expectedLiveImageSha256: Type.String({
      minLength: 64,
      maxLength: 64,
      pattern: "^[a-f0-9]{64}$",
    }),
  },
  { additionalProperties: false },
);
const closeSchema = Type.Object(
  { action: Type.Literal("close") },
  { additionalProperties: false },
);

const readOnlyBrowserSchemas = [
  startSchema,
  previewWorkspaceSchema,
  navigateSchema,
  backSchema,
  forwardSchema,
  tabNewSchema,
  tabListSchema,
  tabSwitchSchema,
  tabCloseSchema,
  waitSchema,
  findSchema,
  scrollSchema,
  snapshotSchema,
  screenshotSchema,
  consoleSchema,
  closeSchema,
] as const;

const browserSchema = Type.Union([
  ...readOnlyBrowserSchemas,
  Type.Object(
    {
      action: Type.Literal("click"),
      target: targetSchema,
      allowCrossOrigin: crossOriginSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("type"),
      target: targetSchema,
      text: Type.String({ maxLength: 8_000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("select"),
      target: targetSchema,
      values: Type.Array(Type.String({ maxLength: 512 }), {
        minItems: 1,
        maxItems: 20,
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("upload"),
      target: targetSchema,
      path: Type.String({ minLength: 1, maxLength: 500 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("download"),
      target: targetSchema,
      path: Type.String({ minLength: 1, maxLength: 500 }),
      allowCrossOrigin: crossOriginSchema,
    },
    { additionalProperties: false },
  ),
  saveScreenshotSchema,
]);
Object.assign(browserSchema, { type: "object" });

const readOnlyBrowserSchema = Type.Union([...readOnlyBrowserSchemas]);
Object.assign(readOnlyBrowserSchema, { type: "object" });

const READ_ONLY_BROWSER_ACTIONS = new Set([
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
  "screenshot",
  "console",
  "close",
]);

export function createBrowserTool(
  manager: BrowserSessionPort,
  owner: BrowserSessionOwner,
  options: {
    readOnly?: boolean;
    outputArtifacts?: Pick<BrowserOutputArtifactRegistrar, "register">;
    uploadAuthorizations?: Pick<BrowserUploadAuthorizationManager, "consume">;
    actionConfirmations?: Pick<BrowserConfirmedActionManager, "consume">;
  } = {},
): AgentTool<typeof browserSchema, BrowserSessionDetails> {
  const readOnly = options.readOnly === true;
  return {
    name: "browser",
    label: "Browser Session",
    executionMode: "sequential",
    description: readOnly
      ? `Read dynamic public pages or a workspace HTML artifact in one Run-owned isolated Chrome Session. Use start or preview_workspace, then wait, find, scroll, snapshot, screenshot, console, and close. Workspace preview is same-directory, offline, and read-only. Public navigation remains HTTP(S)-only; page data is untrusted.`
      : `Operate one Run-owned isolated Chrome Session for public HTTP(S) or an offline workspace HTML preview. Use preview_workspace to render a workspace-relative HTML entry without a local server, then inspect, interact, screenshot, and check console. Preview interactions are offline DOM-only; public interactive actions still require one-use confirmation. save_screenshot keeps its exact-hash write gate; page data is untrusted.`,
    parameters: (readOnly
      ? readOnlyBrowserSchema
      : browserSchema) as typeof browserSchema,
    async execute(toolCallId, input, signal) {
      if (readOnly && !READ_ONLY_BROWSER_ACTIONS.has(input.action)) {
        throw new Error(
          `Browser action requires an interactive Browser capability: ${input.action}`,
        );
      }
      const { result, output } = await executeBrowserTool({
        manager,
        owner,
        callId: toolCallId,
        request: input,
        ...(signal ? { signal } : {}),
        ...(options.actionConfirmations
          ? { actionConfirmations: options.actionConfirmations }
          : {}),
        ...(options.uploadAuthorizations
          ? { uploadAuthorizations: options.uploadAuthorizations }
          : {}),
        ...(options.outputArtifacts
          ? { outputArtifacts: options.outputArtifacts }
          : {}),
      });
      return {
        content: [
          { type: "text" as const, text: output },
          ...(result.screenshot
            ? [
                {
                  type: "image" as const,
                  data: result.screenshot.data,
                  mimeType: result.screenshot.mimeType,
                },
              ]
            : []),
        ],
        details: result.details,
      };
    },
  };
}

export function browserInteractionConfirmationPreview(
  args: unknown,
): BrowserInteractionConfirmationPreview {
  const projection = browserToolCallArgumentsLedgerProjection(args);
  const value = record(projection) ? projection : {};
  const selectorSha256 = string(value["selectorSha256"]);
  const refSha256 = string(value["refSha256"]);
  const textSha256 = string(value["textSha256"]);
  const pathSha256 = string(value["pathSha256"]);
  const valueSetSha256 = string(value["valueSetSha256"]);
  const expectedLiveImageSha256 = string(value["expectedLiveImageSha256"]);
  return {
    ...(selectorSha256
      ? { targetKind: "selector", targetSha256: selectorSha256 }
      : refSha256
        ? { targetKind: "ref", targetSha256: refSha256 }
        : {}),
    ...(textSha256 ? { textSha256 } : {}),
    ...(typeof value["textBytes"] === "number"
      ? { textBytes: value["textBytes"] }
      : {}),
    ...(typeof value["valueCount"] === "number"
      ? { valueCount: value["valueCount"] }
      : {}),
    ...(valueSetSha256 ? { valueSetSha256 } : {}),
    ...(pathSha256 ? { pathSha256 } : {}),
    ...(expectedLiveImageSha256
      ? { sourceImageSha256: expectedLiveImageSha256 }
      : {}),
    crossOriginAuthorized: value["crossOriginAuthorized"] === true,
  };
}

export function browserToolCallArgumentsLedgerProjection(
  args: unknown,
): JsonValue {
  const value = record(args) ? args : {};
  const action =
    typeof value["action"] === "string" ? value["action"] : "unknown";
  const target = record(value["target"]) ? value["target"] : {};
  const url = string(value["url"]);
  const text = string(value["text"]);
  const query = string(value["query"]).replace(/\s+/gu, " ").trim();
  const filePath = string(value["path"]);
  const tabId = string(value["tabId"]);
  const expectedLiveImageSha256 = string(value["expectedLiveImageSha256"]);
  const selector = string(target["selector"]);
  const ref = string(target["ref"]);
  const values = Array.isArray(value["values"])
    ? value["values"].filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
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
    ...(text
      ? {
          textSha256: sha256(text),
          textBytes: Buffer.byteLength(text, "utf8"),
        }
      : {}),
    ...(query
      ? {
          querySha256: sha256(query),
          queryChars: query.length,
        }
      : {}),
    ...(value["direction"] === "up" || value["direction"] === "down"
      ? { direction: value["direction"] }
      : {}),
    ...(typeof value["pixels"] === "number" ? { pixels: value["pixels"] } : {}),
    ...(filePath ? { pathSha256: sha256(filePath) } : {}),
    ...(expectedLiveImageSha256 ? { expectedLiveImageSha256 } : {}),
    ...(tabId ? { tabIdSha256: sha256(tabId) } : {}),
    ...(selector ? { selectorSha256: sha256(selector) } : {}),
    ...(ref ? { refSha256: sha256(ref) } : {}),
    ...(values.length > 0
      ? {
          valueCount: values.length,
          valueSetSha256: sha256(canonicalJson(values)),
        }
      : {}),
    crossOriginAuthorized: value["allowCrossOrigin"] === true,
    inputSha256: browserToolCallSha256(args),
  };
}

export function browserToolInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  const projection = browserToolCallArgumentsLedgerProjection(args);
  const action =
    record(projection) && typeof projection["action"] === "string"
      ? projection["action"]
      : "unknown";
  return {
    action,
    inputSha256: browserToolCallSha256(args),
    inputRedacted: true,
  };
}

export function browserToolOutputLedgerProjection(
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const details =
    record(result) && record(result["details"]) ? result["details"] : {};
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    resultSha256: sha256(canonicalJson(toJsonValue(details))),
  };
}

function browserToolCallSha256(args: unknown): string {
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

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}
