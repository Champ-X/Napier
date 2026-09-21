import type { RunRecord, RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { runExecutionBoundary } from "./effective-run-profile.js";
import {
  runInputCapsuleStore,
  type RunInputCapsule,
} from "./run-input-capsule.js";
import { captureRunInputWorkspace } from "./run-input-workspace.js";
import type { AppendEventInput } from "./run-event-registry.js";

/** Diagnostic capture is optional and never grants file access or changes the
 * prompt. Only its hash/count receipt enters the ledger. Storage failure must
 * not prevent the authorized task from running. */
export async function captureRunInputs(input: {
  store: {
    workspaceRoot: string;
    dataRoot: string;
    appendEvent(event: AppendEventInput): Promise<RunEvent>;
  };
  run: RunRecord;
  text: string;
  enabled?: boolean;
  signal?: AbortSignal;
}): Promise<void> {
  if (!(input.enabled ?? process.env["NAPIER_CAPTURE_RUN_INPUTS"] === "1"))
    return;
  const startedAt = new Date().toISOString();
  let receipt: Record<string, string | number | boolean>;
  try {
    const { configuration } = input.run;
    const boundary = runExecutionBoundary(configuration);
    if (
      !configuration ||
      boundary.restricted ||
      boundary.degraded ||
      !configuration.enabledTools.includes("read_file")
    )
      throw new Error("capture_file_access_unavailable");
    const workspace = await captureRunInputWorkspace({
      workspaceRoot: input.store.workspaceRoot,
      dataRoot: input.store.dataRoot,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const content: Omit<RunInputCapsule, "contentSha256"> = {
      kind: "napier.run-input-capsule",
      schemaVersion: 1,
      threadId: input.run.threadId,
      runId: input.run.id,
      workspaceRootSha256: sha256(input.store.workspaceRoot),
      configurationSha256: configuration.contentSha256,
      promptSha256: sha256(input.text),
      startedAt,
      capturedAt: new Date().toISOString(),
      ...workspace,
    };
    const capsule = {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    };
    await runInputCapsuleStore(input.store.dataRoot).put(
      capsule.contentSha256,
      canonicalJson(capsule),
    );
    receipt = {
      status: workspace.omissions.length ? "partial" : "captured",
      capsuleSha256: capsule.contentSha256,
      fileCount: workspace.files.length,
      byteCount: workspace.bytes,
      omissionCount: workspace.omissions.length,
      scope:
        "local workspace files; optimistic double scan; excludes dependencies and external services",
    };
  } catch (error) {
    receipt = {
      status: "unavailable",
      diagnosticSha256: sha256(
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
  await input.store.appendEvent({
    threadId: input.run.threadId,
    runId: input.run.id,
    type: "run.inputs.captured",
    category: "lifecycle",
    visibility: "debug",
    payload: {
      kind: "napier.run-input-capture",
      schemaVersion: 1,
      ...receipt,
      durationMs: Date.now() - Date.parse(startedAt),
    },
  });
}
