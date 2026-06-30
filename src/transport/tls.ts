import fs from "node:fs";

export type TlsMaterial =
  | { ok: true; cert: Buffer; key: Buffer }
  | { ok: false; reason: "missing" | "unreadable" };

export function loadTlsMaterial(certPath: string | undefined, keyPath: string | undefined): TlsMaterial {
  if (!certPath || !keyPath) {
    return { ok: false, reason: "missing" };
  }
  try {
    return {
      ok: true,
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath)
    };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
