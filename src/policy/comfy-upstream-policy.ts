import dns from "node:dns/promises";
import net from "node:net";
import type { ComfyMcpConfig } from "../config/schema.js";
import { isLoopbackUrl, isPrivateLanAddress, normalizeHost } from "./network-policy.js";

export type DnsLookupAddress = {
  address: string;
};

export async function assertComfyUpstreamAllowed(config: ComfyMcpConfig, target: URL): Promise<void> {
  const issues = validateComfyUpstreamStartup(config, []);
  if (issues.length > 0) {
    throw new Error(issues.join("; "));
  }

  if (isLoopbackUrl(config.comfyuiUrl)) {
    return;
  }

  if (!sameHttpOrigin(config.comfyuiUrl, target)) {
    throw new Error("ComfyUI request target does not match configured origin");
  }

  if (isIpLiteral(target.hostname)) {
    validateResolvedComfyAddresses(config, [{ address: normalizeHost(target.hostname) }]);
    return;
  }

  const addresses = await dns.lookup(target.hostname, {
    all: true,
    verbatim: true
  });
  validateResolvedComfyAddresses(config, addresses);
}

export function validateComfyUpstreamStartup(config: ComfyMcpConfig, issues: string[] = []): string[] {
  if (isLoopbackUrl(config.comfyuiUrl)) {
    return issues;
  }

  if (!config.allowLanComfyUi) {
    issues.push("COMFYMCP_COMFYUI_URL must be an exact loopback origin unless COMFYMCP_ALLOW_LAN_COMFYUI=true");
    return issues;
  }

  if (config.comfyuiUrl.protocol !== "https:") {
    issues.push("LAN ComfyUI upstreams require COMFYMCP_COMFYUI_URL to use HTTPS");
  }
  if (config.comfyuiAllowedHosts.length === 0) {
    issues.push("COMFYMCP_COMFYUI_ALLOWED_HOSTS is required when COMFYMCP_ALLOW_LAN_COMFYUI=true");
  } else if (!isConfiguredComfyHostAllowed(config, config.comfyuiUrl)) {
    issues.push("COMFYMCP_COMFYUI_ALLOWED_HOSTS must include the configured ComfyUI host");
  }

  if (isIpLiteral(config.comfyuiUrl.hostname) && !isPrivateLanAddress(config.comfyuiUrl.hostname)) {
    issues.push("LAN ComfyUI IP literals must be private LAN addresses");
  }

  return issues;
}

export function validateResolvedComfyAddresses(
  config: ComfyMcpConfig,
  addresses: readonly DnsLookupAddress[]
): void {
  if (addresses.length === 0) {
    throw new Error(`ComfyUI upstream ${config.comfyuiUrl.hostname} did not resolve`);
  }
  const unsafe = addresses.find((address) => !isPrivateLanAddress(address.address));
  if (unsafe) {
    throw new Error(
      `ComfyUI upstream ${config.comfyuiUrl.hostname} resolved outside private LAN ranges: ${unsafe.address}`
    );
  }
}

export function isConfiguredComfyHostAllowed(config: ComfyMcpConfig, url: URL): boolean {
  const urlHost = normalizeHost(url.hostname);
  const urlHostWithPort = normalizeHost(url.host);
  return config.comfyuiAllowedHosts.some((entry) => {
    const normalized = normalizeHost(entry);
    return normalized === urlHost || normalized === urlHostWithPort;
  });
}

function sameHttpOrigin(configured: URL, target: URL): boolean {
  const targetAsHttp = new URL(target);
  if (targetAsHttp.protocol === "wss:") {
    targetAsHttp.protocol = "https:";
  } else if (targetAsHttp.protocol === "ws:") {
    targetAsHttp.protocol = "http:";
  }
  return configured.origin === targetAsHttp.origin;
}

function isIpLiteral(value: string): boolean {
  return net.isIP(normalizeHost(value)) !== 0;
}
