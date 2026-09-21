import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type TSchema } from "typebox";

import { preserveAgentToolIdentity } from "./agent-tool-metadata.js";
import { WorkspaceEditSnapshots } from "./workspace-edit-snapshots.js";
import { WorkspacePatchInputError } from "./workspace-patch-input-error.js";

/** Decorate before protocol registration, so schema and invocation receipts
 * describe the real model-facing surface. Mutations still use the original tool.
 */
export function withWorkspaceEditReferences(
  tools: AgentTool[],
  options: { unifiedDiff?: boolean } = {},
): AgentTool[] {
  if (!tools.some((tool) => tool.name === "apply_patch")) return tools;
  const snapshots = new WorkspaceEditSnapshots();
  return tools.map((tool): AgentTool => {
    if (tool.name === "read_file")
      return preserveAgentToolIdentity(tool, {
        ...tool,
        description: `${tool.description} Editable snapshots render lines as L<number>|content; use that exact L<number> as anchorRef. Labels are metadata, not file contents.`,
        execute: async (...args) => {
          const result = await tool.execute(...args);
          const details = result.details as ReadDetails;
          // A clipped line must never acquire an edit reference for unseen bytes.
          if (details.truncated || !Array.isArray(details.lineAnchors))
            return result;
          const raw = result.content.find(
            (part) =>
              part.type === "text" &&
              part.text.startsWith("Napier file metadata: "),
          );
          const source =
            raw?.type === "text"
              ? raw.text.slice(raw.text.indexOf("\n\n") + 2)
              : undefined;
          const reference = snapshots.capture({
            ...details,
            ...(options.unifiedDiff && source !== undefined ? { source } : {}),
          });
          return {
            ...result,
            content: result.content.map((part) => {
              if (
                part.type !== "text" ||
                !part.text.startsWith("Napier file metadata: ")
              )
                return part;
              const boundary = part.text.indexOf("\n\n");
              if (boundary < 0) return part;
              // Other governed tools (LSP/AST/verification) still consume the
              // complete file hash; only the verbose per-line hashes are hidden.
              const metadata = {
                path: details.path,
                sha256: details.sha256,
                snapshotRef: reference.snapshotRef,
              };
              const anchors = new Map(
                reference.anchors.map((anchor) => [
                  anchor.line,
                  anchor.anchorRef,
                ]),
              );
              const content = part.text
                .slice(boundary + 2)
                .split("\n")
                .map((line, index) => {
                  const number = details.startLine + index;
                  return `${anchors.get(number) ?? number}|${line}`;
                })
                .join("\n");
              return {
                ...part,
                text: `Napier file metadata: ${JSON.stringify(metadata)}\nLine labels are metadata; do not copy them into file contents.\n\n${content}`,
              };
            }),
            details: { ...details, ...reference },
          };
        },
      });
    if (tool.name !== "apply_patch") return tool;
    const parameters = structuredClone(tool.parameters) as PatchSchema;
    if (options.unifiedDiff) {
      parameters.properties.operation = Type.Union([
        parameters.properties.operation!,
        Type.Literal("unified_diff"),
      ]);
      parameters.properties.diff = Type.Optional(
        Type.String({ maxLength: 256 * 1024 }),
      );
    }
    parameters.properties.expectedSha256 = Type.Optional(
      parameters.properties.expectedSha256,
    );
    parameters.properties.snapshotRef = Type.Optional(
      Type.String({ maxLength: 64 }),
    );
    parameters.properties.edits.items.properties.anchorRef = Type.Optional(
      Type.String({ maxLength: 20 }),
    );
    parameters.required = parameters.required.filter(
      (name: string) => name !== "expectedSha256",
    );
    return preserveAgentToolIdentity(tool, {
      ...tool,
      parameters,
      description: `${tool.description} You may use snapshotRef from read_file instead of expectedSha256; hashline_replace edits may use anchorRef instead of line/anchorSha256. References name exact read snapshots, expire on resume, and never permit editing a stale file. Legacy full-hash arguments remain valid.${options.unifiedDiff ? " Operation unified_diff requires snapshotRef from a complete read_file and diff (single-file headers --- a/path and +++ b/path, exact @@ coordinates). No fuzzy matching or implicit filesystem actions." : ""}`,
      execute: async (callId, args, signal, onUpdate) => {
        try {
          if (
            (args as Record<string, unknown>).operation === "unified_diff" &&
            (!options.unifiedDiff ||
              typeof (args as Record<string, unknown>).snapshotRef !== "string")
          )
            throw new Error(
              "Unified diff requires the enabled policy and a complete read_file snapshotRef",
            );
          const resolved = snapshots.resolve(args as Record<string, unknown>);
          return await tool.execute(callId, resolved, signal, onUpdate);
        } catch (error) {
          if (error instanceof WorkspacePatchInputError) throw error;
          if (!(error instanceof Error) || !recoverable(error.message))
            throw error;
          throw new Error(
            `${error.message}\n${JSON.stringify({
              kind: "napier.edit-recovery",
              schemaVersion: 1,
              action: "read_then_rebuild_edit",
              automaticRetry: false,
              nextTool: "read_file",
              input: { path: (args as Record<string, unknown>).path },
              instruction:
                "Read the current target, review its contents, then construct a new edit with the returned preconditions. Do not reuse the rejected snapshot.",
            })}`,
            { cause: error },
          );
        }
      },
    });
  });
}

interface ReadDetails {
  path: string;
  startLine: number;
  sha256: string;
  truncated: boolean;
  lineAnchors: Array<{ line: number; sha256: string }>;
}

interface PatchSchema extends TSchema {
  properties: {
    operation?: TSchema;
    diff?: TSchema;
    expectedSha256: TSchema;
    snapshotRef?: TSchema;
    edits: { items: { properties: Record<string, TSchema> } };
  };
  required: string[];
}

function recoverable(message: string): boolean {
  return /unified diff|snapshot|anchor|did not match|ambiguous|precondition failed|SHA-256 precondition/iu.test(
    message,
  );
}
