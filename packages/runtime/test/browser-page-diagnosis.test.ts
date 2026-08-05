import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";

import {
  createBrowserPageDiagnosis,
  probeBrowserPageDiagnosis,
} from "../src/browser-page-diagnosis.js";
import { sha256 } from "../src/ed25519.js";

describe("Browser page diagnosis evidence", () => {
  it("returns stable hash-only evidence and prioritizes challenges", () => {
    const diagnosis = createBrowserPageDiagnosis({
      signals: [
        "password_input",
        "challenge_iframe",
        "challenge_iframe",
        "login_form",
      ],
    });

    expect(diagnosis).toEqual({
      status: "challenge_detected",
      signalCount: 3,
      signalsSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      takeoverRecommended: true,
    });
    expect(JSON.stringify(diagnosis)).not.toContain("password_input");
    expect(JSON.stringify(diagnosis)).not.toContain("challenge_iframe");
  });

  it("fails closed to none for unknown or text-derived signals", () => {
    const diagnosis = createBrowserPageDiagnosis({
      signals: [
        "article_mentions_captcha",
        "private page text",
        "login_form_article",
      ],
    });

    expect(diagnosis).toEqual({
      status: "none",
      signalCount: 0,
      signalsSha256: sha256("[]"),
      takeoverRecommended: false,
    });
  });

  it("ignores ordinary article text that discusses login and CAPTCHA", () => {
    const { document } = parseHTML(`
      <html>
        <head><title>How login and CAPTCHA systems work</title></head>
        <body>
          <article>
            <h1>Login and CAPTCHA design</h1>
            <p>Verify you are human is common text in a CAPTCHA article.</p>
          </article>
        </body>
      </html>
    `);

    const diagnosis = createBrowserPageDiagnosis(
      probeBrowserPageDiagnosis(document.body, {
        kind: "diagnosis",
        href: "https://example.com/articles/captcha-login",
      }),
    );

    expect(diagnosis.status).toBe("none");
    expect(diagnosis.signalCount).toBe(0);
  });

  it("detects password forms and known challenge structures", () => {
    const login = parseHTML(`
      <html><body><form><input type="password" value="PRIVATE"></form></body></html>
    `).document;
    const challenge = parseHTML(`
      <html>
        <head><title>Just a moment</title></head>
        <body>
          <div class="cf-turnstile"></div>
          <iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/widget"></iframe>
        </body>
      </html>
    `).document;

    const loginDiagnosis = createBrowserPageDiagnosis(
      probeBrowserPageDiagnosis(login.body, {
        kind: "diagnosis",
        href: "https://example.com/login",
      }),
    );
    const challengeDiagnosis = createBrowserPageDiagnosis(
      probeBrowserPageDiagnosis(challenge.body, {
        kind: "diagnosis",
        href: "https://example.com/cdn-cgi/challenge-platform/",
      }),
    );

    expect(loginDiagnosis).toEqual(
      expect.objectContaining({
        status: "login_required",
        signalCount: 2,
        takeoverRecommended: true,
      }),
    );
    expect(challengeDiagnosis).toEqual(
      expect.objectContaining({
        status: "challenge_detected",
        signalCount: 4,
        takeoverRecommended: true,
      }),
    );
    expect(JSON.stringify(loginDiagnosis)).not.toContain("PRIVATE");
  });
});
