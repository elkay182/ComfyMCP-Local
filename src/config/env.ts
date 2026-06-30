import { parseEnv, type ComfyMcpConfig } from "./schema.js";
import { validateStartupConfig } from "./validation.js";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ComfyMcpConfig {
  const config = parseEnv(env);
  validateStartupConfig(config);
  return config;
}
