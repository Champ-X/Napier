import type { StreamFrame } from "@napier/contracts";
import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { useNextRunHarnessPolicy } from "../src/use-next-run-harness-policy";
import type { NextRunPromptInput } from "../src/next-run-capability-preset-execution";

const stream = vi.hoisted(() => vi.fn());
vi.mock("../src/api", () => ({ streamPrompt: stream }));
let root: Root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  stream.mockReset();
});

it("sends a strategy once and retains it when submission fails before Run creation", async () => {
  const probe = await mount();
  await act(async () => probe.state.setPreset("coding-python.v1"));
  stream.mockRejectedValueOnce(new Error("unavailable"));
  await act(async () => probe.state.execute(input()));
  expect(probe.state.preset).toBe("coding-python.v1");
  stream.mockImplementationOnce(async (_id, body, dispatch) => {
    expect(body.harnessPolicyPreset).toBe("coding-python.v1");
    dispatch(started());
  });
  await act(async () => probe.state.execute(input()));
  expect(probe.state.preset).toBeUndefined();
  stream.mockImplementationOnce(async (_id, body) => {
    expect(body.harnessPolicyPreset).toBeUndefined();
  });
  await act(async () => probe.state.execute(input()));
});

it.each(["started", "done"])(
  "does not transfer choices across threads or clear a newer choice on a late %s response",
  async (terminal) => {
    const probe = await mount();
    await act(async () => probe.state.setPreset("coding-node.v1"));
    let dispatch: (frame: StreamFrame) => void = () => {};
    let finish: () => void = () => {};
    stream.mockImplementationOnce(async (_id, _body, callback) => {
      dispatch = callback;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const pending = probe.state.execute(input());
    await probe.changeThread("thread_2");
    expect(probe.state.preset).toBeUndefined();
    await act(async () => probe.state.setPreset("research.v1"));
    await act(async () => {
      dispatch(terminal === "started" ? started() : done());
      finish();
      await pending;
    });
    expect(probe.state.preset).toBe("research.v1");
  },
);

it("consumes a strategy on verified terminal evidence and does not restore input if refresh fails", async () => {
  const probe = await mount();
  await act(async () => probe.state.setPreset("coding-python.v1"));
  const request = input(),
    failure = new Error("refresh unavailable");
  request.onRefresh = vi.fn(async () => {
    throw failure;
  });
  stream.mockImplementationOnce(async (_id, body, dispatch) => {
    expect(body.harnessPolicyPreset).toBe("coding-python.v1");
    dispatch(done());
  });
  await act(async () => probe.state.execute(request));
  expect(probe.state.preset).toBeUndefined();
  expect(request.restoreInput).not.toHaveBeenCalled();
  expect(request.onError).toHaveBeenCalledWith(failure);
  expect(request.onFinish).toHaveBeenCalledOnce();
});

async function mount() {
  const { window, document } = parseHTML(
    "<html><body><div id=app></div></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let state: ReturnType<typeof useNextRunHarnessPolicy>;
  let threadId = "thread_1";
  function Probe() {
    state = useNextRunHarnessPolicy(threadId);
    return null;
  }
  root = createRoot(document.getElementById("app") as unknown as HTMLElement);
  await act(async () => root.render(<Probe />));
  return {
    get state() {
      return state!;
    },
    async changeThread(id: string) {
      threadId = id;
      await act(async () => root.render(<Probe />));
    },
  };
}

function input(): NextRunPromptInput {
  return {
    threadId: "thread_1",
    text: "Inspect",
    model: { provider: "faux", id: "faux" },
    onStart: vi.fn(),
    onFinish: vi.fn(),
    onRefresh: vi.fn(async () => {}),
    onError: vi.fn(),
    restoreInput: vi.fn(),
    onFrame: vi.fn(),
  };
}
function started(): StreamFrame {
  return {
    type: "event",
    event: { type: "run.started", runId: "run_1", threadId: "thread_1" },
  } as StreamFrame;
}
function done(): StreamFrame {
  // The API mock stands in for the already-verified terminal stream frame.
  return {
    type: "done",
    runId: "run_1",
    threadId: "thread_1",
    status: "completed",
  } as StreamFrame;
}
