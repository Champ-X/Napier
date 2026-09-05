import type { ToolFailureModeV1 } from "@napier/contracts/tool-protocol";

import { BrowserConfirmationPageChangedError } from "./browser-confirmed-action.js";
import { BrowserSessionInactiveError } from "./browser-session-errors.js";
import { BrowserNavigationPolicyError } from "./browser-session-navigation.js";
import {
  publicUrlProgressFailureDomain,
  publicUrlProgressResource,
  recordValue,
} from "./tool-progress-semantics.js";
import {
  declaredFailureMode,
  structuredTransportFailureClass,
  ToolFailureError,
  toolFailureSemantics,
  toolFailureSignal,
  type ToolFailureDeclaration,
} from "./tool-failure-semantics.js";

const MODES = [
  mode("capability_unsupported", "unsupported", "capability", "terminal"),
  mode("navigation_policy", "policy", "invocation", "correct_input"),
  mode("page_changed", "session_state", "target", "correct_input"),
  mode("session_inactive", "session_state", "session", "recover_state", true),
  mode("origin_timeout", "timeout", "origin", "alternate_route"),
  mode("origin_network", "network", "origin", "alternate_route"),
  mode("route_timeout", "timeout", "route", "alternate_route"),
  mode("route_network", "network", "route", "alternate_route"),
  mode("resource_limit", "resource_limit", "invocation", "terminal"),
  mode("cancelled", "cancelled", "invocation", "terminal"),
] as const;

export const BROWSER_TOOL_FAILURE_DECLARATION: ToolFailureDeclaration = {
  schemaVersion: 1,
  classificationVersion: "1.0.0",
  modes: MODES,
  resolve(input, failure) {
    const signal = toolFailureSignal(failure);
    const transport = structuredTransportFailureClass(failure);
    const modeId =
      signal?.modeId ?? knownBrowserFailureMode(input, failure, transport);
    if (!modeId) throw new Error("Browser failure has no typed signal");
    const selected = declaredFailureMode(
      BROWSER_TOOL_FAILURE_DECLARATION,
      modeId,
    );
    return {
      semantics: toolFailureSemantics(selected),
      ...(selected.scope === "invocation"
        ? {}
        : {
            bindingKey:
              signal?.bindingKey ??
              browserFailureBinding(selected.scope, input),
          }),
      ...(signal?.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: signal.retryAfterMs }),
    };
  },
};

export function browserToolFailure(
  message: string,
  modeId: (typeof MODES)[number]["modeId"],
  bindingKey?: unknown,
  options?: ErrorOptions,
): ToolFailureError {
  return new ToolFailureError(
    message,
    { modeId, ...(bindingKey === undefined ? {} : { bindingKey }) },
    options,
  );
}

function knownBrowserFailureMode(
  input: unknown,
  failure: unknown,
  transport: ReturnType<typeof structuredTransportFailureClass>,
): (typeof MODES)[number]["modeId"] | undefined {
  if (failure instanceof BrowserSessionInactiveError) return "session_inactive";
  if (failure instanceof BrowserNavigationPolicyError)
    return "navigation_policy";
  if (failure instanceof BrowserConfirmationPageChangedError)
    return "page_changed";
  if (transport === "cancelled") return "cancelled";
  const hasUrl = typeof recordValue(input)["url"] === "string";
  if (transport === "timeout")
    return hasUrl ? "origin_timeout" : "route_timeout";
  if (transport === "network")
    return hasUrl ? "origin_network" : "route_network";
  return undefined;
}

function browserFailureBinding(
  scope: ToolFailureModeV1["scope"],
  input: unknown,
): unknown {
  const value = recordValue(input);
  const action = typeof value["action"] === "string" ? value["action"] : "";
  if (scope === "session") {
    return { kind: "browser-session", lane: "interactive" };
  }
  if (scope === "capability") {
    return { kind: "browser-capability", capability: action };
  }
  if (scope === "origin") {
    return publicUrlProgressFailureDomain(value["url"]);
  }
  if (scope === "target") {
    const publicUrl = publicUrlProgressResource(value["url"]);
    if (publicUrl) return publicUrl;
    if (
      [
        "click",
        "type",
        "select",
        "upload",
        "visual_click",
        "keypress",
      ].includes(action)
    ) {
      return { kind: "browser-session-target", action };
    }
    return { kind: "browser-session", action };
  }
  return { kind: "browser-route", route: "interactive_navigation" };
}

function mode(
  modeId: string,
  failureClass: ToolFailureModeV1["class"],
  scope: ToolFailureModeV1["scope"],
  disposition: ToolFailureModeV1["disposition"],
  fatalToSession = false,
): ToolFailureModeV1 {
  return { modeId, class: failureClass, scope, disposition, fatalToSession };
}
