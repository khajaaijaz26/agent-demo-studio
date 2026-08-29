import path from "node:path";
import { randomUUID } from "node:crypto";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { errorMessage } from "../errors.js";
import { slugify } from "../utils/text.js";
import { mediaTaskRequiresVideo, type SceneMediaGenerationResult } from "./generated-media.js";
import { probeMediaInfo } from "./media.js";
import { requireMovingVideo, type MotionQualityReport } from "./motion-quality.js";
import { selectLocalMediaTask } from "./local-media.js";
import type { CreatorProductionPlan, CreatorPromptVideoInput } from "./types.js";

type ProgressReporter = (progress: number, message: string) => void;

export interface ComfyUiStatus {
  configured: boolean;
  available: boolean;
  localOnly: true;
  baseUrl?: string;
  workflowPath?: string;
  message: string;
}

export interface ComfyUiRuntime {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
}

interface ComfyArtifact {
  filename?: string;
  subfolder?: string;
  type?: string;
}

function loopbackBaseUrl(value?: string): string {
  const raw = value || process.env.AGENT_DEMO_COMFYUI_URL;
  if (!raw) throw new Error("ComfyUI is not configured. Set AGENT_DEMO_COMFYUI_URL to its loopback server, usually http://127.0.0.1:8188.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The ComfyUI URL is invalid.");
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase())) {
    throw new Error("ComfyUI generation is restricted to a loopback-only server.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The ComfyUI URL must use HTTP or HTTPS.");
  if (url.username || url.password || url.search || url.hash) throw new Error("The ComfyUI URL cannot contain credentials, a query, or a fragment.");
  return url.origin;
}

function workflowPath(value?: string): string {
  const raw = value || process.env.AGENT_DEMO_COMFYUI_WORKFLOW;
  if (!raw?.trim()) throw new Error("A ComfyUI API workflow is required. Export a workflow in API format and set AGENT_DEMO_COMFYUI_WORKFLOW.");
  return path.resolve(raw);
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

export async function getComfyUiStatus(options: {
  baseUrl?: string;
  workflow?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): Promise<ComfyUiStatus> {
  let baseUrl: string;
  let workflow: string;
  try {
    baseUrl = loopbackBaseUrl(options.baseUrl);
    workflow = workflowPath(options.workflow);
    const info = await stat(workflow);
    if (!info.isFile()) throw new Error("The configured ComfyUI workflow is not a file.");
  } catch (error) {
    return { configured: false, available: false, localOnly: true, message: errorMessage(error) };
  }
  try {
    const response = await fetchWithTimeout(options.fetchImpl ?? fetch, `${baseUrl}/system_stats`, undefined, options.timeoutMs ?? 1_500);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { configured: true, available: true, localOnly: true, baseUrl, workflowPath: workflow, message: "ComfyUI and its API workflow are ready on this device." };
  } catch (error) {
    return { configured: true, available: false, localOnly: true, baseUrl, workflowPath: workflow, message: `ComfyUI is configured but not reachable: ${errorMessage(error)}` };
  }
}

function replaceTemplate(value: unknown, variables: Record<string, string | number>): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceTemplate(item, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, replaceTemplate(item, variables)]));
  }
  if (typeof value !== "string") return value;
  const exact = /^\{\{([A-Z_]+)\}\}$/.exec(value);
  if (exact?.[1] && Object.hasOwn(variables, exact[1])) return variables[exact[1]];
  return value.replace(/\{\{([A-Z_]+)\}\}/g, (match, key: string) => Object.hasOwn(variables, key) ? String(variables[key]) : match);
}

function denseMotionPrompt(input: CreatorPromptVideoInput, plan: CreatorProductionPlan, sceneIndex: number): string {
  const scene = plan.scenes[sceneIndex]!;
  const references = (input.characters ?? []).map((item) => `${item.name}${item.style ? ` (${item.style})` : ""}`).join(", ");
  const character = input.mode === "cartoon"
    ? "Expressive original cartoon characters perform clear body gestures, blink naturally, and speak with visible mouth movement."
    : input.mode === "product-launch"
      ? "The product and presenter move naturally with stable structure and deliberate interaction."
      : "Subjects move continuously and maintain consistent identity and anatomy.";
  return [
    scene.visual,
    character,
    `Temporal action: establish ${scene.title.toLowerCase()}, develop the action, then settle into the next beat.`,
    "Camera: stabilized purposeful motion, coherent framing, no random zoom, no frame jitter.",
    `Visual style: ${plan.creativeDirection.visualStyle}.`,
    references ? `Authorized character references: ${references}. Preserve their intended identity and design.` : "No fixed cast; create only the subjects named in this scene.",
    `Narration/caption language: ${input.language ?? "en"}.`,
    `Narrative context: ${scene.narration}`,
  ].join(" ");
}

