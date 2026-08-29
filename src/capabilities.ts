import path from "node:path";
import { chromium } from "playwright";
import { AGENT_DEMO_VERSION, ffmpegCommand, ffprobeCommand, pathExists } from "./config.js";
import { getComfyUiStatus, type ComfyUiStatus } from "./creator/comfyui.js";
import { getLtxDesktopStatus, type LtxDesktopStatus } from "./creator/ltx-desktop.js";
import { getLocalAiStatus, type LocalAiStatus } from "./creator/local-ai.js";
import { getWanAnimateStatus, type WanAnimateStatus } from "./creator/wan-animate.js";
import type { CreatorMediaProvider, CreatorPlannerProfile, CreatorPlannerProvider } from "./creator/types.js";
import { commandExists } from "./utils/process.js";

export type CapabilityStatus = "ready" | "configured" | "unavailable";
export type CapabilityCategory = "planning" | "recording" | "visuals" | "voice" | "captions" | "music" | "rendering" | "agents";
export type CapabilityCost = "free-local" | "provider-terms";

export interface AgentDemoCapability {
  id: string;
  category: CapabilityCategory;
  label: string;
  status: CapabilityStatus;
  available: boolean;
  selected: boolean;
  required: boolean;
  local: boolean;
  requiresNetwork: boolean;
  cost: CapabilityCost;
  detail: string;
  features: string[];
  setup?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface CapabilityRequest {
  plannerProvider?: CreatorPlannerProvider;
  plannerProfile?: CreatorPlannerProfile;
  plannerModel?: string;
  plannerBaseUrl?: string;
  mediaProvider?: CreatorMediaProvider;
  mediaAdapterUrl?: string;
  comfyuiUrl?: string;
  comfyuiWorkflow?: string;
  ltxDesktopUrl?: string;
  allowCloudMedia?: boolean;
  generateVoice?: boolean;
  voiceProvider?: "local" | "neural" | "local-clone";
  voiceCloneUrl?: string;
  voiceReferenceAvailable?: boolean;
  voiceConsentConfirmed?: boolean;
  voiceSpeakerName?: string;
  generateMusic?: boolean;
  suppliedMusic?: boolean;
  render?: boolean;
  browserRecording?: boolean;
}

export interface CapabilityReport {
  schemaVersion: 1;
  studioVersion: string;
  generatedAt: string;
  platform: NodeJS.Platform;
  architecture: string;
  localFirst: true;
  paidApiTokensRequired: boolean;
  readyForRequest: boolean;
  fullyLocalForRequest: boolean;
  blockers: Array<{ id: string; detail: string; setup?: string }>;
  summary: {
    ready: number;
    configured: number;
    unavailable: number;
    selected: number;
  };
  capabilities: AgentDemoCapability[];
}

export interface CapabilityRuntime {
  commandExists?: (command: string) => Promise<boolean>;
  pathExists?: (filePath: string) => Promise<boolean>;
  localAiStatus?: () => Promise<LocalAiStatus>;
  comfyUiStatus?: () => Promise<ComfyUiStatus>;
  ltxDesktopStatus?: () => Promise<LtxDesktopStatus>;
  wanAnimateStatus?: () => Promise<WanAnimateStatus>;
  browserExecutablePath?: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

interface EndpointCheck {
  available: boolean;
  detail: string;
  endpoint?: string;
}

function loopbackEndpoint(value: string | undefined, label: string): EndpointCheck {
  if (!value?.trim()) return { available: false, detail: `${label} is not configured.` };
  try {
    const url = new URL(value);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase());
    if (!local || (url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.hash) {
      return { available: false, detail: `${label} must be an HTTP(S) loopback URL without credentials or fragments.` };
    }
    return { available: true, detail: `${label} configured on this device.`, endpoint: url.toString() };
  } catch {
    return { available: false, detail: `${label} URL is invalid.` };
  }
}

async function configuredCommand(
  configured: string | undefined,
  candidates: string[],
  exists: (command: string) => Promise<boolean>,
  fileExists: (filePath: string) => Promise<boolean>,
): Promise<{ available: boolean; command?: string }> {
  if (configured?.trim()) {
    const command = configured.trim();
    const available = path.isAbsolute(command) ? await fileExists(command) : await exists(command);
    return { available, command };
  }
  for (const candidate of candidates) if (await exists(candidate)) return { available: true, command: candidate };
  return { available: false };
}

function capability(
  value: Omit<AgentDemoCapability, "available"> & { available?: boolean },
): AgentDemoCapability {
  return { ...value, available: value.available ?? value.status !== "unavailable" };
}

function selectedPlanner(request: CapabilityRequest, localAi: LocalAiStatus): "deterministic" | "ollama" | undefined {
  if (!request.plannerProvider) return undefined;
  if (request.plannerProvider === "deterministic") return "deterministic";
  if (request.plannerProvider === "ollama") return "ollama";
  return localAi.available ? "ollama" : "deterministic";
}

function selectedMediaProvider(request: CapabilityRequest, env: NodeJS.ProcessEnv): Exclude<CreatorMediaProvider, "auto"> | undefined {
  if (!request.mediaProvider) return undefined;
  if (request.mediaProvider !== "auto") return request.mediaProvider;
  if (request.ltxDesktopUrl || env.AGENT_DEMO_LTX_DESKTOP_URL) return "ltx-desktop";
  if ((request.comfyuiUrl || env.AGENT_DEMO_COMFYUI_URL) && (request.comfyuiWorkflow || env.AGENT_DEMO_COMFYUI_WORKFLOW)) return "comfyui";
  if (request.mediaAdapterUrl || env.AGENT_DEMO_MEDIA_ADAPTER_URL || env.AGENT_DEMO_WAN_VIDEO_ADAPTER_URL) return "local-adapter";
  return "animated";
}

/**
 * Inspect the installed video stack without invoking generation or sending data
 * away from the device. Optional loopback adapters are reported as configured,
 * because probing their generation endpoints would create media as a side effect.
 */
export async function inspectCapabilities(
  request: CapabilityRequest = {},
  runtime: CapabilityRuntime = {},
): Promise<CapabilityReport> {
  const exists = runtime.commandExists ?? commandExists;
  const fileExists = runtime.pathExists ?? pathExists;
  const env = runtime.env ?? process.env;
  const platform = runtime.platform ?? process.platform;
  const browserPath = runtime.browserExecutablePath ?? chromium.executablePath();
  const voiceEnabled = request.generateVoice === true;
  const selectedVoice = voiceEnabled ? (request.voiceProvider ?? "local") : undefined;
  const selectedVisuals = selectedMediaProvider(request, env);
  const selectedMusic = request.generateMusic === true && !request.suppliedMusic;
  const localMedia = loopbackEndpoint(
    request.mediaAdapterUrl || env.AGENT_DEMO_MEDIA_ADAPTER_URL || env.AGENT_DEMO_WAN_VIDEO_ADAPTER_URL,
    "Local media adapter",
  );
  const localVoice = loopbackEndpoint(request.voiceCloneUrl || env.AGENT_DEMO_VOICE_CLONE_URL, "Local voice-clone adapter");
  const comfyPromise = runtime.comfyUiStatus
    ? runtime.comfyUiStatus()
    : getComfyUiStatus({
      baseUrl: request.comfyuiUrl,
      workflow: request.comfyuiWorkflow,
      fetchImpl: runtime.fetchImpl,
      timeoutMs: 1_500,
    });
  const ltxPromise = runtime.ltxDesktopStatus
    ? runtime.ltxDesktopStatus()
    : getLtxDesktopStatus({
      baseUrl: request.ltxDesktopUrl,
      fetchImpl: runtime.fetchImpl,
      timeoutMs: 1_500,
      platform,
      env,
    });
  const wanPromise = runtime.wanAnimateStatus
    ? runtime.wanAnimateStatus()
    : getWanAnimateStatus({ env });

  const localAiPromise = runtime.localAiStatus
    ? runtime.localAiStatus()
    : getLocalAiStatus({
      profile: request.plannerProfile,
      model: request.plannerModel,
      baseUrl: request.plannerBaseUrl,
      fetchImpl: runtime.fetchImpl,
    });
  const speechCandidates = platform === "win32" ? ["powershell.exe"] : platform === "darwin" ? ["say"] : ["espeak"];
  const [localAi, comfyUi, ltxDesktop, wanAnimate, ffmpeg, ffprobe, browserReady, speech, neural, whisper, codex, claude] = await Promise.all([
    localAiPromise,
    comfyPromise,
    ltxPromise,
    wanPromise,
    configuredCommand(env.AGENT_DEMO_FFMPEG, [ffmpegCommand()], exists, fileExists),
    configuredCommand(env.AGENT_DEMO_FFPROBE, [ffprobeCommand()], exists, fileExists),
    fileExists(browserPath),
    configuredCommand(undefined, speechCandidates, exists, fileExists),
    configuredCommand(env.AGENT_DEMO_EDGE_TTS, ["edge-tts"], exists, fileExists),
    configuredCommand(env.AGENT_DEMO_WHISPER, ["whisper", "whisper-cli"], exists, fileExists),
    exists("codex"),
    exists("claude"),
  ]);
  const planner = selectedPlanner(request, localAi);
  const cloneAuthorizationReady = Boolean(request.voiceReferenceAvailable && request.voiceConsentConfirmed && request.voiceSpeakerName?.trim());
  const ltxAllowed = ltxDesktop.available && (ltxDesktop.localGenerationAvailable || request.allowCloudMedia === true);

  const capabilities: AgentDemoCapability[] = [
    capability({
      id: "planner.deterministic",
      category: "planning",
      label: "Instant deterministic planner",
      status: "ready",
      selected: planner === "deterministic",
      required: planner === "deterministic",
      local: true,
      requiresNetwork: false,
      cost: "free-local",
      detail: "Built-in production planning is always available and uses no model tokens.",
      features: ["requirements", "storyboard", "resources", "rights", "workflow", "quality-gates"],
    }),
    capability({
      id: "planner.ollama-qwen",
      category: "planning",
      label: "Local Ollama / Qwen planner",
      status: localAi.available ? "ready" : "unavailable",
      selected: planner === "ollama",
      required: planner === "ollama",
      local: true,
      requiresNetwork: false,
      cost: "free-local",
      detail: localAi.message,
      features: ["structured-script", "visual-direction", "prompt-matched-scenes"],
      setup: "ollama pull qwen3.5:0.8b",
      metadata: {
        profile: localAi.profile,
        ...(localAi.selectedModel ? { selectedModel: localAi.selectedModel } : {}),
        ...(localAi.version ? { version: localAi.version } : {}),
      },
    }),
    capability({
      id: "recording.playwright",
      category: "recording",
      label: "Live Chromium recording",
      status: browserReady ? "ready" : "unavailable",
      selected: request.browserRecording === true,
      required: request.browserRecording === true,
      local: true,
      requiresNetwork: false,
      cost: "free-local",
      detail: browserReady ? "Playwright Chromium is installed." : "Playwright Chromium is not installed.",
      features: ["browser-tour", "cursor", "annotations", "screenshots"],
      setup: "agent-demo setup",
    }),
    capability({
      id: "visuals.ltx-desktop",
      category: "visuals",
      label: "LTX Desktop generative video",
      status: ltxDesktop.localGenerationAvailable ? "ready" : ltxDesktop.installed ? "configured" : "unavailable",
      available: ltxAllowed,
      selected: selectedVisuals === "ltx-desktop",
      required: selectedVisuals === "ltx-desktop",
      local: ltxDesktop.localGenerationAvailable,
      requiresNetwork: ltxDesktop.apiOnly,
      cost: ltxDesktop.apiOnly ? "provider-terms" : "free-local",
      detail: ltxDesktop.message,
      features: ["text-to-video", "image-to-video", "audio-to-video", "moving-characters", "synchronized-audio", "LTX-2"],
      setup: ltxDesktop.installed
        ? "Start LTX Desktop and make sure its backend is healthy. Fully local Windows generation requires an NVIDIA CUDA GPU with at least 16 GB VRAM."
        : "Install the official LTX Desktop app, then start its localhost backend.",
      metadata: {
        endpoint: ltxDesktop.baseUrl,
        installed: ltxDesktop.installed,
        apiOnly: ltxDesktop.apiOnly,
        ...(ltxDesktop.executablePath ? { executable: ltxDesktop.executablePath } : {}),
        ...(ltxDesktop.activeModel ? { activeModel: ltxDesktop.activeModel } : {}),
        ...(ltxDesktop.gpuName ? { gpu: ltxDesktop.gpuName } : {}),
      },
    }),
    capability({
      id: "visuals.animated",
      category: "visuals",
      label: "Prompt-conditioned motion graphics",
      status: browserReady && ffmpeg.available ? "ready" : "unavailable",
      selected: selectedVisuals === "animated",
      required: selectedVisuals === "animated",
      local: true,
      requiresNetwork: false,
      cost: "free-local",
      detail: browserReady && ffmpeg.available
        ? "Scene-specific 1080p vector graphics, articulated characters, planned actions, props, settings, and stable backgrounds are ready. This is not Wan/LTX diffusion inference."
        : "The prompt-conditioned motion-graphics engine requires Playwright Chromium and FFmpeg.",
      features: ["semantic-scene-graph", "moving-characters", "planned-actions", "scene-specific-props", "stable-1080p", "no-photo-shake"],
      setup: "Run agent-demo setup and install FFmpeg.",
    }),
    capability({
      id: "visuals.wan-animate-2",
      category: "visuals",
      label: "Wan-Animate-2 character motion",
      status: wanAnimate.available ? "ready" : wanAnimate.metadataInstalled || wanAnimate.weightsInstalled ? "configured" : "unavailable",
      available: wanAnimate.available,
      selected: false,
      required: false,
      local: true,
      requiresNetwork: false,
      cost: "free-local",
      detail: wanAnimate.message,
      features: ["reference-character", "driving-video", "identity-preservation", "viewpoint-control", "720p"],
      setup: "Configure AGENT_DEMO_WAN_ANIMATE_MODEL_PATH and a loopback AGENT_DEMO_WAN_ANIMATE_ADAPTER_URL on a suitable NVIDIA multi-GPU workstation.",
      metadata: {
        modelId: wanAnimate.modelId,
        metadataInstalled: wanAnimate.metadataInstalled,
        weightsInstalled: wanAnimate.weightsInstalled,
        requiredDownloadGb: wanAnimate.requiredDownloadGb,
        ...(wanAnimate.modelPath ? { modelPath: wanAnimate.modelPath } : {}),
        ...(wanAnimate.adapterUrl ? { adapter: wanAnimate.adapterUrl } : {}),
      },
    }),
    capability({
      id: "visuals.comfyui-video",
      category: "visuals",
      label: "ComfyUI generative video",
      status: comfyUi.available ? "ready" : comfyUi.configured ? "configured" : "unavailable",
      available: comfyUi.available,
      selected: selectedVisuals === "comfyui",
      required: selectedVisuals === "comfyui",
      local: true,
      requiresNetwork: false,
      cost: "free-local",
      detail: comfyUi.message,
      features: ["text-to-video", "image-to-video", "speech-to-video", "character-animation", "LTX", "Wan"],
      setup: "Start ComfyUI, export an API workflow containing {{PROMPT}}, then set AGENT_DEMO_COMFYUI_URL and AGENT_DEMO_COMFYUI_WORKFLOW.",
      metadata: {
        ...(comfyUi.baseUrl ? { endpoint: comfyUi.baseUrl } : {}),
        ...(comfyUi.workflowPath ? { workflow: comfyUi.workflowPath } : {}),
      },
    }),
    capability({
      id: "visuals.builtin-uploads",
      category: "visuals",
      label: "Legacy still-image compositor",
      status: "ready",
      selected: selectedVisuals === "builtin",
      required: selectedVisuals === "builtin",
      local: true,
      requiresNetwork: false,
      cost: "free-local",
      detail: "Slides, still artwork, and uploads can be edited, but this path is not real video generation and is never selected automatically.",
      features: ["slides", "locked-stills", "characters", "logos", "vfx"],
    }),
    capability({
      id: "visuals.local-adapter",
      category: "visuals",
      label: "Local image/video generation adapter",
      status: localMedia.available ? "configured" : "unavailable",
      selected: selectedVisuals === "local-adapter",
      required: selectedVisuals === "local-adapter",
      local: true,
      requiresNetwork: false,
      cost: "free-local",
      detail: localMedia.detail,
      features: ["text-to-image", "image-to-video", "text-to-video", "speech-to-video", "character-animation", "batch-scenes"],
      setup: "Set AGENT_DEMO_MEDIA_ADAPTER_URL (or AGENT_DEMO_WAN_VIDEO_ADAPTER_URL) to a loopback /v1/media/generate endpoint.",
      metadata: localMedia.endpoint ? { endpoint: localMedia.endpoint } : undefined,
    }),
    capability({
      id: "voice.system",
      category: "voice",
      label: "Operating-system speech",
      status: speech.available ? "ready" : "unavailable",
      selected: selectedVoice === "local",
      required: selectedVoice === "local",
      local: true,
      requiresNetwork: false,
      cost: "free-local",
      detail: speech.available ? `Local speech is ready through ${speech.command}.` : `No local speech command was found for ${platform}.`,
      features: ["narration", "scene-aligned-tracks", "natural-rate-control"],
      setup: platform === "linux" ? "Install espeak." : undefined,
    }),
    capability({
      id: "voice.edge-tts",
      category: "voice",
      label: "Edge neural speech",
      status: neural.available ? "ready" : "unavailable",
      selected: selectedVoice === "neural",
      required: selectedVoice === "neural",
      local: false,
      requiresNetwork: true,
      cost: "provider-terms",
      detail: neural.available ? `Neural speech command found at ${neural.command}.` : "edge-tts is not installed.",
      features: ["neural-narration", "voice-selection", "rate", "pitch", "volume"],
      setup: "uv tool install edge-tts",
    }),
    capability({
      id: "voice.local-clone",
      category: "voice",
      label: "Consented local voice clone",
      status: localVoice.available && cloneAuthorizationReady ? "configured" : "unavailable",
      selected: selectedVoice === "local-clone",
      required: selectedVoice === "local-clone",
      local: true,
      requiresNetwork: false,
      cost: "free-local",
      detail: !localVoice.available
        ? localVoice.detail
        : cloneAuthorizationReady
          ? "Loopback adapter, reference recording, named speaker, and consent are present."
          : "The adapter is configured, but a reference recording plus named-speaker consent is required.",
      features: ["authorized-reference-voice", "scene-aligned-tracks", "consent-record"],
      setup: "Set AGENT_DEMO_VOICE_CLONE_URL and provide an authorized reference plus named-speaker consent.",
      metadata: localVoice.endpoint ? { endpoint: localVoice.endpoint } : undefined,
    }),
    capability({
      id: "captions.timeline",
      category: "captions",
      label: "Timeline captions",
      status: "ready",
      selected: voiceEnabled,
      required: voiceEnabled,
      local: true,
      requiresNetwork: false,
      cost: "free-local",
      detail: "Scene narration produces synchronized SRT sidecars and optional burned captions.",
      features: ["srt", "vtt", "burn-in", "safe-zones"],
    }),
    capability({
      id: "captions.whisper",
      category: "captions",
      label: "Local Whisper transcription",
      status: whisper.available ? "ready" : "unavailable",
      selected: false,
      required: false,
      local: true,
      requiresNetwork: false,
      cost: "free-local",
      detail: whisper.available ? `Transcription command found at ${whisper.command}.` : "Local Whisper is optional and not installed.",
      features: ["speech-to-text", "existing-video-captions", "language-hint"],
      setup: "Install whisper or whisper-cli, or set AGENT_DEMO_WHISPER.",
    }),
    capability({
      id: "music.procedural",
      category: "music",
      label: "Original procedural music",
      status: "ready",
      selected: selectedMusic,
      required: selectedMusic,
      local: true,
      requiresNetwork: false,
      cost: "free-local",
      detail: "Ambient scores and ASMR soundscapes are synthesized locally without downloaded samples.",
      features: ["ambient", "asmr", "stereo-wav", "automatic-fades"],
    }),
    capability({
      id: "rendering.ffmpeg",
      category: "rendering",
      label: "FFmpeg renderer",
      status: ffmpeg.available ? "ready" : "unavailable",
      selected: request.render === true,
      required: request.render === true,
      local: true,
      requiresNetwork: false,
      cost: "free-local",
      detail: ffmpeg.available ? `FFmpeg is ready through ${ffmpeg.command}.` : "FFmpeg is not available.",
      features: ["h264", "hevc", "aac", "transitions", "vfx", "audio-mix"],
      setup: "Install FFmpeg and ensure ffmpeg is on PATH.",
    }),
    capability({
      id: "rendering.ffprobe",
      category: "rendering",
      label: "FFprobe media inspection",
      status: ffprobe.available ? "ready" : "unavailable",
      selected: request.render === true,
      required: request.render === true,
      local: true,
      requiresNetwork: false,
      cost: "free-local",
      detail: ffprobe.available ? `FFprobe is ready through ${ffprobe.command}.` : "FFprobe is not available.",
      features: ["duration", "dimensions", "frame-rate", "audio-probe"],
      setup: "Install FFmpeg and ensure ffprobe is on PATH.",
    }),
    capability({
      id: "agents.codex",
      category: "agents",
      label: "Codex CLI",
      status: codex ? "ready" : "unavailable",
      selected: false,
      required: false,
      local: true,
      requiresNetwork: false,
      cost: "provider-terms",
      detail: codex ? "Codex CLI is installed." : "Codex CLI is optional and not installed.",
      features: ["mcp-install", "terminal-orchestration"],
      setup: "Install Codex, then run agent-demo setup --codex.",
    }),
    capability({
      id: "agents.claude",
      category: "agents",
      label: "Claude Code CLI",
      status: claude ? "ready" : "unavailable",
      selected: false,
      required: false,
      local: true,
      requiresNetwork: false,
      cost: "provider-terms",
      detail: claude ? "Claude Code CLI is installed." : "Claude Code CLI is optional and not installed.",
      features: ["mcp-install", "terminal-orchestration"],
      setup: "Install Claude Code, then run agent-demo setup --claude.",
    }),
  ];

  const blockers = capabilities
    .filter((item) => item.required && !item.available)
    .map((item) => ({ id: item.id, detail: item.detail, ...(item.setup ? { setup: item.setup } : {}) }));
  const selected = capabilities.filter((item) => item.selected);
  const paidApiTokensRequired = selected.some((item) => item.required && item.requiresNetwork && item.cost === "provider-terms");
  return {
    schemaVersion: 1,
    studioVersion: AGENT_DEMO_VERSION,
    generatedAt: (runtime.now?.() ?? new Date()).toISOString(),
    platform,
    architecture: runtime.architecture ?? process.arch,
    localFirst: true,
    paidApiTokensRequired,
    readyForRequest: blockers.length === 0,
    fullyLocalForRequest: blockers.length === 0 && selected.every((item) => item.local && !item.requiresNetwork && item.cost === "free-local"),
    blockers,
    summary: {
      ready: capabilities.filter((item) => item.status === "ready").length,
      configured: capabilities.filter((item) => item.status === "configured").length,
      unavailable: capabilities.filter((item) => item.status === "unavailable").length,
      selected: selected.length,
    },
    capabilities,
  };
}
