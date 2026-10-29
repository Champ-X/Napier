import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceApiBinding, workspaceNavigationUrl } from "../src/workspace-api-binding";

const a = `workspace_${"a".repeat(64)}`;
const b = `workspace_${"b".repeat(64)}`;
const response = (id?: string) => new Response("{}", { headers: id ? { "X-Napier-Workspace-Id": id } : {} });
afterEach(() => vi.unstubAllGlobals());

describe("document workspace binding", () => {
  it("retains A across a delayed response and follow-up while another document opens B", async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => { resolve = done; });
    const fetch = vi.fn().mockImplementationOnce(() => pending).mockResolvedValueOnce(response(b)).mockResolvedValueOnce(response(a));
    vi.stubGlobal("fetch", fetch);
    const left = new WorkspaceApiBinding(`http://localhost/?workspace=${a}`);
    const right = new WorkspaceApiBinding(`http://localhost/?workspace=${b}`);
    const task = left.fetch("/api/threads/same/decision");
    await right.fetch("/api/threads/same/decision", { method: "POST" });
    resolve(response(a)); await task;
    await left.fetch("/api/threads/same/continue", { method: "POST" });
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      `/api/workspaces/${a}/threads/same/decision`,
      `/api/workspaces/${b}/threads/same/decision`,
      `/api/workspaces/${a}/threads/same/continue`,
    ]);
  });

  it("learns the launch identity once and binds subsequent resources without changing evidence paths", async () => {
    const bound = vi.fn();
    const binding = new WorkspaceApiBinding("http://localhost/?thread=thread_abcdefgh", bound);
    const fetch = vi.fn().mockResolvedValueOnce(response(a)).mockResolvedValueOnce(response(a));
    vi.stubGlobal("fetch", fetch);
    await binding.fetch("/api/bootstrap?thread=thread_abcdefgh");
    await binding.fetch("/api/events");
    expect(bound).toHaveBeenCalledExactlyOnceWith(a);
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/bootstrap?thread=thread_abcdefgh");
    expect(fetch.mock.calls[1]?.[0]).toBe(`/api/workspaces/${a}/events`);
    expect(binding.address("/api/workspace/preview/token/index.html")).toBe(`/api/workspaces/${a}/workspace/preview/token/index.html`);
  });

  it("rejects foreign, contradictory and invalid addresses before fetching", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const binding = new WorkspaceApiBinding(`http://localhost/?workspace=${a}`);
    for (const endpoint of ["https://example.com/api/threads", `/api/workspaces/${b}/threads`, "/assets/file.js"]) {
      await expect(binding.fetch(endpoint)).rejects.toThrow("Workspace API address");
    }
    await expect(new WorkspaceApiBinding("http://localhost/?workspace=invalid").fetch("/api/bootstrap")).rejects.toThrow("Workspace address is invalid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects mismatched and missing identities, including explicit first requests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(b)).mockResolvedValueOnce(response()).mockResolvedValueOnce(response(b)));
    const binding = new WorkspaceApiBinding(`http://localhost/?workspace=${a}`);
    await expect(binding.fetch("/api/bootstrap")).rejects.toThrow("another workspace");
    await expect(binding.fetch("/api/bootstrap")).rejects.toThrow("could not be verified");
    await expect(new WorkspaceApiBinding().fetch(`/api/workspaces/${a}/bootstrap`)).rejects.toThrow("another workspace");
  });

  it("does not let two unbound bootstrap replies latch different identities", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; })).mockResolvedValueOnce(response(a)));
    const binding = new WorkspaceApiBinding();
    const delayed = binding.fetch("/api/bootstrap");
    await binding.fetch("/api/health");
    resolve(response(b));
    await expect(delayed).rejects.toThrow("another workspace");
  });

  it("keeps legacy servers usable and preserves errors from an unavailable addressed workspace", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response("missing", { status: 404 })));
    expect((await new WorkspaceApiBinding().fetch("/api/bootstrap")).status).toBe(200);
    expect((await new WorkspaceApiBinding(`http://localhost/?workspace=${a}`).fetch("/api/bootstrap")).status).toBe(404);
  });

  it("navigates with an explicit workspace and clears the prior thread and review fragment", () => {
    expect(workspaceNavigationUrl(b, `http://localhost/?workspace=${a}&thread=old#preview`)).toBe(`/?workspace=${b}`);
    expect(workspaceNavigationUrl(b, "http://localhost/?theme=dark", "thread_abcdefgh")).toBe(`/?theme=dark&workspace=${b}&thread=thread_abcdefgh`);
  });
});
