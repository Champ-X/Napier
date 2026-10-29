import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlanArtifactTextPeek } from "../src/artifact-file-api";
import { ArtifactInlinePreview } from "../src/ArtifactInlinePreview";
import type { ConversationArtifact } from "../src/conversation-artifact-view-model";

const containers: HTMLElement[] = [];

afterEach(async () => {
  await Promise.all(
    containers.splice(0).map(async (container) => {
      await act(async () => render(null, container));
    }),
  );
  vi.unstubAllGlobals();
});

describe("ArtifactInlinePreview", () => {
  it("reloads when only the selected digest changes and ignores the old pending response", async () => {
    const container = installDom();
    const first = artifact();
    first.artifact.sha256 = "b".repeat(64);
    const next = structuredClone(first);
    next.artifact.sha256 = "d".repeat(64);
    let finishOld!: (value: PlanArtifactTextPeek) => void;
    const old = new Promise<PlanArtifactTextPeek>((resolve) => {
      finishOld = resolve;
    });
    const response = (sha256: string) => ({
      kind: "napier.plan-artifact-text-peek" as const,
      schemaVersion: 1 as const,
      planId: "plan_1",
      artifactId: "report",
      planRevision: 2,
      status: "produced",
      artifactKind: "file",
      pathSha256: pathHash(first.artifact.path),
      sha256,
      sizeBytes: 100,
      lineCount: 1,
      textSha256: sha256,
      text: "<main>Report</main>",
    });
    const peekArtifact = vi
      .fn<() => Promise<ReturnType<typeof response>>>()
      .mockImplementationOnce(() => old)
      .mockResolvedValueOnce(response(next.artifact.sha256!));
    const previewFile = vi.fn(async (path: string) => ({
      path,
      filename: "report.html",
      contentType: "text/html",
      blob: new Blob([]),
      sha256: next.artifact.sha256!,
      sizeBytes: 100,
      previewUrl: "/new-preview",
    }));
    const show = async (item: ConversationArtifact) =>
      act(async () =>
        render(
          <ArtifactInlinePreview
            item={item}
            peekArtifact={peekArtifact}
            previewFile={previewFile}
          />,
          container,
        ),
      );
    await show(first);
    await show(next);
    await waitFor(() => elements(container, "iframe").length === 1);
    expect(peekArtifact).toHaveBeenCalledTimes(2);
    await act(async () => finishOld(response(first.artifact.sha256!)));
    expect(elements(container, "iframe")[0]?.getAttribute("src")).toBe(
      "/new-preview",
    );
    expect(previewFile).toHaveBeenCalledOnce();
  });

  it("does not label a newer manifest response as the selected version's live preview", async () => {
    const container = installDom();
    const item = artifact();
    const previewFile = vi.fn();
    await act(async () => {
      render(
        <ArtifactInlinePreview
          item={item}
          previewFile={previewFile}
          peekArtifact={async () => ({
            kind: "napier.plan-artifact-text-peek",
            schemaVersion: 1,
            planId: item.planId,
            artifactId: item.artifact.id,
            planRevision: item.planRevision + 1,
            status: "produced",
            artifactKind: "file",
            pathSha256: pathHash("artifacts/report.html"),
            sha256: "b".repeat(64),
            sizeBytes: 100,
            lineCount: 1,
            textSha256: "c".repeat(64),
            text: "<main>New version</main>",
          })}
        />,
        container,
      );
    });
    await waitFor(
      () => container.textContent?.includes("Preview unavailable") === true,
    );
    expect(previewFile).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Live preview");
  });

  it.each([true, false])(
    "previews large HTML through a read-only file peek when size is known: %s",
    async (knownSize) => {
      const container = installDom();
      const item = artifact();
      if (knownSize) item.artifact.sizeBytes = 3 * 1024 * 1024;
      const file = {
        kind: "napier.plan-artifact-file-preview" as const,
        planId: "plan_1",
        artifactId: "report",
        planRevision: 2,
        status: "produced",
        artifactKind: "file",
        pathSha256: pathHash("artifacts/report.html"),
        path: item.artifact.path,
        filename: "report.html",
        contentType: "text/html",
        blob: new Blob(["<main>HTML</main>"]),
        sizeBytes: 3 * 1024 * 1024,
        sha256: "b".repeat(64),
      };
      const peekArtifact = vi.fn(async () => {
        throw new Error("Artifact preview exceeds the 2 MiB text limit");
      });
      const peekArtifactFile = vi.fn(async () => file);
      const previewFile = vi.fn(async () => ({
        ...file,
        previewUrl: "/api/workspace/preview/site/report.html",
      }));
      await act(async () => {
        render(
          <ArtifactInlinePreview
            item={item}
            peekArtifact={peekArtifact}
            peekArtifactFile={peekArtifactFile}
            previewFile={previewFile}
          />,
          container,
        );
      });
      await waitFor(() => elements(container, "iframe").length === 1);
      expect(peekArtifact).toHaveBeenCalledTimes(knownSize ? 0 : 1);
      expect(peekArtifactFile).toHaveBeenCalledWith(
        "thread_1",
        "plan_1",
        "report",
      );
      expect(previewFile).toHaveBeenCalledWith(
        item.artifact.path,
        expect.any(AbortSignal),
      );
      expect(
        elements(container, "iframe")[0]?.getAttribute("srcdoc"),
      ).toBeNull();
    },
  );

  it("renders a directory-scoped sandboxed thumbnail that opens the full inspector", async () => {
    const container = installDom();
    const onInspect = vi.fn();
    await act(async () => {
      render(
        <ArtifactInlinePreview
          item={artifact()}
          onInspect={onInspect}
          previewFile={async (path) => ({
            path,
            filename: "report.html",
            contentType: "text/html",
            blob: new Blob([]),
            sizeBytes: 100,
            sha256: "b".repeat(64),
            previewUrl: "/api/workspace/preview/site/report.html",
          })}
          peekArtifact={async () => ({
            kind: "napier.plan-artifact-text-peek",
            schemaVersion: 1,
            planId: "plan_1",
            artifactId: "report",
            planRevision: 2,
            status: "produced",
            artifactKind: "file",
            pathSha256: pathHash("artifacts/report.html"),
            sha256: "b".repeat(64),
            sizeBytes: 100,
            lineCount: 1,
            textSha256: "c".repeat(64),
            text: '<script>window.bad = true</script><button onclick="window.bad=true">Open</button>',
          })}
        />,
        container,
      );
    });
    await waitFor(() => elements(container, "iframe").length === 1);

    const frame = elements(container, "iframe")[0]!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("src")).toBe(
      "/api/workspace/preview/site/report.html",
    );
    expect(frame.getAttribute("srcdoc")).toBeNull();

    await act(async () => {
      (elements(container, "button")[0] as HTMLElement).click();
    });
    expect(onInspect).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "preview",
        planId: "plan_1",
        threadId: "thread_1",
      }),
    );
  });
});

