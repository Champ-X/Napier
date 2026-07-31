import { describe, expect, it, vi } from "vitest";

import {
  effectivePort,
  isPublicIpAddress,
  resolvePublicHost,
  validatePublicHttpUrl,
} from "../src/public-network.js";

describe("public network policy", () => {
  it("classifies public and non-public IPv4 and IPv6 addresses", () => {
    expect(isPublicIpAddress("1.1.1.1")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);

    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "192.0.2.1",
      "192.168.0.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
      "::",
      "::1",
      "::c0a8:101",
      "::ffff:1.1.1.1",
      "64:ff9b::c0a8:101",
      "2001:db8::1",
      "fc00::1",
      "fe80::1",
      "ff00::1",
    ]) {
      expect(isPublicIpAddress(address), address).toBe(false);
    }
  });

  it("resolves every answer and rejects mixed public and private DNS", async () => {
    const publicLookup = vi.fn(async () => [
      { address: "2606:4700:4700::1111", family: 6 as const },
      { address: "1.1.1.1", family: 4 as const },
    ]);
    await expect(
      resolvePublicHost("Example.COM", { lookup: publicLookup }),
    ).resolves.toEqual({
      hostname: "example.com",
      addresses: [
        { address: "1.1.1.1", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
      ],
      loopback: false,
    });
    expect(publicLookup).toHaveBeenCalledWith("example.com");

    await expect(
      resolvePublicHost("example.com", {
        lookup: async () => [
          { address: "1.1.1.1", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      }),
    ).rejects.toThrow("private or reserved");
    await expect(
      resolvePublicHost("example.com", { lookup: async () => [] }),
    ).rejects.toThrow("private or reserved");
  });

  it("denies local names by default and exposes only an explicit loopback exception", async () => {
    await expect(resolvePublicHost("localhost")).rejects.toThrow(
      "private or reserved",
    );
    await expect(
      resolvePublicHost("[::1]", { allowLoopback: true }),
    ).resolves.toEqual({
      hostname: "::1",
      addresses: [{ address: "::1", family: 6 }],
      loopback: true,
    });
    await expect(resolvePublicHost("printer.local")).rejects.toThrow(".local");
    await expect(resolvePublicHost("fe80::1%en0")).rejects.toThrow(
      "Hostname is invalid",
    );
  });

  it("validates HTTP URLs, credentials, and the configured port boundary", () => {
    expect(validatePublicHttpUrl("https://example.com/path").hostname).toBe(
      "example.com",
    );
    expect(effectivePort(new URL("http://example.com"))).toBe(80);
    expect(effectivePort(new URL("https://example.com"))).toBe(443);
    expect(effectivePort(new URL("https://example.com:8443"))).toBe(8443);

    expect(() => validatePublicHttpUrl("file:///etc/passwd")).toThrow(
      "HTTP(S)",
    );
    expect(() =>
      validatePublicHttpUrl("https://user:secret@example.com"),
    ).toThrow("credentials");
    expect(() => validatePublicHttpUrl("http://localhost")).toThrow(
      "private or reserved",
    );
    expect(() => validatePublicHttpUrl("https://127.0.0.1")).toThrow(
      "private or reserved",
    );
    expect(() => validatePublicHttpUrl("https://printer.local")).toThrow(
      "private or reserved",
    );
    expect(() => validatePublicHttpUrl("https://example.com:8443")).toThrow(
      "port",
    );
    expect(() =>
      validatePublicHttpUrl("https://example.com:8443", {
        allowedPorts: [8443],
      }),
    ).not.toThrow();
  });
});
