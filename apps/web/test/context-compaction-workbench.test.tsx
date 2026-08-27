import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ContextCompactionForkResult,
  ContextCompactionPreview,
} from "@napier/contracts/context-compaction";

const containers: HTMLElement[] = [];

afterEach(async () => {
  for (const container of containers.splice(0)) {
    await act(async () => render(null, container));
  }
  vi.unstubAllGlobals();
});

describe("ContextCompactionWorkbenchPanel", () => {
  it("previews evidence, applies a fork, and opens the target Thread", async () => {
    const container = installChineseDom();
    const { ContextCompactionWorkbenchPanel } =
      await import("../src/ContextCompactionWorkbenchPanel");
    const previewRequest = vi.fn(async () => preview);
    const applyRequest = vi.fn(async () => forkResult);
    const onOpenThread = vi.fn(async () => undefined);
    const onRefresh = vi.fn(async () => undefined);

    await act(async () => {
      render(
        <ContextCompactionWorkbenchPanel
          threadId={preview.sourceThreadId}
          threadTitle="Workbench task"
          messageCount={14}
          model={{
            key: "openai/gpt-5.2",
            provider: "openai",
            id: "gpt-5.2",
            label: "OpenAI / GPT-5.2",
            configured: true,
            known: true,
          }}
          running={false}
          onOpenThread={onOpenThread}
          onRefresh={onRefresh}
          previewRequest={previewRequest}
          applyRequest={applyRequest}
        />,
        container,
      );
    });

    expect(container.textContent).toContain("源会话记录始终保持不变");
    const previewButton = buttonById("context-compaction-preview-action");
    await act(async () => {
      previewButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(previewRequest).toHaveBeenCalledWith(preview.sourceThreadId, {
      retainedMessageCount: 10,
      model: { provider: "openai", id: "gpt-5.2" },
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(preview.summary);
    expect(container.textContent).toContain(preview.decisions[0]);
    expect(container.textContent).toContain(preview.openLoops[0]);
    expect(container.textContent).toContain(preview.artifacts[0]);

    const applyButton = buttonById("context-compaction-apply-action");
    expect(applyButton.disabled).toBe(false);
    await act(async () => {
      applyButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(applyRequest).toHaveBeenCalledWith(preview.sourceThreadId, {
      expectedPreviewSha256: preview.previewSha256,
      title: "Workbench task / compacted",
    });
    expect(onOpenThread).toHaveBeenCalledWith(forkResult.targetThreadId);
  });

  it("disables preview when the source has too few messages", async () => {
    const container = installChineseDom();
    const { ContextCompactionWorkbenchPanel } =
      await import("../src/ContextCompactionWorkbenchPanel");
    await act(async () => {
      render(
        <ContextCompactionWorkbenchPanel
          threadId={preview.sourceThreadId}
          messageCount={2}
          model={{
            key: "openai/gpt-5.2",
            provider: "openai",
            id: "gpt-5.2",
            label: "OpenAI / GPT-5.2",
            configured: true,
            known: true,
          }}
          running={false}
          onOpenThread={() => undefined}
          onRefresh={async () => undefined}
        />,
        container,
      );
    });

    expect(container.textContent).toContain("至少需要三条消息");
    expect(buttonById("context-compaction-preview-action").disabled).toBe(true);
  });
});

const preview: ContextCompactionPreview = {
  kind: "napier.context-compaction-preview",
  schemaVersion: 1,
  previewRunId: "run_preview_12345678",
  sourceThreadId: "thread_source12345678",
  sourceEventCount: 24,
  sourceEventSetSha256: "1".repeat(64),
  fromSeq: 2,
  toSeq: 12,
  retainedFromSeq: 14,
  sourceMessageCount: 8,
  sourceMessageSha256: "2".repeat(64),
  continuityEventCount: 2,
  continuitySha256: "3".repeat(64),
  retainedMessageCount: 10,
  model: { provider: "openai", id: "gpt-5.2" },
  summary: "已完成实现，下一步验证桌面布局。",
  decisions: ["源会话保持不变。"],
  openLoops: ["执行浏览器验收。"],
  artifacts: ["apps/web/src/ContextCompactionWorkbenchPanel.tsx"],
  previewSha256: "4".repeat(64),
};

const checkpointContent = {
  summary: preview.summary,
  decisions: preview.decisions,
  openLoops: preview.openLoops,
  artifacts: preview.artifacts,
};

const forkResult: ContextCompactionForkResult = {
  kind: "napier.context-compaction-fork-result",
  schemaVersion: 1,
  sourceThreadId: preview.sourceThreadId,
  targetThreadId: "thread_target12345678",
  previewSha256: preview.previewSha256,
  checkpoint: {
    schemaVersion: 1,
    checkpointId: "checkpoint_12345678",
    fromSeq: 2,
    toSeq: 9,
    retainedFromSeq: 11,
    sourceEventCount: 8,
    sourceSha256: "5".repeat(64),
    summarySha256: "6".repeat(64),
    continuityProjectionVersion: 1,
    continuityEventCount: 2,
    continuitySha256: "7".repeat(64),
    ...checkpointContent,
  },
};

function buttonById(id: string): HTMLButtonElement {
  const button = document.getElementById(id);
  if (!button) throw new Error(`Button not found: ${id}`);
  return button as HTMLButtonElement;
}

function installChineseDom(): HTMLElement {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: () => "zh" },
  });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.getElementById("app") as unknown as HTMLElement;
  containers.push(container);
  return container;
}
