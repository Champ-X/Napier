import { describe, expect, it, vi } from "vitest";

import { settleBrowserToolOutput } from "../src/browser-tool-output.js";
import type {
  BrowserSessionDetails,
  BrowserSessionOperationResult,
} from "../src/browser-session-model.js";

describe("Browser Agent file output settlement", () => {
  it("registers confirmed downloads and reports standard Plan settlement", async () => {
    const registrar = {
      register: vi.fn(async () => ({
        status: "registered" as const,
        reason: "artifact_registered" as const,
        planId: "plan_download",
        artifactId: "archive",
      })),
    };
    const result = downloadResult();

    await expect(
      settleBrowserToolOutput({
        owner: { threadId: "thread_download", runId: "run_download" },
        request: {
          action: "download",
          target: { ref: "e1" },
          path: "artifacts/archive.zip",
        },
        result,
        registrar,
      }),
    ).resolves.toBe("Browser DOWNLOAD complete.\nPlan Artifact: verified");
    expect(registrar.register).toHaveBeenCalledWith(
      { threadId: "thread_download", runId: "run_download" },
      {
        action: "download",
        path: "artifacts/archive.zip",
        pathSha256: "a".repeat(64),
        fileSha256: "b".repeat(64),
        fileBytes: 255_486,
      },
    );
  });

  it("keeps output bytes successful when registration skips or fails", async () => {
    const result = downloadResult();
    for (const registration of [
      { status: "skipped" as const, reason: "no_run_bound_plan" as const },
      {
        status: "failed" as const,
        reason: "artifact_registration_failed" as const,
      },
    ]) {
      await expect(
        settleBrowserToolOutput({
          owner: { threadId: "thread_download", runId: "run_download" },
          request: {
            action: "download",
            target: { ref: "e1" },
            path: "artifacts/archive.zip",
          },
          result,
          registrar: { register: vi.fn(async () => registration) },
        }),
      ).resolves.toContain(`not verified (${registration.reason})`);
    }
    await expect(
      settleBrowserToolOutput({
        owner: { threadId: "thread_download", runId: "run_download" },
        request: {
          action: "download",
          target: { ref: "e1" },
          path: "artifacts/archive.zip",
        },
        result,
        registrar: {
          register: vi.fn(async () => {
            throw new Error("registration unavailable");
          }),
        },
      }),
    ).resolves.toContain("not verified (artifact_registration_failed)");
  });
});

function downloadResult(): BrowserSessionOperationResult {
  return {
    output: "Browser DOWNLOAD complete.",
    details: {
      ...details("download"),
      file: {
        pathSha256: "a".repeat(64),
        fileSha256: "b".repeat(64),
        fileBytes: 255_486,
      },
      suggestedFilenameSha256: "c".repeat(64),
    },
  };
}

function details(
  action: BrowserSessionDetails["action"],
): BrowserSessionDetails {
  return {
    kind: "napier.browser-session-operation",
    schemaVersion: 3,
    action,
    sessionMode: "run_persistent",
    sessionReused: true,
    sessionOperation: 2,
    sessionIdSha256: "d".repeat(64),
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: "e".repeat(64),
    browserExecutableSha256: "f".repeat(64),
    browserVersionSha256: "1".repeat(64),
    limitsSha256: "2".repeat(64),
    currentUrlSha256: "3".repeat(64),
    currentOriginSha256: "4".repeat(64),
    titleSha256: "5".repeat(64),
    pageDiagnosis: {
      status: "none",
      signalCount: 0,
      signalsSha256: "6".repeat(64),
      takeoverRecommended: false,
    },
    blockedRequestCount: 0,
    network: {
      requestCount: 1,
      connectCount: 1,
      rejectedCount: 0,
      transferredBytes: 255_486,
      destinationCount: 1,
      destinationsSha256: "7".repeat(64),
    },
    crossOriginAuthorized: false,
  };
}
