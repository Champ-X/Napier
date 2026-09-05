import { describe, expect, it } from "vitest";

import { createOwnedToolRecordV2 } from "../src/tool-protocol-registry.js";
import {
  createWorkspaceFileApplyTool,
  createWorkspaceFilePreviewTool,
} from "../src/workspace-file-tools.js";
import type { WorkspaceFileMutationManager } from "../src/workspace-file-mutations.js";
import { createWorkspacePatchTool } from "../src/workspace-patch-tool.js";
import { projectHostProgressEffect } from "../src/run-progress-host-effects.js";
import { createWorkspaceProcessTool } from "../src/workspace-process-tool.js";
import type { WorkspaceProcessManager } from "../src/workspace-processes.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

describe("workspace Tool Progress Protocol", () => {
  it("binds successful patches to a workspace path and its resulting content", () => {
    const patch = createOwnedToolRecordV2(
      createWorkspacePatchTool({
        workspaceRoot: "/workspace",
        dataRoot: "/data",
        async applyPatch() {
          throw new Error("not used by progress resolution");
        },
      }),
    );
    const input = {
      operation: "create",
      path: "src/result.ts",
      expectedSha256: null,
      content: "export const result = 1;\n",
    };
    const first = patch.progress(
      input,
      result({
        pathSha256: HASH_A,
        operation: "create",
        beforeSha256: null,
        afterSha256: HASH_B,
        beforeBytes: 0,
        afterBytes: 25,
        editCount: 1,
        resultSha256: HASH_C,
      }),
    );
    const repeated = patch.progress(
      input,
      result({
        pathSha256: HASH_A,
        operation: "create",
        beforeSha256: null,
        afterSha256: HASH_B,
        beforeBytes: 0,
        afterBytes: 25,
        editCount: 1,
        resultSha256: HASH_D,
      }),
    );
    const changedContent = patch.progress(
      input,
      result({ afterSha256: HASH_C }),
    );
    const changedPath = patch.progress(
      { ...input, path: "src/other.ts" },
      result({ afterSha256: HASH_B }),
    );

    expect(patch.definition.progress.operations).toEqual(["mutate"]);
    expect(first).toEqual(
      expect.objectContaining({
        operation: "mutate",
        scope: "workspace",
        contribution: "product",
        resourceKeySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        stateSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(repeated.resourceKeySha256).toBe(first.resourceKeySha256);
    expect(repeated.stateSha256).toBe(first.stateSha256);
    expect(changedContent.stateSha256).not.toBe(first.stateSha256);
    expect(changedPath.resourceKeySha256).not.toBe(first.resourceKeySha256);
    expect(patch.progress(input).stateSha256).toBeUndefined();
    expect(
      patch.progress(input, result({ afterSha256: HASH_B }), true),
    ).not.toHaveProperty("stateSha256");
  });

  it("keeps file previews neutral and binds applies to the observed target state", () => {
    const manager = {} as WorkspaceFileMutationManager;
    const owner = { threadId: "thread_fixture", runId: "run_fixture" };
    const preview = createOwnedToolRecordV2(
      createWorkspaceFilePreviewTool(manager, owner),
    );
    const apply = createOwnedToolRecordV2(
      createWorkspaceFileApplyTool(manager, owner),
    );

    expect(
      preview.invocation({
        action: "preview",
        operation: "move",
        sourcePath: "draft.md",
        destinationPath: "final.md",
      }).progress,
    ).toEqual(
      expect.objectContaining({
        operation: "observe",
        scope: "workspace",
        contribution: "neutral",
      }),
    );
    expect(
      preview.progress(
        { action: "list_trash" },
        result({ status: "listed", resultSha256: HASH_A }),
      ),
    ).not.toHaveProperty("stateSha256");

    const input = { previewId: "filepreview_fixture1" };
    const first = apply.progress(
      input,
      result({
        action: "apply",
        status: "applied",
        operation: "move",
        destinationPathSha256: HASH_A,
        afterSha256: HASH_B,
        resultSha256: HASH_C,
      }),
    );
    const repeated = apply.progress(
      input,
      result({
        action: "apply",
        status: "applied",
        operation: "move",
        destinationPathSha256: HASH_A,
        afterSha256: HASH_B,
        resultSha256: HASH_C,
      }),
    );
    const differentResult = apply.progress(
      input,
      result({
        action: "apply",
        status: "applied",
        operation: "move",
        destinationPathSha256: HASH_A,
        afterSha256: HASH_B,
        resultSha256: HASH_D,
      }),
    );
    const differentTarget = apply.progress(
      input,
      result({
        action: "apply",
        status: "applied",
        operation: "move",
        destinationPathSha256: HASH_D,
        afterSha256: HASH_B,
        resultSha256: HASH_C,
      }),
    );

    expect(first).toEqual(
      expect.objectContaining({
        operation: "mutate",
        scope: "workspace",
        contribution: "product",
        resourceKeySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        stateSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(repeated).toEqual(first);
    expect(differentResult.stateSha256).not.toBe(first.stateSha256);
    expect(differentTarget.resourceKeySha256).toBe(first.resourceKeySha256);
    expect(differentTarget.stateSha256).not.toBe(first.stateSha256);
  });

  it("recognizes product progress only after a scoped process write settles and verifies", () => {
    const process = createOwnedToolRecordV2(
      createWorkspaceProcessTool({} as WorkspaceProcessManager, {
        threadId: "thread_fixture",
        runId: "run_fixture",
      }),
    );
    const input = { action: "poll", processId: "process_fixture1" };
    const terminalWrite = {
      action: "poll",
      processId: "process_fixture1",
      status: "succeeded",
      workspaceAccess: "scoped_write",
      writeScopeSetSha256: HASH_A,
      workspaceDeltaStatus: "changed",
      workspaceWriteScopeStatus: "within_scope",
      workspaceChangedFileCount: 2,
      resultSha256: HASH_B,
    };

    expect(process.definition.progress.operations).toEqual([
      "observe",
      "mutate",
    ]);
    expect(process.invocation(input).progress).toEqual(
      expect.objectContaining({
        operation: "observe",
        scope: "session",
        contribution: "neutral",
      }),
    );
    expect(
      process.progress(input, result({ ...terminalWrite, status: "running" })),
    ).toEqual(
      expect.objectContaining({
        operation: "observe",
        contribution: "neutral",
      }),
    );
    expect(
      process.progress(
        input,
        result({ ...terminalWrite, workspaceAccess: "read_only" }),
      ),
    ).toEqual(
      expect.objectContaining({
        operation: "observe",
        contribution: "neutral",
      }),
    );
    expect(
      process.progress(
        input,
        result({
          ...terminalWrite,
          workspaceWriteScopeStatus: "outside_scope",
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        operation: "observe",
        contribution: "neutral",
      }),
    );
    expect(
      process.progress(
        input,
        result({ ...terminalWrite, workspaceDeltaStatus: "unchanged" }),
      ),
    ).toEqual(
      expect.objectContaining({
        operation: "observe",
        contribution: "neutral",
      }),
    );

    const completed = process.progress(input, result(terminalWrite));
    const repeated = process.progress(
      { action: "cancel", processId: "process_fixture1" },
      result({ ...terminalWrite, action: "cancel", resultSha256: HASH_D }),
    );
    const nextProcess = process.progress(
      { action: "poll", processId: "process_fixture2" },
      result({ ...terminalWrite, processId: "process_fixture2" }),
    );

    expect(completed).toEqual(
      expect.objectContaining({
        operation: "observe",
        scope: "session",
        contribution: "neutral",
        resourceKeySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(repeated.resourceKeySha256).toBe(completed.resourceKeySha256);
    expect(nextProcess.resourceKeySha256).not.toBe(completed.resourceKeySha256);

    const canonicalEffect = projectHostProgressEffect(
      { type: "workspace.process.settled" } as never,
      {
        id: "process_fixture1",
        status: "succeeded",
        workspaceAccess: "scoped_write",
        writeScopeSetSha256: HASH_A,
        workspaceDeltaStatus: "changed",
        workspaceWriteScopeStatus: "within_scope",
        workspaceAfterSha256: HASH_B,
      },
    );
    expect(canonicalEffect).toEqual(
      expect.objectContaining({
        operation: "mutate",
        scope: "workspace",
        contribution: "product",
        resourceKeySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        stateSha256: HASH_B,
      }),
    );
  });
});

function result(details: Record<string, unknown>) {
  return {
    content: [],
    details,
  };
}
