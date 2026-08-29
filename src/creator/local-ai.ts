import { errorMessage } from "../errors.js";
import type {
  CreatorPlannerProfile,
  CreatorPlannerProvider,
  CreatorProductionPlan,
  CreatorPromptVideoInput,
} from "./types.js";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_KEEP_ALIVE = "30m";
const PLAN_CACHE_TTL_MS = 30 * 60_000;

interface OllamaModelRecord {
  name?: string;
  model?: string;
  size?: number;
  modified_at?: string;
}

interface OllamaTagsResponse {
  models?: OllamaModelRecord[];
}

interface OllamaVersionResponse {
  version?: string;
}

interface OllamaChatResponse {
  model?: string;
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

interface LocalPlanDraft {
  title: string;
  audience: string;
  scenes: Array<{
    visual: string;
    narration: string;
    onScreenText: string;
  }>;
}

interface PlanCacheEntry {
  expiresAt: number;
  model: string;
  promptTokens?: number;
  outputTokens?: number;
  draft: LocalPlanDraft;
}

const planCache = new Map<string, PlanCacheEntry>();

export interface LocalAiRuntime {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface LocalAiStatusOptions extends LocalAiRuntime {
  baseUrl?: string;
  profile?: CreatorPlannerProfile;
  model?: string;
  timeoutMs?: number;
}

export interface LocalAiModel {
  name: string;
  sizeBytes?: number;
  modifiedAt?: string;
}

export interface LocalAiStatus {
  available: boolean;
  localOnly: true;
  baseUrl: string;
  version?: string;
  profile: CreatorPlannerProfile;
  selectedModel?: string;
  models: LocalAiModel[];
  message: string;
}

export interface LocalAiWarmResult {
  warmed: boolean;
  model: string;
  baseUrl: string;
  durationMs: number;
  keepAlive: string;
}

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", maxLength: 80 },
    audience: { type: "string", maxLength: 140 },
    scenes: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          visual: { type: "string", maxLength: 180 },
          narration: { type: "string", maxLength: 180 },
          onScreenText: { type: "string", maxLength: 55 },
        },
        required: ["visual", "narration", "onScreenText"],
      },
    },
  },
  required: ["title", "audience", "scenes"],
} as const;

