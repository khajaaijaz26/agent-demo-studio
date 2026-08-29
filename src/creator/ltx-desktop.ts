import path from "node:path";
import os from "node:os";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { errorMessage } from "../errors.js";
import { slugify } from "../utils/text.js";
import type { SceneMediaGenerationResult } from "./generated-media.js";
import { probeMediaInfo } from "./media.js";
import { requireMovingVideo, type MotionQualityReport } from "./motion-quality.js";
import type { CreatorProductionPlan, CreatorPromptVideoInput } from "./types.js";

type ProgressReporter = (progress: number, message: string) => void;

const DEFAULT_LTX_DESKTOP_URL = "http://127.0.0.1:41954";
const GENERATION_TIMEOUT_MS = 90 * 60_000;

interface LtxHealth {
  status?: string;
  active_model?: string | null;
  gpu_info?: { name?: string; vram?: number; vramUsed?: number };
  models_status?: Array<{ id?: string; downloaded?: boolean; loaded?: boolean }>;
}

interface LtxRuntimePolicy {
  force_api_generations?: boolean;
}

type LtxResolution = "540p" | "720p" | "1080p" | "1440p" | "2160p";
type LtxDuration = 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20;

interface LtxModelSpec {
  pipeline?: "fast" | "pro" | "fast-2.5" | "pro-2.5";
  spec?: {
    supported_resolutions_durations?: Partial<Record<LtxResolution, { fps_to_durations?: Partial<Record<"24" | "25" | "48" | "50", LtxDuration[]>> }>>;
    capabilities?: { t2v?: boolean; i2v?: boolean; a2v?: boolean };
  };
}

interface LtxModelSpecs {
  local_models?: LtxModelSpec[];
  api_models?: LtxModelSpec[];
}

export interface LtxDesktopStatus {
  installed: boolean;
  available: boolean;
  localGenerationAvailable: boolean;
  apiOnly: boolean;
  localOnly: boolean;
  baseUrl: string;
  executablePath?: string;
  activeModel?: string;
  gpuName?: string;
  message: string;
}

export interface LtxDesktopRuntime {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  installedPaths?: string[];
  now?: () => number;
}

function loopbackLtxUrl(value?: string): string {
  let url: URL;
  try {
    url = new URL(value || process.env.AGENT_DEMO_LTX_DESKTOP_URL || DEFAULT_LTX_DESKTOP_URL);
  } catch {
    throw new Error("The LTX Desktop URL is invalid.");
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase())) {
    throw new Error("LTX Desktop integration is restricted to its loopback-only backend.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The LTX Desktop URL must use HTTP or HTTPS.");
  if (url.username || url.password || url.search || url.hash) throw new Error("The LTX Desktop URL cannot contain credentials, a query, or a fragment.");
  return url.origin;
}

function candidateInstallPaths(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === "win32") {
    return [
      ...(env.ProgramFiles ? [path.join(env.ProgramFiles, "LTX Desktop", "LTX Desktop.exe")] : []),
      ...(env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, "Programs", "LTX Desktop", "LTX Desktop.exe")] : []),
    ];
  }
  if (platform === "darwin") return ["/Applications/LTX Desktop.app"];
  return ["/usr/bin/ltx-desktop", "/opt/LTX Desktop/ltx-desktop", path.join(os.homedir(), ".local", "bin", "ltx-desktop")];
}

async function firstExistingPath(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      // Keep looking. Discovery is read-only and intentionally best effort.
    }
  }
  return undefined;
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(fetchImpl: typeof fetch, baseUrl: string, route: string, timeoutMs: number): Promise<T> {
  const response = await fetchWithTimeout(fetchImpl, `${baseUrl}${route}`, undefined, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json() as T;
}

export async function getLtxDesktopStatus(options: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  installedPaths?: string[];
} = {}): Promise<LtxDesktopStatus> {
  let baseUrl: string;
  try {
    baseUrl = loopbackLtxUrl(options.baseUrl);
  } catch (error) {
    return {
      installed: false,
      available: false,
      localGenerationAvailable: false,
      apiOnly: false,
      localOnly: true,
      baseUrl: DEFAULT_LTX_DESKTOP_URL,
      message: errorMessage(error),
    };
  }
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const executablePath = await firstExistingPath(options.installedPaths ?? candidateInstallPaths(platform, env));
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 1_500;
  try {
    const [health, policy] = await Promise.all([
      getJson<LtxHealth>(fetchImpl, baseUrl, "/health", timeoutMs),
      getJson<LtxRuntimePolicy>(fetchImpl, baseUrl, "/api/runtime-policy", timeoutMs),
    ]);
    const apiOnly = policy.force_api_generations === true;
    return {
      installed: Boolean(executablePath) || health.status === "ok",
      available: health.status === "ok",
      localGenerationAvailable: health.status === "ok" && !apiOnly,
      apiOnly,
      localOnly: !apiOnly,
      baseUrl,
      executablePath,
      activeModel: health.active_model || undefined,
      gpuName: health.gpu_info?.name,
      message: apiOnly
        ? "LTX Desktop is reachable, but this computer is in API-only mode. Paid LTX generation is disabled unless the user explicitly opts in."
        : "LTX Desktop is ready for fully local text-, image-, and audio-to-video generation.",
    };
  } catch (error) {
    const installed = Boolean(executablePath);
    return {
      installed,
      available: false,
      localGenerationAvailable: false,
      apiOnly: false,
      localOnly: true,
      baseUrl,
      executablePath,
      message: installed
        ? `LTX Desktop is installed, but its backend is not reachable at ${baseUrl}. On Windows, local LTX requires a supported NVIDIA CUDA GPU with at least 16 GB VRAM. Backend detail: ${errorMessage(error)}`
        : `LTX Desktop was not detected and its backend is not reachable at ${baseUrl}.`,
    };
  }
}

