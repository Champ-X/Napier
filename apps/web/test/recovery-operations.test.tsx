import { act } from "preact/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import type { RunRecord, ThreadDetail } from "@napier/contracts";
import type { RunRecoveryCheckpoint } from "@napier/contracts/manual-run-recovery";
import { afterEach, expect, it, vi } from "vitest";
import { RecoveryBanner } from "../src/RecoveryBanner";
import {
  useThreadRecovery,
  type ThreadRecoveryOptions,
} from "../src/use-thread-recovery";
import { resumeInterruptedRun } from "../src/thread-run-api";
vi.mock("../src/thread-run-api", () => ({ resumeInterruptedRun: vi.fn() }));
vi.mock("lucide-react", () => {
  const Icon = (props: Record<string, unknown>) => <svg {...props} />;
  return { RotateCcw: Icon, Search: Icon, ArrowRight: Icon };
});
const roots: Root[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const run = {
  id: "run_recovery",
  threadId: "thread_recovery",
  status: "interrupted",
  source: "user",
} as RunRecord;
const facts: RunRecoveryCheckpoint = {
  runId: run.id,
  sourceRunId: run.id,
  throughSeq: 3,
  total: 1,
  omitted: 0,
  evidenceLimited: false,
  counts: {
    completed: 0,
    not_executed: 0,
    needs_reconciliation: 1,
    not_replayable: 0,
  },
  operations: [
    {
      callId: "call_write",
      toolName: "bash",
      startedSeq: 1,
      evidenceSeq: 1,
      status: "needs_reconciliation",
      reason: "effect_unresolved",
    },
  ],
};
const props = {
  run,
  checkpoint: facts,
  running: false,
  modelConfigured: true,
  onResume: vi.fn(),
  onInspect: vi.fn(),
  onOpenWorkflow: vi.fn(),
};
it.each([
  facts,
  undefined,
  { ...facts, runId: "run_old" },
  { ...facts, evidenceLimited: true },
])(
  "offers read-only inspection for uncertain or stale evidence",
  (checkpoint) => {
    const html = renderToStaticMarkup(
      <RecoveryBanner {...props} checkpoint={checkpoint} />,
    );
    expect(html).toContain("Inspect read-only");
    expect(html).not.toContain(">Continue task<");
  },
);
it("routes decisions and Workflow checkpoints without generic resume", () => {
  expect(
    renderToStaticMarkup(
      <RecoveryBanner {...props} decisionId="decision_original" />,
    ),
  ).toContain("Review decision");
  const html = renderToStaticMarkup(
    <RecoveryBanner
      {...props}
      run={{ ...run, source: "workflow", workflowPlanId: "plan_original" }}
    />,
  );
  expect(html).toContain("View plan overview");
  expect(html).not.toContain("Inspect read-only</button>");
});
it("keeps the reason and button disabled when the model is unavailable", () => {
  const html = renderToStaticMarkup(
    <RecoveryBanner {...props} modelConfigured={false} />,
  );
  const { document } = parseHTML(html);
  const button = document.querySelector(".recovery-primary") as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-describedby")).toContain(`recovery-unavailable-${run.id}`);
  expect(document.getElementById(`recovery-unavailable-${run.id}`)?.textContent).toBeTruthy();
});
it("deduplicates immediate resume clicks and attributes delayed errors to the originating thread", async () => {
  const { document, window } = parseHTML(
    '<html><body><div id="app"></div></body></html>',
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.getElementById("app")!);
  roots.push(root);
  const pending = Promise.withResolvers<void>();
  vi.mocked(resumeInterruptedRun).mockReturnValue(pending.promise);
  const onError = vi.fn(),
    onFinish = vi.fn(),
    onRefresh = vi.fn(async () => undefined);
  let resume!: (readOnly?: boolean) => Promise<void>;
  const options: ThreadRecoveryOptions = {
    detail: { thread: { id: run.threadId } } as ThreadDetail,
    run,
    running: false,
    modelConfigured: true,
    model: { provider: "faux", id: "faux-1" },
    onStart: vi.fn(),
    onFinish,
    onRefresh,
    onError,
    onFrame: () => () => {},
    onUnavailable: vi.fn(),
  };
  function Harness({ value }: { value: ThreadRecoveryOptions }) {
    resume = useThreadRecovery(value);
    return null;
  }
  await act(async () => root.render(<Harness value={options} />));
  let first!: Promise<void>;
  await act(async () => {
    first = resume(true);
    await resume(true);
  });
  expect(resumeInterruptedRun).toHaveBeenCalledTimes(1);
  expect(vi.mocked(resumeInterruptedRun).mock.calls[0]?.slice(0, 2)).toEqual([
    run.threadId,
    { runId: run.id, readOnly: true, model: options.model },
  ]);
  await act(async () =>
    root.render(
      <Harness
        value={{
          ...options,
          detail: { thread: { id: "thread_other" } } as ThreadDetail,
        }}
      />,
    ),
  );
  const error = new Error("connection lost");
  await act(async () => {
    pending.reject(error);
    await first;
  });
  expect(onError).toHaveBeenCalledWith(run.threadId, error);
  expect(onFinish).toHaveBeenCalledWith(run.threadId);
  expect(onRefresh).toHaveBeenCalledWith(run.threadId);
});
