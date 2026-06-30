import type { ComfyMcpConfig } from "../config/schema.js";
import { validateHttpStartupSettings } from "../config/validation.js";

export function assertStreamableHttpReady(config: ComfyMcpConfig, activeBearerRecords: number): void {
  const issues = validateHttpStartupSettings(config, activeBearerRecords, []);
  if (issues.length > 0) {
    throw new Error(issues.join("; "));
  }
}
