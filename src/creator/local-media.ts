import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { mediaTaskRequiresVideo, type GeneratedSceneMedia, type SceneMediaGenerationResult } from "./generated-media.js";
import { requireMovingVideo, type MotionQualityReport } from "./motion-quality.js";
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
  const raw = value || process.env.AGENT_DEMO_MEDIA_ADAPTER_URL || process.env.AGENT_DEMO_WAN_VIDEO_ADAPTER_URL;
  if (!raw) throw new Error("A local media adapter is not configured. Set AGENT_DEMO_MEDIA_ADAPTER_URL or AGENT_DEMO_WAN_VIDEO_ADAPTER_URL to its loopback /v1/media/generate endpoint.");
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
  return input.source || input.sceneSources?.length || input.characters?.length ? "image-to-video" : "text-to-video";
}

function sourcePath(source: string): string {
  return source.startsWith("builtin:") || /^[a-z][a-z\d+.-]*:\/\//i.test(source) ? source : path.resolve(source);
}

async function fileDigest(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
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
        characterReferences: (input.characters ?? []).map((character, index) => ({
          id: character.id?.trim() || `character-${index + 1}`,
          name: character.name,
          sourcePath: sourcePath(character.source),
          role: character.role ?? "character",
          style: character.style,
          rights: character.rights,
        })),
        generation: {
          visualQuality: plan.requirements.visualQuality ?? "generative",
          negativePrompt: input.negativePrompt,
          seed: input.seed,
          language: input.language ?? "en",
          outputPresets: plan.requirements.outputPresets,
          visualStyle: plan.creativeDirection.visualStyle,
          pacing: plan.creativeDirection.pacing,
          composition: plan.creativeDirection.composition,
        },
        scenes: plan.scenes.map((scene, index) => ({
          id: scene.id,
          title: scene.title,
          visual: scene.visual,
          durationSeconds: scene.durationSeconds,
          narration: scene.narration,
          onScreenText: scene.onScreenText,
          audioPath: options.audioPaths?.[index],
          animation: scene.animation,
          camera: scene.animation?.camera ?? (index === 0 ? "wide" : "medium"),
          transition: scene.transition,
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
    let qualityReportPath: string | undefined;
    if (mediaTaskRequiresVideo(task)) {
      const stills = outputs.filter((item) => item.kind !== "video");
      if (stills.length) {
        throw new Error(`The ${task} adapter returned ${stills.length} still image${stills.length === 1 ? "" : "s"}. A real video task must return video files; Agent Demo Studio will not fake motion by shaking photos.`);
      }
      if (outputs.length !== plan.scenes.length) {
        throw new Error(`The ${task} adapter returned ${outputs.length} video${outputs.length === 1 ? "" : "s"} for ${plan.scenes.length} planned scenes. Return exactly one generated video per scene so narration and motion stay synchronized.`);
      }
      const byScene = new Map(outputs.map((item) => [item.sceneId, item]));
      const missingSceneIds = plan.scenes.filter((scene) => !byScene.has(scene.id)).map((scene) => scene.id);
      if (outputs.some((item) => !item.sceneId) || byScene.size !== outputs.length || missingSceneIds.length) {
        throw new Error(`The ${task} adapter must return one unique sceneId for every planned scene. Missing or duplicated: ${missingSceneIds.join(", ") || "sceneId metadata"}.`);
      }
      const ordered = plan.scenes.map((scene) => byScene.get(scene.id)!);
      outputs.splice(0, outputs.length, ...ordered);
      const quality: MotionQualityReport[] = [];
      const digests: string[] = [];
      for (const output of outputs) {
        const motion = await requireMovingVideo(output.path);
        quality.push(motion);
        digests.push(await fileDigest(output.path));
        output.durationSeconds = motion.durationSeconds;
        output.width = motion.width;
        output.height = motion.height;
        output.fps = motion.fps;
      }
      if (new Set(digests).size !== digests.length) {
        throw new Error(`The ${task} adapter reused an identical video for multiple planned scenes. Every scene must be generated from its own visual beat.`);
      }
      qualityReportPath = path.join(outputRoot, "motion-quality.json");
      await writeFile(qualityReportPath, `${JSON.stringify({ passed: true, uniqueSceneFiles: true, clips: quality }, null, 2)}\n`, "utf8");
    }
    return {
      provider: "local-adapter",
      local: true,
      task,
      qualityTier: "generative-video",
      durationMs: Math.max(0, now() - startedAt),
      outputs,
      qualityReportPath,
      backend: { name: "Agent Demo local media adapter", endpoint },
    };
  } finally {
    clearTimeout(timer);
  }
}
