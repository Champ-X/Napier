import { readFile } from "node:fs/promises";

import type { CredentialReference } from "@napier/contracts";
import { describe, expect, it, vi } from "vitest";

import { CredentialCard } from "../src/CredentialCard";
import { CredentialRegister } from "../src/CredentialRegister";
import type { CredentialDraft } from "../src/credential-register-types";
import { renderToStaticMarkup } from "./render-static-preact";

describe("Credential register", () => {
  it("renders an environment-reference form without exposing a secret field", () => {
    const markup = renderToStaticMarkup(
      CredentialRegister({
        providers: ["openai", "anthropic"],
        references: [],
        draft: draft(),
        busy: false,
        busyReferenceId: undefined,
        canAdd: true,
        onProvider: vi.fn(),
        onDraft: vi.fn(),
        onAdd: vi.fn(),
        onCheck: vi.fn(),
        onToggle: vi.fn(),
      }),
    );

    expect(markup).toContain("Provider credentials");
    expect(markup).toContain("OPENAI_API_KEY");
    expect(markup).toContain("No credential references are registered");
    expect(markup).not.toContain('type="password"');
  });

  it("renders Keychain metadata and keeps optional secret entry local to that source", () => {
    const markup = renderToStaticMarkup(
      CredentialRegister({
        providers: ["openai"],
        references: [],
        draft: draft({ sourceType: "macos_keychain" }),
        busy: false,
        busyReferenceId: undefined,
        canAdd: false,
        onProvider: vi.fn(),
        onDraft: vi.fn(),
        onAdd: vi.fn(),
        onCheck: vi.fn(),
        onToggle: vi.fn(),
      }),
    );

    expect(markup).toContain('type="password"');
    expect(markup).toContain("Keychain service");
    expect(markup).toContain("Replace existing Keychain item");
    expect(markup).toContain('aria-busy="false"');
  });

  it("keeps unavailable errors distinct from an unchecked reference", () => {
    const unavailable = renderToStaticMarkup(
      CredentialCard({
        reference: reference({
          availability: "missing",
          lastError: "Environment variable is missing.",
        }),
        busy: false,
        onCheck: vi.fn(),
        onToggle: vi.fn(),
      }),
    );
    const unchecked = renderToStaticMarkup(
      CredentialCard({
        reference: reference({
          availability: "unknown",
          lastError: "Stale diagnostic",
        }),
        busy: false,
        onCheck: vi.fn(),
        onToggle: vi.fn(),
      }),
    );

    expect(unavailable).toContain("Environment variable is missing.");
    expect(unavailable).toContain("availability-missing");
    expect(unchecked).toContain("Not checked");
    expect(unchecked).not.toContain("Stale diagnostic");
  });

  it("owns the full reusable interaction and accessibility contract", async () => {
    const css = (
      await Promise.all(
        ["credential-register.css", "credential-card.css"].map((file) =>
          readFile(new URL(`../src/${file}`, import.meta.url), "utf8"),
        ),
      )
    ).join("\n");

    expect(css).toContain(
      "min-height: calc(var(--control-target-primary) + var(--space-1))",
    );
    expect(css).toContain(":hover:not(:disabled)");
    expect(css).toContain(":active:not(:disabled)");
    expect(css).toContain(":focus-visible");
    expect(css).toContain(":disabled");
    expect(css).toContain('[aria-busy="true"]');
    expect(css).toContain("@container credential-register");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
  });
});

function draft(overrides: Partial<CredentialDraft> = {}): CredentialDraft {
  return {
    providerId: "openai",
    sourceType: "environment",
    label: "OpenAI",
    environmentVariable: "OPENAI_API_KEY",
    keychainService: "napier.openai",
    keychainAccount: "workspace",
    keychainSecret: "",
    replaceExisting: false,
    ...overrides,
  };
}

function reference(
  overrides: Partial<CredentialReference> = {},
): CredentialReference {
  return {
    id: "credential_1",
    providerId: "openai",
    label: "OpenAI",
    source: { type: "environment", variable: "OPENAI_API_KEY" },
    status: "active",
    availability: "available",
    revision: 1,
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}
