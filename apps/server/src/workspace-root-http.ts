import type { WorkspaceSummary } from "@napier/contracts";
import type { LocalStore } from "@napier/runtime";
import { Hono } from "hono";

import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import {
  errorMessage,
  jsonError,
  setBodyContentSha256Header,
} from "./http-response-evidence.js";
import { parseRebindWorkspaceRootRequest } from "./workspace-root-http-validation.js";
import {
  resolveRebindWorkspaceRoot,
  WorkspaceRebindBusyError,
  WorkspaceRebindRequestError,
  workspaceRebindBusyReasons,
} from "./workspace-rebind.js";

const MAX_WORKSPACE_ROOT_REQUEST_BYTES = 8 * 1024;

export type RebindWorkspace = (
  absoluteRoot: string,
) => Promise<WorkspaceSummary>;

interface WorkspaceRootHttpServices {
  store: Pick<
    LocalStore,
    "getWorkspaceSummary" | "listThreads" | "listRuns"
  >;
}

export function registerWorkspaceRootHttp(
  app: Hono,
  services: WorkspaceRootHttpServices,
  rebindWorkspace?: RebindWorkspace,
): void {
  app.post("/api/workspace/root", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_WORKSPACE_ROOT_REQUEST_BYTES,
        "Workspace root rebind request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseRebindWorkspaceRootRequest(input);
    if (!body) {
      return jsonError(context, "Workspace root rebind request is invalid", 400);
    }
    if (!rebindWorkspace) {
      return jsonError(
        context,
        "Workspace rebind is not available in this runtime",
        409,
      );
    }
    const busy = workspaceRebindBusyReasons(services.store);
    if (busy.length > 0) {
      return jsonError(context, `Workspace is busy: ${busy.join("; ")}`, 409);
    }
    let resolvedRoot: string;
    try {
      resolvedRoot = await resolveRebindWorkspaceRoot(
        body.root,
        services.store.getWorkspaceSummary().root,
      );
    } catch (error) {
      if (error instanceof WorkspaceRebindRequestError) {
        return jsonError(context, error.message, error.status);
      }
      throw error;
    }
    let summary: WorkspaceSummary;
    try {
      summary = await rebindWorkspace(resolvedRoot);
    } catch (error) {
      if (error instanceof WorkspaceRebindBusyError) {
        return jsonError(context, error.message, 409);
      }
      if (error instanceof WorkspaceRebindRequestError) {
        return jsonError(context, error.message, error.status);
      }
      return jsonError(context, errorMessage(error), 500);
    }
    setBodyContentSha256Header(context, summary);
    return context.json(summary, 200);
  });
}
