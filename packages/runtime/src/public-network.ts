import type { LookupAddress } from "node:dns";
import { lookup as defaultLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export type PublicHostLookup = (
  hostname: string,
) => Promise<readonly LookupAddress[]>;

export interface PublicHostResolution {
  hostname: string;
  addresses: LookupAddress[];
  loopback: boolean;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const BLOCKED_IPV4 = new BlockList();
const BLOCKED_IPV6 = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED_IPV4.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fec0::", 10],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED_IPV6.addSubnet(network, prefix, "ipv6");
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !BLOCKED_IPV4.check(address, "ipv4");
  if (family === 6) return !BLOCKED_IPV6.check(address, "ipv6");
  return false;
}

export async function resolvePublicHost(
  input: string,
  options: {
    allowLoopback?: boolean;
    lookup?: PublicHostLookup;
  } = {},
): Promise<PublicHostResolution> {
  const hostname = normalizeHostname(input);
  const loopback = LOOPBACK_HOSTS.has(hostname);
  if (loopback) {
    if (!options.allowLoopback) {
      throw new Error("Host resolves to a private or reserved address");
    }
    return {
      hostname,
      addresses: [
        {
          address: hostname === "localhost" ? "127.0.0.1" : hostname,
          family: hostname === "::1" ? 6 : 4,
        },
      ],
      loopback: true,
    };
  }
  if (hostname.endsWith(".local")) {
    throw new Error("Hosts under .local are not allowed");
  }
  const family = isIP(hostname);
  if (family !== 0) {
    if (!isPublicIpAddress(hostname)) {
      throw new Error("Host resolves to a private or reserved address");
    }
    return {
      hostname,
      addresses: [{ address: hostname, family }],
      loopback: false,
    };
  }
  const lookup = options.lookup ?? systemLookup;
  const resolved = [...(await lookup(hostname))];
  if (
    resolved.length === 0 ||
    resolved.some(
      (entry) =>
        (entry.family !== 4 && entry.family !== 6) ||
        !isPublicIpAddress(entry.address),
    )
  ) {
    throw new Error("Host resolves to a private or reserved address");
  }
  const addresses = resolved
    .map((entry) => ({ address: entry.address, family: entry.family }))
    .sort(
      (left, right) =>
        left.family - right.family || left.address.localeCompare(right.address),
    );
  return { hostname, addresses, loopback: false };
}

export function validatePublicHttpUrl(
  value: string,
  options: { allowedPorts?: readonly number[] } = {},
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP(S) URLs are allowed");
  }
  if (url.username || url.password) {
    throw new Error("URL credentials are not allowed");
  }
  const hostname = normalizeHostname(url.hostname);
  if (
    LOOPBACK_HOSTS.has(hostname) ||
    hostname.endsWith(".local") ||
    (isIP(hostname) !== 0 && !isPublicIpAddress(hostname))
  ) {
    throw new Error("URL host is private or reserved");
  }
  const port = effectivePort(url);
  const allowedPorts = options.allowedPorts ?? [80, 443];
  if (!allowedPorts.includes(port)) {
    throw new Error("URL port is not allowed");
  }
  return url;
}

export function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

function normalizeHostname(value: string): string {
  const hostname = value
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/u, "$1");
  if (
    !hostname ||
    hostname.length > 253 ||
    /[\u0000-\u0020\u007f/%@\\]/u.test(hostname)
  ) {
    throw new Error("Hostname is invalid");
  }
  return hostname;
}

async function systemLookup(hostname: string): Promise<LookupAddress[]> {
  return defaultLookup(hostname, { all: true, verbatim: true });
}
