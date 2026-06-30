import path from "node:path";

export type PathDecision =
  | { ok: true; normalizedPath: string }
  | { ok: false; reason: "EMPTY_PATH" | "WINDOWS_DEVICE_PATH" | "UNC_PATH" | "RESERVED_NAME" | "OUTSIDE_ROOT" };

const RESERVED_WINDOWS_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9"
]);

export function containPath(root: string, candidate: string): PathDecision {
  if (!candidate) {
    return { ok: false, reason: "EMPTY_PATH" };
  }
  if (/^\\\\[.?]\\/.test(candidate)) {
    return { ok: false, reason: "WINDOWS_DEVICE_PATH" };
  }
  if (/^\\\\/.test(candidate)) {
    return { ok: false, reason: "UNC_PATH" };
  }

  const basename = path.basename(candidate).split(".")[0]?.toLowerCase();
  if (basename && RESERVED_WINDOWS_NAMES.has(basename)) {
    return { ok: false, reason: "RESERVED_NAME" };
  }

  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(resolvedRoot, candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return { ok: true, normalizedPath: resolvedCandidate };
  }
  return { ok: false, reason: "OUTSIDE_ROOT" };
}
