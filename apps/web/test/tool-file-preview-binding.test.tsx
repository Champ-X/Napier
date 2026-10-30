import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceFileInspector } from "../src/WorkspaceFileInspector";
import type { WorkspaceFilePreview } from "../src/workspace-directory-api";

const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
const hash = createHash("sha256").update("x").digest("hex");
function binding() {
  return {
    sourceEventId: "event_one",
    receipt: {
      threadId: "thread_one",
      runId: "run_one",
      operationId: "call_one",
      path: "report.txt",
      fileSha256: hash,
      fileBytes: 1,
      toolName: "research_source" as const,
      action: "verify_report" as const,
      materialization: "observed" as const,
      evidence: "Report bytes verified.",
    },
  };
}
function preview(): WorkspaceFilePreview {
  return {
    path: "/workspace/report.txt",
    filename: "report.txt",
    contentType: "text/plain",
    text: "x",
    blob: new Blob(["x"]),
    sizeBytes: 1,
    sha256: hash,
  };
}
function dom() {
  const parsed = parseHTML('<html><body><div id="root"></div></body></html>');
  for (const [key, value] of Object.entries({
    document: parsed.document,
    window: parsed.window,
    navigator: parsed.window.navigator,
    HTMLElement: parsed.window.HTMLElement,
    Event: parsed.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    vi.stubGlobal(key, value);
  const container = parsed.document.querySelector("#root") as HTMLElement;
  const root = createRoot(container);
  roots.push(root);
  return { container, root };
}
async function until(assertion: () => boolean) {
  for (let i = 0; i < 30; i++) {
    if (assertion()) return;
    await act(async () => Promise.resolve());
  }
  throw new Error("Preview did not settle");
}
it("shows recorded integrity only after a bound tool file's verified bytes load", async () => {
  const { root, container } = dom();
  await act(async () =>
    root.render(
      <WorkspaceFileInspector
        path="report.txt"
        threadId="thread_one"
        expectedSha256={hash}
        {...{ toolFileBinding: binding() }}
        onClose={() => undefined}
        onContinueEditing={() => undefined}
        previewFile={async () => preview()}
      />,
    ),
  );
  await until(() => container.textContent?.includes("1 bytes") === true);
  expect(container.textContent).toContain("File integrity recorded");
  expect(container.textContent).not.toContain("File verification pending");
});

it.each(["digest", "size"])(
  "refuses a loaded %s mismatch instead of recording integrity",
  async (mismatch) => {
    const { root, container } = dom();
    const result = preview();
    if (mismatch === "digest") result.sha256 = "b".repeat(64);
    else result.sizeBytes = 2;
    await act(async () =>
      root.render(
        <WorkspaceFileInspector
          path="report.txt"
          threadId="thread_one"
          expectedSha256={hash}
          toolFileBinding={binding()}
          onClose={() => undefined}
          onContinueEditing={() => undefined}
          previewFile={async () => result}
        />,
      ),
    );
    await until(() => Boolean(container.querySelector("[role=alert]")));
    expect(container.textContent).toContain(
      "The file changed since inspection",
    );
    expect(container.textContent).not.toContain("File integrity recorded");
  },
);
it.each(["reference", "thread", "path"])(
  "keeps %s without matching tool provenance pending",
  async (kind) => {
    const { root, container } = dom();
    const selected = binding();
    if (kind === "thread") selected.receipt.threadId = "thread_other";
    if (kind === "path") selected.receipt.path = "other.txt";
    await act(async () =>
      root.render(
        <WorkspaceFileInspector
          path="report.txt"
          threadId="thread_one"
          expectedSha256={hash}
          {...(kind !== "reference" ? { toolFileBinding: selected } : {})}
          onClose={() => undefined}
          onContinueEditing={() => undefined}
          previewFile={async () => preview()}
        />,
      ),
    );
    await until(() => container.textContent?.includes("1 bytes") === true);
    expect(container.textContent).toContain("File verification pending");
    expect(container.textContent).not.toContain("File integrity recorded");
  },
);
it.each(["runId", "operationId"] as const)(
  "invalidates already loaded bytes when the same path/hash changes %s",
  async (field) => {
    const { root, container } = dom();
    const pending: Array<(result: WorkspaceFilePreview) => void> = [];
    const previewFile = vi.fn(
      () =>
        new Promise<WorkspaceFilePreview>((resolve) => pending.push(resolve)),
    );
    const render = async (selected: ReturnType<typeof binding>) =>
      act(async () =>
        root.render(
          <WorkspaceFileInspector
            path="report.txt"
            threadId="thread_one"
            expectedSha256={hash}
            toolFileBinding={selected}
            onClose={() => undefined}
            onContinueEditing={() => undefined}
            previewFile={previewFile}
          />,
        ),
      );
    const initial = binding();
    await render(initial);
    expect(container.textContent).toContain("File verification pending");
    await act(async () => pending[0]!(preview()));
    await until(
      () => container.textContent?.includes("File integrity recorded") === true,
    );
    const next = binding();
    next.receipt[field] = "new_identity";
    await render(next);
    expect(previewFile).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("File integrity recorded");
    await act(async () => pending[1]!(preview()));
    await until(
      () => container.textContent?.includes("File integrity recorded") === true,
    );
  },
);
it("ignores an old operation response arriving after the new selection", async () => {
  const { root, container } = dom();
  const pending: Array<{
    resolve: (result: WorkspaceFilePreview) => void;
    signal: AbortSignal | undefined;
  }> = [];
  const previewFile = vi.fn(
    (_path: string, signal?: AbortSignal) =>
      new Promise<WorkspaceFilePreview>((resolve) =>
        pending.push({ resolve, signal }),
      ),
  );
  const render = async (selected: ReturnType<typeof binding>) =>
    act(async () =>
      root.render(
        <WorkspaceFileInspector
          path="report.txt"
          threadId="thread_one"
          expectedSha256={hash}
          toolFileBinding={selected}
          onClose={() => undefined}
          onContinueEditing={() => undefined}
          previewFile={previewFile}
        />,
      ),
    );
  await render(binding());
  const next = binding();
  next.receipt.operationId = "call_two";
  next.sourceEventId = "event_two";
  await render(next);
  expect(pending[0]!.signal?.aborted).toBe(true);
  await act(async () => pending[0]!.resolve(preview()));
  expect(container.textContent).not.toContain("File integrity recorded");
  await act(async () => pending[1]!.resolve(preview()));
  await until(
    () => container.textContent?.includes("File integrity recorded") === true,
  );
});
it("drops recorded status during a fresh reload and keeps a failed reload pending", async () => {
  const { root, container } = dom();
  let rejectReload: (reason: Error) => void = () => undefined;
  const previewFile = vi
    .fn()
    .mockResolvedValueOnce(preview())
    .mockImplementationOnce(
      () =>
        new Promise<WorkspaceFilePreview>((_resolve, reject) => {
          rejectReload = reject;
        }),
    );
  await act(async () =>
    root.render(
      <WorkspaceFileInspector
        path="report.txt"
        threadId="thread_one"
        expectedSha256={hash}
        toolFileBinding={binding()}
        onClose={() => undefined}
        onContinueEditing={() => undefined}
        previewFile={previewFile}
      />,
    ),
  );
  await until(
    () => container.textContent?.includes("File integrity recorded") === true,
  );
  const refresh = container.querySelector(
    'button[aria-label="Refresh"]',
  ) as HTMLButtonElement;
  expect(refresh).not.toBeNull();
  await act(async () => refresh.click());
  expect(container.textContent).not.toContain("File integrity recorded");
  await act(async () => rejectReload(new Error("Preview unavailable")));
  await until(() => Boolean(container.querySelector("[role=alert]")));
  expect(container.textContent).not.toContain("File integrity recorded");
});
