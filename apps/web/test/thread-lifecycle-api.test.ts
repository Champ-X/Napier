import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { restoreThread, trashThread } from "../src/thread-lifecycle-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Thread lifecycle API", () => {
  it("uses hash-verified trash and restore routes", async () => {
    const responses = [
      response({ action: "trashed" }),
      response({ action: "restored" }),
    ];
    const fetchMock = vi.fn(async () => responses.shift()!);
    vi.stubGlobal("fetch", fetchMock);

    await expect(trashThread("thread_1")).resolves.toEqual({
      action: "trashed",
    });
    await expect(restoreThread("thread_1")).resolves.toEqual({
      action: "restored",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/threads/thread_1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/threads/thread_1/restore",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

function response(body: unknown): Response {
  const text = JSON.stringify(body);
  return new Response(text, {
    headers: {
      "Content-Type": "application/json",
      "X-Napier-Content-SHA256": sha256Text(text),
      "X-Napier-Content-SHA256-Mode": "body",
    },
  });
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
