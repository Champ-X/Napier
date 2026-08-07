export const NAPIER_MANAGEMENT_HTTP_ERROR_CODES = [
  "invalid_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "request_too_large",
  "rate_limited",
  "server_error",
  "http_error",
] as const;

export type NapierManagementHttpErrorCode =
  (typeof NAPIER_MANAGEMENT_HTTP_ERROR_CODES)[number];

export type NapierManagementOperation = "get_effective_agent_capabilities";

export type NapierManagementClientErrorData =
  | {
      readonly kind: "http";
      readonly operation: NapierManagementOperation;
      readonly status: number;
      readonly code: NapierManagementHttpErrorCode;
      readonly serverMessage: string;
      readonly contentSha256: string;
      readonly messageSha256: string;
    }
  | {
      readonly kind: "transport";
      readonly operation: NapierManagementOperation;
      readonly reason: "aborted" | "timeout" | "network_failure";
    }
  | {
      readonly kind: "integrity";
      readonly operation: NapierManagementOperation;
      readonly status: number;
      readonly reason:
        | "content_hash_missing"
        | "content_hash_mode_invalid"
        | "content_hash_invalid"
        | "content_hash_mismatch"
        | "projection_hash_missing"
        | "projection_hash_invalid"
        | "projection_hash_mismatch"
        | "error_message_hash_missing"
        | "error_message_hash_invalid"
        | "error_message_hash_mismatch";
      readonly expectedSha256?: string;
      readonly actualSha256?: string;
    }
  | {
      readonly kind: "protocol";
      readonly operation: NapierManagementOperation;
      readonly status?: number;
      readonly reason:
        | "redirected"
        | "response_too_large"
        | "unexpected_status"
        | "content_type_invalid"
        | "utf8_invalid"
        | "json_invalid"
        | "projection_invalid"
        | "agent_identity_mismatch"
        | "error_envelope_invalid"
        | "error_status_missing"
        | "error_status_invalid"
        | "error_status_mismatch"
        | "error_code_missing"
        | "error_code_invalid"
        | "error_code_mismatch";
    };

export function managementHttpErrorCodeForStatus(
  status: number,
): NapierManagementHttpErrorCode {
  switch (status) {
    case 400:
      return "invalid_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 413:
      return "request_too_large";
    case 429:
      return "rate_limited";
    default:
      return status >= 500 ? "server_error" : "http_error";
  }
}

export function isNapierManagementHttpErrorCode(
  value: unknown,
): value is NapierManagementHttpErrorCode {
  return (
    typeof value === "string" &&
    (NAPIER_MANAGEMENT_HTTP_ERROR_CODES as readonly string[]).includes(value)
  );
}
