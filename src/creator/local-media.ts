import path from "node:path";
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { mediaTaskRequiresVideo, type GeneratedSceneMedia, type SceneMediaGenerationResult } from "./generated-media.js";
import type { CreatorMediaTask, CreatorProductionPlan, CreatorPromptVideoInput } from "./types.js";

export type LocalGeneratedMedia = GeneratedSceneMedia;

export interface LocalMediaGenerationResult extends SceneMediaGenerationResult {
  provider: "local-adapter";
  qualityTier: "generative-video";
}

export interface LocalMediaRuntime {
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export interface LocalMediaGenerationOptions {
  audioPaths?: Array<string | undefined>;
}

interface AdapterResponse {
  outputs?: Array<{ path?: string; kind?: string; sceneId?: string; model?: string; prompt?: string; rights?: string }>;
}

function adapterEndpoint(value?: string): string {
  const raw = value || process.env.AGENT_DEMO_MEDIA_ADAPTER_URL;
  if (!raw) throw new Error("A local media adapter is not configured. Set AGENT_DEMO_MEDIA_ADAPTER_URL to its loopback /v1/media/generate endpoint.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The local media adapter URL is invalid.");
  }
  if (!(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase()))) {
    throw new Error("Media generation is restricted to a loopback-only local adapter.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The local media adapter must use HTTP or HTTPS.");
  if (url.username || url.password || url.hash) throw new Error("The local media adapter URL cannot contain credentials or a fragment.");
  return url.toString();
}

export function selectLocalMediaTask(input: CreatorPromptVideoInput): Exclude<CreatorMediaTask, "auto"> {
  if (input.mediaTask && input.mediaTask !== "auto") return input.mediaTask;
  // A request for a video must never silently become a collection of stills.
  // Source media becomes I2V; a text-only request becomes true T2V.
  return input.source || input.sceneSources?.length ? "image-to-video" : "text-to-video";
}

function sourcePath(source: string): string {
  return source.startsWith("builtin:") || /^[a-z][a-z\d+.-]*:\/\//i.test(source) ? source : path.resolve(source);
}

/**
 * One batch request keeps orchestration fast and lets a local ComfyUI/SD/FLUX/
 * video bridge optimize its own queue. See docs/LOCAL-AI.md for the protocol.
 */
export async function generateLocalSceneMedia(
  input: CreatorPromptVideoInput,
  plan: CreatorProductionPlan,
  outputDirectory: string,
  runtime: LocalMediaRuntime = {},
  options: LocalMediaGenerationOptions = {},
): Promise<LocalMediaGenerationResult> {
  const endpoint = adapterEndpoint(input.mediaAdapterUrl);
  const task = selectLocalMediaTask(input);
  const outputRoot = path.resolve(outputDirectory);
  await mkdir(outputRoot, { recursive: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), runtime.timeoutMs ?? 30 * 60_000);
  const now = runtime.now ?? Date.now;
  const startedAt = now();
  try {
    const response = await (runtime.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        protocol: "agent-demo-local-media-v2",
        task,
        outputDirectory: outputRoot,
        title: plan.title,
        mode: plan.mode,
        brief: plan.originalPrompt,
        targetDurationSeconds: plan.requirements.targetDurationSeconds,
        sourcePaths: [...new Set([...(input.source ? [sourcePath(input.source)] : []), ...(input.sceneSources ?? []).map(sourcePath)])],
        scenes: plan.scenes.map((scene, index) => ({
          id: scene.id,
          title: scene.title,
          visual: scene.visual,
          durationSeconds: scene.durationSeconds,
          narration: scene.narration,
          onScreenText: scene.onScreenText,
          audioPath: options.audioPaths?.[index],
        })),
        performance: input.plannerProfile === "quality" ? "quality" : "fast",
      }),
    });
    if (!response.ok) throw new Error(`Local media adapter returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
    const payload = await response.json() as AdapterResponse;
    const outputs: LocalGeneratedMedia[] = [];
    for (const item of payload.outputs ?? []) {
      if (!item.path || (item.kind !== "image" && item.kind !== "video")) continue;
      const outputPath = path.resolve(item.path);
      const relative = path.relative(outputRoot, outputPath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("The local media adapter returned a path outside the requested output directory.");
      await access(outputPath, constants.R_OK);
      outputs.push({ path: outputPath, kind: item.kind, sceneId: item.sceneId, model: item.model, prompt: item.prompt, rights: item.rights });
    }
    if (!outputs.length) throw new Error("The local media adapter returned no readable image or video outputs.");
    if (mediaTaskRequiresVideo(task)) {
      const stills = outputs.filter((item) => item.kind !== "video");
      if (stills.length) {
        throw new Error(`The ${task} adapter returned ${stills.length} still image${stills.length === 1 ? "" : "s"}. A real video task must return video files; Agent Demo Studio will not fake motion by shaking photos.`);
      }
      if (outputs.length < plan.scenes.length) {
        throw new Error(`The ${task} adapter returned ${outputs.length} video${outputs.length === 1 ? "" : "s"} for ${plan.scenes.length} planned scenes. Return one generated video per scene so narration and motion stay synchronized.`);
      }
    }
    return {
      provider: "local-adapter",
      local: true,
      task,
      qualityTier: "generative-video",
      durationMs: Math.max(0, now() - startedAt),
      outputs,
      backend: { name: "Agent Demo local media adapter", endpoint },
    };
  } finally {
    clearTimeout(timer);
  }
}
