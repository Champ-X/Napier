import { expect, it } from "vitest";
import {
  DapProcessSession,
  type DapProcesses,
} from "../src/dap-process-session.js";

const encode = (value: unknown) => {
  const text = JSON.stringify(value);
  return `Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`;
};
function fixture(messages: unknown[]) {
  let read = false;
  const processes = {
    writePrivateProtocolInput: async () => ({}),
    outputPrivateProtocol: async () => {
      if (read) throw new Error("Unexpected extra protocol read");
      read = true;
      return {
        chunks: [
          { cursor: 1, stream: "stdout", text: messages.map(encode).join("") },
        ],
      };
    },
  } as unknown as DapProcesses;
  return new DapProcessSession(
    processes,
    { threadId: "thread_one", runId: "run_one" },
    "process_one",
  );
}
const initialized = { seq: 2, type: "event", event: "initialized" };
const response = {
  seq: 1,
  type: "response",
  request_seq: 1,
  command: "initialize",
  success: true,
  body: { supportsConfigurationDoneRequest: true },
};

it("accepts unique debugpy messages whose sequence allocation precedes another thread's send", async () => {
  const session = fixture([initialized, response]);
  const body = await session.request("initialize", {}, Date.now() + 1000);
  expect(body).toEqual(response.body);
  expect(await session.event("initialized", Date.now() + 1000)).toEqual(
    initialized,
  );
  expect(session.evidence()).toMatchObject({
    responsesSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
  });
});

it("rejects repeated message identities even when other sequences intervened", async () => {
  const session = fixture([
    initialized,
    response,
    { ...initialized, event: "terminated" },
  ]);
  await expect(
    session.request("initialize", {}, Date.now() + 1000),
  ).rejects.toThrow(/duplicated/);
});

it("keeps request identity, command and single-response correlation strict", async () => {
  for (const messages of [
    [{ ...response, request_seq: 9 }],
    [{ ...response, command: "launch" }],
    [response, { ...response, seq: 3 }],
  ]) {
    const session = fixture(messages);
    await expect(
      session.request("initialize", {}, Date.now() + 1000),
    ).rejects.toThrow(/does not match a request/);
  }
});

it("bounds unique protocol identities and retains arrival-order state transitions", async () => {
  const session = fixture([
    { seq: 3, type: "event", event: "continued" },
    { seq: 2, type: "event", event: "stopped", body: { threadId: 1 } },
    response,
  ]);
  await session.request("initialize", {}, Date.now() + 1000);
  expect(session.state).toBe("paused");
  expect(session.threadId).toBe(1);
  const flood = fixture(
    Array.from({ length: 317 }, (_, i) => ({
      seq: i + 1,
      type: "event",
      event: "output",
      body: { output: "" },
    })),
  );
  await expect(flood.event("initialized", Date.now() + 1000)).rejects.toThrow(
    /limit/,
  );
});
