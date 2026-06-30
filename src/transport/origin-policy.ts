import type { ComfyMcpConfig } from "../config/schema.js";

export function assertComfyOrigin(config: ComfyMcpConfig, target: URL): void {
  if (target.origin !== config.comfyuiUrl.origin) {
    throw new Error("ComfyUI request target does not match configured origin");
  }
  if (target.pathname.startsWith("//")) {
    throw new Error("ComfyUI request target contains an invalid path");
  }
}

export function resolveComfyUrl(config: ComfyMcpConfig, pathname: string): URL {
  const target = new URL(pathname, config.comfyuiUrl);
  assertComfyOrigin(config, target);
  return target;
}
