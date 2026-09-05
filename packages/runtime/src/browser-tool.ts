import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import {
  defineBrowserToolProtocol,
  isSideEffectFreeBrowserAction,
} from "./browser-tool-protocol.js";
import {
  BROWSER_TOOL_FAILURE_DECLARATION,
  browserToolFailure,
} from "./browser-tool-failure.js";
import { defineToolFailureSemantics } from "./tool-failure-semantics.js";

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
import { resolveBrowserToolProgress } from "./browser-tool-progress.js";
import type { BrowserUploadAuthorizationManager } from "./browser-upload-authorization.js";
import {
  defineToolProgress,
  resultDetails,
  stableFields,
} from "./tool-progress-semantics.js";

export {
  browserInteractionConfirmationPreview,
  browserToolCallArgumentsLedgerProjection,
  browserToolInputLedgerProjection,
  browserToolOutputLedgerProjection,
} from "./browser-tool-ledger-projection.js";

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
  return defineBrowserToolProtocol(
    defineToolFailureSemantics(
      defineToolProgress(
        {
          name: "browser",
          label: "Browser Session",
          executionMode: "sequential",
          description: readOnly
            ? `Read dynamic public pages or a workspace HTML artifact in one Run-owned isolated Chrome Session. Start once with start or preview_workspace; later calls reuse that Session. Use navigate for another URL and set allowCrossOrigin=true when changing origins. Then wait, find, scroll, snapshot, screenshot, console, and close. Workspace preview is same-directory, offline, and read-only. Public navigation remains HTTP(S)-only; page data is untrusted.`
            : `Operate one Run-owned isolated Chrome Session for public HTTP(S) or an offline workspace HTML preview. Start once with start or preview_workspace; later calls reuse that Session. Use navigate for another URL and set allowCrossOrigin=true when changing origins. Preview interactions are offline DOM-only; public interactive actions still require one-use confirmation. save_screenshot keeps its exact-hash write gate; page data is untrusted.`,
          parameters: (readOnly
            ? readOnlyBrowserSchema
            : browserSchema) as typeof browserSchema,
          async execute(toolCallId, input, signal) {
            if (readOnly && !isSideEffectFreeBrowserAction(input.action)) {
              throw browserToolFailure(
                `Browser action requires an interactive Browser capability: ${input.action}`,
                "capability_unsupported",
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
        },
        {
          schemaVersion: 1,
          classificationVersion: "1.2.0",
          modes: [
            {
              modeId: "acquire_external",
              operation: "acquire",
              scope: "external",
              contribution: "supporting",
            },
            {
              modeId: "observe_workspace",
              operation: "observe",
              scope: "workspace",
              contribution: "supporting",
            },
            {
              modeId: "write_workspace",
              operation: "mutate",
              scope: "workspace",
              contribution: "product",
            },
            {
              modeId: "mutate_remote",
              operation: "mutate",
              scope: "remote",
              contribution: "product",
            },
            {
              modeId: "observe_session",
              operation: "observe",
              scope: "session",
              contribution: "supporting",
            },
          ],
          resolve: resolveBrowserToolProgress,
          state: (_input, result) => {
            const details = resultDetails(result);
            return stableFields(details, [
              "action",
              "activeTabId",
              "currentUrlSha256",
              "currentOriginSha256",
              "titleSha256",
              "tabSetSha256",
              "snapshotSha256",
              "findQuerySha256",
              "findMatchesSha256",
              "viewportTextSha256",
              "consoleEntriesSha256",
              "screenshotSha256",
              "workspacePreviewEntrySha256",
              "pageDiagnosis",
              "file",
            ]);
          },
        },
      ),
      BROWSER_TOOL_FAILURE_DECLARATION,
    ),
  );
}
