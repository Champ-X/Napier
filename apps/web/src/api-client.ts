import {
  parseVerifiedJson,
  requireNapierContentHash,
  throwNapierApiError,
  verifyNapierBodyContentHash,
  verifyNapierContentHash,
} from "./api-error";

export interface NapierJsonResponse<T> {
  body: T;
  headers: Headers;
}

export async function requestJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  return (await requestJsonWithResponse<T>(path, init)).body;
}

export async function requestJsonWithResponse<T>(
  path: string,
  init?: RequestInit,
): Promise<NapierJsonResponse<T>> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    await throwNapierApiError(response, "Request failed", path);
  }
  const text = await response.text();
  requireNapierContentHash(path, response);
  const verifiedBodySha256 = await verifyNapierBodyContentHash(
    path,
    response,
    text,
  );
  const payload = parseVerifiedJson<T>(
    path,
    response,
    text,
    verifiedBodySha256,
  );
  if (!verifiedBodySha256) {
    await verifyNapierContentHash(path, response, text, payload);
  }
  return { body: payload, headers: response.headers };
}