function closestSupportedDuration(values: LtxDuration[], desired: number): LtxDuration | undefined {
  const ordered = [...new Set(values)].sort((left, right) => left - right);
  return ordered.find((item) => item >= desired) ?? ordered.at(-1);
}

function chooseGenerationSpec(specs: LtxModelSpecs, apiOnly: boolean, desiredSeconds: number): {
  model: NonNullable<LtxModelSpec["pipeline"]>;
  resolution: LtxResolution;
  duration: LtxDuration;
} {
  const candidates = (apiOnly ? specs.api_models : specs.local_models) ?? [];
  const preferred = candidates.find((item) => item.pipeline === "fast-2.5")
    ?? candidates.find((item) => item.pipeline === "fast")
    ?? candidates[0];
  if (!preferred?.pipeline || !preferred.spec?.supported_resolutions_durations) {
    throw new Error(`LTX Desktop did not report an available ${apiOnly ? "API" : "local"} video model.`);
  }
  for (const resolution of ["1080p", "720p", "540p"] as const) {
    const durations = preferred.spec.supported_resolutions_durations[resolution]?.fps_to_durations?.["24"] ?? [];
    const duration = closestSupportedDuration(durations, desiredSeconds);
    if (duration !== undefined && duration >= desiredSeconds) return { model: preferred.pipeline, resolution, duration };
  }
  const possibilities = (["1080p", "720p", "540p"] as const).flatMap((resolution) => {
    const durations = preferred.spec!.supported_resolutions_durations![resolution]?.fps_to_durations?.["24"] ?? [];
    const duration = closestSupportedDuration(durations, desiredSeconds);
    return duration === undefined ? [] : [{ resolution, duration }];
  }).sort((left, right) => right.duration - left.duration);
  const best = possibilities[0];
  if (!best || best.duration + 0.01 < desiredSeconds) {
    throw new Error(`The planned ${desiredSeconds.toFixed(1)} second scene exceeds the active LTX Desktop model's maximum clip duration. Shorten scenes or split the storyboard before generation.`);
  }
  return { model: preferred.pipeline, ...best };
}

function scenePrompt(input: CreatorPromptVideoInput, plan: CreatorProductionPlan, index: number): string {
  const scene = plan.scenes[index]!;
  const references = (input.characters ?? []).map((item) => `${item.name}${item.style ? ` (${item.style})` : ""}`).join(", ");
  return [
    scene.visual,
    `Continuous temporal action for ${scene.durationSeconds.toFixed(1)} seconds with natural subject movement, stable identity, coherent anatomy, and synchronized environmental motion.`,
    input.mode === "cartoon"
      ? "Original expressive animated characters gesture, blink, change pose, and visibly speak; this is a continuous animated shot, not a still illustration."
      : "Subjects perform purposeful physical actions throughout the shot; avoid frozen poses and slideshow motion.",
    `Camera remains stabilized and intentional. Visual style: ${plan.creativeDirection.visualStyle}.`,
    references ? `Authorized character references: ${references}. Preserve their intended identity and design.` : "No fixed cast; create only the subjects named in this scene.",
    `Narration/caption language: ${input.language ?? "en"}.`,
    `Narrative beat: ${scene.narration}`,
  ].join(" ");
}

function aspectRatio(input: CreatorPromptVideoInput): "16:9" | "9:16" {
  const first = input.presets?.[0];
  return first && ["shorts", "reels", "tiktok", "story", "podcast-vertical"].includes(first) ? "9:16" : "16:9";
}

