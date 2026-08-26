import { parseHTML } from "linkedom";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContextPanelController } from "../src/use-context-panel-controller";

const containers: HTMLElement[] = [];

describe("Context panel sections Chinese copy", () => {
  afterEach(() => {
    containers.splice(0).forEach((container) => render(null, container));
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("renders the runtime model and prompt variables in Chinese", async () => {
    const container = installChineseDom();
    const [{ ContextRunModelCard }, { ContextPromptVariablesFieldset }] =
      await Promise.all([
        import("../src/ContextRunModelCard"),
        import("../src/ContextPromptVariablesFieldset"),
      ]);
    const controller = stubController({
      agent: { model: { provider: "openai", id: "gpt-5" } },
      models: [model("openai", "gpt-5", "GPT-5", true)],
      selectedModelKey: "openai/gpt-5",
      selectedModel: { configured: true },
      onModel: vi.fn(),
      configurationBusy: false,
      agentPromptVariables: [
        { name: "today", type: "current_date", format: "iso-date" },
      ],
      addPromptVariable: vi.fn(),
      insertPromptVariable: vi.fn(),
      removePromptVariable: vi.fn(),
      replacePromptVariable: vi.fn(),
    });

    render(
      <>
        <ContextRunModelCard controller={controller} />
        <ContextPromptVariablesFieldset controller={controller} />
      </>,
      container,
    );

    expect(container.textContent).toContain("运行模型");
    expect(container.textContent).toContain("为下次运行选择模型");
    expect(container.textContent).toContain("冻结的运行变量");
    expect(container.textContent).toContain("{{today}}");
    expect(container.textContent).not.toContain("Runtime model");
  });

  it("renders recovery and loop safeguards in Chinese", async () => {
    const container = installChineseDom();
    const [
      { ContextRecoveryPolicyFieldset },
      { ContextToolLoopGuardFieldset },
    ] = await Promise.all([
      import("../src/ContextRecoveryPolicyFieldset"),
      import("../src/ContextToolLoopGuardFieldset"),
    ]);
    const controller = stubController({
      configurationBusy: false,
      agentRecoveryMode: "safe_read_only",
      agentRecoveryMaxAttempts: 2,
      agentRecoveryBackoffSeconds: 5,
      setAgentRecoveryMode: vi.fn(),
      setAgentRecoveryMaxAttempts: vi.fn(),
      setAgentRecoveryBackoffSeconds: vi.fn(),
      agentToolLoopGuardEnabled: true,
      agentToolLoopGuardThreshold: 3,
      agentToolLoopGuardExemptTools: "web_search",
      setAgentToolLoopGuardEnabled: vi.fn(),
      setAgentToolLoopGuardThreshold: vi.fn(),
      setAgentToolLoopGuardExemptTools: vi.fn(),
    });

    render(
      <>
        <ContextRecoveryPolicyFieldset controller={controller} />
        <ContextToolLoopGuardFieldset controller={controller} />
      </>,
      container,
    );

    expect(container.textContent).toContain("安全自动恢复");
    expect(container.textContent).toContain("工具循环防护");
    expect(container.innerHTML).toContain('value="web_search"');
    expect(container.textContent).not.toContain("Safe automatic recovery");
  });

  it("renders the Route v2 control plane and its safety boundary in Chinese", async () => {
    const container = installChineseDom();
    const { ContextModelRouteFieldset } = await import(
      "../src/ContextModelRouteFieldset"
    );
    const controller = stubController({
      agent: { model: { provider: "openai", id: "gpt-5.4" } },
      configurationBusy: false,
      credentials: [
        {
          id: "credential_0123456789abcdef",
          providerId: "openai",
          label: "OpenAI primary",
          status: "active",
        },
      ],
      providers: ["openai"],
      modelGroups: [
        {
          provider: "openai",
          label: "OpenAI",
          options: [
            {
              key: "openai/gpt-5.4",
              label: "openai / GPT-5.4",
              configured: true,
            },
          ],
        },
      ],
      modelRouteEnabled: true,
      setModelRouteEnabled: vi.fn(),
      modelRoutePolicy: {
        schemaVersion: 2,
        roles: {
          reasoning: {
            model: { provider: "openai", id: "gpt-5.4" },
            endpointProfileId: "corp_gateway",
          },
        },
        endpointProfiles: [
          {
            id: "corp_gateway",
            providerId: "openai",
            kind: "gateway",
            baseUrl: "https://gateway.example.test/v1",
            dialect: "openai_responses",
          },
        ],
        retryPolicy: { jitterRatio: 0.2, maxBackoffMs: 120_000 },
      },
      setModelRoutePolicy: vi.fn(),
      modelRouteError: undefined,
    });

    render(<ContextModelRouteFieldset controller={controller} />, container);

    expect(container.textContent).toContain("路由控制面");
    expect(container.textContent).toContain("模型角色");
    expect(container.textContent).toContain("端点 Profile");
    expect(container.textContent).toContain("凭证池");
    expect(container.textContent).toContain("可见输出");
    expect(container.innerHTML).toContain("corp_gateway");
    expect(container.textContent).not.toContain("Route control plane");
  });
});

function stubController(
  fields: Record<string, unknown>,
): ContextPanelController {
  return fields as unknown as ContextPanelController;
}

function model(
  provider: string,
  id: string,
  name: string,
  configured: boolean,
) {
  return {
    provider,
    providerName: provider,
    id,
    name,
    contextWindow: 100_000,
    reasoning: true,
    vision: false,
    configured,
  };
}

function installChineseDom(): HTMLElement {
  vi.resetModules();
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
  const container = document.getElementById("app") as unknown as HTMLElement;
  containers.push(container);
  return container;
}
