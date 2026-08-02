import { createHmac, timingSafeEqual } from "node:crypto";

export function inboundChannelToken(headers: Headers): string | undefined {
  const authorization = headers.get("authorization")?.trim();
  const bearer = authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/u);
  if (bearer?.[1]) return bearer[1];
  const direct = headers.get("x-napier-channel-token")?.trim();
  return direct && /^[A-Za-z0-9_-]{32,128}$/u.test(direct) ? direct : undefined;
}

export function validInboundSignature(
  headers: Headers,
  body: string,
  token: string,
  toleranceSeconds: number,
): boolean {
  const timestamp = headers.get("x-napier-channel-timestamp")?.trim();
  const signature = headers.get("x-napier-channel-signature")?.trim();
  if (!timestamp || !signature) return false;
  const timestampMs = Date.parse(timestamp);
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > toleranceSeconds * 1_000
  ) {
    return false;
  }
  const expected = createHmac("sha256", token)
    .update(`${timestamp}\n${body}`)
    .digest("hex");
  const normalized = signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;
  if (!/^[a-f0-9]{64}$/iu.test(normalized)) return false;
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(normalized.toLowerCase(), "hex");
  return right.byteLength === left.byteLength && timingSafeEqual(left, right);
}