function clean(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function normalizedProfile(value?: string): CreatorPlannerProfile {
  const profile = value || process.env.AGENT_DEMO_PLANNER_PROFILE || "fast";
  if (profile !== "fast" && profile !== "quality") throw new Error("Planner profile must be 'fast' or 'quality'.");
  return profile;
}

function normalizedProvider(value?: string): CreatorPlannerProvider {
  const provider = value || process.env.AGENT_DEMO_PLANNER_PROVIDER || "auto";
  if (provider !== "auto" && provider !== "deterministic" && provider !== "ollama") {
    throw new Error("Planner provider must be 'auto', 'deterministic', or 'ollama'.");
  }
  return provider;
}

export function localOllamaBaseUrl(value?: string): string {
  const raw = value || process.env.AGENT_DEMO_OLLAMA_URL || DEFAULT_OLLAMA_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The Ollama URL is invalid.");
  }
  const hostname = url.hostname.toLowerCase();
  if (!(["127.0.0.1", "localhost", "[::1]"].includes(hostname))) {
    throw new Error("Local-only mode accepts Ollama only on localhost, 127.0.0.1, or ::1.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The Ollama URL must use HTTP or HTTPS.");
  if (url.username || url.password || url.search || url.hash) throw new Error("The Ollama URL cannot contain credentials, a query, or a fragment.");
  return url.origin;
}

export function assertLocalModelName(value: string): string {
  const model = value.trim();
  if (!model) throw new Error("The local model name cannot be empty.");
  if (/[\r\n\0]/.test(model)) throw new Error("The local model name contains invalid characters.");
  if (model.toLowerCase().includes("cloud")) throw new Error("Cloud-tagged Ollama models are disabled in local-only mode.");
  return model;
}

function endpoint(baseUrl: string, pathname: string): string {
  return new URL(pathname, `${baseUrl}/`).toString();
}

async function fetchJson<T>(fetchImpl: typeof fetch, url: string, init: RequestInit | undefined, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const detail = clean(await response.text(), 240);
      throw new Error(`Local Ollama returned HTTP ${response.status}${detail ? `: ${detail}` : ""}.`);
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

function modelNames(records: OllamaModelRecord[]): string[] {
  return records
    .map((record) => record.name || record.model || "")
    .map((name) => name.trim())
    .filter((name) => Boolean(name) && !name.toLowerCase().includes("cloud"));
}

function exactCandidate(names: string[], candidates: string[]): string | undefined {
  const lookup = new Map(names.map((name) => [name.toLowerCase(), name]));
  for (const candidate of candidates) {
    const match = lookup.get(candidate);
    if (match) return match;
  }
  return undefined;
}

function approximateSize(name: string): number {
  const match = /(?:^|[:_-])(\d+(?:\.\d+)?)b(?:$|[-_:])/i.exec(name);
  return match?.[1] ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

export function selectLocalPlannerModel(names: string[], profile: CreatorPlannerProfile = "fast", requested?: string): string | undefined {
  const safeNames = names.map((name) => assertLocalModelName(name));
  if (requested) {
    const wanted = assertLocalModelName(requested);
    return safeNames.find((name) => name.toLowerCase() === wanted.toLowerCase());
  }
  const preferred = profile === "fast"
    ? ["qwen3.5:0.8b", "qwen3:0.6b", "qwen2.5:0.5b", "qwen3.5:2b", "qwen3:1.7b", "qwen3.5:4b", "qwen3:4b"]
    : ["qwen3.5:4b", "qwen3:4b", "qwen3.5:2b", "qwen3:1.7b", "qwen3.5:0.8b", "qwen3:0.6b"];
  const exact = exactCandidate(safeNames, preferred);
  if (exact) return exact;
  const generative = safeNames.filter((name) => /qwen|llama|mistral|gemma|phi/i.test(name) && !/embed/i.test(name));
  return [...generative].sort((left, right) => {
    const familyDelta = Number(!/qwen/i.test(left)) - Number(!/qwen/i.test(right));
    if (familyDelta) return familyDelta;
    const sizeDelta = approximateSize(left) - approximateSize(right);
    return profile === "fast" ? sizeDelta : -sizeDelta;
  })[0];
}

export async function getLocalAiStatus(options: LocalAiStatusOptions = {}): Promise<LocalAiStatus> {
  const baseUrl = localOllamaBaseUrl(options.baseUrl);
  const profile = normalizedProfile(options.profile);
  const requestedModel = options.model ? assertLocalModelName(options.model) : undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 1_500;
  try {
    const tags = await fetchJson<OllamaTagsResponse>(fetchImpl, endpoint(baseUrl, "/api/tags"), undefined, timeoutMs);
    const records = tags.models ?? [];
    const names = modelNames(records);
    const selectedModel = selectLocalPlannerModel(names, profile, requestedModel);
    let version: string | undefined;
    try {
      version = (await fetchJson<OllamaVersionResponse>(fetchImpl, endpoint(baseUrl, "/api/version"), undefined, timeoutMs)).version;
    } catch {
      // Tags are enough to plan. Older Ollama versions may not expose /api/version.
    }
    return {
      available: Boolean(selectedModel),
      localOnly: true,
      baseUrl,
      version,
      profile,
      selectedModel,
      models: records.map((record) => ({
        name: record.name || record.model || "unknown",
        sizeBytes: record.size,
        modifiedAt: record.modified_at,
      })),
      message: selectedModel
        ? `Ready with ${selectedModel}; all planning stays on this device.`
        : requestedModel
          ? `Ollama is running, but ${requestedModel} is not installed.`
          : "Ollama is running, but no supported local generation model is installed.",
    };
  } catch (error) {
    return {
      available: false,
      localOnly: true,
      baseUrl,
      profile,
      models: [],
      message: `Local Ollama is unavailable; instant deterministic planning will be used. ${clean(errorMessage(error), 180)}`,
    };
  }
}

function validDraft(value: unknown): value is LocalPlanDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<LocalPlanDraft>;
  if (typeof draft.title !== "string" || typeof draft.audience !== "string") return false;
  return Array.isArray(draft.scenes) && draft.scenes.length === 3 && draft.scenes.every((scene) => (
    Boolean(scene)
    && typeof scene.visual === "string"
    && typeof scene.narration === "string"
    && typeof scene.onScreenText === "string"
  ));
}

function mergedPlan(
  input: CreatorPromptVideoInput,
  baseline: CreatorProductionPlan,
  draft: LocalPlanDraft,
  metadata: NonNullable<CreatorProductionPlan["intelligence"]>,
): CreatorProductionPlan {
  const narrationEnabled = baseline.requirements.narration;
  return {
    ...baseline,
    title: input.title?.trim() ? baseline.title : clean(draft.title, 80) || baseline.title,
    requirements: {
      ...baseline.requirements,
      audience: clean(draft.audience, 180) || baseline.requirements.audience,
    },
    scenes: baseline.scenes.map((scene, index) => {
      const generated = draft.scenes[index];
      if (!generated) return scene;
      return {
        ...scene,
        visual: clean(generated.visual, 220) || scene.visual,
        // An explicitly authored narration is a locked script. Qwen may improve
        // its visual treatment and on-screen text, but must not rewrite it.
        narration: narrationEnabled && !input.narration ? (clean(generated.narration, 240) || scene.narration) : scene.narration,
        onScreenText: clean(generated.onScreenText, 64) || scene.onScreenText,
      };
    }),
    intelligence: metadata,
  };
}

function deterministicPlan(baseline: CreatorProductionPlan, profile: CreatorPlannerProfile, fallbackReason?: string): CreatorProductionPlan {
  return {
    ...baseline,
    intelligence: {
      provider: "deterministic",
      local: true,
      profile,
      ...(fallbackReason ? { fallbackReason: clean(fallbackReason, 220) } : {}),
    },
  };
}

function planCacheKey(input: CreatorPromptVideoInput, plan: CreatorProductionPlan, model: string): string {
  return JSON.stringify({
    model,
    prompt: input.prompt,
    mode: input.mode,
    title: input.title,
    narration: input.narration,
    durationSeconds: plan.requirements.targetDurationSeconds,
    presenter: input.presenter,
    voiceProvider: input.voiceProvider,
    presets: input.presets,
    generateVoice: input.generateVoice,
    generateMusic: input.generateMusic,
    source: input.source,
    sceneSources: input.sceneSources,
    characters: input.characters,
    logoSource: input.logoSource,
    musicSource: input.musicSource,
    mediaProvider: input.mediaProvider,
    mediaTask: input.mediaTask,
  });
}

function cachePlan(key: string, entry: PlanCacheEntry): void {
  planCache.set(key, entry);
  if (planCache.size > 50) planCache.delete(planCache.keys().next().value as string);
}

export async function enhancePromptVideoPlan(
  input: CreatorPromptVideoInput,
  baseline: CreatorProductionPlan,
  runtime: LocalAiRuntime = {},
): Promise<CreatorProductionPlan> {
  const provider = normalizedProvider(input.plannerProvider);
  const profile = normalizedProfile(input.plannerProfile);
  if (provider === "deterministic") return deterministicPlan(baseline, profile);

  const baseUrl = localOllamaBaseUrl(input.plannerBaseUrl);
  const requestedModel = input.plannerModel || process.env.AGENT_DEMO_OLLAMA_MODEL;
  if (requestedModel) assertLocalModelName(requestedModel);
  const fetchImpl = runtime.fetchImpl ?? fetch;
  const now = runtime.now ?? Date.now;
  const startedAt = now();

  try {
    const status = await getLocalAiStatus({
      baseUrl,
      profile,
      model: requestedModel,
      fetchImpl,
      timeoutMs: provider === "auto" ? 1_500 : 5_000,
    });
    if (!status.available || !status.selectedModel) {
      if (provider === "ollama") throw new Error(status.message);
      return deterministicPlan(baseline, profile, status.message);
    }
    const cacheKey = planCacheKey(input, baseline, status.selectedModel);
    const cached = planCache.get(cacheKey);
    if (cached && cached.expiresAt > now()) {
      return mergedPlan(input, baseline, cached.draft, {
        provider: "ollama",
        local: true,
        profile,
        model: cached.model,
        promptTokens: cached.promptTokens,
        outputTokens: cached.outputTokens,
        durationMs: Math.max(0, now() - startedAt),
        cacheHit: true,
      });
    }
    if (cached) planCache.delete(cacheKey);

    const response = await fetchJson<OllamaChatResponse>(fetchImpl, endpoint(baseUrl, "/api/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: status.selectedModel,
        stream: false,
        think: false,
        keep_alive: process.env.AGENT_DEMO_OLLAMA_KEEP_ALIVE || DEFAULT_KEEP_ALIVE,
        format: PLAN_SCHEMA,
        messages: [
          {
            role: "system",
            content: "Return only the compact video-plan JSON. Use supplied facts only; invent no claims. Write exactly three sequential scenes. Keep each visual under 14 words, narration under 18 words, and on-screen phrase under five words. Never request tools, credentials, network access, or approval.",
          },
          {
            role: "user",
            content: JSON.stringify({
              brief: clean(input.prompt, profile === "fast" ? 900 : 2_400),
              lockedNarration: input.narration ? clean(input.narration, profile === "fast" ? 1_000 : 3_000) : undefined,
              mode: input.mode,
              targetSeconds: baseline.requirements.targetDurationSeconds,
              presenter: input.presenter ?? "automatic fictional host",
              source: input.source || input.sceneSources?.length
                ? "user-provided local scene media is available"
                : input.mediaProvider === "local-adapter"
                  ? `generate scene media through the configured local ${input.mediaTask ?? "automatic"} adapter`
                  : "use replaceable bundled local visual assets",
              instruction: input.narration
                ? "Return a short title, focused audience, and three achievable story scenes whose visuals and on-screen text match the locked narration in order. Do not rewrite that script."
                : "Return a short title, focused audience, and three achievable story scenes.",
            }),
          },
        ],
        options: {
          temperature: 0,
          seed: 42,
          num_ctx: profile === "fast" ? 1_024 : 4_096,
          num_predict: profile === "fast" ? 240 : 360,
        },
      }),
    }, profile === "fast" ? 90_000 : 180_000);

    const content = response.message?.content;
    if (!content) throw new Error("Local Ollama returned no plan content.");
    const draft = JSON.parse(content) as unknown;
    if (!validDraft(draft)) throw new Error("Local Ollama returned a plan that did not match the required schema.");
    cachePlan(cacheKey, {
      expiresAt: now() + PLAN_CACHE_TTL_MS,
      model: response.model || status.selectedModel,
      promptTokens: response.prompt_eval_count,
      outputTokens: response.eval_count,
      draft,
    });
    return mergedPlan(input, baseline, draft, {
      provider: "ollama",
      local: true,
      profile,
      model: response.model || status.selectedModel,
      promptTokens: response.prompt_eval_count,
      outputTokens: response.eval_count,
      durationMs: Math.max(0, now() - startedAt),
    });
  } catch (error) {
    if (provider === "ollama") throw error;
    return deterministicPlan(baseline, profile, `Local Qwen planning failed, so the non-blocking fallback was used: ${errorMessage(error)}`);
  }
}

export async function warmLocalPlanner(options: LocalAiStatusOptions = {}): Promise<LocalAiWarmResult> {
  const status = await getLocalAiStatus({ ...options, timeoutMs: options.timeoutMs ?? 5_000 });
  if (!status.available || !status.selectedModel) throw new Error(status.message);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const startedAt = now();
  await fetchJson<Record<string, unknown>>(fetchImpl, endpoint(status.baseUrl, "/api/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: status.selectedModel,
      prompt: "",
      stream: false,
      keep_alive: process.env.AGENT_DEMO_OLLAMA_KEEP_ALIVE || DEFAULT_KEEP_ALIVE,
    }),
  }, 180_000);
  return {
    warmed: true,
    model: status.selectedModel,
    baseUrl: status.baseUrl,
    durationMs: Math.max(0, now() - startedAt),
    keepAlive: process.env.AGENT_DEMO_OLLAMA_KEEP_ALIVE || DEFAULT_KEEP_ALIVE,
  };
}
