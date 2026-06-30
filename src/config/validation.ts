import { type ComfyMcpConfig, ConfigError } from "./schema.js";
import {
  classifyIpAddress,
  isLoopbackAddress,
  isPrivateLanAddress,
  isWildcardAddress,
  isLoopbackUrl
} from "../policy/network-policy.js";

export function validateStartupConfig(config: ComfyMcpConfig, activeBearerRecords = 0): void {
  const issues: string[] = [];

  if (!isLoopbackUrl(config.comfyuiUrl)) {
    issues.push("COMFYMCP_COMFYUI_URL must be an exact loopback origin");
  }
  if (config.comfyuiUrl.username || config.comfyuiUrl.password) {
    issues.push("COMFYMCP_COMFYUI_URL must not contain credentials");
  }
  if (config.comfyuiUrl.pathname !== "/" || config.comfyuiUrl.search || config.comfyuiUrl.hash) {
    issues.push("COMFYMCP_COMFYUI_URL must be an origin without path, query, or fragment");
  }
  if (config.requireEgressEnforcement && config.egressAssurance !== "container_verified") {
    issues.push("generation requires container_verified egress assurance");
  }

  if (config.transport === "stdio") {
    if (
      config.http.advertisedUrl ||
      config.http.tlsMode ||
      config.http.tlsCert ||
      config.http.tlsKey ||
      config.http.allowedClientCidrs.length > 0 ||
      config.http.allowedHosts.length > 0
    ) {
      issues.push("HTTP listener settings are invalid when COMFYMCP_TRANSPORT=stdio");
    }
  } else {
    validateHttpStartupSettings(config, activeBearerRecords, issues);
  }

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }
}

export function validateHttpStartupSettings(
  config: ComfyMcpConfig,
  activeBearerRecords: number,
  issues: string[] = []
): string[] {
  const { http } = config;
  const bindClass = classifyIpAddress(http.bind);
  const nonLoopbackBind = !isLoopbackAddress(http.bind);

  if (!http.advertisedUrl) {
    issues.push("COMFYMCP_HTTP_ADVERTISED_URL is required for Streamable HTTP");
  } else {
    if (http.advertisedUrl.protocol !== "https:") {
      issues.push("COMFYMCP_HTTP_ADVERTISED_URL must be HTTPS");
    }
    if (http.advertisedUrl.pathname !== http.path) {
      issues.push("COMFYMCP_HTTP_ADVERTISED_URL must end at /mcp");
    }
    if (!http.allowedHosts.includes(http.advertisedUrl.host)) {
      issues.push("COMFYMCP_HTTP_ALLOWED_HOSTS must include the advertised host");
    }
  }

  if (activeBearerRecords <= 0) {
    issues.push("Streamable HTTP requires at least one active bearer record");
  }
  if (http.allowedClientCidrs.length === 0) {
    issues.push("COMFYMCP_HTTP_ALLOWED_CLIENT_CIDRS is required for Streamable HTTP");
  }
  if (http.allowedHosts.length === 0) {
    issues.push("COMFYMCP_HTTP_ALLOWED_HOSTS is required for Streamable HTTP");
  }
  if (isWildcardAddress(http.bind)) {
    issues.push("wildcard HTTP bind addresses are rejected");
  }
  if (nonLoopbackBind && !isPrivateLanAddress(http.bind)) {
    issues.push(`HTTP bind address must be private LAN or loopback, got ${bindClass}`);
  }
  if (!http.tlsMode) {
    issues.push("COMFYMCP_HTTP_TLS_MODE is required for Streamable HTTP");
  } else if (http.tlsMode === "native") {
    if (!http.tlsCert || !http.tlsKey) {
      issues.push("native TLS requires COMFYMCP_HTTP_TLS_CERT and COMFYMCP_HTTP_TLS_KEY");
    }
    if (!nonLoopbackBind) {
      issues.push("native TLS LAN mode requires an explicit non-loopback private bind address");
    }
    if (http.trustedProxyCidrs.length > 0) {
      issues.push("trusted proxy CIDRs are invalid with native TLS");
    }
  } else if (http.tlsMode === "trusted_proxy") {
    if (nonLoopbackBind) {
      issues.push("trusted-proxy mode must bind ComfyMCP to loopback");
    }
    if (http.trustedProxyCidrs.length === 0) {
      issues.push("trusted-proxy mode requires COMFYMCP_HTTP_TRUSTED_PROXY_CIDRS");
    }
    if (http.tlsCert || http.tlsKey) {
      issues.push("native TLS certificate settings are invalid with trusted-proxy mode");
    }
  }

  return issues;
}
