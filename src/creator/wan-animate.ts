import os from "node:os";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";

const WAN_MODEL_ID = "Wan-AI/Wan2.2-Animate-2-14B";
const POINTER_HEADER = "version https://git-lfs.github.com/spec/v1";

export interface WanAnimateStatus {
  modelId: typeof WAN_MODEL_ID;
  metadataInstalled: boolean;
  weightsInstalled: boolean;
  adapterConfigured: boolean;
  available: boolean;
  modelPath?: string;
  adapterUrl?: string;
  message: string;
  requiredDownloadGb: number;
}

export interface WanAnimateStatusOptions {
  modelPath?: string;
  adapterUrl?: string;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
}

function loopbackAdapter(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase())) return undefined;
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password || url.hash) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

async function existingDirectory(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) return path.resolve(candidate);
    } catch {
      // Discovery is best effort and never downloads checkpoints.
    }
  }
  return undefined;
}

async function materializedCheckpoint(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (info.size > 1024 * 1024) return true;
    return !(await readFile(filePath, "utf8")).startsWith(POINTER_HEADER);
  } catch {
    return false;
  }
}

/**
 * Detect Wan-Animate-2 without starting Python or fetching its 82.5 GB model.
 * A metadata-only Git/Xet clone is useful for provenance and setup, but it is
 * intentionally not reported as generation-ready.
 */
export async function getWanAnimateStatus(options: WanAnimateStatusOptions = {}): Promise<WanAnimateStatus> {
  const env = options.env ?? process.env;
  const home = options.homeDirectory ?? os.homedir();
  const configuredPath = options.modelPath || env.AGENT_DEMO_WAN_ANIMATE_MODEL_PATH;
  const modelPath = await existingDirectory([
    ...(configuredPath ? [configuredPath] : []),
    path.join(home, "Models", "Wan2.2-Animate-2-14B"),
    path.join(home, "models", "Wan2.2-Animate-2-14B"),
  ]);
  const adapterUrl = loopbackAdapter(options.adapterUrl || env.AGENT_DEMO_WAN_ANIMATE_ADAPTER_URL);
  const metadataInstalled = Boolean(modelPath);
  const weightsInstalled = modelPath
    ? await materializedCheckpoint(path.join(modelPath, "wan_animate_2", "wan_animate_2_bf16.safetensors"))
      || await materializedCheckpoint(path.join(modelPath, "wan_animate_2", "wan_animate_2_bf16_distillation.safetensors"))
    : false;
  const adapterConfigured = Boolean(adapterUrl);
  const available = weightsInstalled && adapterConfigured;
  const message = available
    ? "Wan-Animate-2 weights and a loopback generation adapter are configured. Runtime readiness still depends on the adapter's GPU health check."
    : metadataInstalled && !weightsInstalled
      ? "Wan-Animate-2 metadata is installed, but its 82.5 GB weights were deliberately skipped. This is not a runnable model installation."
      : weightsInstalled
        ? "Wan-Animate-2 weights are present, but no loopback adapter is configured."
        : "Wan-Animate-2 is optional and not installed. Use a metadata-only clone first; download weights only on a suitable multi-GPU workstation.";
  return {
    modelId: WAN_MODEL_ID,
    metadataInstalled,
    weightsInstalled,
    adapterConfigured,
    available,
    modelPath,
    adapterUrl,
    message,
    requiredDownloadGb: 82.5,
  };
}
