import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";

import {
  createBrowserSensitiveTargetEvidence,
  probeBrowserSensitiveTarget,
} from "../src/browser-sensitive-target.js";
import { sha256 } from "../src/ed25519.js";

describe("Browser sensitive target probe", () => {
  it("is self-contained when serialized for Playwright evaluation", () => {
    const reconstructed = Function(
      `"use strict"; return (${probeBrowserSensitiveTarget.toString()});`,
    )() as typeof probeBrowserSensitiveTarget;
    const document = parseHTML(`
      <html><body><form>
        <input id="user" autocomplete="username">
        <input type="password">
      </form></body></html>
    `).document;

    expect(
      createBrowserSensitiveTargetEvidence(
        reconstructed(document.querySelector<HTMLElement>("#user")!, {
          action: "type",
        }),
      ).status,
    ).toBe("credential");
  });

  it("requires human takeover for credential fields and login submit", () => {
    const document = parseHTML(`
      <html><body>
        <form>
          <input id="user" autocomplete="username">
          <input id="password" type="password" value="PRIVATE">
          <button id="submit">Sign in</button>
        </form>
      </body></html>
    `).document;

    for (const [selector, action] of [
      ["#user", "type"],
      ["#password", "type"],
      ["#submit", "click"],
    ] as const) {
      const probe = probeBrowserSensitiveTarget(
        document.querySelector<HTMLElement>(selector)!,
        { action },
      );
      const evidence = createBrowserSensitiveTargetEvidence(probe);
      expect(evidence).toEqual(
        expect.objectContaining({
          status: "credential",
          signalCount: expect.any(Number),
          signalsSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      );
      expect(evidence.signalCount).toBeGreaterThan(0);
      expect(JSON.stringify({ probe, evidence })).not.toContain("PRIVATE");
    }
  });

  it("requires human takeover for challenge widgets and exact controls", () => {
    const document = parseHTML(`
      <html><body>
        <div class="cf-turnstile"><button id="widget">Continue</button></div>
        <button id="human">Verify you are human</button>
      </body></html>
    `).document;

    for (const selector of ["#widget", "#human"]) {
      expect(
        createBrowserSensitiveTargetEvidence(
          probeBrowserSensitiveTarget(
            document.querySelector<HTMLElement>(selector)!,
            { action: "click" },
          ),
        ).status,
      ).toBe("human_verification");
    }
  });

  it("keeps ordinary fields and non-submit login-page controls eligible", () => {
    const document = parseHTML(`
      <html><body>
        <form>
          <input type="password">
          <button id="cancel" type="button">Cancel</button>
        </form>
        <input id="search" autocomplete="off">
      </body></html>
    `).document;

    for (const [selector, action] of [
      ["#cancel", "click"],
      ["#search", "type"],
    ] as const) {
      expect(
        createBrowserSensitiveTargetEvidence(
          probeBrowserSensitiveTarget(
            document.querySelector<HTMLElement>(selector)!,
            { action },
          ),
        ),
      ).toEqual({
        status: "ordinary",
        signalCount: 0,
        signalsSha256: sha256("[]"),
      });
    }
  });

  it("drops unknown probe signals from public evidence", () => {
    expect(
      createBrowserSensitiveTargetEvidence({
        signals: ["private body", "passwordish"],
      }),
    ).toEqual({
      status: "ordinary",
      signalCount: 0,
      signalsSha256: sha256("[]"),
    });
  });
});
