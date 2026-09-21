import { FLASH_SPENDING_POLICY } from "./harness-spending-budget.mjs";

/** Stream unchanged bytes to the SDK. Only complete terminal usage releases a
 * reservation. Cancellation, transport errors and malformed streams retain it. */
export function installSpendingBudget(budget) {
  const original = globalThis.fetch;
  // A cancelled SDK stream can still be draining at the provider boundary.
  // Do not overlap a retry with an unreceipted request from this transport.
  // Historical reservations belong to earlier sessions and remain untouched.
  let pendingRequestId;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== "https://api.deepseek.com") return original(input, init);
    const denied = (pending = false) =>
      new Response(
        JSON.stringify({
          error: {
            message: pending
              ? "Previous Harness provider request has no complete usage receipt; no new provider request was sent"
              : "Local Harness CNY spending budget refused request",
            code: pending
              ? "harness_spending_evidence_pending"
              : "harness_spending_budget",
          },
        }),
        { status: 402 },
      );
    if (
      !/^\/(v1\/)?chat\/completions$/.test(url.pathname) ||
      request.method !== "POST"
    )
      return denied();
    let body;
    try {
      body = await request.clone().json();
    } catch {
      return denied();
    }
    if (
      !FLASH_SPENDING_POLICY.modelAliases.includes(body.model) ||
      body.stream !== true ||
      (body.n !== undefined && body.n !== 1) ||
      (body.max_tokens !== undefined &&
        (!Number.isSafeInteger(body.max_tokens) ||
          body.max_tokens <= 0 ||
          body.max_tokens > FLASH_SPENDING_POLICY.maxOutputTokens))
    )
      return denied();
    request.signal.throwIfAborted();
    if (pendingRequestId !== undefined) return denied(true);
    const id = budget.reserve();
    if (id === undefined) return denied();
    pendingRequestId = id;
    const response = await original(request, { redirect: "error" });
    if (
      !response.ok ||
      !response.body ||
      !response.headers.get("content-type")?.includes("text/event-stream")
    )
      return response;
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let pending = "",
      usage,
      done = false,
      valid = true;
    const settle = () => {
      if (budget.settle(id, usage) && pendingRequestId === id)
        pendingRequestId = undefined;
    };
    const inspect = (text) => {
      pending += text;
      if (pending.length > 1_048_576) {
        valid = false;
        pending = "";
        return;
      }
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          done = true;
          // SDKs may cancel their reader at [DONE] without asking for EOF.
          if (valid) settle();
          continue;
        }
        try {
          const event = JSON.parse(data);
          if (event.usage) usage = event.usage;
        } catch {
          valid = false;
        }
      }
    };
    return new Response(
      new ReadableStream({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              inspect(decoder.decode() + "\n");
              if (valid && done) settle();
              controller.close();
              return;
            }
            inspect(decoder.decode(chunk.value, { stream: true }));
            controller.enqueue(chunk.value);
          } catch (error) {
            controller.error(error);
          }
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      }),
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    );
  };
  return () => {
    globalThis.fetch = original;
  };
}