async function uploadInputImage(fetchImpl: typeof fetch, baseUrl: string, filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append("image", new Blob([bytes]), path.basename(filePath));
  form.append("type", "input");
  form.append("overwrite", "true");
  const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/upload/image`, { method: "POST", body: form }, 2 * 60_000);
  if (!response.ok) throw new Error(`ComfyUI could not upload the source image (HTTP ${response.status}): ${(await response.text()).slice(0, 240)}`);
  const payload = await response.json() as { name?: string; subfolder?: string };
  if (!payload.name) throw new Error("ComfyUI did not return an uploaded image name.");
  return payload.subfolder ? `${payload.subfolder}/${payload.name}` : payload.name;
}

function outputArtifacts(history: Record<string, unknown>): ComfyArtifact[] {
  const outputs = history.outputs && typeof history.outputs === "object" ? history.outputs as Record<string, unknown> : {};
  const artifacts: ComfyArtifact[] = [];
  for (const value of Object.values(outputs)) {
    if (!value || typeof value !== "object") continue;
    for (const list of Object.values(value as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      for (const item of list) if (item && typeof item === "object" && typeof (item as ComfyArtifact).filename === "string") artifacts.push(item as ComfyArtifact);
    }
  }
  return artifacts;
}

async function awaitHistory(
  fetchImpl: typeof fetch,
  baseUrl: string,
  promptId: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/history/${encodeURIComponent(promptId)}`, undefined, 15_000);
    if (response.ok) {
      const payload = await response.json() as Record<string, Record<string, unknown>>;
      const history = payload[promptId];
      if (history) {
        const status = history.status as { status_str?: string; completed?: boolean; messages?: unknown[] } | undefined;
        if (status?.status_str === "error") throw new Error(`ComfyUI generation failed: ${JSON.stringify(status.messages ?? []).slice(0, 600)}`);
        if (status?.completed || outputArtifacts(history).length) return history;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`ComfyUI did not complete prompt ${promptId} within ${Math.round(timeoutMs / 60_000)} minutes.`);
}

function extensionKind(filename: string): "image" | "video" | undefined {
  const extension = path.extname(filename).toLowerCase();
  if ([".mp4", ".webm", ".mov", ".mkv"].includes(extension)) return "video";
  if ([".png", ".jpg", ".jpeg", ".webp", ".avif"].includes(extension)) return "image";
  return undefined;
}