export async function generateLtxDesktopSceneMedia(
  input: CreatorPromptVideoInput,
  plan: CreatorProductionPlan,
  outputDirectory: string,
  audioPaths: Array<string | undefined> = [],
  report: ProgressReporter = () => undefined,
  runtime: LtxDesktopRuntime = {},
): Promise<SceneMediaGenerationResult> {
  const startedAt = (runtime.now ?? Date.now)();
  const fetchImpl = runtime.fetchImpl ?? fetch;
  const baseUrl = loopbackLtxUrl(input.ltxDesktopUrl);
  const status = await getLtxDesktopStatus({
    baseUrl,
    fetchImpl,
    timeoutMs: runtime.timeoutMs ?? 2_500,
    platform: runtime.platform,
    env: runtime.env,
    installedPaths: runtime.installedPaths,
  });
  if (!status.available) throw new Error(status.message);
  if (status.apiOnly && input.allowCloudMedia !== true) {
    throw new Error("LTX Desktop is in paid API-only mode on this hardware. Agent Demo Studio will not spend credits or upload prompts/media unless allowCloudMedia is explicitly enabled.");
  }
  const specs = await getJson<LtxModelSpecs>(fetchImpl, baseUrl, "/api/generate/models-specs", 10_000);
  const outputRoot = path.resolve(outputDirectory);
  await mkdir(outputRoot, { recursive: true });
  const sceneSources = [...new Set([...(input.source ? [input.source] : []), ...(input.sceneSources ?? [])])];
  const characterSources = [...new Set((input.characters ?? []).map((item) => item.source))];
  const sources = sceneSources.length ? sceneSources : characterSources;
  const outputs: SceneMediaGenerationResult["outputs"] = [];
  const quality: MotionQualityReport[] = [];
  for (const [index, scene] of plan.scenes.entries()) {
    report(30 + index * 12, `Generating scene ${index + 1} of ${plan.scenes.length} with LTX Desktop`);
    const generation = chooseGenerationSpec(specs, status.apiOnly, scene.durationSeconds);
    const source = sources.length ? sources[index % sources.length] : undefined;
    const audioPath = audioPaths[index];
    const prompt = scenePrompt(input, plan, index);
    const payload = {
      prompt,
      resolution: generation.resolution,
      model: generation.model,
      cameraMotion: "none",
      negativePrompt: input.negativePrompt || "frozen frame, slideshow, camera shake, jitter, flicker, warped anatomy, duplicate subject, unreadable text, watermark",
      duration: generation.duration,
      fps: 24,
      audio: Boolean(audioPath),
      imagePath: source && /\.(?:avif|jpe?g|png|webp)$/i.test(source) ? path.resolve(source) : null,
      lastImagePath: null,
      keyframes: [],
      audioPath: audioPath ? path.resolve(audioPath) : null,
      aspectRatio: aspectRatio(input),
      seed: Number.isFinite(input.seed) ? Number(input.seed) + index : null,
      loras: [],
    };
    const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, runtime.timeoutMs ?? GENERATION_TIMEOUT_MS);
    if (!response.ok) throw new Error(`LTX Desktop rejected scene ${index + 1} (HTTP ${response.status}): ${(await response.text()).slice(0, 800)}`);
    const result = await response.json() as { status?: string; video_path?: string };
    if (result.status !== "complete" || !result.video_path) throw new Error(`LTX Desktop did not return a completed video for scene ${index + 1}.`);
    await stat(result.video_path);
    const stem = `${String(index + 1).padStart(2, "0")}-${slugify(scene.title) || scene.id}`;
    const outputPath = path.join(outputRoot, `${stem}.mp4`);
    await copyFile(result.video_path, outputPath);
    const motion = await requireMovingVideo(outputPath);
    quality.push(motion);
    const media = await probeMediaInfo(outputPath);
    outputs.push({
      path: outputPath,
      kind: "video",
      sceneId: scene.id,
      model: `LTX Desktop ${generation.model}`,
      prompt,
      rights: status.apiOnly
        ? "Generated through LTX Desktop API mode; LTX API terms, source rights, and synthetic-media disclosure requirements apply."
        : "Generated locally through LTX Desktop; retain the LTX model license, source rights, prompt, and disclosure record.",
      durationSeconds: media.durationSeconds,
      width: media.width,
      height: media.height,
      fps: media.fps,
    });
  }
  const qualityReportPath = path.join(outputRoot, "motion-quality.json");
  await writeFile(qualityReportPath, `${JSON.stringify({ passed: quality.every((item) => item.passed), clips: quality }, null, 2)}\n`, "utf8");
  return {
    provider: "ltx-desktop",
    local: !status.apiOnly,
    task: audioPaths.some(Boolean) ? "speech-to-video" : sources.length ? "image-to-video" : "text-to-video",
    qualityTier: "generative-video",
    durationMs: Math.max(0, (runtime.now ?? Date.now)() - startedAt),
    outputs,
    qualityReportPath,
    backend: { name: "LTX Desktop", endpoint: baseUrl, mode: status.apiOnly ? "api" : "local" },
  };
}
