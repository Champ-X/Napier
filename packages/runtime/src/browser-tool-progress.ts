import {
  progressSemantics,
  publicUrlProgressFailureDomain,
  publicUrlProgressResource,
  recordValue,
} from "./tool-progress-semantics.js";
import { sha256 } from "./ed25519.js";

const BROWSER_ACQUISITION_ACTIONS = new Set([
  "start",
  "navigate",
  "back",
  "forward",
  "tab_new",
  // Public wait temporarily enables outbound network and may acquire fresh
  // page state; classify by I/O effect, not by the verb's passive spelling.
  "wait",
]);

const BROWSER_REMOTE_MUTATION_ACTIONS = new Set([
  "click",
  "type",
  "select",
  "upload",
  "visual_click",
  "keypress",
]);

export function resolveBrowserToolProgress(input: unknown) {
  const value = recordValue(input);
  const action = typeof value["action"] === "string" ? value["action"] : "";
  const urlResource = publicUrlProgressResource(value["url"]);
  const originBinding = publicUrlProgressFailureDomain(value["url"]);
  const sessionBinding = { kind: "browser-session", lane: "interactive" };
  if (BROWSER_ACQUISITION_ACTIONS.has(action)) {
    const resourceKey = urlResource ?? {
      kind: "browser-history-navigation",
      action,
    };
    const legacyDomain = originBinding ?? {
      kind: "browser-history-navigation",
    };
    return {
      semantics: progressSemantics("acquire", "external", "supporting"),
      resourceKey,
      failureBindings: {
        target: resourceKey,
        ...(originBinding ? { origin: originBinding } : {}),
        route: { kind: "browser-route", route: "interactive_navigation" },
        capability: {
          kind: "browser-capability",
          capability: "public_navigation",
        },
        session: sessionBinding,
      },
      failureDomainKey: legacyDomain,
    };
  }
  if (action === "preview_workspace") {
    return {
      semantics: progressSemantics("observe", "workspace", "supporting"),
      resourceKey: { kind: "workspace-path", path: value["path"] },
    };
  }
  if (action === "save_screenshot" || action === "download") {
    const resourceKey = { kind: "workspace-path", path: value["path"] };
    return {
      semantics: progressSemantics("mutate", "workspace", "product"),
      resourceKey,
      failureBindings: {
        target: resourceKey,
        capability: { kind: "browser-capability", capability: action },
        session: sessionBinding,
      },
      failureDomainKey: sessionBinding,
    };
  }
  if (BROWSER_REMOTE_MUTATION_ACTIONS.has(action)) {
    const resourceKey = browserRemoteProductResource(value, action);
    return {
      // An approved interaction changes the user's remote product, just as a
      // workspace write changes a local product. Treating it as neutral makes
      // long, valid automation indistinguishable from a spinning observer.
      semantics: progressSemantics("mutate", "remote", "product"),
      resourceKey,
      failureBindings: {
        target: resourceKey,
        capability: { kind: "browser-capability", capability: action },
        session: sessionBinding,
      },
      failureDomainKey: sessionBinding,
    };
  }
  const resourceKey = { kind: "browser-session", action };
  return {
    semantics: progressSemantics("observe", "session", "supporting"),
    resourceKey,
    failureBindings: {
      target: resourceKey,
      capability: { kind: "browser-capability", capability: action },
      session: sessionBinding,
    },
    failureDomainKey: sessionBinding,
  };
}

/**
 * Identifies the remote product without publishing selectors, refs, typed
 * text, selected values, or workspace paths. Repeating the same action on the
 * same target therefore cannot manufacture a fresh progress resource merely
 * by changing secret input; a distinct stable result state is still recorded
 * by the Tool Progress declaration.
 */
function browserRemoteProductResource(
  value: Record<string, unknown>,
  action: string,
) {
  const target = recordValue(value["target"]);
  const selector = text(valueOf(target, "selector"));
  const ref = text(valueOf(target, "ref"));
  const key = text(value["key"]);
  const x = finiteInteger(value["x"]);
  const y = finiteInteger(value["y"]);
  return {
    kind: "browser-remote-product",
    action,
    ...(selector ? { selectorSha256: sha256(selector) } : {}),
    ...(ref ? { refSha256: sha256(ref) } : {}),
    ...(key ? { keySha256: sha256(key) } : {}),
    ...(x !== undefined && y !== undefined ? { point: [x, y] } : {}),
  };
}

function valueOf(
  value: Record<string, unknown>,
  field: string,
): unknown {
  return value[field];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}
