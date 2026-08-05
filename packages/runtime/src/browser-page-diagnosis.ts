import type { BrowserPageDiagnosisEvidence } from "@napier/contracts/browser-live-view";
import type { Page } from "playwright-core";

import { BROWSER_ACTION_TIMEOUT_MS } from "./browser-session-model.js";
import { canonicalJson, sha256 } from "./ed25519.js";

const MAX_DIAGNOSIS_SIGNALS = 12;

type BrowserPageDiagnosisSignal =
  | "challenge_control"
  | "challenge_iframe"
  | "challenge_path"
  | "challenge_script"
  | "challenge_title"
  | "challenge_widget"
  | "login_form"
  | "password_input";

interface BrowserPageDiagnosisProbe {
  signals: BrowserPageDiagnosisSignal[];
}

export interface BrowserPageSourceProbe extends BrowserPageDiagnosisProbe {
  url: string;
  title: string;
  text: string;
  semanticControls: Array<{ line: string; appMount: boolean }>;
}

type BrowserPageDiagnosisRequest =
  | { kind: "diagnosis"; href: string }
  | { kind: "source"; href: string; limit: number };
type BrowserPageDiagnosisResult<T extends BrowserPageDiagnosisRequest> =
  T extends { kind: "source" }
    ? BrowserPageSourceProbe
    : BrowserPageDiagnosisProbe;

export async function diagnoseBrowserPage(
  page: Page,
  signal?: AbortSignal,
): Promise<BrowserPageDiagnosisEvidence> {
  const probe = await page.locator("html").evaluate(
    probeBrowserPageDiagnosis,
    { kind: "diagnosis" as const, href: page.url().slice(0, 4_096) },
    {
      timeout: BROWSER_ACTION_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    },
  );
  return createBrowserPageDiagnosis(probe);
}

export function probeBrowserPageDiagnosis<
  T extends BrowserPageDiagnosisRequest,
