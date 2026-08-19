import { afterEach, describe, expect, it, vi } from "vitest";

describe("Browser Live Chinese activity projection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("localizes control, takeover, confirmation, pause, and idle states", async () => {
    vi.stubGlobal("window", {
      localStorage: { getItem: () => "zh" },
    });
    const { browserLiveActivity } =
      await import("../src/browser-live-activity");

    expect(
      browserLiveActivity([], "run_live", {
        pauseStatus: "running",
        takeoverOpen: false,
        controlTransition: "pausing",
      }),
    ).toEqual({ state: "control", label: "控制 · 当前动作完成后暂停" });
    expect(
      browserLiveActivity([], "run_live", {
        pauseStatus: "paused",
        takeoverOpen: true,
        operatorAction: "save_screenshot",
      }),
    ).toEqual({ state: "operator", label: "操作者 · 正在截取页面" });
    expect(
      browserLiveActivity([], "run_live", {
        pauseStatus: "running",
        takeoverOpen: false,
        confirmationAction: "download",
      }),
    ).toEqual({ state: "confirmation", label: "等待 · 批准：正在下载文件" });
    expect(
      browserLiveActivity([], "run_live", {
        pauseStatus: "paused",
        takeoverOpen: false,
      }),
    ).toEqual({ state: "paused", label: "等待 · 操作者已暂停自动化" });
    expect(
      browserLiveActivity([], "run_live", {
        pauseStatus: "running",
        takeoverOpen: false,
      }),
    ).toEqual({ state: "idle", label: "就绪 · 等待智能体" });
  });
});
