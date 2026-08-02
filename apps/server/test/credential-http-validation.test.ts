import { describe, expect, it } from "vitest";

import {
  parseCreateCredentialReferenceRequest,
  parseCreateMacOsKeychainCredentialRequest,
  parseCredentialThreadContextRequest,
  parseSetCredentialReferenceStatusRequest,
} from "../src/credential-http-validation.js";

describe("Credential HTTP validation", () => {
  it("normalizes environment references and rejects unknown fields", () => {
    expect(
      parseCreateCredentialReferenceRequest({
        providerId: " DeepSeek ",
        label: "  Server   environment  ",
        source: {
          type: "environment",
          variable: " DEEPSEEK_API_KEY ",
        },
        threadId: "thread_0123456789abcdef",
      }),
    ).toEqual({
      providerId: "deepseek",
      label: "Server environment",
      source: {
        type: "environment",
        variable: "DEEPSEEK_API_KEY",
      },
      threadId: "thread_0123456789abcdef",
    });
    expect(
      parseCreateCredentialReferenceRequest({
        providerId: "deepseek",
        label: "Server environment",
        source: {
          type: "environment",
          variable: "DEEPSEEK_API_KEY",
        },
        unexpected: true,
      }),
    ).toBeUndefined();
    expect(
      parseCreateCredentialReferenceRequest({
        providerId: "deepseek",
        label: "Server environment",
        source: {
          type: "environment",
          variable: "lowercase-key",
        },
      }),
    ).toBeUndefined();
  });

  it("bounds Keychain writes without returning malformed secrets", () => {
    expect(
      parseCreateMacOsKeychainCredentialRequest({
        providerId: " OpenAI ",
        label: " Production ",
        service: " Napier ",
        account: " operator ",
        secret: " private-secret ",
        replaceExisting: true,
      }),
    ).toEqual({
      providerId: "openai",
      label: "Production",
      service: "Napier",
      account: "operator",
      secret: "private-secret",
      replaceExisting: true,
    });
    expect(
      parseCreateMacOsKeychainCredentialRequest({
        providerId: "openai",
        label: "Production",
        service: "Napier\nInjected",
        account: "operator",
        secret: "private-secret",
      }),
    ).toBeUndefined();
    expect(
      parseCreateMacOsKeychainCredentialRequest({
        providerId: "openai",
        label: "Production",
        service: "Napier",
        account: "operator",
        secret: "short",
      }),
    ).toBeUndefined();
  });

  it("accepts only exact optional thread and status request shapes", () => {
    expect(parseCredentialThreadContextRequest(undefined)).toEqual({});
    expect(
      parseCredentialThreadContextRequest({
        threadId: "thread_0123456789abcdef",
      }),
    ).toEqual({ threadId: "thread_0123456789abcdef" });
    expect(
      parseCredentialThreadContextRequest({
        threadId: "thread_0123456789abcdef",
        unexpected: true,
      }),
    ).toBeUndefined();
    expect(
      parseSetCredentialReferenceStatusRequest({
        status: "disabled",
        threadId: "thread_0123456789abcdef",
      }),
    ).toEqual({
      status: "disabled",
      threadId: "thread_0123456789abcdef",
    });
    expect(
      parseSetCredentialReferenceStatusRequest({ status: "pending" }),
    ).toBeUndefined();
  });
});
