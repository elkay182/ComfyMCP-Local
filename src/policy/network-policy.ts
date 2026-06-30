import net from "node:net";

export type IpAddressClass =
  | "loopback"
  | "private"
  | "shared"
  | "ula"
  | "link_local"
  | "wildcard"
  | "global"
  | "invalid";

export function isLoopbackUrl(url: URL): boolean {
  return (url.protocol === "http:" || url.protocol === "https:") && isLoopbackAddress(url.hostname);
}

export function isLoopbackAddress(value: string): boolean {
  const host = normalizeHost(value);
  if (host === "localhost") {
    return true;
  }
  if (net.isIPv4(host)) {
    const parts = host.split(".").map(Number);
    return parts[0] === 127;
  }
  if (net.isIPv6(host)) {
    return host === "::1" || host.toLowerCase() === "0:0:0:0:0:0:0:1";
  }
  return false;
}

export function isWildcardAddress(value: string): boolean {
  const host = normalizeHost(value);
  return host === "0.0.0.0" || host === "::";
}

export function isPrivateLanAddress(value: string): boolean {
  const addressClass = classifyIpAddress(value);
  return addressClass === "private" || addressClass === "shared" || addressClass === "ula";
}

export function classifyIpAddress(value: string): IpAddressClass {
  const host = normalizeHost(value);
  if (isWildcardAddress(host)) {
    return "wildcard";
  }
  if (isLoopbackAddress(host)) {
    return "loopback";
  }
  if (net.isIPv4(host)) {
    const [a = 0, b = 0] = host.split(".").map(Number);
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return "private";
    }
    if (a === 100 && b >= 64 && b <= 127) {
      return "shared";
    }
    if (a === 169 && b === 254) {
      return "link_local";
    }
    return "global";
  }
  if (net.isIPv6(host)) {
    const lower = host.toLowerCase();
    if (lower.startsWith("fc") || lower.startsWith("fd")) {
      return "ula";
    }
    if (lower.startsWith("fe80:")) {
      return "link_local";
    }
    return "global";
  }
  return "invalid";
}

export function normalizeHost(value: string): string {
  return value.trim().replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

export function isIpv4InCidr(address: string, cidr: string): boolean {
  const [range, prefixRaw] = cidr.split("/");
  if (!range || prefixRaw === undefined || !net.isIPv4(range) || !net.isIPv4(address)) {
    return false;
  }
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(address) & mask) === (ipv4ToInt(range) & mask);
}

export function isAddressInCidrs(address: string, cidrs: string[]): boolean {
  const normalized = normalizeHost(address);
  return cidrs.some((cidr) => {
    if (cidr.includes("/")) {
      return isIpv4InCidr(normalized, cidr);
    }
    return normalizeHost(cidr) === normalized;
  });
}

function ipv4ToInt(address: string): number {
  return address
    .split(".")
    .map(Number)
    .reduce((accumulator, octet) => ((accumulator << 8) | octet) >>> 0, 0);
}
