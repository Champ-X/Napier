import { describe, expect, it } from "vitest";

import { BROWSER_TOOL_FAILURE_DECLARATION } from "../src/browser-tool-failure.js";
import { BrowserSessionInactiveError } from "../src/browser-session-errors.js";
import { stableOperationBinding } from "../src/tool-operation-binding.js";
import { resolveDeclaredToolFailure } from "../src/tool-failure-semantics.js";
import {
  webFetchFailure,
  webFetchFailureReceipt,
  webFetchOriginBinding,
} from "../src/web-fetch-failure.js";
import {
  webSearchCapabilityBinding,
  webSearchFailure,
  webSearchFailureReceipt,
  webSearchRouteBinding,
} from "../src/web-search-failure.js";
import { normalizeWebSearchRequest } from "../src/web-search-model.js";

describe("built-in typed Tool failure declarations", () => {
  it("binds Search route and capability modes independently", () => {
    const request = normalizeWebSearchRequest({ query: "公开资料" });
    const route = webSearchFailureReceipt(
      { ...request, attemptedProvider: "bing" },
      webSearchFailure(
        "连接失败",
        "route_network",
        webSearchRouteBinding("bing"),
      ),
    );
    const capability = webSearchFailureReceipt(
      request,
      webSearchFailure(
        "图片能力不可用",
        "capability_unavailable",
        webSearchCapabilityBinding(request),
      ),
    );

    expect(route).toMatchObject({
      coverage: "trusted_declared",
      scope: "route",
      bindingSha256: stableOperationBinding(webSearchRouteBinding("bing")),
    });
    expect(capability).toMatchObject({
      coverage: "trusted_declared",
      scope: "capability",
      bindingSha256: stableOperationBinding(
        webSearchCapabilityBinding(request),
      ),
    });
  });

  it("binds Fetch transport failures to origin without reading diagnostics", () => {
    const url = "https://example.test/article";
    const receipt = webFetchFailureReceipt(
      { action: "fetch", url },
      webFetchFailure("读取超时", "origin_timeout", webFetchOriginBinding(url)),
    );
    expect(receipt).toMatchObject({
      coverage: "trusted_declared",
      class: "timeout",
      scope: "origin",
      bindingSha256: stableOperationBinding(webFetchOriginBinding(url)),
    });
  });

  it("binds Browser session failures and rejects message-only impersonation", () => {
    const input = { action: "navigate", url: "https://example.test" };
    const typed = resolveDeclaredToolFailure(
      BROWSER_TOOL_FAILURE_DECLARATION,
      input,
      new BrowserSessionInactiveError(),
    );
    const messageOnly = resolveDeclaredToolFailure(
      BROWSER_TOOL_FAILURE_DECLARATION,
      input,
      new Error("Browser Session is not active for this Run"),
    );

    expect(typed).toMatchObject({
      coverage: "trusted_declared",
      scope: "session",
      disposition: "recover_state",
      fatalToSession: true,
      bindingSha256: stableOperationBinding({
        kind: "browser-session",
        lane: "interactive",
      }),
    });
    expect(messageOnly).toMatchObject({
      coverage: "invalid_declared",
      class: "unknown",
      scope: "invocation",
      disposition: "terminal",
    });
  });
});
