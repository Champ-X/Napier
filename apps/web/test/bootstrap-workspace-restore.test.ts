import { afterEach, describe, expect, it, vi } from "vitest";

import { getBootstrapRestoringWorkspace } from "../src/bootstrap-api";

afterEach(() => vi.unstubAllGlobals());

describe("workspace-aware bootstrap", () => {
  it("restores a thread-only deep link from its recent workspace", async () => {
    const target = "thread_fixture01";
    const bootstrap = { activeThread: { thread: { id: target } } };
    const responses = [
      response({ error: `Thread not found: ${target}` }, 404),
      response([{ root: "/work/one", name: "one", lastOpenedAt: "2026-08-21T00:00:00.000Z" }]),
      response([{ id: target }]),
      response({ root: "/work/one" }),
      response(bootstrap),
    ];
    const fetch = vi.fn(async (_input: RequestInfo | URL) => responses.shift()!);
    vi.stubGlobal("fetch", fetch);

    await expect(getBootstrapRestoringWorkspace(target)).resolves.toEqual(bootstrap);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `/api/bootstrap?thread=${target}`,
      "/api/workspace/recent",
      "/api/workspace/threads?root=%2Fwork%2Fone",
      "/api/workspace/root",
      `/api/bootstrap?thread=${target}`,
    ]);
  });

  it("does not scan workspaces for non-404 failures", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL) => response({ error: "Unavailable" }, 503));
    vi.stubGlobal("fetch", fetch);

    await expect(getBootstrapRestoringWorkspace("thread_fixture02")).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

function response(body: unknown, status = 200): Response {
  const text = JSON.stringify(body);
  return new Response(text, {
    status,
    headers: {
      "content-type": "application/json",
      "x-napier-content-sha256": createHash("sha256").update(text).digest("hex"),
      "x-napier-content-sha256-mode": "body",
    },
  });
}
import { createHash } from "node:crypto";

