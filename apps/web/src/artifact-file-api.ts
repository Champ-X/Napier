import { throwNapierApiError } from "./api-error";

export interface PlanArtifactFileDownload {
  blob: Blob;
  filename: string;
  sha256: string;
  sizeBytes: number;
}

export async function downloadPlanArtifactFile(
  threadId: string,
  planId: string,
  artifactId: string,
): Promise<PlanArtifactFileDownload> {
  const path = `/api/threads/${encodeURIComponent(threadId)}/plans/${encodeURIComponent(planId)}/artifacts/${encodeURIComponent(artifactId)}/file`;
  const response = await fetch(path);
  if (!response.ok) {
    await throwNapierApiError(response, "Request failed", path);
  }
  const expectedSha256 = response.headers.get("X-Napier-Content-SHA256");
  if (!expectedSha256 || !/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    throw new Error(`Response hash missing for ${path}`);
  }
  const bytes = await response.arrayBuffer();
  const observedSha256 = await sha256ArrayBuffer(bytes);
  if (observedSha256 !== expectedSha256) {
    throw new Error(`Response hash mismatch for ${path}`);
  }
  const headerSize = response.headers.get(
    "X-Napier-Plan-Artifact-Size-Bytes",
  );
  const sizeBytes = Number(headerSize ?? Number.NaN);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error(`Response artifact size invalid for ${path}`);
  }
  return {
    blob: new Blob([bytes], {
      type: response.headers.get("Content-Type") ?? "application/octet-stream",
    }),
    filename: contentDispositionFilename(response) ?? `${artifactId}.artifact`,
    sha256: expectedSha256,
    sizeBytes,
  };
}

async function sha256ArrayBuffer(value: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function contentDispositionFilename(response: Response): string | undefined {
  const header = response.headers.get("Content-Disposition");
  const match = header?.match(/\bfilename="([^"]+)"/u);
  return match?.[1];
}
