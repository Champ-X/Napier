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

export function probeBrowserPageDiagnosis(
  root: HTMLElement,
  request: { kind: "diagnosis"; href: string },
): BrowserPageDiagnosisProbe {
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
  return { signals: [...signals].sort() };

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
