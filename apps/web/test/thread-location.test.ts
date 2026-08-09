import { describe, expect, it, vi } from "vitest";

import {
  commitThreadLocation,
  replaceThreadLocation,
  threadIdFromLocation,
} from "../src/thread-location";

describe("Thread location", () => {
  it("restores only valid Thread IDs from the current URL", () => {
    expect(
      threadIdFromLocation({
        href: "http://127.0.0.1:8787/?thread=thread_fixture01",
      }),
    ).toBe("thread_fixture01");
    expect(
      threadIdFromLocation({
        href: "http://127.0.0.1:8787/?thread=not-a-thread",
      }),
    ).toBeUndefined();
  });

  it("preserves unrelated query and hash state while replacing Thread", () => {
    const replaceState = vi.fn();
    replaceThreadLocation(
      "thread_fixture02",
      { href: "http://127.0.0.1:8787/?view=plan#evidence" },
      { replaceState },
    );

    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/?view=plan&thread=thread_fixture02#evidence",
    );
  });

  it("commits selection and removes a missing Thread from the URL", () => {
    const setSelectedThreadId = vi.fn();
    const replaceState = vi.fn();
    commitThreadLocation(
      setSelectedThreadId,
      undefined,
      {
        href: "http://127.0.0.1:8787/?thread=thread_fixture03",
      },
      { replaceState },
    );

    expect(setSelectedThreadId).toHaveBeenCalledWith(undefined);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/");
  });
});
