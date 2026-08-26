import os from "node:os";
import path from "node:path";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

export const AGENT_DEMO_VERSION = "0.3.1";

export function getStudioRoot(override?: string): string {
  if (override) return path.resolve(override);
  if (process.env.AGENT_DEMO_HOME) return path.resolve(process.env.AGENT_DEMO_HOME);
  return path.join(os.homedir(), "AgentDemoStudio");
}

export function getProjectsRoot(override?: string): string {
  return path.join(getStudioRoot(override), "projects");
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function ffmpegCommand(): string {
  return process.env.AGENT_DEMO_FFMPEG || "ffmpeg";
}

export function ffprobeCommand(): string {
  return process.env.AGENT_DEMO_FFPROBE || "ffprobe";
}
