import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useExperimentDeskLifecycle } from "../src/use-experiment-desk-lifecycle";

interface Checkpoint {
  key: string;
  value: string;
}

interface Request {
  value: string;
}

interface Preview {
  previewSha256: string;
}

interface Result {
  targetThreadId: string;
}

const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("useExperimentDeskLifecycle", () => {
  it("binds preview and execution to the selected checkpoint", async () => {
    const previewRequest = vi.fn(
      async (request: Request): Promise<Preview> => ({
        previewSha256: `preview-${request.value}`,
      }),
    );
    const executeRequest = vi.fn(
      async (
        request: Request,
        preview: Preview,
        onFrame: () => void,
      ): Promise<Result> => {
        onFrame();
        onFrame();
        return {
          targetThreadId: `${request.value}:${preview.previewSha256}`,
        };
      },
    );
    const probe = await mountProbe({ previewRequest, executeRequest });

    expect(probe.read().checkpoint?.key).toBe("second");
    await act(async () => probe.read().previewExperiment());
    expect(previewRequest).toHaveBeenCalledWith(
      { value: "two" },
      expect.any(AbortSignal),
    );
    expect(probe.read().preview?.previewSha256).toBe("preview-two");

    await act(async () => probe.read().executeExperiment());
    expect(executeRequest).toHaveBeenCalledWith(
      { value: "two" },
      { previewSha256: "preview-two" },
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(probe.read().result?.targetThreadId).toBe("two:preview-two");
    expect(probe.read().streamedFrameCount).toBe(2);
  });

  it("aborts invalidated work and ignores a late preview response", async () => {
    let settlePreview!: (preview: Preview) => void;
    let observedSignal: AbortSignal | undefined;
    const previewRequest = vi.fn((_request: Request, signal: AbortSignal) => {
      observedSignal = signal;
      return new Promise<Preview>((resolve) => {
        settlePreview = resolve;
      });
    });
    const probe = await mountProbe({
      previewRequest,
      executeRequest: vi.fn(async () => ({ targetThreadId: "unused" })),
    });

    let pending!: Promise<void>;
    await act(async () => {
      pending = probe.read().previewExperiment();
      await Promise.resolve();
    });
    expect(probe.read().busy).toBe("preview");

    await act(async () => probe.read().invalidatePreview());
    expect(observedSignal?.aborted).toBe(true);
    settlePreview({ previewSha256: "late" });
    await act(async () => pending);

    expect(probe.read().preview).toBeUndefined();
    expect(probe.read().busy).toBeUndefined();
  });

  it("resets state and aborts active work when the source thread changes", async () => {
    let observedSignal: AbortSignal | undefined;
    const probe = await mountProbe({
      previewRequest: (_request, signal) => {
        observedSignal = signal;
        return new Promise<Preview>(() => undefined);
      },
      executeRequest: vi.fn(async () => ({ targetThreadId: "unused" })),
    });

    await act(async () => {
      void probe.read().previewExperiment();
      await Promise.resolve();
    });
    await probe.render({
      threadId: "thread-2",
      checkpoints: [{ key: "third", value: "three" }],
    });

    expect(observedSignal?.aborted).toBe(true);
    expect(probe.read().checkpointKey).toBe("third");
    expect(probe.read().preview).toBeUndefined();
    expect(probe.read().busy).toBeUndefined();
    expect(probe.read().error).toBeUndefined();
  });

  it("retains source-running and preview-required errors", async () => {
    const probe = await mountProbe({
      previewRequest: vi.fn(async () => ({ previewSha256: "preview" })),
      executeRequest: vi.fn(async () => ({ targetThreadId: "unused" })),
    });

    await act(async () => probe.read().executeExperiment());
    expect(probe.read().error).toBe("preview required");

    await probe.render({ running: true });
    await act(async () => probe.read().executeExperiment());
    expect(probe.read().error).toBe("source running");
  });
});

async function mountProbe(input: {
  previewRequest(request: Request, signal: AbortSignal): Promise<Preview>;
  executeRequest(
    request: Request,
    preview: Preview,
    onFrame: () => void,
    signal: AbortSignal,
  ): Promise<Result>;
}) {
  const container = installDom();
  const root = createRoot(container);
  roots.push(root);
  const defaults = {
    threadId: "thread-1",
    checkpoints: [
      { key: "first", value: "one" },
      { key: "second", value: "two" },
    ] satisfies Checkpoint[],
    running: false,
  };
  let props = defaults;
  let reading!: ReturnType<
    typeof useExperimentDeskLifecycle<Checkpoint, Request, Preview, Result>
  >;

  function Probe() {
    reading = useExperimentDeskLifecycle({
      ...props,
      sourceRunningError: "source running",
      previewRequiredError: "preview required",
      buildRequest: (checkpoint) => ({ value: checkpoint.value }),
      previewRequest: input.previewRequest,
      executeRequest: input.executeRequest,
    });
    return <div />;
  }

  const render = async (next: Partial<typeof defaults> = {}) => {
    props = { ...props, ...next };
    await act(async () => root.render(<Probe />));
  };
  await render();

  return {
    read: () => reading,
    render,
  };
}

function installDom(): HTMLElement {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("AbortSignal", globalThis.AbortSignal);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return document.getElementById("app") as HTMLElement;
}
