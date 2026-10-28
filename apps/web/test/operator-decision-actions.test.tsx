import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorDecision } from "@napier/contracts";
import type { WebThreadDetail } from "../src/api";
import { useOperatorDecisionActions } from "../src/use-operator-decision-actions";
import OperatorDecisionPanel from "../src/OperatorDecisionPanel";
import { operatorDecisionCopy as copy } from "../src/operator-decision-copy";

const api = vi.hoisted(() => ({
  answerOperatorDecision: vi.fn(),
  cancelOperatorDecision: vi.fn(),
  continueOperatorDecision: vi.fn(),
  getThread: vi.fn(),
}));
vi.mock("../src/thread-run-api", () => api);
vi.mock("lucide-react", () => ({
  ArrowRight: () => <svg />,
  CircleHelp: () => <svg />,
  X: () => <svg />,
}));
let container: HTMLElement;
let input: Parameters<typeof useOperatorDecisionActions>[0];
let actions: ReturnType<typeof useOperatorDecisionActions>;
const decision = (threadId = "thread_a"): OperatorDecision => ({
  kind: "napier.operator-decision",
  schemaVersion: 1,
  id: `decision_${threadId}`,
  threadId,
  runId: `run_${threadId}`,
  status: "pending",
  header: "Output",
  question: `Choose for ${threadId}`,
  options: [
    { id: "option_1", label: "File", description: "Create a file." },
    { id: "option_2", label: "Stop", description: "Stay paused." },
  ],
  multiSelect: false,
  questionSha256: "a".repeat(64),
  requestedAt: "2026-10-29T00:00:00Z",
  requestedEventSeq: 1,
  contentSha256: "b".repeat(64),
});
const saved = (item: OperatorDecision) => ({
  ...item,
  status: "answered" as const,
  selectedOptionIds: ["option_1"],
  customText: "Keep this answer.",
  answerSha256: "c".repeat(64),
  answeredAt: "2026-10-29T00:01:00Z",
  answeredEventSeq: 2,
});
const detail = (item: OperatorDecision, workflow = false) =>
  ({
    thread: { id: item.threadId },
    operatorDecisions: [item],
    runs: [{ id: item.runId, source: workflow ? "workflow" : "user" }],
  }) as unknown as WebThreadDetail;

