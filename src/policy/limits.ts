import { DEFAULT_LIMITS, type LimitsConfig } from "../config/schema.js";

export function mergeTightenedLimits(
  serverLimits: LimitsConfig = DEFAULT_LIMITS,
  requested: Partial<LimitsConfig> | undefined
): LimitsConfig {
  if (!requested) {
    return serverLimits;
  }
  const merged = { ...serverLimits };
  for (const key of Object.keys(requested) as Array<keyof LimitsConfig>) {
    const value = requested[key];
    if (typeof value === "number" && value > 0) {
      merged[key] = Math.min(serverLimits[key], value);
    }
  }
  return merged;
}
