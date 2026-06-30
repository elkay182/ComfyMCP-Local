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
