import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listWorkspaceEntries } = vi.hoisted(() => ({
  listWorkspaceEntries: vi.fn(),
}));

vi.mock("../src/workspace-directory-api", () => ({
  listWorkspaceEntries,
}));

import { WorkspaceFileTree } from "../src/WorkspaceFileTree";

const roots: Root[] = [];

beforeEach(() => {
  listWorkspaceEntries.mockReset();
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("WorkspaceFileTree", () => {
  it("loads every page of a large folder without duplicating entries", async () => {
    listWorkspaceEntries
      .mockResolvedValueOnce(
        listing([file("/workspace/alpha.txt")], "/workspace/alpha.txt"),
      )
      .mockResolvedValueOnce(
        listing(
          [file("/workspace/alpha.txt"), file("/workspace/beta.txt")],
          null,
        ),
      );
    const container = await mountTree();

    const loadMore = findElementsByLocalName(container, "button").find(
      (button) => /load more|加载更多/iu.test(button.textContent ?? ""),
    ) as HTMLButtonElement | undefined;
    expect(loadMore).toBeTruthy();
    await act(async () => loadMore?.click());

    expect(listWorkspaceEntries).toHaveBeenNthCalledWith(
      2,
      "/workspace",
      "/workspace/alpha.txt",
    );
    expect(container.textContent).toContain("alpha.txt");
    expect(container.textContent).toContain("beta.txt");
    expect(
      findElementsByLocalName(container, "button").filter((element) =>
        element.classList.contains("is-file"),
      ),
    ).toHaveLength(2);
    expect(
      findElementsByLocalName(container, "span").filter((element) =>
        element.classList.contains("is-file"),
      ),
    ).toHaveLength(0);
  });

  it("opens an ordinary workspace file even when it is not a plan output", async () => {
    listWorkspaceEntries.mockResolvedValueOnce(
      listing([file("/workspace/notes.txt")], null),
    );
    const onOpenFile = vi.fn();
    const container = await mountTree(true, onOpenFile);

    const fileButton = findElementsByLocalName(container, "button").find(
      (element) => element.classList.contains("is-file"),
    ) as HTMLButtonElement | undefined;
    await act(async () => fileButton?.click());

    expect(onOpenFile).toHaveBeenCalledWith("/workspace/notes.txt");
  });

  it("ignores a stale request after refresh and clears its busy state", async () => {
    const first = deferred<ReturnType<typeof listing>>();
    listWorkspaceEntries
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(listing([file("/workspace/fresh.txt")], null));
    const container = await mountTree(false);

    const refresh = container.querySelector<HTMLButtonElement>(
      ".workspace-file-tree-refresh",
    );
    await act(async () => refresh?.click());
    first.resolve(listing([file("/workspace/stale.txt")], null));
    await act(async () => first.promise);

    expect(container.textContent).toContain("fresh.txt");
    expect(container.textContent).not.toContain("stale.txt");
    expect(
      container
        .querySelector(".workspace-file-tree")
        ?.getAttribute("aria-busy"),
    ).toBe("false");
  });
});

async function mountTree(
  flush = true,
  onOpenFile: (path: string) => void = () => undefined,
): Promise<HTMLElement> {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.getElementById("app") as unknown as HTMLElement;
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <WorkspaceFileTree
        workspaceRoot="/workspace"
        openablePaths={[]}
        onOpenFile={onOpenFile}
      />,
    );
    if (flush) await Promise.resolve();
  });
  return container;
}

function listing(
  entries: Array<ReturnType<typeof file>>,
  nextCursor: string | null,
) {
  return {
    path: "/workspace",
    parent: null,
    entries,
    truncated: nextCursor !== null,
    nextCursor,
  };
}

function file(path: string) {
  return {
    name: path.split("/").at(-1) ?? path,
    path,
    kind: "file" as const,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

function findElementsByLocalName(root: Element, localName: string): Element[] {
  const matches: Element[] = [];
  for (const child of Array.from(root.children)) {
    if (typeof child.localName === "string" && child.localName === localName) {
      matches.push(child);
    }
    matches.push(...findElementsByLocalName(child, localName));
  }
  return matches;
}