function Harness() {
  actions = useOperatorDecisionActions(input);
  if (!input.decision) return null;
  return (
    <OperatorDecisionPanel
      key={input.decision.id}
      decision={actions.operatorDecisionState?.savedDecision ?? input.decision}
      workflowOwned={input.detail?.runs[0]?.source === "workflow"}
      busy={actions.operatorDecisionBusy}
      state={actions.operatorDecisionState}
      onDraftChange={actions.setOperatorDecisionDraft}
      onAnswer={actions.answerOperatorDecision}
      onAnswerAndContinue={actions.answerAndContinueOperatorDecision}
      onContinue={actions.continueOperatorDecision}
      onCancel={actions.cancelOperatorDecision}
    />
  );
}
function draw() {
  act(() => render(<Harness />, container));
}
beforeEach(() => {
  const { window, document } = parseHTML(
    "<html><body><div id=app></div></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("Event", window.Event);
  container = document.getElementById("app") as unknown as HTMLElement;
  const item = decision();
  input = {
    workspaceKey: "workspace_a",
    decision: item,
    detail: detail(item),
    isRunning: false,
    loadThread: api.getThread,
    onStart: vi.fn(),
    onFinish: vi.fn(),
    onFrame: vi.fn(() => vi.fn()),
    onCommit: vi.fn(),
    onRunError: vi.fn(),
  };
  api.answerOperatorDecision.mockResolvedValue(saved(item));
  api.continueOperatorDecision.mockResolvedValue(undefined);
  api.cancelOperatorDecision.mockResolvedValue(undefined);
  api.getThread.mockResolvedValue(detail(saved(item)));
  draw();
});
afterEach(() => {
  act(() => render(null, container));
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("operator answer and continuation", () => {
  it("saves before continuing and excludes duplicate requests in the same render", async () => {
    const save = Promise.withResolvers<OperatorDecision>();
    api.answerOperatorDecision.mockReturnValue(save.promise);
    const answer = {
      selectedOptionIds: ["option_1"],
      customText: "Keep this answer.",
    };
    act(() => actions.setOperatorDecisionDraft(answer));
    let pending!: Promise<void>;
    act(() => {
      pending = actions.answerAndContinueOperatorDecision(
        input.decision!.id,
        answer,
      );
      void actions.answerAndContinueOperatorDecision(
        input.decision!.id,
        answer,
      );
    });
    expect(api.answerOperatorDecision).toHaveBeenCalledTimes(1);
    expect(api.continueOperatorDecision).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      copy.saving,
    );
    await act(async () => {
      save.resolve(saved(input.decision!));
      await pending;
    });
    expect(api.continueOperatorDecision).toHaveBeenCalledOnce();
    expect(input.onStart).toHaveBeenCalledOnce();
    expect(input.onFinish).toHaveBeenCalledOnce();
  });

  it("keeps a failed answer and its error on the originating thread", async () => {
    const save = Promise.withResolvers<OperatorDecision>();
    api.answerOperatorDecision.mockReturnValue(save.promise);
    api.getThread.mockRejectedValue(new Error("offline"));
    const answer = {
      selectedOptionIds: ["option_1"],
      customText: "Unsent A answer",
    };
    act(() => actions.setOperatorDecisionDraft(answer));
    let pending!: Promise<void>;
    act(() => {
      pending = actions.answerAndContinueOperatorDecision(
        input.decision!.id,
        answer,
      );
    });
    const original = input;
    const b = decision("thread_b");
    input = { ...input, decision: b, detail: detail(b) };
    draw();
    expect(actions.operatorDecisionBusy).toBe(false);
    await act(async () => {
      save.reject(new Error("offline"));
      await pending;
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector("textarea")?.value).toBe("");
    input = original;
    draw();
    expect(container.querySelector("textarea")?.value).toBe(answer.customText);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      copy.saveUnconfirmed,
    );
    expect(api.continueOperatorDecision).not.toHaveBeenCalled();
    expect(input.onRunError).not.toHaveBeenCalled();
  });

  it("retains a saved answer when continuing fails and retries without resaving", async () => {
    api.continueOperatorDecision.mockRejectedValueOnce(
      new Error("response lost"),
    );
    const answer = {
      selectedOptionIds: ["option_1"],
      customText: "Keep this answer.",
    };
    await act(async () => {
      await actions.answerAndContinueOperatorDecision(
        input.decision!.id,
        answer,
      );
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      copy.continueFailed,
    );
    expect(container.querySelector("textarea")?.value).toBe(answer.customText);
    await act(async () => {
      await actions.continueOperatorDecision(input.decision!);
    });
    expect(api.answerOperatorDecision).toHaveBeenCalledTimes(1);
    expect(api.continueOperatorDecision).toHaveBeenCalledTimes(2);
  });

  it("reconciles a saved answer after response loss and offers an idempotent continuation", async () => {
    api.answerOperatorDecision.mockRejectedValueOnce(
      new Error("response lost"),
    );
    const answer = {
      selectedOptionIds: ["option_1"],
      customText: "Keep this answer.",
    };
    act(() => actions.setOperatorDecisionDraft(answer));
    await act(async () => {
      await actions.answerAndContinueOperatorDecision(
        input.decision!.id,
        answer,
      );
    });
    expect(actions.operatorDecisionState?.savedDecision).toEqual(
      saved(input.decision!),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      copy.savedReady,
    );
    expect(api.continueOperatorDecision).not.toHaveBeenCalled();
    await act(async () => {
      await actions.continueOperatorDecision(input.decision!);
    });
    expect(api.answerOperatorDecision).toHaveBeenCalledOnce();
    expect(api.continueOperatorDecision).toHaveBeenCalledOnce();
  });

  it("does not equate a conflicting saved answer with the submitted draft", async () => {
    api.answerOperatorDecision.mockRejectedValueOnce(new Error("conflict"));
    const answer = {
      selectedOptionIds: ["option_2"],
      customText: "Another choice.",
    };
    act(() => actions.setOperatorDecisionDraft(answer));
    await act(async () => {
      await actions.answerAndContinueOperatorDecision(
        input.decision!.id,
        answer,
      );
    });
    expect(actions.operatorDecisionState?.savedDecision).toBeUndefined();
    expect(actions.operatorDecisionState?.draft).toEqual(answer);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      copy.saveUnconfirmed,
    );
    expect(input.onCommit).toHaveBeenCalledWith(
      input.decision!.threadId,
      detail(saved(input.decision!)),
    );
    expect(api.continueOperatorDecision).not.toHaveBeenCalled();
  });

  it("does not report a continuation failure when reconciliation confirms completion", async () => {
    const continued = {
      ...saved(input.decision!),
      status: "continued" as const,
      continuationRunId: "run_continued",
    };
    api.continueOperatorDecision.mockRejectedValueOnce(
      new Error("response lost"),
    );
    api.getThread.mockResolvedValue({
      ...detail(continued),
      runs: [{ id: "run_continued", status: "completed" }],
    });
    await act(async () => {
      await actions.answerAndContinueOperatorDecision(input.decision!.id, {
        selectedOptionIds: ["option_1"],
      });
    });
    expect(input.onRunError).not.toHaveBeenCalled();
    expect(input.onFinish).toHaveBeenCalledOnce();
    expect(input.onCommit).toHaveBeenCalledOnce();
  });

  it("does not continue or commit old requests after a workspace change", async () => {
    const save = Promise.withResolvers<OperatorDecision>();
    api.answerOperatorDecision.mockReturnValue(save.promise);
    const original = input;
    let pending!: Promise<void>;
    act(() => {
      pending = actions.answerAndContinueOperatorDecision(input.decision!.id, {
        selectedOptionIds: ["option_1"],
      });
    });
    input = { ...input, workspaceKey: "workspace_b" };
    draw();
    await act(async () => {
      save.resolve(saved(original.decision!));
      await pending;
    });
    expect(api.continueOperatorDecision).not.toHaveBeenCalled();
    expect(api.getThread).not.toHaveBeenCalled();
    expect(original.onCommit).not.toHaveBeenCalled();
    expect(actions.operatorDecisionState).toBeUndefined();
  });

  it("offers save-only for Workflow decisions and leaves their execution to the Workflow", async () => {
    input = { ...input, detail: detail(input.decision!, true) };
    draw();
    act(() =>
      actions.setOperatorDecisionDraft({ selectedOptionIds: ["option_1"] }),
    );
    expect(
      container.querySelector('button[type="submit"]')?.textContent,
    ).toContain(copy.saveOnly);
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(api.answerOperatorDecision).toHaveBeenCalledOnce();
    expect(api.continueOperatorDecision).not.toHaveBeenCalled();
  });

  it("validates missing and oversized CJK answers at submission without deleting them", () => {
    act(() =>
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      copy.chooseAnswer,
    );
    const text = "中".repeat(1400);
    act(() =>
      actions.setOperatorDecisionDraft({
        selectedOptionIds: [],
        customText: text,
      }),
    );
    act(() =>
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      copy.answerTooLong,
    );
    expect(container.querySelector("textarea")?.value).toBe(text);
    expect(api.answerOperatorDecision).not.toHaveBeenCalled();
  });
});
