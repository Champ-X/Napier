import { afterEach, describe, expect, it, vi } from "vitest";
import { navigateWorkspaceRoot } from "../src/bootstrap-api";
import { rebindWorkspaceRoot } from "../src/api";

vi.mock("../src/api", () => ({ rebindWorkspaceRoot: vi.fn(), listRecentWorkspaces: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("workspace navigation ordering", () => {
  it("keeps the latest selection when an earlier open returns later", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { href: "http://localhost/?thread=old", assign } });
    const a = `workspace_${"a".repeat(64)}`;
    const b = `workspace_${"b".repeat(64)}`;
    let resolve!: (value: Awaited<ReturnType<typeof rebindWorkspaceRoot>>) => void;
    vi.mocked(rebindWorkspaceRoot).mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
      .mockResolvedValueOnce({ workspaceId: b } as never);
    const first = navigateWorkspaceRoot("/first");
    await navigateWorkspaceRoot("/second", "thread_second01");
    resolve({ workspaceId: a } as Awaited<ReturnType<typeof rebindWorkspaceRoot>>); await first;
    expect(assign).toHaveBeenCalledTimes(1);
    const destination = new URL(assign.mock.calls[0]![0], "http://localhost");
    expect(destination.searchParams.get("workspace")).toBe(b);
    expect(destination.searchParams.get("thread")).toBe("thread_second01");
  });

  it("ignores an obsolete failure but surfaces a current failure", async () => {
    vi.stubGlobal("window", { location: { href: "http://localhost/", assign: vi.fn() } });
    let reject!: (error: Error) => void;
    vi.mocked(rebindWorkspaceRoot).mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail; }))
      .mockRejectedValueOnce(new Error("Current workspace is unavailable"));
    const first = navigateWorkspaceRoot("/first");
    await expect(navigateWorkspaceRoot("/second")).rejects.toThrow("Current workspace");
    reject(new Error("Obsolete failure"));
    await expect(first).resolves.toBeUndefined();
  });
});
