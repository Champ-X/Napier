import type { LocalStore } from "@napier/runtime/store";
import {
  inspectStandardSkillResource,
  StandardSkillResourceInspectionError,
} from "@napier/runtime/standard-skill-catalog";
import type { StandardSkillRootKind } from "@napier/contracts/skill-load-standard";
import { Hono } from "hono";

import {
  errorMessage,
  jsonError,
  safeFilenameSegment,
  setStableContentSha256Header,
} from "./http-response-evidence.js";

type SkillResourcePreviewStore = Pick<LocalStore, "getWorkspaceSummary">;

/**
 * Preview a receipt-bound Skill resource without treating its virtual path as
 * a workspace filesystem path. The runtime re-applies the Skill catalog's
 * bounded, symlink-free loader and rejects source or content drift.
 */
export function registerSkillResourcePreviewHttp(
  app: Hono,
  store: SkillResourcePreviewStore,
): void {
  app.get("/api/skills/resource", async (context) => {
    const reference = {
      skillName: context.req.query("name") ?? "",
      resourcePath: context.req.query("path") ?? "",
      rootKind: (context.req.query("rootKind") ?? "") as StandardSkillRootKind,
      rawContentSha256: context.req.query("sha256") ?? "",
    };
    try {
      const resource = await inspectStandardSkillResource(
        store.getWorkspaceSummary().root,
        reference,
      );
      const contents = Buffer.from(resource.text, "utf8");
      if (
        contents.byteLength !== resource.sizeBytes ||
        resource.rawContentSha256 !== reference.rawContentSha256
      ) {
        return jsonError(context, "Skill resource preview drifted", 409);
      }
      context.header("Cache-Control", "no-store");
      context.header(
        "Content-Type",
        resourceContentType(resource.resourcePath),
      );
      context.header(
        "Content-Disposition",
        `inline; filename="${safeFilenameSegment(fileName(resource.resourcePath), "skill-resource")}"`,
      );
      context.header(
        "X-Napier-Workspace-File-Size-Bytes",
        String(resource.sizeBytes),
      );
      context.header(
        "X-Napier-Skill-Resource-Virtual-Path",
        resource.virtualPath,
      );
      setStableContentSha256Header(context, resource.rawContentSha256);
      const body = contents.buffer.slice(
        contents.byteOffset,
        contents.byteOffset + contents.byteLength,
      ) as ArrayBuffer;
      return context.body(body);
    } catch (error) {
      if (error instanceof StandardSkillResourceInspectionError) {
        const status =
          error.code === "invalid_reference"
            ? 400
            : error.code === "resource_drift"
              ? 409
              : 404;
        return jsonError(context, error.message, status);
      }
      return jsonError(context, errorMessage(error), 500);
    }
  });
}

function fileName(resourcePath: string): string {
  return resourcePath.split("/").at(-1) ?? "skill-resource";
}

function resourceContentType(resourcePath: string): string {
  const extension = resourcePath.split(".").at(-1)?.toLowerCase();
  if (extension === "md" || extension === "markdown") {
    return "text/markdown; charset=utf-8";
  }
  if (extension === "json") return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}
