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
        effect: action === "type" ? "data_entry" : "interaction",
        signalCount: 0,
        signalsSha256: sha256("[]"),
      });
    }
  });

  it("drops unknown probe signals from public evidence", () => {
    expect(
      createBrowserSensitiveTargetEvidence({
        signals: ["private body", "passwordish"],
        effect: "interaction",
      }),
    ).toEqual({
      status: "ordinary",
      effect: "interaction",
      signalCount: 0,
      signalsSha256: sha256("[]"),
    });
  });

  it("classifies fixed high-impact click effects without returning labels", () => {
    const document = parseHTML(`
      <html><body>
        <button id="delete">Delete account</button>
        <button id="purchase">Place order</button>
        <button id="publish">Publish post</button>
        <button id="send">Send message</button>
        <button id="permission">Grant access</button>
        <form><button id="submit">Continue</button></form>
        <button id="ordinary" type="button">Open details</button>
      </body></html>
    `).document;
    const expected = {
      "#delete": "deletion",
      "#purchase": "purchase",
      "#publish": "publication",
      "#send": "communication",
      "#permission": "permission_change",
      "#submit": "form_submit",
      "#ordinary": "interaction",
    } as const;

    for (const [selector, effect] of Object.entries(expected)) {
      const probe = probeBrowserSensitiveTarget(
        document.querySelector<HTMLElement>(selector)!,
        { action: "click" },
      );
      expect(probe.effect).toBe(effect);
      expect(JSON.stringify(probe)).not.toContain(
        document.querySelector<HTMLElement>(selector)!.textContent,
      );
    }
  });

  it("classifies non-click effects from the action", () => {
    const document = parseHTML(
      `<html><body><input id="target" autocomplete="off"></body></html>`,
    ).document;
    const target = document.querySelector<HTMLElement>("#target")!;
    expect(probeBrowserSensitiveTarget(target, { action: "type" }).effect).toBe(
      "data_entry",
    );
    expect(
      probeBrowserSensitiveTarget(target, { action: "select" }).effect,
    ).toBe("selection_change");
    expect(
      probeBrowserSensitiveTarget(target, { action: "upload" }).effect,
    ).toBe("file_upload");
    expect(
      probeBrowserSensitiveTarget(target, { action: "download" }).effect,
    ).toBe("file_download");
  });
});
