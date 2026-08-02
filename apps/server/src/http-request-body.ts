export class RequestBodyTooLargeError extends Error {}

export async function readOptionalLimitedJson(
  request: Request,
  maximumBytes: number,
  subject: string,
): Promise<unknown | undefined> {
  const body = await readLimitedBody(request, maximumBytes, subject, false);
  if (body === undefined || body.byteLength === 0) return undefined;
  const source = body.toString("utf8");
  return source.trim() ? (JSON.parse(source) as unknown) : undefined;
}

export async function readLimitedBytes(
  request: Request,
  maximumBytes: number,
  subject: string,
): Promise<Buffer> {
  const body = await readLimitedBody(request, maximumBytes, subject, true);
  if (!body) throw new Error("request body is required");
  return body;
}

export async function readLimitedJson(
  request: Request,
  maximumBytes: number,
  subject = "Thread replay import",
): Promise<unknown> {
  const body = await readLimitedBody(request, maximumBytes, subject, true);
  if (!body || body.byteLength === 0) {
    throw new Error("request body is required");
  }
  return JSON.parse(body.toString("utf8")) as unknown;
}

async function readLimitedBody(
  request: Request,
  maximumBytes: number,
  subject: string,
  required: boolean,
): Promise<Buffer | undefined> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    Number.isFinite(Number(declaredLength)) &&
    Number(declaredLength) > maximumBytes
  ) {
    throw new RequestBodyTooLargeError(
      `${subject} exceeds ${maximumBytes} bytes`,
    );
  }
  if (!request.body) {
    if (required) throw new Error("request body is required");
    return undefined;
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError(
          `${subject} exceeds ${maximumBytes} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
