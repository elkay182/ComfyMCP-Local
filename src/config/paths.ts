import path from "node:path";

export function defaultStateDir(platform = process.platform, home = process.env.HOME): string {
  if (platform === "win32") {
    const appData = process.env.LOCALAPPDATA ?? home ?? ".";
    return path.join(appData, "comfymcp-local");
  }
  if (platform === "darwin") {
    return path.join(home ?? ".", "Library", "Application Support", "comfymcp-local");
  }
  return path.join(home ?? ".", ".local", "state", "comfymcp-local");
}

export function joinStatePath(stateDir: string, child: string): string {
  return path.join(stateDir, child);
}
