import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/schema.js";
import {
  isConfiguredComfyHostAllowed,
  validateResolvedComfyAddresses
} from "../../src/policy/comfy-upstream-policy.js";

describe("ComfyUI upstream policy", () => {
  it("allows configured hostnames with or without explicit default ports", () => {
    const config = parseEnv({
      COMFYMCP_COMFYUI_URL: "https://comfy-gpu.lan.example",
      COMFYMCP_ALLOW_LAN_COMFYUI: "true",
      COMFYMCP_COMFYUI_ALLOWED_HOSTS: "comfy-gpu.lan.example,comfy-gpu.lan.example:443"
    });

    expect(isConfiguredComfyHostAllowed(config, config.comfyuiUrl)).toBe(true);
  });

  it("accepts private LAN DNS answers", () => {
    const config = parseEnv({
      COMFYMCP_COMFYUI_URL: "https://comfy-gpu.lan.example",
      COMFYMCP_ALLOW_LAN_COMFYUI: "true",
      COMFYMCP_COMFYUI_ALLOWED_HOSTS: "comfy-gpu.lan.example"
    });

    expect(() =>
      validateResolvedComfyAddresses(config, [{ address: "192.168.1.42" }, { address: "fd00::42" }])
    ).not.toThrow();
  });

  it("rejects public DNS answers", () => {
    const config = parseEnv({
      COMFYMCP_COMFYUI_URL: "https://comfy-gpu.lan.example",
      COMFYMCP_ALLOW_LAN_COMFYUI: "true",
      COMFYMCP_COMFYUI_ALLOWED_HOSTS: "comfy-gpu.lan.example"
    });

    expect(() => validateResolvedComfyAddresses(config, [{ address: "192.168.1.42" }, { address: "8.8.8.8" }])).toThrow(
      /outside private LAN/
    );
  });

  it("rejects empty DNS results", () => {
    const config = parseEnv({
      COMFYMCP_COMFYUI_URL: "https://comfy-gpu.lan.example",
      COMFYMCP_ALLOW_LAN_COMFYUI: "true",
      COMFYMCP_COMFYUI_ALLOWED_HOSTS: "comfy-gpu.lan.example"
    });

    expect(() => validateResolvedComfyAddresses(config, [])).toThrow(/did not resolve/);
  });
});
