import {
  isNapierManagementHttpErrorCode,
  managementHttpErrorCodeForStatus,
  NAPIER_MANAGEMENT_HTTP_ERROR_CODES,
  type NapierManagementClientErrorData,
} from "@napier/contracts/management-http";
import { describe, expect, it } from "vitest";

describe("management HTTP contracts", () => {
  it("maps every explicit and fallback status", () => {
    expect(
      [
        [400, "invalid_request"],
        [401, "unauthorized"],
        [403, "forbidden"],
        [404, "not_found"],
        [409, "conflict"],
        [413, "request_too_large"],
        [429, "rate_limited"],
        [422, "http_error"],
        [499, "http_error"],
        [500, "server_error"],
        [503, "server_error"],
      ].map(([status]) => managementHttpErrorCodeForStatus(Number(status))),
    ).toEqual([
      "invalid_request",
      "unauthorized",
      "forbidden",
      "not_found",
      "conflict",
      "request_too_large",
      "rate_limited",
      "http_error",
      "http_error",
      "server_error",
      "server_error",
    ]);
  });

  it("guards the complete finite code set", () => {
    expect(NAPIER_MANAGEMENT_HTTP_ERROR_CODES).toHaveLength(9);
    for (const code of NAPIER_MANAGEMENT_HTTP_ERROR_CODES) {
      expect(isNapierManagementHttpErrorCode(code)).toBe(true);
    }
    expect(isNapierManagementHttpErrorCode("private_error")).toBe(false);
    expect(isNapierManagementHttpErrorCode(404)).toBe(false);
  });

  it("keeps every public error-data variant serializable and bounded", () => {
    const digest = "a".repeat(64);
    const values: NapierManagementClientErrorData[] = [
      {
        kind: "http",
        operation: "get_effective_agent_capabilities",
        status: 404,
        code: "not_found",
        serverMessage: "Agent not found",
        contentSha256: digest,
        messageSha256: digest,
      },
      {
        kind: "transport",
        operation: "get_effective_agent_capabilities",
        reason: "timeout",
      },
      {
        kind: "integrity",
        operation: "get_effective_agent_capabilities",
        status: 200,
        reason: "content_hash_mismatch",
        expectedSha256: digest,
        actualSha256: "b".repeat(64),
      },
      {
        kind: "protocol",
        operation: "get_effective_agent_capabilities",
        status: 200,
        reason: "projection_invalid",
      },
    ];
    expect(JSON.parse(JSON.stringify(values))).toEqual(values);
    expect(JSON.stringify(values)).not.toMatch(
      /\b(?:body|cause|response|stack|url)\b/iu,
    );
  });
});
