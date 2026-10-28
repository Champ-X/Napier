import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWorkflowRecovery } from "../src/use-workflow-recovery";

const api = vi.hoisted(() => ({
  getWorkflowRecovery: vi.fn(),
  recoverWorkflow: vi.fn(),
}));
vi.mock("../src/workflow-recovery-api", () => api);
let container: HTMLElement;
let input: Parameters<typeof useWorkflowRecovery>[0];
let actions: ReturnType<typeof useWorkflowRecovery>;
function Harness() {
  actions = useWorkflowRecovery(input);
  return null;
}
function draw() {
  act(() =>
    render(
      <Harness key={`${input.workspaceKey}:${input.threadId}`} />,
      container,
    ),
  );
}
const checkpoint = (hash = "a".repeat(64)) => ({
  schemaVersion: 1,
  threadId: input.threadId,
  planId: input.planId,
  status: "ready",
  action: "resume",
  checkpointSha256: hash,
  manifestSha256: "f".repeat(64),
});
beforeEach(async () => {
  const { document, window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  container = document.createElement("div");
  document.body.append(container);
  input = {
    workspaceKey: "workspace_a",
    threadId: "thread_a",
    planId: "plan_a",
    revision: 1,
    eventCount: 10,
    running: false,
    onSettled: vi.fn(),
  };
  api.getWorkflowRecovery.mockImplementation(async () => checkpoint());
  api.recoverWorkflow.mockResolvedValue({ status: "completed" });
  await act(async () => draw());
});
afterEach(() => {
  act(() => render(null, container));
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("suppresses same-render double submits and reconciles after a lost response", async () => {
  const pending = Promise.withResolvers<unknown>();
  api.recoverWorkflow.mockReturnValue(pending.promise);
  let operation!: Promise<void>;
  act(() => {
    operation = actions.continueWorkflow();
    void actions.continueWorkflow();
  });
  expect(api.recoverWorkflow).toHaveBeenCalledOnce();
  api.getWorkflowRecovery.mockResolvedValue({
    ...checkpoint(),
    status: "completed",
    action: undefined,
    checkpointSha256: undefined,
  });
  await act(async () => {
    pending.reject(new Error("lost"));
    await operation;
  });
  expect(input.onSettled).toHaveBeenCalledOnce();
  expect(actions.error).toBe(true);
  expect(actions.checkpoint?.status).toBe("completed");
  await act(async () => actions.continueWorkflow());
  expect(api.recoverWorkflow).toHaveBeenCalledOnce();
});

it("does not commit an old response into another workspace", async () => {
  const pending = Promise.withResolvers<unknown>();
  api.recoverWorkflow.mockReturnValue(pending.promise);
  const original = input.onSettled;
  let operation!: Promise<void>;
  act(() => {
    operation = actions.continueWorkflow();
  });
  input = { ...input, workspaceKey: "workspace_b", onSettled: vi.fn() };
  await act(async () => draw());
  await act(async () => {
    pending.reject(new Error("late"));
    await operation;
  });
  expect(original).not.toHaveBeenCalled();
  expect(input.onSettled).not.toHaveBeenCalled();
  expect(actions.error).toBe(false);
  expect(actions.working).toBe(false);
});

it("does not replace newer checkpoint data with a delayed read", async () => {
  const delayed = Promise.withResolvers<ReturnType<typeof checkpoint>>();
  api.getWorkflowRecovery
    .mockReturnValueOnce(delayed.promise)
    .mockResolvedValueOnce(checkpoint("b".repeat(64)));
  let first!: Promise<void>;
  act(() => {
    first = actions.refresh();
  });
  await act(async () => actions.refresh());
  await act(async () => {
    delayed.resolve(checkpoint());
    await first;
  });
  expect(actions.checkpoint?.checkpointSha256).toBe("b".repeat(64));
});
