import { parseHTML } from "linkedom";
import { render } from "preact";
import type { KeyboardEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ComposerProps } from "../src/Composer";
import { handleComposerKeys } from "../src/composer-keyboard";

vi.mock("lucide-react", () => {
  const Icon = (props: Record<string, unknown>) => <svg {...props} />;
  return {
    Activity: Icon,
    CirclePause: Icon,
    AlertTriangle: Icon,
    ImagePlus: Icon,
    Send: Icon,
    SlidersHorizontal: Icon,
    Square: Icon,
    X: Icon,
  };
});

vi.mock("../src/ConversationPlanProgress", () => ({
  ConversationPlanProgress: () => null,
}));
vi.mock("../src/ComposerCapabilityControl", () => ({
  ComposerCapabilityControl: () => null,
}));
vi.mock("../src/ComposerHarnessPolicyControl", () => ({
  ComposerHarnessPolicyControl: () => null,
}));
vi.mock("../src/ProviderSetupCard", () => ({
  ProviderSetupCard: () => null,
}));
vi.mock("../src/use-composer-height", () => ({ useComposerHeight: () => {} }));

let container: HTMLElement | undefined;

afterEach(() => {
  if (container) render(null, container);
  container = undefined;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("composer interaction states", () => {
  it("keeps idle input quiet and exposes the active run's message purpose", async () => {
    const target = installDom();
    const { Composer } = await import("../src/Composer");
    const props = composerProps();
    render(<Composer {...props} />, target);
    await vi.dynamicImportSettled();
    expect(target.querySelector(".composer-interaction-bar")).toBeNull();

    props.vm.isRunning = true;
    props.vm.composer = "保留已有实现";
    render(<Composer {...props} />, target);
    expect(target.querySelector('[role="status"]')?.textContent).toContain(
      "任务执行中",
    );
    expect(target.querySelector(".run-button.control")?.textContent).toContain(
      "发送纠偏",
    );
    expect(target.querySelector(".run-button.stop")?.textContent).toContain(
      "停止",
    );
    const mode = target.querySelector("select")!;
    expect(mode.getAttribute("aria-label")).toBe("运行输入模式");
    Object.defineProperty(mode, "value", { value: "follow_up" });
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    expect(props.vm.setControlMessageMode).toHaveBeenCalledWith("follow_up");

    props.vm.controlMessageMode = "follow_up";
    render(<Composer {...props} />, target);
    expect(target.querySelector("textarea")?.getAttribute("placeholder")).toBe(
      "写下接下来要处理的任务…",
    );
    expect(target.querySelector(".run-button.control")?.textContent).toContain(
      "加入队列",
    );
    expect(
      target.querySelector("#composer-interaction-hint")?.textContent,
    ).toBe("这条消息将在当前任务结束后继续处理。");
  });

  it.each(["decision", "browser"] as const)(
    "prioritizes pending %s over the run and explains the disabled input",
    async (pending) => {
      const target = installDom();
      const { Composer } = await import("../src/Composer");
      const props = composerProps();
      props.vm.isRunning = true;
      if (pending === "decision") {
        props.vm.openOperatorDecision = {
          header: "请选择交付方式",
        } as NonNullable<ComposerProps["vm"]["openOperatorDecision"]>;
      } else {
        props.vm.browserInteractionConfirmation = {
          id: "browser_confirmation_1",
        } as NonNullable<ComposerProps["vm"]["browserInteractionConfirmation"]>;
      }
      render(<Composer {...props} />, target);
      await vi.dynamicImportSettled();
      const textarea = target.querySelector("textarea")!;
      expect(textarea.hasAttribute("disabled")).toBe(true);
      expect(textarea.getAttribute("aria-describedby")).toContain(
        "composer-interaction-hint",
      );
      expect(target.querySelector("select")).toBeNull();
      expect(target.querySelector('[role="status"]')?.textContent).toBe(
        pending === "decision" ? "等待你的选择" : "等待浏览器操作确认",
      );
    },
  );

  it("keeps command-enter from sending during IME composition", () => {
    const submit = vi.fn();
    const preventDefault = vi.fn();
    const key = {
      key: "Enter",
      metaKey: true,
      ctrlKey: false,
      nativeEvent: { isComposing: true },
      preventDefault,
    } as unknown as KeyboardEvent<HTMLTextAreaElement>;
    handleComposerKeys(key, submit);
    expect(submit).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    key.nativeEvent = { isComposing: false } as globalThis.KeyboardEvent;
    handleComposerKeys(key, submit);
    expect(submit).toHaveBeenCalledOnce();
  });
});

function installDom(): HTMLElement {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: () => "zh" },
  });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  container = document.getElementById("app") as unknown as HTMLElement;
  return container;
}

function composerProps(): ComposerProps {
  return {
    vm: {
      composer: "",
      composerImages: [],
      isRunning: false,
      activeRunId: "run_1",
      detail: { thread: { id: "thread_1" }, plans: [], events: [], runs: [] },
      controlMessageMode: "steering",
      setComposer: vi.fn(),
      setComposerImages: vi.fn(),
      setControlMessageMode: vi.fn(),
      submit: vi.fn(),
      stop: vi.fn(),
    } as unknown as ComposerProps["vm"],
    activeAgent: undefined,
    activeModel: {
      key: "test/model",
      id: "model",
      provider: "test",
      configured: true,
      vision: true,
    } as ComposerProps["activeModel"],
    canStartRun: true,
    onOpenInspector: vi.fn(),
  };
}
