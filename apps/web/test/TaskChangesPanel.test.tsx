import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceTrashItem } from "@napier/contracts";
import { TaskChangesPanel } from "../src/TaskChangesPanel";
import {
  listWorkspaceTrash,
  restoreWorkspaceTrashItem,
} from "../src/workspace-file-api";

vi.mock("../src/workspace-file-api", () => ({
  listWorkspaceTrash: vi.fn(),
  restoreWorkspaceTrashItem: vi.fn(),
}));

const containers: HTMLElement[] = [];
const listTrash = vi.mocked(listWorkspaceTrash);
const restoreTrash = vi.mocked(restoreWorkspaceTrashItem);

afterEach(async () => {
  await Promise.all(
    containers.splice(0).map(async (container) => {
      await act(async () => render(null, container));
    }),
  );
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("TaskChangesPanel recovery disclosure", () => {
  it("does not advertise recovery when the managed trash is empty", async () => {
    listTrash.mockResolvedValue(trashList([]));
    const container = installDom();

    await renderPanel(container);
    await waitFor(() => listTrash.mock.calls.length === 1);
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector(".task-recovery-disclosure")).toBeNull();
    expect(container.textContent).not.toContain("Workspace recovery");
  });

  it("keeps recovery undisclosed while availability is loading", async () => {
    let resolveList!: (value: ReturnType<typeof trashList>) => void;
    listTrash.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    const container = installDom();

    await renderPanel(container);
    await waitFor(() => listTrash.mock.calls.length === 1);
    expect(container.querySelector(".task-recovery-disclosure")).toBeNull();

    resolveList(trashList([]));
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("shows recovery only when a reversible trash item exists", async () => {
    listTrash.mockResolvedValue(trashList([trashItem()]));
    const container = installDom();

    await renderPanel(container);
    await waitFor(
      () => container.querySelector(".task-recovery-disclosure") !== null,
    );

    expect(container.querySelector(".task-recovery-disclosure")).not.toBeNull();
    expect(container.textContent).toContain("artifacts/report.md");
  });

  it("reports availability errors without inventing a recovery action", async () => {
    listTrash.mockRejectedValue(new Error("offline"));
    const container = installDom();

    await renderPanel(container);
    await waitFor(
      () => container.querySelector(".task-recovery-error") !== null,
    );

    expect(container.querySelector(".task-recovery-disclosure")).toBeNull();
  });

  it("keeps the restore receipt visible after the trash becomes empty", async () => {
    listTrash
      .mockResolvedValueOnce(trashList([trashItem()]))
      .mockResolvedValueOnce(trashList([]));
    restoreTrash.mockResolvedValue({
      kind: "napier.workspace-trash-restore",
      schemaVersion: 1,
      trashId: "trash_1",
      restoredPath: "artifacts/report.md",
      evidence: {
        kind: "napier.workspace-file-mutation",
        schemaVersion: 1,
        id: "mutation_1",
        threadId: "thread_1",
        runId: "run_1",
        operation: "restore",
        initiatedBy: "operator",
        fileCount: 1,
        directoryCount: 0,
        bytes: 64,
        trashId: "trash_1",
        reversible: false,
        postcondition: "verified",
        appliedAt: "2026-08-26T00:01:00.000Z",
        contentSha256: "c".repeat(64),
      },
    });
    const container = installDom();

    await renderPanel(container);
    await waitFor(
      () => container.querySelector(".files-restore-button") !== null,
    );
    await act(async () => {
      container
        .querySelector(".files-restore-button")!
        .dispatchEvent(new Event("click", { bubbles: true }));
    });
    await waitFor(() => restoreTrash.mock.calls.length === 1);
    await waitFor(() => container.querySelector(".files-restored") !== null);

    expect(listTrash).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".task-recovery-disclosure")).not.toBeNull();
    expect(container.textContent).toContain("artifacts/report.md");
  });
});

async function renderPanel(container: HTMLElement): Promise<void> {
  await act(async () => {
    render(
      <TaskChangesPanel
        detail={
          {
            thread: { id: "thread_1" },
            plans: [],
            artifacts: [],
            citations: [],
          } as never
        }
      />,
      container,
    );
  });
}

function installDom(): HTMLElement {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  const container = document.getElementById("app") as unknown as HTMLElement;
  containers.push(container);
  return container;
}

function trashList(items: WorkspaceTrashItem[]) {
  return {
    kind: "napier.workspace-trash-list" as const,
    schemaVersion: 1 as const,
    threadId: "thread_1",
    items,
  };
}

function trashItem(): WorkspaceTrashItem {
  return {
    kind: "napier.workspace-trash-item",
    schemaVersion: 1,
    id: "trash_1",
    threadId: "thread_1",
    runId: "run_1",
    originalPath: "artifacts/report.md",
    originalPathSha256: "a".repeat(64),
    entryKind: "file",
    snapshotSha256: "b".repeat(64),
    fileCount: 1,
    directoryCount: 0,
    bytes: 64,
    trashedAt: "2026-08-26T00:00:00.000Z",
    contentSha256: "c".repeat(64),
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error("Timed out waiting for component state");
}