>(root: HTMLElement, request: T): BrowserPageDiagnosisResult<T> {
  const signals = new Set<BrowserPageDiagnosisSignal>();
  const document = root.ownerDocument;
  const body = document.body ?? root;
  const currentHref = document.defaultView?.location?.href ?? request.href;
  const title = document.title.trim().toLowerCase();
  const pathname =
    safeUrl(currentHref, request.href)?.pathname.toLowerCase() ?? "";
  const passwordInputs = body.querySelectorAll<HTMLInputElement>(
    'input[type="password"]',
  );
  if (passwordInputs.length > 0) signals.add("password_input");
  if (
    Array.from(passwordInputs).some((input) => input.closest("form") !== null)
  ) {
    signals.add("login_form");
  }
  if (
    body.querySelector(
      [
        ".cf-turnstile",
        ".g-recaptcha",
        ".h-captcha",
        "[data-turnstile-sitekey]",
      ].join(","),
    )
  ) {
    signals.add("challenge_widget");
  }
  if (
    Array.from(
      body.querySelectorAll<HTMLElement>(
        'button,[role="button"],[role="checkbox"],input[type="checkbox"]',
      ),
    ).some((control) =>
      /^(verify you are human|i am human|i'm not a robot)$/u.test(
        (
          control.getAttribute("aria-label") ??
          control.getAttribute("value") ??
          control.textContent ??
          ""
        )
          .replace(/\s+/gu, " ")
          .trim()
          .toLowerCase(),
      ),
    )
  ) {
    signals.add("challenge_control");
  }
  if (
    Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe")).some(
      (frame) =>
        /(^|\.)challenges\.cloudflare\.com$/u.test(safeHost(frame.src)) ||
        /(^|\.)hcaptcha\.com$/u.test(safeHost(frame.src)) ||
        /(^|\.)recaptcha\.net$/u.test(safeHost(frame.src)) ||
        (/(^|\.)google\.com$/u.test(safeHost(frame.src)) &&
          /\/recaptcha\//u.test(safePath(frame.src))),
    )
  ) {
    signals.add("challenge_iframe");
  }
  if (
    Array.from(document.querySelectorAll<HTMLScriptElement>("script")).some(
      (script) => {
        const host = safeHost(script.src);
        const path = safePath(script.src);
        return (
          /(^|\.)challenges\.cloudflare\.com$/u.test(host) ||
          /(^|\.)hcaptcha\.com$/u.test(host) ||
          ((/(^|\.)google\.com$/u.test(host) ||
            /(^|\.)gstatic\.com$/u.test(host) ||
            /(^|\.)recaptcha\.net$/u.test(host)) &&
            /\/recaptcha\//u.test(path))
        );
      },
    )
  ) {
    signals.add("challenge_script");
  }
  if (
    /^(just a moment|attention required|security check|verify you are human|human verification)$/u.test(
      title,
    )
  ) {
    signals.add("challenge_title");
  }
  if (/^\/cdn-cgi\/challenge-platform(?:\/|$)/u.test(pathname)) {
    signals.add("challenge_path");
  }
  const probe = { signals: [...signals].sort() };
  return (
    request.kind === "source"
      ? {
          ...probe,
          url: currentHref,
          title: document.title.slice(0, 512),
          text: body.innerText.slice(0, request.limit + 1),
          semanticControls: sourceSemanticControls(body),
        }
      : probe
  ) as BrowserPageDiagnosisResult<T>;

  function sourceSemanticControls(
    sourceBody: HTMLElement,
  ): Array<{ line: string; appMount: boolean }> {
    const controls: Array<{ line: string; appMount: boolean }> = [];
    const seen = new Set<string>();
    for (const control of sourceBody.querySelectorAll<HTMLElement>(
      [
        'input:not([type="hidden"])',
        "textarea",
        "select",
        "button",
        '[role="button"]',
        '[role="textbox"]',
        '[contenteditable="true"]',
      ].join(","),
    )) {
      const tagName = control.tagName.toLowerCase();
      const inputType = (control.getAttribute("type") ?? "text").toLowerCase();
      if (tagName === "input" && inputType === "password") {
        continue;
      }
      const name = controlName(control);
      if (!name) continue;
      const line = `Control: ${controlRole(control)} "${name}"`;
      if (seen.has(line)) continue;
      seen.add(line);
      controls.push({
        line,
        appMount: Boolean(
          control.closest("#root,#app,#application,#__next,#__nuxt"),
        ),
      });
      if (controls.length >= 32) break;
    }
    return controls;
  }

  function controlName(control: HTMLElement): string {
    const id = control.id;
    const label = id
      ? Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find(
          (candidate) => candidate.getAttribute("for") === id,
        )?.textContent
      : undefined;
    const tagName = control.tagName.toLowerCase();
    return normalizeControlText(
      control.getAttribute("aria-label") ??
        label ??
        control.closest("label")?.textContent ??
        control.getAttribute("placeholder") ??
        (tagName === "button" || controlRole(control) === "button"
          ? control.textContent
          : undefined) ??
        "",
    );
  }

  function controlRole(control: HTMLElement): string {
    const explicit = normalizeControlText(control.getAttribute("role") ?? "");
    if (
      ["button", "checkbox", "combobox", "radio", "textbox"].includes(explicit)
    ) {
      return explicit;
    }
    const tagName = control.tagName.toLowerCase();
    if (tagName === "textarea") return "textbox";
    if (tagName === "select") return "combobox";
    if (tagName === "button") return "button";
    if (tagName === "input") {
      const type = (control.getAttribute("type") ?? "text").toLowerCase();
      if (type === "checkbox" || type === "radio") return type;
      if (["button", "reset", "submit"].includes(type)) return "button";
      return "textbox";
    }
    return control.getAttribute("contenteditable") === "true"
      ? "textbox"
      : "control";
  }

  function normalizeControlText(value: string): string {
    return value
      .replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 160);
  }

  function safeUrl(value: string, base: string): URL | undefined {
    try {
      return new URL(value, base);
    } catch {
      return undefined;
    }
  }

  function safeHost(value: string): string {
    return safeUrl(value, currentHref)?.hostname.toLowerCase() ?? "";
  }

  function safePath(value: string): string {
    return safeUrl(value, currentHref)?.pathname.toLowerCase() ?? "";
  }
}

export function createBrowserPageDiagnosis(
  probe: BrowserPageDiagnosisProbe,
): BrowserPageDiagnosisEvidence {
  const signals = [
    ...new Set(probe.signals.filter(isBrowserPageDiagnosisSignal)),
  ]
    .sort()
    .slice(0, MAX_DIAGNOSIS_SIGNALS);
  const challengeDetected = signals.some((value) =>
    value.startsWith("challenge_"),
  );
  const loginRequired = signals.some(
    (value) => value === "login_form" || value === "password_input",
  );
  const status = challengeDetected
    ? "challenge_detected"
    : loginRequired
      ? "login_required"
      : "none";
  return {
    status,
    signalCount: signals.length,
    signalsSha256: sha256(canonicalJson(signals)),
    takeoverRecommended: status !== "none",
  };
}

function isBrowserPageDiagnosisSignal(
  value: string,
): value is BrowserPageDiagnosisSignal {
  return (
    value === "challenge_control" ||
    value === "challenge_iframe" ||
    value === "challenge_path" ||
    value === "challenge_script" ||
    value === "challenge_title" ||
    value === "challenge_widget" ||
    value === "login_form" ||
    value === "password_input"
  );
}
