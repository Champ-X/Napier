import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BrowserUseLocalBackend,
  BrowserUseLocalProcessControl,
} from "../src/index.js";
import { BROWSER_USE_LOCAL_BRIDGE } from "../src/browser-use-local-bridge.js";

describe("Browser Use local backend boundary", () => {
  it("rejects private browser targets before inspecting or starting Python", async () => {
    const backend = new BrowserUseLocalBackend({
      dataRoot: path.join(os.tmpdir(), "napier-browser-use-invalid"),
      env: { NAPIER_BROWSER_USE_CREDENTIAL: "not-used" },
    });
    const base = {
      task: "Inspect the release notes",
      model: { provider: "openai", id: "gpt-test" },
      maxSteps: 4,
    } as const;

    await expect(
      backend.run(
        {
          ...base,
          startUrl: "http://127.0.0.1/private",
          allowedDomains: ["127.0.0.1"],
        },
        () => undefined,
      ),
    ).rejects.toThrow("allowed domain is invalid");
    await expect(
      backend.run(
        {
          ...base,
          startUrl: "http://localhost/private",
          allowedDomains: ["localhost"],
        },
        () => undefined,
      ),
    ).rejects.toThrow("allowed domain is invalid");
  });

  it("pins deterministic first navigation and a public read-only action policy", () => {
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain(
      "await agent.browser_session.navigate_to(request['initialUrl'])",
    );
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain("directly_open_url=False");
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain("'input'");
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain("'read_file'");
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain("'upload_file'");
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain("'send_keys'");
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain("block_ip_addresses=True");
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain("captcha_solver=False");
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain("accept_downloads=False");
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain("headless=False");
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain(
      "user_data_dir=artifact_dir / 'profile'",
    );
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain(
      "--disable-component-extensions-with-background-pages",
    );
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain(
      "await agent.browser_session.start()",
    );
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain(
      "event_bus.on(NavigationStartedEvent, acknowledge_navigation_started)",
    );
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain(
      "'challengeMode': 'automatic_takeover_pause'",
    );
  });

  it("keeps DeepSeek thinking models on validated actions without forcing tool choice", () => {
    const deepseekAdapter = BROWSER_USE_LOCAL_BRIDGE.slice(
      BROWSER_USE_LOCAL_BRIDGE.indexOf("def deepseek_model"),
      BROWSER_USE_LOCAL_BRIDGE.indexOf("def model_for"),
    );

    expect(deepseekAdapter).toContain("tools=call_tools");
    expect(deepseekAdapter).not.toContain("tool_choice=");
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain(
      "return json.loads(message.content)",
    );
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain(
      "raise ValueError('Expected a structured browser action')",
    );
    expect(deepseekAdapter).toContain(
      "parsed = structured_action_payload(message)",
    );
    expect(deepseekAdapter).toContain("output_format.model_validate(parsed)");
    expect(deepseekAdapter).toContain("ChatInvokeUsage(");
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain(
      "return deepseek_model(model, credential)",
    );
  });

  it("attributes only the current Browser Use step error", () => {
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain(
      "current_error = errors[-1] if errors else None",
    );
    expect(BROWSER_USE_LOCAL_BRIDGE).not.toContain(
      "[value for value in active_agent.history.errors() if value]",
    );
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain(
      "public_step_error(current_error)",
    );
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain(
      "code = 'model_action_invalid'",
    );
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain("code = 'page_changed'");
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain(
      "code = 'browser_action_failed'",
    );
    expect(BROWSER_USE_LOCAL_BRIDGE).toContain(
      "the agent can re-observe and retry",
    );
    const stepProjection = BROWSER_USE_LOCAL_BRIDGE.slice(
      BROWSER_USE_LOCAL_BRIDGE.indexOf("def public_step_error"),
      BROWSER_USE_LOCAL_BRIDGE.indexOf("async def main"),
    );
    expect(stepProjection).not.toContain("stopped before producing a result");
  });

  it("pauses only the agent, resumes it, and stops the isolated process group", () => {
    const signals: Array<[number, NodeJS.Signals]> = [];
    const control = new BrowserUseLocalProcessControl({
      platform: "darwin",
      kill: (pid, signal) => signals.push([pid, signal]),
      schedule: (operation) => operation(),
    });
    control.attach(77);

    expect(control.pause()).toMatchObject({ state: "paused" });
    expect(control.takeover()).toMatchObject({ state: "takeover" });
    expect(control.resume()).toMatchObject({ state: "running" });
    expect(control.takeover()).toMatchObject({ state: "takeover" });
    control.terminate();

    expect(signals).toEqual([
      [77, "SIGSTOP"],
      [77, "SIGCONT"],
      [77, "SIGSTOP"],
      [77, "SIGCONT"],
      [-77, "SIGTERM"],
      [-77, "SIGKILL"],
    ]);
  });

  it("reports local takeover unavailable where agent-only suspension is unsupported", () => {
    const signals: Array<[number, NodeJS.Signals]> = [];
    const control = new BrowserUseLocalProcessControl({
      platform: "win32",
      kill: (pid, signal) => signals.push([pid, signal]),
      schedule: (operation) => operation(),
    });
    control.attach(88);

    expect(() => control.takeover()).toThrow("unavailable on this host");
    control.terminate();
    expect(signals).toEqual([
      [88, "SIGTERM"],
      [88, "SIGKILL"],
    ]);
  });
});
