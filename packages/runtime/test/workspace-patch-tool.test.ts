import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyWorkspacePatch,
  createWorkspacePatchTool,
  workspacePatchToolCallArgumentsLedgerProjection,
  workspacePatchToolOutputLedgerProjection,
  type WorkspacePatchObserver,
} from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("workspace patch Agent tool", () => {
  it("leaves the workspace unchanged when pre-write diagnostics fail", async () => {
    const fixture = await createFixture();
    const target = path.join(fixture.workspaceRoot, "target.ts");
    const source = "export const value: string = 42;\n";
    await writeFile(target, source);
    const digest = sha256(source);
    const observer: WorkspacePatchObserver = {
      supports: () => true,
      async observeBefore() {
        throw new Error("pre-write language server unavailable");
      },
      async observeAfter() {
        throw new Error("must not observe after a rejected preflight");
      },
    };
    const tool = createTool(fixture, observer);

    await expect(
      tool.execute("patch-preflight", {
        operation: "replace",
        path: "target.ts",
        expectedSha256: digest,
        edits: [{ oldText: "42", newText: "'ok'" }],
      }),
    ).rejects.toThrow("pre-write language server unavailable");
    expect(await readFile(target, "utf8")).toBe(source);
  });

  it("reports unavailable post-write diagnostics without hiding the committed write", async () => {
    const fixture = await createFixture();
    const target = path.join(fixture.workspaceRoot, "private-target.ts");
    const source = "export const value: string = 42;\n";
    const updated = "export const value: string = 'ok';\n";
    await writeFile(target, source);
    const sourceSha256 = sha256(source);
    const updatedSha256 = sha256(updated);
    const observer: WorkspacePatchObserver = {
      supports: () => true,
      async observeBefore() {
        return { fileSha256: sourceSha256, opaque: {} };
      },
      async observeAfter() {
        throw new Error("PRIVATE_SERVER_FAILURE");
      },
    };
    const tool = createTool(fixture, observer);
    const args = {
      operation: "replace" as const,
      path: "private-target.ts",
      expectedSha256: sourceSha256,
      edits: [{ oldText: "42", newText: "'ok'" }],
    };

    const result = await tool.execute("patch-postflight", args);

    expect(await readFile(target, "utf8")).toBe(updated);
    expect(result.details).toEqual(
      expect.objectContaining({
        kind: "napier.workspace-patch",
        schemaVersion: 1,
        afterSha256: updatedSha256,
        diagnostics: expect.objectContaining({
          status: "unavailable",
          expectedFileSha256: updatedSha256,
          errorSha256: sha256("PRIVATE_SERVER_FAILURE"),
        }),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(result.details).not.toHaveProperty("path");
    const output =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(output).not.toContain("PRIVATE_SERVER_FAILURE");
    expect(output).toContain(sha256("PRIVATE_SERVER_FAILURE"));
    expect(
      workspacePatchToolCallArgumentsLedgerProjection(args),
    ).not.toHaveProperty("path");
    const durable = workspacePatchToolOutputLedgerProjection(output, result);
    expect(durable).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        resultSha256: result.details.resultSha256,
      }),
    );
    expect(JSON.stringify(durable)).not.toContain("PRIVATE");
  });

  it("honors cancellation after preflight and before commit", async () => {
    const fixture = await createFixture();
    const target = path.join(fixture.workspaceRoot, "cancelled.ts");
    const source = "export const value = 0;\n";
    const sourceSha256 = sha256(source);
    await writeFile(target, source);
    const controller = new AbortController();
    const observer: WorkspacePatchObserver = {
      supports: () => true,
      async observeBefore() {
        controller.abort();
        return { fileSha256: sourceSha256, opaque: {} };
      },
      async observeAfter() {
        throw new Error("must not run");
      },
    };
    const tool = createTool(fixture, observer);

    await expect(
      tool.execute(
        "patch-cancelled",
        {
          operation: "replace",
          path: "cancelled.ts",
          expectedSha256: sourceSha256,
          edits: [{ oldText: "= 0", newText: "= 1" }],
        },
        controller.signal,
      ),
    ).rejects.toThrow("aborted before commit");
    expect(await readFile(target, "utf8")).toBe(source);
  });

  it("does not launch diagnostics for unsupported files", async () => {
    const fixture = await createFixture();
    const target = path.join(fixture.workspaceRoot, "notes.md");
    const source = "# Draft\n";
    await writeFile(target, source);
    let observations = 0;
    const observer: WorkspacePatchObserver = {
      supports: () => false,
      async observeBefore() {
        observations += 1;
        throw new Error("unexpected");
      },
      async observeAfter() {
        observations += 1;
        throw new Error("unexpected");
      },
    };
    const tool = createTool(fixture, observer);

    const result = await tool.execute("patch-markdown", {
      operation: "replace",
      path: "notes.md",
      expectedSha256: sha256(source),
      edits: [{ oldText: "Draft", newText: "Final" }],
    });

    expect(observations).toBe(0);
    expect(await readFile(target, "utf8")).toBe("# Final\n");
    expect(result.details).not.toHaveProperty("diagnostics");
  });

  it("preserves the patch CAS winner under concurrent preflight observations", async () => {
    const fixture = await createFixture();
    const target = path.join(fixture.workspaceRoot, "counter.ts");
    const source = "export const value = 0;\n";
    const sourceSha256 = sha256(source);
    await writeFile(target, source);
    let postObservations = 0;
    const observer: WorkspacePatchObserver = {
      supports: () => true,
      async observeBefore() {
        return { fileSha256: sourceSha256, opaque: {} };
      },
      async observeAfter(input) {
        postObservations += 1;
        return cleanObservation(input.expectedSha256);
      },
    };
    const tool = createTool(fixture, observer);

    const results = await Promise.allSettled([
      tool.execute("patch-one", {
        operation: "replace",
        path: "counter.ts",
        expectedSha256: sourceSha256,
        edits: [{ oldText: "= 0", newText: "= 1" }],
      }),
      tool.execute("patch-two", {
        operation: "replace",
        path: "counter.ts",
        expectedSha256: sourceSha256,
        edits: [{ oldText: "= 0", newText: "= 2" }],
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(postObservations).toBe(1);
    expect([
      "export const value = 1;\n",
      "export const value = 2;\n",
    ]).toContain(await readFile(target, "utf8"));
  });
});

async function createFixture(): Promise<{
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-patch-tool-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await Promise.all([
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(dataRoot, { recursive: true }),
  ]);
  return { workspaceRoot, dataRoot };
}

function createTool(
  fixture: { workspaceRoot: string; dataRoot: string },
  observer: WorkspacePatchObserver,
) {
  return createWorkspacePatchTool({
    ...fixture,
    observer,
    applyPatch: applyWorkspacePatch,
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cleanObservation(expectedFileSha256: string) {
  return {
    summary: "Patch diagnostics: clean",
    details: {
      kind: "napier.workspace-patch-diagnostics" as const,
      schemaVersion: 1 as const,
      status: "clean" as const,
      expectedFileSha256,
      observedFileSha256: expectedFileSha256,
      durationMs: 0,
      resultSha256: sha256(expectedFileSha256),
    },
  };
}
