import { describe, expect, it } from "vitest";
import { parseEnv, ConfigError } from "../../src/config/schema.js";
import { validateHttpStartupSettings, validateStartupConfig } from "../../src/config/validation.js";

describe("configuration", () => {
  it("starts in disconnected local stdio mode without required environment", () => {
    const config = parseEnv({});

    expect(config.transport).toBe("stdio");
    expect(config.deploymentMode).toBe("local_stdio");
    expect(config.comfyuiUrl.origin).toBe("http://127.0.0.1:8188");
    expect(() => validateStartupConfig(config)).not.toThrow();
  });

  it("rejects non-loopback ComfyUI origins", () => {
    const config = parseEnv({
      COMFYMCP_COMFYUI_URL: "http://192.168.1.99:8188"
    });

    expect(() => validateStartupConfig(config)).toThrow(ConfigError);
    expect(() => validateStartupConfig(config)).toThrow(/COMFYMCP_ALLOW_LAN_COMFYUI=true/);
  });

  it("accepts explicit HTTPS LAN ComfyUI upstreams", () => {
    const config = parseEnv({
      COMFYMCP_COMFYUI_URL: "https://comfy-gpu.lan.example",
      COMFYMCP_ALLOW_LAN_COMFYUI: "true",
      COMFYMCP_COMFYUI_ALLOWED_HOSTS: "comfy-gpu.lan.example"
    });

    expect(config.allowLanComfyUi).toBe(true);
    expect(config.comfyuiAllowedHosts).toEqual(["comfy-gpu.lan.example"]);
    expect(() => validateStartupConfig(config)).not.toThrow();
  });

  it("rejects LAN ComfyUI upstreams without HTTPS and host allowlisting", () => {
    const config = parseEnv({
      COMFYMCP_COMFYUI_URL: "http://comfy-gpu.lan.example",
      COMFYMCP_ALLOW_LAN_COMFYUI: "true"
    });

    expect(() => validateStartupConfig(config)).toThrow(/HTTPS/);
    expect(() => validateStartupConfig(config)).toThrow(/COMFYMCP_COMFYUI_ALLOWED_HOSTS/);
  });

  it("rejects LAN ComfyUI upstreams when the configured host is not allowlisted", () => {
    const config = parseEnv({
      COMFYMCP_COMFYUI_URL: "https://comfy-gpu.lan.example",
      COMFYMCP_ALLOW_LAN_COMFYUI: "true",
      COMFYMCP_COMFYUI_ALLOWED_HOSTS: "other.lan.example"
    });

    expect(() => validateStartupConfig(config)).toThrow(/must include the configured ComfyUI host/);
  });

  it("accepts private LAN ComfyUI IP literals when explicitly allowlisted", () => {
    const config = parseEnv({
      COMFYMCP_COMFYUI_URL: "https://192.168.1.99:8188",
      COMFYMCP_ALLOW_LAN_COMFYUI: "true",
      COMFYMCP_COMFYUI_ALLOWED_HOSTS: "192.168.1.99:8188"
    });

    expect(() => validateStartupConfig(config)).not.toThrow();
  });

  it("rejects public ComfyUI IP literals even when LAN mode is enabled", () => {
    const config = parseEnv({
      COMFYMCP_COMFYUI_URL: "https://8.8.8.8",
      COMFYMCP_ALLOW_LAN_COMFYUI: "true",
      COMFYMCP_COMFYUI_ALLOWED_HOSTS: "8.8.8.8"
    });

    expect(() => validateStartupConfig(config)).toThrow(/private LAN/);
  });

  it("rejects dormant HTTP listener settings in stdio mode", () => {
    const config = parseEnv({
      COMFYMCP_HTTP_ALLOWED_HOSTS: "comfy-gpu.lan:9100"
    });

    expect(() => validateStartupConfig(config)).toThrow(/HTTP listener settings/);
  });

  it("requires a fail-closed Streamable HTTP configuration", () => {
    const config = parseEnv({
      COMFYMCP_TRANSPORT: "streamable_http"
    });

    expect(validateHttpStartupSettings(config, 0, [])).toEqual(
      expect.arrayContaining([
        "COMFYMCP_HTTP_ADVERTISED_URL is required for Streamable HTTP",
        "Streamable HTTP requires at least one active bearer record",
        "COMFYMCP_HTTP_ALLOWED_CLIENT_CIDRS is required for Streamable HTTP",
        "COMFYMCP_HTTP_ALLOWED_HOSTS is required for Streamable HTTP",
        "COMFYMCP_HTTP_TLS_MODE is required for Streamable HTTP"
      ])
    );
  });

  it("accepts the native TLS private-LAN shape when bearer records exist", () => {
    const config = parseEnv({
      COMFYMCP_TRANSPORT: "streamable_http",
      COMFYMCP_HTTP_BIND: "192.168.1.50",
      COMFYMCP_HTTP_ADVERTISED_URL: "https://comfy-gpu.lan:9100/mcp",
      COMFYMCP_HTTP_TLS_MODE: "native",
      COMFYMCP_HTTP_TLS_CERT: "/tmp/comfy-gpu.crt",
      COMFYMCP_HTTP_TLS_KEY: "/tmp/comfy-gpu.key",
      COMFYMCP_HTTP_ALLOWED_CLIENT_CIDRS: "192.168.1.0/24",
      COMFYMCP_HTTP_ALLOWED_HOSTS: "comfy-gpu.lan:9100"
    });

    expect(validateHttpStartupSettings(config, 1, [])).toEqual([]);
  });
});
