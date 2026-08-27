import type {
  ApplyContextCompactionForkRequest,
  ContextCompactionForkResult,
  ContextCompactionPreview,
  PreviewContextCompactionRequest,
} from "@napier/contracts/context-compaction";
import { validateContextCompactionPreview } from "@napier/contracts/context-compaction";
import { validateContextCompactionForkResult } from "@napier/contracts/context-compaction";

import { requestJsonWithResponse } from "./api-client";
import { canonicalJson, sha256Text } from "./stable-digest";

export async function previewContextCompaction(
  threadId: string,
  request: PreviewContextCompactionRequest,
): Promise<ContextCompactionPreview> {
  const { body, headers } = await requestJsonWithResponse<unknown>(
    `/api/threads/${encodeURIComponent(threadId)}/context-compaction/preview`,
    { method: "POST", body: JSON.stringify(request) },
  );
  const preview = validateContextCompactionPreview(body);
  if (
    preview.sourceThreadId !== threadId ||
    preview.retainedMessageCount !== request.retainedMessageCount ||
    canonicalJson(preview.model) !== canonicalJson(request.model) ||
    headers.get("cache-control") !== "no-store" ||
    headers.get("x-napier-context-compaction-preview-sha256") !==
      preview.previewSha256
  ) {
    throw new Error("Context compaction preview binding is invalid");
  }
  return preview;
}

export async function applyContextCompactionFork(
  threadId: string,
  request: ApplyContextCompactionForkRequest,
): Promise<ContextCompactionForkResult> {
  const { body: input, headers } = await requestJsonWithResponse<unknown>(
    `/api/threads/${encodeURIComponent(threadId)}/context-compaction/forks`,
    { method: "POST", body: JSON.stringify(request) },
  );
  const body = validateContextCompactionForkResult(input);
  if (
    body.kind !== "napier.context-compaction-fork-result" ||
    body.schemaVersion !== 1 ||
    body.sourceThreadId !== threadId ||
    body.targetThreadId === threadId ||
    body.previewSha256 !== request.expectedPreviewSha256 ||
    headers.get("cache-control") !== "no-store" ||
    headers.get("x-napier-context-compaction-preview-sha256") !==
      body.previewSha256 ||
    body.checkpoint.summarySha256 !==
      (await sha256Text(
        JSON.stringify({
          summary: body.checkpoint.summary,
          decisions: body.checkpoint.decisions,
          openLoops: body.checkpoint.openLoops,
          artifacts: body.checkpoint.artifacts,
        }),
      ))
  ) {
    throw new Error("Context compaction fork response is invalid");
  }
  return body;
}
