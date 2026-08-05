import os from "node:os";
import path from "node:path";

function resolveWorkspacePath(): string {
  const fromEnv = process.env.DIMCAN_WORKSPACE?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  if (process.platform === "win32") {
    return String.raw`K:\RenovationPlatform\Dimcan Workspace`;
  }

  return path.join(os.homedir(), "Dimcan Workspace");
}

export const WORKSPACE_PATH = resolveWorkspacePath();
export const PROJECTS_ROOT = path.join(WORKSPACE_PATH, "Projects");
export const ARCHIVE_PROJECTS_ROOT = path.join(WORKSPACE_PATH, "Archive", "Projects");

export const STANDARD_FOLDERS = [
  "Projects",
  "Clients",
  "Suppliers",
  "Templates",
  "Price Lists",
  "Standards",
  "AI Knowledge",
  "Archive",
];

// Log the resolved root once at startup so a misconfigured path is obvious.
console.info(`[dimcan] Workspace root: ${WORKSPACE_PATH}`);