function artifact(): ConversationArtifact {
  return {
    id: "event_1",
    seq: 1,
    createdAt: "2026-08-30T00:00:00.000Z",
    attemptScope: "current",
    threadId: "thread_1",
    runId: "run_1",
    planId: "plan_1",
    planRevision: 2,
    artifact: {
      id: "report",
      path: "artifacts/report.html",
      kind: "file",
      description: "Running report",
      evidence: "Produced by fixture",
      status: "produced",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:01.000Z",
    },
  };
}

function installDom(): HTMLElement {
  const parsed = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal("document", parsed.document);
  vi.stubGlobal("window", parsed.window);
  vi.stubGlobal("navigator", parsed.window.navigator);
  vi.stubGlobal("HTMLElement", parsed.window.HTMLElement);
  vi.stubGlobal("Event", parsed.window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = parsed.document.querySelector("#root") as HTMLElement;
  containers.push(container);
  return container;
}

function elements(root: Element, localName: string): Element[] {
  const matches: Element[] = [];
  for (const child of Array.from(root.children)) {
    if (child.localName === localName) matches.push(child);
    matches.push(...elements(child, localName));
  }
  return matches;
}

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (assertion()) return;
    await act(async () => Promise.resolve());
  }
  throw new Error("Timed out waiting for assertion");
}

function pathHash(path: string): string {
  return createHash("sha256").update(path).digest("hex");
}
