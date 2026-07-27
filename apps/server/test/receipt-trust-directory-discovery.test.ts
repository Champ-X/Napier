import { describe, expect, it } from "vitest";

import {
  MAX_RECEIPT_TRUST_DIRECTORY_RESPONSE_BYTES,
  ReceiptTrustAnchorDirectoryDiscoveryService,
} from "../src/receipt-trust-directory-discovery.js";

const SOURCE_URL = "https://trust.example.test/anchors.json";

describe("receipt trust anchor directory discovery", () => {
  it("rejects redirects before reading a response body", async () => {
    const service = createService(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: "https://other.example.test/anchors.json" },
      });
    });

    await expect(service.discover({ sourceUrl: SOURCE_URL })).rejects.toEqual(
      expect.objectContaining({
        status: 502,
        message:
          "Receipt trust anchor directory source redirects are not allowed",
      }),
    );
  });

  it("rejects declared and streamed responses beyond the fixed body budget", async () => {
    const declaredService = createService(async () => {
      return new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(
            MAX_RECEIPT_TRUST_DIRECTORY_RESPONSE_BYTES + 1,
          ),
        },
      });
    });

    await expect(
      declaredService.discover({ sourceUrl: SOURCE_URL }),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 502,
        message:
          "Receipt trust anchor directory response exceeds the size limit",
      }),
    );

    const streamedService = createService(async () => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new Uint8Array(MAX_RECEIPT_TRUST_DIRECTORY_RESPONSE_BYTES),
            );
            controller.enqueue(new Uint8Array(1));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    await expect(
      streamedService.discover({ sourceUrl: SOURCE_URL }),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 502,
        message:
          "Receipt trust anchor directory response exceeds the size limit",
      }),
    );
  });

  it("maps timeout and endpoint validation failures without URL disclosure", async () => {
    const timeoutService = createService(async () => {
      throw new DOMException("private timeout detail", "TimeoutError");
    });
    await expect(
      timeoutService.discover({ sourceUrl: SOURCE_URL }),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 504,
        message: "Receipt trust anchor directory discovery timed out",
      }),
    );

    const invalidEndpointService =
      new ReceiptTrustAnchorDirectoryDiscoveryService({
        allowedOrigins: ["https://trust.example.test"],
        validateEndpoint: async () => {
          throw new Error(`private endpoint detail: ${SOURCE_URL}`);
        },
        fetcher: async () => {
          throw new Error("fetch must not run");
        },
      });
    await expect(
      invalidEndpointService.discover({ sourceUrl: SOURCE_URL }),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 400,
        message:
          "Receipt trust anchor directory source is not a public HTTPS endpoint",
      }),
    );
  });

  it("rejects non-origin allowlist entries during construction", () => {
    expect(
      () =>
        new ReceiptTrustAnchorDirectoryDiscoveryService({
          allowedOrigins: ["https://trust.example.test/private/path"],
        }),
    ).toThrow("allowed origin is invalid");
  });
});

function createService(
  fetcher: ConstructorParameters<
    typeof ReceiptTrustAnchorDirectoryDiscoveryService
  >[0]["fetcher"],
): ReceiptTrustAnchorDirectoryDiscoveryService {
  return new ReceiptTrustAnchorDirectoryDiscoveryService({
    allowedOrigins: ["https://trust.example.test"],
    validateEndpoint: async () => undefined,
    ...(fetcher ? { fetcher } : {}),
  });
}