export async function generateComfyUiSceneMedia(
  input: CreatorPromptVideoInput,
  plan: CreatorProductionPlan,
  outputDirectory: string,
  audioPaths: Array<string | undefined> = [],
  report: ProgressReporter = () => undefined,
  runtime: ComfyUiRuntime = {},
): Promise<SceneMediaGenerationResult> {
  const startedAt = (runtime.now ?? Date.now)();
  const fetchImpl = runtime.fetchImpl ?? fetch;
  const baseUrl = loopbackBaseUrl(input.comfyuiUrl);
  const workflow = workflowPath(input.comfyuiWorkflow);
  const raw = await readFile(workflow, "utf8");
  if (!raw.includes("{{PROMPT}}")) throw new Error("The ComfyUI API workflow must contain a {{PROMPT}} placeholder so each planned scene receives its own motion prompt.");
  const template = JSON.parse(raw) as Record<string, unknown>;
  const promptTemplate = template.prompt && typeof template.prompt === "object" ? template.prompt : template;
  const outputRoot = path.resolve(outputDirectory);
  await mkdir(outputRoot, { recursive: true });
  const task = selectLocalMediaTask(input);
  const sceneSources = [...new Set([...(input.source ? [input.source] : []), ...(input.sceneSources ?? [])])];
  const characterSources = [...new Set((input.characters ?? []).map((item) => item.source))];
  const sources = sceneSources.length ? sceneSources : characterSources;
  const quality: MotionQualityReport[] = [];
  const outputs: SceneMediaGenerationResult["outputs"] = [];
  for (const [index, scene] of plan.scenes.entries()) {
    report(30 + index * 12, `Generating real motion for scene ${index + 1} of ${plan.scenes.length} in ComfyUI`);
    const source = sources.length ? sources[index % sources.length] : undefined;
    const uploadedImage = source && /\.(?:avif|jpe?g|png|webp)$/i.test(source)
      ? await uploadInputImage(fetchImpl, baseUrl, path.resolve(source))
      : source ? path.resolve(source) : "";
    const seed = Number.isFinite(input.seed) ? Number(input.seed) + index : Math.floor(Math.random() * 2_147_483_647);
    const variables: Record<string, string | number> = {
      PROMPT: denseMotionPrompt(input, plan, index),
      NEGATIVE_PROMPT: input.negativePrompt || "frozen frame, slideshow, camera shake, jitter, flicker, warped anatomy, broken hands, duplicate subjects, unreadable text, watermark",
      WIDTH: 1280,
      HEIGHT: 720,
      FPS: 24,
      FRAMES: Math.max(25, Math.min(241, Math.round(scene.durationSeconds * 24) + 1)),
      DURATION: scene.durationSeconds,
      SEED: seed,
      SCENE_ID: scene.id,
      INPUT_IMAGE: uploadedImage || "",
      INPUT_AUDIO: audioPaths[index] ? path.resolve(audioPaths[index]!) : "",
    };
    const prompt = replaceTemplate(promptTemplate, variables);
    const queued = await fetchWithTimeout(fetchImpl, `${baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, client_id: `agent-demo-${randomUUID()}` }),
    }, 30_000);
    if (!queued.ok) throw new Error(`ComfyUI rejected scene ${index + 1} (HTTP ${queued.status}): ${(await queued.text()).slice(0, 600)}`);
    const queuePayload = await queued.json() as { prompt_id?: string; error?: string; node_errors?: unknown };
    if (!queuePayload.prompt_id) throw new Error(`ComfyUI returned no prompt_id: ${queuePayload.error || JSON.stringify(queuePayload.node_errors ?? {}).slice(0, 500)}`);
    const history = await awaitHistory(fetchImpl, baseUrl, queuePayload.prompt_id, runtime.timeoutMs ?? 45 * 60_000, runtime.pollIntervalMs ?? 1_000);
    const artifacts = outputArtifacts(history).map((artifact) => ({ ...artifact, kind: artifact.filename ? extensionKind(artifact.filename) : undefined })).filter((artifact) => artifact.kind);
    const chosen = mediaTaskRequiresVideo(task)
      ? [...artifacts].reverse().find((artifact) => artifact.kind === "video")
      : [...artifacts].reverse().find((artifact) => artifact.kind === "image") ?? [...artifacts].reverse().find((artifact) => artifact.kind === "video");
    if (!chosen?.filename || !chosen.kind) throw new Error(`ComfyUI completed scene ${index + 1} but returned no ${mediaTaskRequiresVideo(task) ? "video" : "image"} artifact. Ensure the API workflow ends in Save Video or Save Image.`);
    const artifactUrl = new URL("/view", `${baseUrl}/`);
    artifactUrl.searchParams.set("filename", chosen.filename);
    artifactUrl.searchParams.set("subfolder", chosen.subfolder || "");
    artifactUrl.searchParams.set("type", chosen.type || "output");
    const artifactResponse = await fetchWithTimeout(fetchImpl, artifactUrl.toString(), undefined, 5 * 60_000);
    if (!artifactResponse.ok) throw new Error(`Could not download ComfyUI output ${chosen.filename} (HTTP ${artifactResponse.status}).`);
    const stem = `${String(index + 1).padStart(2, "0")}-${slugify(scene.title) || scene.id}`;
    const outputPath = path.join(outputRoot, `${stem}${path.extname(chosen.filename).toLowerCase()}`);
    await writeFile(outputPath, Buffer.from(await artifactResponse.arrayBuffer()));
    let media: Awaited<ReturnType<typeof probeMediaInfo>> | undefined;
    if (chosen.kind === "video") {
      const motion = await requireMovingVideo(outputPath);
      quality.push(motion);
      media = await probeMediaInfo(outputPath);
    }
    outputs.push({
      path: outputPath,
      kind: chosen.kind,
      sceneId: scene.id,
      model: `ComfyUI · ${path.basename(workflow)}`,
      prompt: String(variables.PROMPT),
      rights: "Generated locally through the configured ComfyUI workflow; retain every checkpoint, LoRA, and source-media license.",
      durationSeconds: media?.durationSeconds,
      width: media?.width,
      height: media?.height,
      fps: media?.fps,
    });
  }
  if (mediaTaskRequiresVideo(task) && outputs.some((item) => item.kind !== "video")) {
    throw new Error("ComfyUI returned a still image for a real-video task. Agent Demo Studio will not convert it into a shaking slideshow.");
  }
  const qualityReportPath = path.join(outputRoot, "motion-quality.json");
  await writeFile(qualityReportPath, `${JSON.stringify({ passed: quality.every((item) => item.passed), clips: quality }, null, 2)}\n`, "utf8");
  return {
    provider: "comfyui",
    local: true,
    task,
    qualityTier: mediaTaskRequiresVideo(task) ? "generative-video" : "animated-2d",
    durationMs: Math.max(0, (runtime.now ?? Date.now)() - startedAt),
    outputs,
    qualityReportPath,
    backend: { name: "ComfyUI", endpoint: baseUrl, workflow },
  };
}
