import { parseHTML } from "linkedom";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationArtifact } from "../src/conversation-artifact-view-model";
import type { ConversationCitation } from "../src/conversation-citation-view-model";
import type { ConversationRecovery } from "../src/conversation-recovery-view-model";
import type { ConversationSubagent } from "../src/conversation-subagent-view-model";

const containers: HTMLElement[] = [];

describe("conversation detail Chinese copy", () => {
  afterEach(() => {
    containers.splice(0).forEach((container) => render(null, container));
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("renders delegated work without English chrome", async () => {
    const container = installChineseDom();
    const { ConversationSubagentCard } =
      await import("../src/ConversationSubagentCard");

    render(<ConversationSubagentCard item={subagentItem()} />, container);
    const markup = container.textContent ?? "";

    expect(markup).toContain("子智能体 · 审查 · 已完成");
    expect(markup).toContain("结果摘要");
    expect(markup).toContain("1 条证据 · 详情已隐藏");
    expect(markup).not.toContain("Outcome summary");
    expect(markup).not.toContain("details hidden");
  });

  it("renders artifact and citation evidence without English chrome", async () => {
    const artifactContainer = installChineseDom();
    const [{ ConversationArtifactCard }, { ConversationCitationCard }] =
      await Promise.all([
        import("../src/ConversationArtifactCard"),
        import("../src/ConversationCitationCard"),
      ]);

    render(
      <ConversationArtifactCard
        item={artifactItem()}
        threadId="thread_12345678"
        onLedgerChanged={vi.fn()}
      />,
      artifactContainer,
    );
    const artifactMarkup = artifactContainer.textContent ?? "";
    const citationContainer = installChineseDom();
    render(
      <ConversationCitationCard citation={citationItem()} index={1} />,
      citationContainer,
    );
    const citationMarkup = citationContainer.textContent ?? "";

    expect(artifactMarkup).toContain("当前 产物 · 已验证");
    expect(artifactMarkup).toContain("类型");
    expect(artifactMarkup).toContain("预览");
    expect(artifactMarkup).not.toContain("Current Artifact");
    expect(citationMarkup).toContain("引用 1");
    expect(citationMarkup).toContain("网页来源证据");
    expect(citationMarkup).toContain("来源权威性与主张充分性仍需审查");
    expect(citationMarkup).not.toContain("Evidence binding only");
  });

  it("renders recovery policy and blockers without English chrome", async () => {
    const container = installChineseDom();
    const { ConversationRecoveryCard } =
      await import("../src/ConversationRecoveryCard");

    render(<ConversationRecoveryCard item={recoveryItem()} />, container);
    const markup = container.textContent ?? "";

    expect(markup).toContain("恢复 · 已阻止");
    expect(markup).toContain("检测到写入或委派产生的副作用");
    expect(markup).toContain("安全只读");
    expect(markup).toContain("来源运行");
    expect(markup).not.toContain("Automatic recovery stopped safely");
    expect(markup).not.toContain("Source Run");
  });
});

function installChineseDom(): HTMLElement {
  vi.resetModules();
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
  const container = document.getElementById("app") as unknown as HTMLElement;
  containers.push(container);
  return container;
}

function subagentItem(): ConversationSubagent {
  return {
    id: "event_subagent",
    seq: 3,
    createdAt: "2026-08-19T08:02:00.000Z",
    task: {
      id: "task_12345678",
      role: "reviewer",
      description: "核对证据",
      status: "completed",
      model: { provider: "openai", id: "gpt-test" },
      stepCount: 2,
      turnCount: 1,
      usage: { inputTokens: 1200, outputTokens: 300 },
      stopReason: "completed",
      outcome: {
        summary: "审查完成。",
        items: [
          {
            kind: "finding",
            severity: "info",
            title: "证据一致",
            evidenceCount: 1,
          },
        ],
      },
    },
    itemCount: 1,
    evidenceCount: 1,
    unknownCount: 0,
    blockerCount: 0,
    warningCount: 0,
  };
}

function artifactItem(): ConversationArtifact {
  return {
    id: "event_artifact",
    seq: 4,
    createdAt: "2026-08-19T08:03:00.000Z",
    attemptScope: "current",
    threadId: "thread_12345678",
    runId: "run_12345678",
    planId: "plan_12345678",
    planRevision: 1,
    artifact: {
      id: "artifact_report",
      path: "artifacts/report.md",
      kind: "file",
      description: "交付报告",
      status: "verified",
      sha256: "a".repeat(64),
      sizeBytes: 2048,
      evidence: "verification_1",
      createdAt: "2026-08-19T08:00:00.000Z",
      updatedAt: "2026-08-19T08:03:00.000Z",
    },
  };
}

function citationItem(): ConversationCitation {
  return {
    id: "event_citation",
    seq: 5,
    createdAt: "2026-08-19T08:04:00.000Z",
    callId: "call_12345678",
    citationId: "citation_12345678",
    sourceId: "source_12345678901234567890",
    sourceKind: "web_fetch",
    startLine: 10,
    endLine: 14,
    sourceContentSha256: "b".repeat(64),
    sourceTitleSha256: "c".repeat(64),
    quoteSha256: "d".repeat(64),
    claimSha256: "e".repeat(64),
  };
}

function recoveryItem(): ConversationRecovery {
  return {
    id: "run_12345678",
    seq: 6,
    createdAt: "2026-08-19T08:05:00.000Z",
    status: "skipped",
    assessment: {
      contentSha256: "f".repeat(64),
      interruptedRunId: "run_12345678",
      rootRunId: "run_root1234",
      eligible: false,
      blockReasons: ["unsafe_tool_effect"],
      policy: { mode: "safe_read_only", maxAttempts: 2, backoffMs: 500 },
      toolCalls: {
        total: 2,
        readOnly: 1,
        unsafe: 1,
        unknownEffect: 0,
        unresolved: 0,
      },
      eventRange: {
        fromSeq: 1,
        toSeq: 6,
        eventCount: 6,
        eventStreamSha256: "1".repeat(64),
      },
      priorAttempts: 0,
      assessedAt: "2026-08-19T08:05:00.000Z",
    },
    eventIds: ["event_recovery"],
  };
}
