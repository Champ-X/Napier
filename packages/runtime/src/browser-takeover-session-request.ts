import type { ExecuteBrowserTakeoverActionRequest } from "@napier/contracts/browser-takeover";

export function takeoverSessionRequest(
  request: ExecuteBrowserTakeoverActionRequest,
) {
  if (request.action === "click") {
    return {
      action: request.action,
      target: { ref: request.ref },
      ...(request.allowCrossOrigin === true
        ? { allowCrossOrigin: true as const }
        : {}),
    };
  }
  if (request.action === "visual_click") {
    return {
      action: request.action,
      x: request.x,
      y: request.y,
      ...(request.allowCrossOrigin === true
        ? { allowCrossOrigin: true as const }
        : {}),
    };
  }
  if (request.action === "keypress") {
    return {
      action: request.action,
      key: request.key,
      ...(request.allowCrossOrigin === true
        ? { allowCrossOrigin: true as const }
        : {}),
    };
  }
  if (request.action === "type") {
    return {
      action: request.action,
      target: { ref: request.ref },
      text: request.text,
    };
  }
  if (request.action === "select") {
    return {
      action: request.action,
      target: { ref: request.ref },
      values: request.values,
    };
  }
  if (request.action === "download") {
    return {
      action: request.action,
      target: { ref: request.ref },
      path: request.path,
      ...(request.allowCrossOrigin === true
        ? { allowCrossOrigin: true as const }
        : {}),
    };
  }
  if (request.action === "save_screenshot") {
    return {
      action: request.action,
      path: request.path,
      expectedLiveImageSha256: request.expectedLiveImageSha256,
    };
  }
  if (request.action === "scroll") {
    return {
      action: request.action,
      direction: request.direction,
      ...(request.pixels !== undefined ? { pixels: request.pixels } : {}),
    };
  }
  if (request.action === "back" || request.action === "forward") {
    return {
      action: request.action,
      ...(request.allowCrossOrigin === true
        ? { allowCrossOrigin: true as const }
        : {}),
    };
  }
  if (request.action === "tab_new") {
    return {
      action: request.action,
      url: request.url,
      ...(request.allowCrossOrigin === true
        ? { allowCrossOrigin: true as const }
        : {}),
    };
  }
  if (request.action === "tab_switch" || request.action === "tab_close") {
    return { action: request.action, tabId: request.tabId };
  }
  return {
    action: request.action,
    ...(request.durationMs !== undefined
      ? { durationMs: request.durationMs }
      : {}),
  };
}
