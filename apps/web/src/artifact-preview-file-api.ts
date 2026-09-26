import { throwNapierApiError } from "./api-error";
import {
  ledgerEventReceiptFromHeaders,
  sha256ArrayBuffer,
  type PlanArtifactLedgerEventReceipt,
} from "./artifact-file-receipt";
import {
  readFilePreviewResponse,
  type WorkspaceFilePreview,
} from "./workspace-directory-api";

export interface PlanArtifactFilePreview extends WorkspaceFilePreview {
  kind: "napier.plan-artifact-file-preview";
  planId: string;
  artifactId: string;
  planRevision: number;
  status: string;
  artifactKind: string;
  pathSha256: string;
}

export type PlanArtifactFilePreviewReceipt = PlanArtifactFilePreview &
  PlanArtifactLedgerEventReceipt;

export async function previewPlanArtifactFile(
  threadId: string,
  planId: string,
  artifactId: string,
): Promise<PlanArtifactFilePreviewReceipt> {
  return requestPlanArtifactFilePreview(threadId, planId, artifactId, false);
}

export async function peekPlanArtifactFile(
  threadId: string,
  planId: string,
  artifactId: string,
): Promise<PlanArtifactFilePreview> {
  return requestPlanArtifactFilePreview(threadId, planId, artifactId, true);
}

function requestPlanArtifactFilePreview(
  threadId: string,
  planId: string,
  artifactId: string,
  peek: false,
): Promise<PlanArtifactFilePreviewReceipt>;
function requestPlanArtifactFilePreview(
  threadId: string,
  planId: string,
  artifactId: string,
  peek: true,
): Promise<PlanArtifactFilePreview>;
async function requestPlanArtifactFilePreview(
  threadId: string,
  planId: string,
  artifactId: string,
  peek: boolean,
): Promise<PlanArtifactFilePreview | PlanArtifactFilePreviewReceipt> {
  const endpoint = `/api/threads/${encodeURIComponent(threadId)}/plans/${encodeURIComponent(planId)}/artifacts/${encodeURIComponent(artifactId)}/preview-file`;
  const response = await fetch(peek ? `${endpoint}/peek` : endpoint);
  if (!response.ok)
    await throwNapierApiError(
      response,
      "Could not preview artifact file",
      endpoint,
    );
  const headers = response.headers;
  const planRevision = Number(
    headers.get("X-Napier-Plan-Revision") ?? Number.NaN,
  );
  const status = headers.get("X-Napier-Plan-Artifact-Status");
  const artifactKind = headers.get("X-Napier-Plan-Artifact-Kind");
  const pathSha256 = headers.get("X-Napier-Plan-Artifact-Path-SHA256");
  const encodedPath = headers.get("X-Napier-Plan-Artifact-Path");
  if (
    headers.get("X-Napier-Thread-Id") !== threadId ||
    headers.get("X-Napier-Plan-Id") !== planId ||
    headers.get("X-Napier-Plan-Artifact-Id") !== artifactId ||
    !Number.isSafeInteger(planRevision) ||
    planRevision < 1 ||
    (status !== "produced" && status !== "verified") ||
    artifactKind !== "file" ||
    !pathSha256 ||
    !/^[a-f0-9]{64}$/u.test(pathSha256) ||
    !encodedPath
  ) {
    throw new Error(`Response artifact identity invalid for ${endpoint}`);
  }
  const path = decodeURIComponent(encodedPath);
  if (
    (await sha256ArrayBuffer(new TextEncoder().encode(path).buffer)) !==
    pathSha256
  ) {
    throw new Error(`Response artifact path mismatch for ${endpoint}`);
  }
  if (peek && headers.get("X-Napier-Read-Mode") !== "peek") {
    throw new Error(`Response read mode invalid for ${endpoint}`);
  }
  const receipt = peek
    ? undefined
    : ledgerEventReceiptFromHeaders(response, endpoint);
  const previewHeaders = new Headers(headers);
  previewHeaders.set(
    "X-Napier-Workspace-File-Size-Bytes",
    headers.get("X-Napier-Plan-Artifact-Size-Bytes") ?? "",
  );
  previewHeaders.set("X-Napier-Workspace-File-Path", encodedPath);
  const preview = await readFilePreviewResponse(
    new Response(response.body, {
      status: response.status,
      headers: previewHeaders,
    }),
    endpoint,
    path,
  );
  if (headers.get("X-Napier-Plan-Artifact-SHA256") !== preview.sha256) {
    throw new Error(`Response artifact hash mismatch for ${endpoint}`);
  }
  const result: PlanArtifactFilePreview = {
    ...preview,
    kind: "napier.plan-artifact-file-preview",
    planId,
    artifactId,
    planRevision,
    status,
    artifactKind,
    pathSha256,
  };
  return receipt ? { ...result, ...receipt } : result;
}
