import { describe, expect, it } from "vitest";
import {
  classifyIpAddress,
  isAddressInCidrs,
  isLoopbackUrl,
  isPrivateLanAddress
} from "../../src/policy/network-policy.js";

describe("network policy", () => {
  it("classifies allowed local and private address families", () => {
    expect(classifyIpAddress("127.0.0.1")).toBe("loopback");
    expect(classifyIpAddress("192.168.1.50")).toBe("private");
    expect(classifyIpAddress("100.64.1.2")).toBe("shared");
    expect(classifyIpAddress("fd00::1")).toBe("ula");
    expect(classifyIpAddress("8.8.8.8")).toBe("global");
    expect(classifyIpAddress("0.0.0.0")).toBe("wildcard");
  });

  it("recognizes loopback URLs", () => {
    expect(isLoopbackUrl(new URL("http://127.0.0.1:8188"))).toBe(true);
    expect(isLoopbackUrl(new URL("http://localhost:8188"))).toBe(true);
    expect(isLoopbackUrl(new URL("http://192.168.1.50:8188"))).toBe(false);
  });

  it("matches IPv4 CIDRs for admission", () => {
    expect(isAddressInCidrs("192.168.1.77", ["192.168.1.0/24"])).toBe(true);
    expect(isAddressInCidrs("192.168.2.77", ["192.168.1.0/24"])).toBe(false);
    expect(isPrivateLanAddress("192.168.1.77")).toBe(true);
  });
});
