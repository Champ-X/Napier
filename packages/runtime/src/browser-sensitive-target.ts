import type { Locator } from "playwright-core";

import { BROWSER_ACTION_TIMEOUT_MS } from "./browser-session-model.js";
import { canonicalJson, sha256 } from "./ed25519.js";

const MAX_BROWSER_SENSITIVE_TARGET_SIGNALS = 8;

export type BrowserSensitiveTargetStatus =
  | "ordinary"
  | "credential"
  | "human_verification";

type BrowserSensitiveTargetSignal =
  | "challenge_control"
  | "challenge_frame"
  | "challenge_widget"
  | "credential_autocomplete"
  | "password_form_field"
  | "password_form_submit"
  | "password_input";

interface BrowserSensitiveTargetProbe {
  signals: BrowserSensitiveTargetSignal[];
}

export interface BrowserSensitiveTargetEvidence {
  status: BrowserSensitiveTargetStatus;
  signalCount: number;
  signalsSha256: string;
}

export async function inspectBrowserSensitiveTarget(
  locator: Locator,
  action: "click" | "type" | "select" | "upload" | "download",
  signal?: AbortSignal,
): Promise<BrowserSensitiveTargetEvidence> {
  const probe = await locator.evaluate(
    probeBrowserSensitiveTarget,
    { action },
    {
      timeout: BROWSER_ACTION_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    },
  );
  return createBrowserSensitiveTargetEvidence(probe);
}

export function probeBrowserSensitiveTarget(
  target: HTMLElement,
  request: {
    action: "click" | "type" | "select" | "upload" | "download";
  },
): BrowserSensitiveTargetProbe {
  const signals = new Set<BrowserSensitiveTargetSignal>();
  addCredentialSignals(signals, target, request.action);
  addChallengeSignals(signals, target, request.action);
  return { signals: [...signals].sort() };

  function addCredentialSignals(
    output: Set<BrowserSensitiveTargetSignal>,
    element: HTMLElement,
    action: "click" | "type" | "select" | "upload" | "download",
  ): void {
    const tag = element.tagName.toLowerCase();
    const inputType = (element.getAttribute("type") ?? "").toLowerCase();
    const passwordForm = Boolean(
      element.closest("form")?.querySelector('input[type="password"]'),
    );
    if (tag === "input" && inputType === "password")
      output.add("password_input");
    if (action === "type" && credentialAutocomplete(element))
      output.add("credential_autocomplete");
    if (action === "type" && passwordForm && editableTarget(element))
      output.add("password_form_field");
    if (action === "click" && passwordForm && submitTarget(tag, inputType))
      output.add("password_form_submit");
  }

  function addChallengeSignals(
    output: Set<BrowserSensitiveTargetSignal>,
    element: HTMLElement,
    action: "click" | "type" | "select" | "upload" | "download",
  ): void {
    const tag = element.tagName.toLowerCase();
    const challengeRoot = element.closest(
      [
        ".cf-turnstile",
        ".g-recaptcha",
        ".h-captcha",
        "[data-turnstile-sitekey]",
      ].join(","),
    );
    if (challengeRoot) output.add("challenge_widget");
    if (
      tag === "iframe" &&
      isChallengeUrl(element.getAttribute("src") ?? "", element.ownerDocument)
    ) {
      output.add("challenge_frame");
    }
    if (action === "click" && challengeControlText(element)) {
      output.add("challenge_control");
    }
  }

  function isChallengeUrl(value: string, document: Document): boolean {
    try {
      const url = new URL(
        value,
        document.defaultView?.location?.href ?? "https://invalid.example/",
      );
      return (
        /(^|\.)challenges\.cloudflare\.com$/u.test(url.hostname) ||
        /(^|\.)hcaptcha\.com$/u.test(url.hostname) ||
        /(^|\.)recaptcha\.net$/u.test(url.hostname) ||
        (/(^|\.)google\.com$/u.test(url.hostname) &&
          /\/recaptcha\//u.test(url.pathname))
      );
    } catch {
      return false;
    }
  }

  function credentialAutocomplete(element: HTMLElement): boolean {
    return (element.getAttribute("autocomplete") ?? "")
      .toLowerCase()
      .split(/\s+/u)
      .some((value) =>
        [
          "username",
          "current-password",
          "new-password",
          "one-time-code",
        ].includes(value),
      );
  }

  function editableTarget(element: HTMLElement): boolean {
    const tag = element.tagName.toLowerCase();
    return (
      tag === "input" ||
      tag === "textarea" ||
      element.getAttribute("contenteditable") === "true" ||
      element.getAttribute("role") === "textbox"
    );
  }

  function submitTarget(tag: string, inputType: string): boolean {
    return (
      (tag === "button" && inputType !== "button" && inputType !== "reset") ||
      (tag === "input" && (inputType === "image" || inputType === "submit"))
    );
  }

  function challengeControlText(element: HTMLElement): boolean {
    return /^(verify you are human|i am human|i'm not a robot)$/u.test(
      (
        element.getAttribute("aria-label") ??
        element.getAttribute("value") ??
        element.textContent ??
        ""
      )
        .replace(/\s+/gu, " ")
        .trim()
        .toLowerCase(),
    );
  }
}

export function createBrowserSensitiveTargetEvidence(
  probe: BrowserSensitiveTargetProbe,
): BrowserSensitiveTargetEvidence {
  const signals = [
    ...new Set(probe.signals.filter(isBrowserSensitiveTargetSignal)),
  ]
    .sort()
    .slice(0, MAX_BROWSER_SENSITIVE_TARGET_SIGNALS);
  const status = signals.some((value) => value.startsWith("challenge_"))
    ? "human_verification"
    : signals.some(
          (value) =>
            value === "credential_autocomplete" ||
            value === "password_form_field" ||
            value === "password_form_submit" ||
            value === "password_input",
        )
      ? "credential"
      : "ordinary";
  return {
    status,
    signalCount: signals.length,
    signalsSha256: sha256(canonicalJson(signals)),
  };
}

function isBrowserSensitiveTargetSignal(
  value: string,
): value is BrowserSensitiveTargetSignal {
  return (
    value === "challenge_control" ||
    value === "challenge_frame" ||
    value === "challenge_widget" ||
    value === "credential_autocomplete" ||
    value === "password_form_field" ||
    value === "password_form_submit" ||
    value === "password_input"
  );
}
