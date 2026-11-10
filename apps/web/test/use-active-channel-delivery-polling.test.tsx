import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InboundDelivery } from "@napier/contracts";

import { useActiveChannelDeliveryPolling } from "../src/use-active-channel-delivery-polling";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../src/automation-api", () => ({ getInboundDeliveries: api.get }));

let container: HTMLElement;
const update = vi.fn();
const running = [{ id: "delivery", status: "running" }] as InboundDelivery[];

function Harness({ channels }: { channels: string[] }) {
  useActiveChannelDeliveryPolling(
    Object.fromEntries(channels.map((channel) => [channel, running])),
    update,
  );
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  const { window, document } = parseHTML("<html><body><div id=app></div></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  container = document.getElementById("app") as unknown as HTMLElement;
  api.get.mockReset();
  update.mockReset();
});

afterEach(() => {
  act(() => render(null, container));
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

it("keeps only one request in flight for a slow channel", async () => {
  let complete!: (value: InboundDelivery[]) => void;
  api.get.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  act(() => render(<Harness channels={["slow"]} />, container));
  await advance(2_000);
  expect(api.get).toHaveBeenCalledTimes(1);
  await advance(10_000);
  expect(api.get).toHaveBeenCalledTimes(1);

  await act(async () => { complete(running); });
  expect(update).toHaveBeenCalledWith("slow", running);
  await advance(1_999);
  expect(api.get).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(api.get).toHaveBeenCalledTimes(2);
});

it("continues refreshing healthy channels when another channel fails or hangs", async () => {
  api.get.mockImplementation((channelId: string) => {
    if (channelId === "failed") return Promise.reject(new Error("Offline"));
    if (channelId === "stuck") return new Promise(() => {});
    return Promise.resolve(running);
  });
  act(() => render(<Harness channels={["healthy", "failed", "stuck"]} />, container));
  await advance(2_000);
  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith("healthy", running);
  await advance(2_000);
  expect(update).toHaveBeenCalledTimes(2);
  expect(api.get.mock.calls.filter(([id]) => id === "stuck")).toHaveLength(1);
});

it("aborts pending reads and ignores late results when channels become inactive", async () => {
  let complete!: (value: InboundDelivery[]) => void;
  api.get.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  act(() => render(<Harness channels={["channel"]} />, container));
  await advance(2_000);
  const signal = api.get.mock.calls[0]?.[1] as AbortSignal;
  expect(signal.aborted).toBe(false);

  act(() => render(<Harness channels={[]} />, container));
  expect(signal.aborted).toBe(true);
  await act(async () => { complete(running); });
  await advance(10_000);
  expect(update).not.toHaveBeenCalled();
  expect(api.get).toHaveBeenCalledTimes(1);
});
