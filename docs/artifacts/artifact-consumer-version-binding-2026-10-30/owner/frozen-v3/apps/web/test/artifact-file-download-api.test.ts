import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadPlanArtifactFile } from "../src/artifact-file-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Artifact file download API", () => {
  it("downloads plan artifact files with response hash verification", async () => {
    const bytes = new TextEncoder().encode("downloadable artifact\n");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe(
        "/api/threads/thread_1/plans/plan_1/artifacts/artifact_1/file",
      );
      expect(init).toBeUndefined();
      return new Response(bytes, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition":
            'attachment; filename="napier-artifact-artifact_1-report.txt"',
          "X-Napier-Thread-Id": "thread_1",
          "X-Napier-Plan-Id": "plan_1",
          "X-Napier-Plan-Artifact-Id": "artifact_1",
          "X-Napier-Plan-Revision": "3",
          "X-Napier-Plan-Artifact-Status": "verified",
          "X-Napier-Plan-Artifact-Path-SHA256": "a".repeat(64),
          "X-Napier-Content-SHA256": sha256,
          "X-Napier-Plan-Artifact-Size-Bytes": String(bytes.byteLength),
          "X-Napier-Ledger-Event-Id": "event_download1234567890",
          "X-Napier-Ledger-Event-Seq": "6",
          "X-Napier-Ledger-Event-SHA256": "d".repeat(64),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const download = await downloadPlanArtifactFile(
      "thread_1",
      "plan_1",
      "artifact_1",
    );
    await expect(download.blob.text()).resolves.toBe("downloadable artifact\n");
    expect(download).toEqual(
      expect.objectContaining({
        filename: "napier-artifact-artifact_1-report.txt",
        sha256,
        sizeBytes: bytes.byteLength,
        ledgerEventId: "event_download1234567890",
        ledgerEventSeq: 6,
        ledgerEventSha256: "d".repeat(64),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects plan artifact downloads without ledger receipt headers", async () => {
    const bytes = new TextEncoder().encode("downloadable artifact\n");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const fetchMock = vi.fn(async () => {
      return new Response(bytes, {
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Napier-Thread-Id": "thread_1",
          "X-Napier-Plan-Id": "plan_1",
          "X-Napier-Plan-Artifact-Id": "artifact_1",
          "X-Napier-Plan-Revision": "3",
          "X-Napier-Plan-Artifact-Status": "verified",
          "X-Napier-Plan-Artifact-Path-SHA256": "a".repeat(64),
          "X-Napier-Content-SHA256": sha256,
          "X-Napier-Plan-Artifact-Size-Bytes": String(bytes.byteLength),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadPlanArtifactFile("thread_1", "plan_1", "artifact_1"),
    ).rejects.toThrow(
      "Response ledger receipt invalid for /api/threads/thread_1/plans/plan_1/artifacts/artifact_1/file",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["X-Napier-Plan-Id", "other-plan", "identity invalid"],
    ["X-Napier-Plan-Revision", "0", "identity invalid"],
    ["X-Napier-Plan-Artifact-Size-Bytes", "99", "size invalid"],
  ])("rejects a download with invalid %s", async (header, value, error) => {
    const bytes = new TextEncoder().encode("file");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(bytes, {
            headers: {
              "X-Napier-Thread-Id": "thread_1",
              "X-Napier-Plan-Id": "plan_1",
              "X-Napier-Plan-Artifact-Id": "artifact_1",
              "X-Napier-Plan-Revision": "3",
              "X-Napier-Plan-Artifact-Status": "verified",
              "X-Napier-Plan-Artifact-Path-SHA256": "a".repeat(64),
              "X-Napier-Content-SHA256": createHash("sha256")
                .update(bytes)
                .digest("hex"),
              "X-Napier-Plan-Artifact-Size-Bytes": String(bytes.byteLength),
              "X-Napier-Ledger-Event-Id": "event_1",
              "X-Napier-Ledger-Event-Seq": "1",
              "X-Napier-Ledger-Event-SHA256": "b".repeat(64),
              [header]: value,
            },
          }),
      ),
    );
    await expect(
      downloadPlanArtifactFile("thread_1", "plan_1", "artifact_1"),
    ).rejects.toThrow(error);
  });

  it("uses safe hash-addressed plan artifact fallback filenames", async () => {
    const bytes = new TextEncoder().encode("downloadable artifact\n");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const fetchMock = vi.fn(async (path: string) => {
      expect(path).toBe(
        "/api/threads/thread_1/plans/plan_1/artifacts/artifact%2Fbad%3Apath/file",
      );
      return new Response(bytes, {
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Napier-Thread-Id": "thread_1",
          "X-Napier-Plan-Id": "plan_1",
          "X-Napier-Plan-Artifact-Id": "artifact/bad:path",
          "X-Napier-Plan-Revision": "3",
          "X-Napier-Plan-Artifact-Status": "verified",
          "X-Napier-Plan-Artifact-Path-SHA256": "a".repeat(64),
          "X-Napier-Content-SHA256": sha256,
          "X-Napier-Plan-Artifact-Size-Bytes": String(bytes.byteLength),
          "X-Napier-Ledger-Event-Id": "event_download1234567890",
          "X-Napier-Ledger-Event-Seq": "6",
          "X-Napier-Ledger-Event-SHA256": "d".repeat(64),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadPlanArtifactFile("thread_1", "plan_1", "artifact/bad:path"),
    ).resolves.toEqual(
      expect.objectContaining({
        filename: `napier-artifact-artifact_bad_path-${sha256.slice(0, 12)}.artifact`,
        sha256,
        sizeBytes: bytes.byteLength,
        ledgerEventId: "event_download1234567890",
        ledgerEventSeq: 6,
        ledgerEventSha256: "d".repeat(64),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
