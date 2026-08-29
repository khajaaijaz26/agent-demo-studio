import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { inspectCapabilities, type CapabilityRuntime } from "../capabilities.js";
import { generateAmbientMusic, generateAsmrSoundscape } from "../audio/music.js";
import { generateNeuralSpeech } from "../audio/neural-tts.js";
import { generateLocalSpeech } from "../audio/tts.js";
import { generateLocalClonedSpeech } from "../audio/voice-clone.js";
import { slugify } from "../utils/text.js";
import { analyzeAnimatedScene, generateAnimatedSceneMedia } from "./animated-media.js";
import { bundledAssetLicense } from "./assets.js";
import { serializeSrt } from "./captions.js";
import { generateComfyUiSceneMedia } from "./comfyui.js";
import type { SceneMediaGenerationResult } from "./generated-media.js";
import { enhancePromptVideoPlan, type LocalAiRuntime } from "./local-ai.js";
import { generateLocalSceneMedia } from "./local-media.js";
import { generateLtxDesktopSceneMedia } from "./ltx-desktop.js";
import { probeMediaInfo } from "./media.js";
import { renderCreatorManifest } from "./renderer.js";
import {
  CREATOR_SCHEMA_VERSION,
  type CaptionCue,
  type CreatorClip,
  type CreatorManifest,
  type CreatorOverlay,
  type CreatorProductionPlan,
  type CreatorPromptMode,
  type CreatorPromptModeChoice,
  type CreatorPromptVideoInput,
  type CreatorPromptVideoResult,
} from "./types.js";

type ProgressReporter = (progress: number, message: string) => void;

export interface PromptPlanningRuntime extends LocalAiRuntime {
  capabilityRuntime?: CapabilityRuntime;
}

const DEFAULT_DURATIONS = {
  "product-launch": 24,
  cartoon: 36,
  story: 45,
  asmr: 30,
  vfx: 18,
} as const;

/**
 * Chooses an editing/audio treatment without limiting the subject matter sent to
 * the visual model. `auto` is intentionally a control-surface choice; persisted
 * plans always contain one concrete treatment.
 */
export function inferPromptMode(prompt: string, requested: CreatorPromptModeChoice = "auto"): CreatorPromptMode {
  if (requested !== "auto") return requested;
  if (/\b(asmr|whisper(?:ed|ing)?|satisfying|tapping|crackle|close[- ]?mic|sensory)\b/i.test(prompt)) return "asmr";
  if (/\b(vfx|visual effects?|glitch|transformation reel|compositing|neon effects?|cinematic effects?)\b/i.test(prompt)) return "vfx";
  if (/\b(product launch|advert(?:isement)?|commercial|brand film|promo|saas demo|app demo|website demo|call to action|cta)\b/i.test(prompt)
    || /\blaunch\b.*\b(product|platform|app|website|service|tool)\b/i.test(prompt)) return "product-launch";
  if (/\b(cartoon|classroom|animated lesson|animation|teacher|students?|education(?:al)?|explainer|diagram|infographic|whiteboard)\b/i.test(prompt)) return "cartoon";
  if (/\b(story|narrative|fairy tale|bedtime|documentary|short film|music video|anime|cinematic scene)\b/i.test(prompt)) return "story";
  return "story";
}

export function resolveRequestedVisualQuality(input: CreatorPromptVideoInput): "generative" | "motion-graphics" {
  if (input.mediaProvider && input.mediaProvider !== "auto") {
    return input.mediaProvider === "animated" || input.mediaProvider === "builtin" ? "motion-graphics" : "generative";
  }
  if (input.visualQuality === "generative" || input.visualQuality === "motion-graphics") return input.visualQuality;
  if (["text-to-video", "image-to-video", "speech-to-video", "character-animation"].includes(input.mediaTask ?? "")) return "generative";
  const suppliedImages = [input.source, ...(input.sceneSources ?? []), ...(input.characters ?? []).map((character) => character.source)]
    .filter((source): source is string => Boolean(source))
    .some((source) => /\.(?:avif|gif|jpe?g|png|webp)$/i.test(source));
  if (suppliedImages) return "generative";
  if (/\b(vector|motion graphics?|infographic|diagram animation|simple 2d|lightweight 2d)\b/i.test(input.prompt)) return "motion-graphics";
  if (/\b(video|film|reel|short|advert(?:isement)?|commercial|cartoon|animated|animation|characters?|seedance|wan|ltx|photoreal(?:istic)?|diffusion|realistic human|foundation video model|text[- ]to[- ]video|image[- ]to[- ]video|speech[- ]to[- ]video)\b/i.test(input.prompt)) return "generative";
  return "motion-graphics";
}

export function resolvePromptMediaProvider(
  input: CreatorPromptVideoInput,
  env: NodeJS.ProcessEnv = process.env,
): Exclude<NonNullable<CreatorPromptVideoInput["mediaProvider"]>, "auto"> {
  if (input.mediaProvider && input.mediaProvider !== "auto") return input.mediaProvider;
  const quality = resolveRequestedVisualQuality(input);
  if (quality === "motion-graphics") return "animated";
  if (input.ltxDesktopUrl || env.AGENT_DEMO_LTX_DESKTOP_URL) return "ltx-desktop";
  if ((input.comfyuiUrl || env.AGENT_DEMO_COMFYUI_URL) && (input.comfyuiWorkflow || env.AGENT_DEMO_COMFYUI_WORKFLOW)) return "comfyui";
  if (input.mediaAdapterUrl || env.AGENT_DEMO_MEDIA_ADAPTER_URL || env.AGENT_DEMO_WAN_VIDEO_ADAPTER_URL) return "local-adapter";
  // Never promise Seedance-style generation and quietly return moving photos.
  // LTX Desktop has an official typed localhost API. Selecting it here makes
  // the persisted capability gate explain hardware/API-only limitations rather
  // than silently turning a generative request into a moving slideshow.
  return "ltx-desktop";
}

function motionStandard(provider: ReturnType<typeof resolvePromptMediaProvider>): NonNullable<CreatorProductionPlan["requirements"]["motionStandard"]> {
  if (provider === "animated") return "animated-2d";
  if (provider === "ltx-desktop" || provider === "comfyui" || provider === "local-adapter") return "generative-video";
  return "still-composite";
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function projectTitle(input: CreatorPromptVideoInput): string {
  if (input.title?.trim()) return cleanText(input.title);
  const words = cleanText(input.prompt).replace(/[.!?].*$/s, "").split(" ").slice(0, 8);
  const title = words.join(" ").replace(/[^\p{L}\p{N}\s'&-]/gu, "").trim();
  return title || "Prompt video";
}

function promptBeats(prompt: string): string[] {
  const normalized = cleanText(prompt);
  let beats = normalized.split(/(?:\s*[.!?]\s+|\s*[;\n]\s*)/).map(cleanText).filter((item) => item.length >= 3);
  if (beats.length < 2) beats = normalized.split(/\s*,\s*/).map(cleanText).filter((item) => item.length >= 3);
  if (!beats.length) beats = ["A new story begins"];
  return beats.slice(0, 5).map((item) => item.length > 76 ? `${item.slice(0, 73).trimEnd()}…` : item);
}

function splitNarrationAcrossScenes(value: string, sceneCount: number): string[] {
  const text = cleanText(value);
  if (!text || sceneCount <= 0) return [];
  const sentences = text.split(/(?<=[.!?])\s+/).map(cleanText).filter(Boolean);
  if (sentences.length <= 1) return [text, ...Array.from({ length: Math.max(0, sceneCount - 1) }, () => "")];
  if (sentences.length <= sceneCount) return Array.from({ length: sceneCount }, (_, index) => sentences[index] ?? "");
  return Array.from({ length: sceneCount }, (_, index) => {
    const start = Math.floor(index * sentences.length / sceneCount);
    const end = Math.floor((index + 1) * sentences.length / sceneCount);
    return sentences.slice(start, Math.max(start + 1, end)).join(" ");
  });
}

function compactOverlayText(value: string, maxCharacters = 52): string {
  const normalized = cleanText(value);
  return normalized.length > maxCharacters
    ? `${normalized.slice(0, maxCharacters - 1).trimEnd()}…`
    : normalized;
}

function narrationOverlayText(value: string, index: number): string {
  const normalized = cleanText(value);
  const lower = normalized.toLowerCase();
  if (/\b(?:sun(?:ny)?|warm(?:s|ed|ing)?)\b/.test(lower) && /\b(?:water|vapor|evaporation|evaporates?|evaporating)\b/.test(lower)) return "Evaporation - water becomes vapor";
  if (/\b(?:cool(?:s|ed|ing)?|gather(?:s|ed|ing)?|condensation|condenses?|condensing)\b/.test(lower) && /\b(?:clouds?|droplets?|vapor)\b/.test(lower)) return "Condensation - vapor forms clouds";
  if (/\b(?:rains?|raining|rainfall|snow|snowing|heavy droplets?|precipitation|precipitates?)\b/.test(lower)) return "Precipitation - water returns";
  const firstClause = normalized.split(/[,;:]/, 1)[0] || normalized;
  return compactOverlayText(firstClause || `Scene ${index + 1}`, 58);
}

function intendedAudience(prompt: string): string {
  const age = prompt.match(/\bages?\s+((?:\d{1,2}|[a-z]+)(?:\s*(?:-|to|through)\s*(?:\d{1,2}|[a-z]+))?)/i)?.[1];
  if (age) return `Children ages ${cleanText(age)}`;
  if (/\b(?:children|kids|young learners|primary pupils)\b/i.test(prompt)) return "Children, young learners, and their families";
  if (/\bteachers?|educators?|instructors?\b/i.test(prompt)) return "Teachers and education professionals";
  if (/\bstudents?|learners?|pupils?\b/i.test(prompt)) return "Students and learners";
  return "The intended product or story audience; refine this field when the brief names a specific viewer.";
}

function launchTimings(duration: number): { beatStart: number; beatEnd: number; ctaStart: number } {
  const beatStart = Math.min(3, duration * 0.18);
  const ctaDuration = Math.min(4.5, Math.max(1.4, duration * 0.28));
  const ctaStart = Math.max(beatStart + 1.1, duration - ctaDuration);
  return {
    beatStart,
    beatEnd: Math.max(beatStart + 0.9, Math.min(8.5, ctaStart - 0.25)),
    ctaStart,
  };
}

function builtInScene(mode: CreatorPromptVideoInput["mode"]): string {
  if (mode === "cartoon") return "builtin:scene/cartoon-workshop";
  if (mode === "story") return "builtin:scene/story-forest";
  if (mode === "asmr") return "builtin:scene/asmr-glass";
  return "builtin:scene/launch-stage";
}

function presenterSource(id: NonNullable<CreatorPromptVideoInput["presenter"]>): { type: "presenter" | "character"; source: string } | undefined {
  if (id === "none") return undefined;
  if (id === "aria" || id === "leo") return { type: "presenter", source: `builtin:presenter/${id}` };
  return { type: "character", source: `builtin:character/${id}` };
}

function plannedPresenter(input: CreatorPromptVideoInput): NonNullable<CreatorPromptVideoInput["presenter"]> {
  if (input.characters?.length) return "none";
  return input.presenter ?? "none";
}

function cartoonCast(presenter: NonNullable<CreatorPromptVideoInput["presenter"]>): Array<"aria" | "leo" | "nova" | "milo"> {
  if (presenter === "none") return [];
  if (presenter === "milo") return ["milo", "nova"];
  if (presenter === "aria" || presenter === "leo") return [presenter];
  return ["nova", "milo"];
}

export function createPromptVideoPlan(input: CreatorPromptVideoInput): CreatorProductionPlan {
  const prompt = cleanText(input.prompt);
  if (!prompt) throw new Error("A prompt is required.");
  const mediaProvider = resolvePromptMediaProvider(input);
  const title = projectTitle(input);
  const duration = Math.max(6, Math.min(600, input.durationSeconds ?? DEFAULT_DURATIONS[input.mode]));
  const presets = input.presets ?? (input.mode === "asmr" ? ["youtube-1080p", "reels"] : ["youtube-1080p", "shorts", "reels", "tiktok"]);
  const beats = promptBeats(prompt);
  const visualBeats = beats.length > 3 && /^(?:create|generate|make|produce)\b.*\b(?:video|film|cartoon|story|advert|reel|short)\b/i.test(beats[0] ?? "")
    ? beats.slice(1)
    : beats;
  const presenter = plannedPresenter(input);
  const suppliedCharacters = (input.characters ?? []).filter((character) => cleanText(character.name) && character.source.trim());
  const selectedCartoonCast = input.mode === "cartoon" ? cartoonCast(presenter) : [];
  const cartoonCastNames = suppliedCharacters.length
    ? suppliedCharacters.map((character) => cleanText(character.name))
    : selectedCartoonCast.map((id) => id[0]!.toUpperCase() + id.slice(1));
  const cartoonCastLabel = cartoonCastNames.join(" and ");
  const direction = {
    "product-launch": { visualStyle: "Premium cinematic product reveal with controlled glow and confident typography", pacing: "Hook quickly, establish value, show proof, then hold a clear CTA", composition: "Product-first widescreen stage with presenter balanced against readable copy", effects: ["cinematic", "glow"] as const },
    cartoon: { visualStyle: "Colorful original cartoon world with expressive fictional hosts and continuous character action", pacing: "Playful setup, discovery, response, and satisfying resolution", composition: "Alternating character staging, large readable teaching visuals, and generous caption-safe space", effects: ["comic"] as const },
    story: { visualStyle: "Atmospheric illustrated storybook with gentle depth and light", pacing: "Calm opening, rising curiosity, meaningful turn, reflective ending", composition: "Layered scenic motion with a narrator character and uncluttered story text", effects: ["dream"] as const },
    asmr: { visualStyle: "Macro glass, water, ceramic, and soft luminous texture", pacing: "Slow, continuous, low-stimulation sensory progression", composition: "Centered tactile detail with minimal typography and spacious negative space", effects: ["asmr-soft"] as const },
    vfx: { visualStyle: "High-contrast cinematic transformation reel with neon and analog texture", pacing: "Immediate visual hook, escalating transformations, clean final reveal", composition: "Full-frame effects showcase with concise overlays kept clear of captions", effects: ["neon", "glitch", "vhs"] as const },
  }[input.mode];
  const sceneWeights = [0.28, 0.4, 0.32];
  const sceneTitles = ["Hook and establish", "Develop and demonstrate", "Resolve and remember"];
  const transitions = input.mode === "cartoon" || input.mode === "asmr" ? ["fade", "dissolve", "dissolve"] as const : ["fade", "fade-black", "fade-black"] as const;
  const sceneDirections = input.mode === "cartoon"
    ? cartoonCastNames.length > 1
      ? [`Reveal the workshop and introduce ${cartoonCastLabel}`, `Let ${cartoonCastLabel} exchange the central idea`, "Land both characters on the final lesson or CTA"]
      : cartoonCastNames.length === 1
        ? [`Reveal the workshop and introduce ${cartoonCastLabel}`, `Let ${cartoonCastLabel} demonstrate the central idea`, "Land the host on the final lesson or CTA"]
        : ["Reveal the workshop with a strong visual hook", "Develop the central idea through objects and motion", "Resolve on the final lesson or CTA without a host"]
    : input.mode === "story"
      ? ["Establish the illustrated world and its emotional question", "Move through the central discovery or challenge", "Hold on the consequence and closing message"]
      : input.mode === "asmr"
        ? ["Establish the tactile material and quiet room tone", "Move slowly across the primary sensory action", "Ease into a visually and sonically soft finish"]
        : input.mode === "vfx"
          ? ["Establish a clean cinematic source image", "Escalate neon, VHS, glow, and glitch treatments", "Resolve the transformation into a readable final frame"]
          : ["Open with the product promise and brand stage", "Explain the strongest benefit with presenter support", "End on proof and a clear next action"];
  const sceneBeatValues = sceneDirections.map((_, index) => {
    const beatIndex = visualBeats.length <= 1 ? 0 : Math.round(index * (visualBeats.length - 1) / Math.max(1, sceneDirections.length - 1));
    return visualBeats[beatIndex] ?? visualBeats.at(-1) ?? prompt;
  });
  // `visual` is the literal on-screen beat, not a production instruction. Camera,
  // style, and staging already live in creativeDirection and should not be parsed
  // as visible subjects (for example, the word "lesson" becoming a classroom).
  const sceneVisuals = sceneBeatValues;
  const narrationEnabled = input.generateVoice !== false && input.mode !== "asmr";
  const musicEnabled = input.generateMusic !== false || Boolean(input.musicSource);
  const sceneNarration = narrationEnabled ? cleanText(input.narration ?? prompt) : "No narration; visuals and sound carry this scene.";
  const authoredNarration = narrationEnabled && input.narration ? splitNarrationAcrossScenes(input.narration, sceneWeights.length) : undefined;
  const visualSources = [...new Set([...(input.source ? [input.source] : []), ...(input.sceneSources ?? []).filter(Boolean)])];
  const resources: CreatorProductionPlan["resources"] = visualSources.length
    ? visualSources.map((source, index) => ({
      id: `scene-source-${index + 1}`,
      category: "source-media" as const,
      requirement: `${index === 0 ? "Primary" : "Additional"} user-supplied or locally generated scene media`,
      source,
      status: "provided" as const,
      rights: "User must own, generate, or license this source; retain its provenance with the project.",
    }))
    : mediaProvider === "animated"
      ? [{
        id: "animated-scene-media",
        category: "scene",
        requirement: "Generate one real 1080p vector-animation clip per planned scene with articulated characters and stable backgrounds",
        source: "animated:agent-demo-vector-animation-v1",
        status: "generated",
        rights: "Original deterministic vector animation generated locally by Agent Demo Studio under MIT.",
      }]
      : mediaProvider === "ltx-desktop"
        ? [{
          id: "generated-scene-media",
          category: "scene",
          requirement: `Generate one true motion-video clip per scene through the official LTX Desktop localhost API (${input.mediaTask ?? "auto"})`,
          source: `ltx-desktop:${input.ltxDesktopUrl || process.env.AGENT_DEMO_LTX_DESKTOP_URL || "http://127.0.0.1:41954"}`,
          status: "generated",
          rights: "Generated through LTX Desktop; retain source rights, prompts, model-license terms, and synthetic-media disclosure records.",
        }]
      : mediaProvider === "comfyui"
        ? [{
          id: "generated-scene-media",
          category: "scene",
          requirement: `Generate one true motion-video clip per scene through the configured ComfyUI API workflow (${input.mediaTask ?? "auto"})`,
          source: `comfyui:${input.comfyuiWorkflow || process.env.AGENT_DEMO_COMFYUI_WORKFLOW || "workflow-required"}`,
          status: "generated",
          rights: "Locally generated media; retain every checkpoint, LoRA, source, prompt, and model-license record.",
        }]
        : mediaProvider === "local-adapter"
      ? [{
        id: "generated-scene-media",
        category: "scene",
        requirement: `Generate brief-specific scene media with the loopback local adapter (${input.mediaTask ?? "auto"})`,
        source: `local-adapter:${input.mediaTask ?? "auto"}`,
        status: "generated",
        rights: "Locally generated media; record the adapter, model, prompt, and model-license terms in the final manifest.",
      }]
      : [{
      id: "primary-visual",
      category: "scene",
      requirement: `Starter ${input.mode} environment; replace per shot when the brief needs different art`,
      source: builtInScene(input.mode),
      status: "bundled",
      rights: "Original synthetic Agent Demo Studio asset, bundled under MIT.",
      }];
  if ((mediaProvider === "ltx-desktop" || mediaProvider === "local-adapter" || mediaProvider === "comfyui") && visualSources.length) resources.push({
    id: "local-media-adapter",
    category: "scene",
    requirement: `Transform the supplied media into real motion video with the loopback ${mediaProvider === "ltx-desktop" ? "LTX Desktop engine" : mediaProvider === "comfyui" ? "ComfyUI workflow" : "local adapter"} (${input.mediaTask ?? "auto"})`,
    source: `${mediaProvider}:${input.mediaTask ?? "auto"}`,
    status: "generated",
    rights: "Record the local adapter, model, generation prompt, source rights, and model-license terms in the final manifest.",
  });
  if (suppliedCharacters.length) {
    for (const [index, character] of suppliedCharacters.entries()) {
      resources.push({
        id: character.id?.trim() || `custom-character-${index + 1}`,
        category: "character",
        requirement: `${character.role === "presenter" ? "Presenter" : "Character"}: ${cleanText(character.name)}${character.style ? ` (${cleanText(character.style)})` : ""}`,
        source: character.source,
        status: "provided",
        rights: character.rights?.trim() || "User must own, generate, or license this character and retain consent/provenance records.",
      });
    }
  } else if (input.mode === "cartoon") {
    for (const [index, id] of cartoonCast(presenter).entries()) {
      const selected = presenterSource(id)!;
      resources.push({ id, category: "character", requirement: `${index === 0 ? "Primary" : "Secondary"} fictional ${selected.type === "character" ? "cartoon host" : "presenter"}`, source: selected.source, status: "bundled", rights: "Original synthetic Agent Demo Studio character, bundled under MIT." });
    }
  } else if (presenter !== "none") {
    const selected = presenterSource(presenter)!;
    resources.push({ id: presenter, category: "character", requirement: `${selected.type === "presenter" ? "Fictional product presenter" : "Fictional story character"}`, source: selected.source, status: "bundled", rights: "Original synthetic Agent Demo Studio character, bundled under MIT; disclose synthetic use where required." });
  }
  if (input.logoSource) resources.push({ id: "brand-logo", category: "source-media", requirement: "Optional brand or subject logo", source: input.logoSource, status: "provided", rights: "User must own or license the supplied logo." });
  if (narrationEnabled) resources.push(
    {
      id: "voiceover",
      category: "voice",
      requirement: `Paced narration matched to the planned story${input.language ? ` in ${input.language}` : ""}`,
      source: input.voiceProvider === "neural"
        ? `neural:${input.voice ?? "automatic voice"}`
        : input.voiceProvider === "local-clone"
          ? `local-clone:${input.voiceConsent?.speakerName || "consented speaker"}`
          : `local:${input.voice ?? "system default"}`,
      status: "generated",
      rights: input.voiceProvider === "local-clone"
        ? "Local cloning is allowed only with named speaker authorization recorded in voiceConsent."
        : "Generated speech; operating-system or selected provider terms apply.",
    },
    { id: "captions", category: "captions", requirement: "Readable captions aligned to narration", source: "generated:captions.srt", status: "generated", rights: "Derived from the user prompt or narration." },
  );
  if (input.voiceProvider === "local-clone" && input.voiceReference) resources.push({
    id: "voice-reference",
    category: "source-media",
    requirement: `Reference recording for the authorized voice of ${input.voiceConsent?.speakerName || "the named speaker"}`,
    source: input.voiceReference,
    status: "provided",
    rights: "Biometric voice reference; keep private, record speaker authorization, restrict scope, and do not publish the reference file.",
  });
  if (musicEnabled) resources.push({
    id: "score",
    category: input.mode === "asmr" ? "sound" : "music",
    requirement: input.mode === "asmr" ? "Quiet stereo ASMR soundscape" : "Supporting score below narration",
    source: input.musicSource ?? (input.mode === "asmr" ? "generated:local-asmr-soundscape" : "generated:local-ambient-score"),
    status: input.musicSource ? "provided" : "generated",
    rights: input.musicSource ? "User must own or license this audio and preserve its attribution." : "Procedurally generated by Agent Demo Studio for this project.",
  });
  resources.push({ id: "effects", category: "vfx", requirement: "Mode-specific color and motion treatment", source: direction.effects.join(", "), status: "bundled", rights: "Rendered locally with FFmpeg filter graphs." });
  for (const preset of presets) resources.push({ id: `export-${preset}`, category: "export", requirement: `${preset} delivery master`, source: `preset:${preset}`, status: "generated", rights: "Derived output; source-asset rights continue to apply." });

  return {
    planVersion: 1,
    title,
    originalPrompt: prompt,
    mode: input.mode,
    requirements: {
      objective: `Produce a complete ${input.mode} video that communicates: ${prompt}`,
      audience: intendedAudience(prompt),
      targetDurationSeconds: duration,
      outputPresets: presets,
      language: input.language?.trim() || "en",
      visualQuality: resolveRequestedVisualQuality(input),
      sourceStrategy: (mediaProvider === "ltx-desktop" || mediaProvider === "local-adapter" || mediaProvider === "comfyui") && visualSources.length
        ? `Transform ${visualSources.length} supplied source${visualSources.length === 1 ? "" : "s"} into moving video through the configured loopback-only ${mediaProvider === "ltx-desktop" ? "LTX Desktop engine" : mediaProvider === "comfyui" ? "ComfyUI workflow" : "adapter"} and preserve source and model provenance.`
        : visualSources.length
        ? `Use ${visualSources.length} supplied or locally generated scene source${visualSources.length === 1 ? "" : "s"}, preserving aspect and provenance.`
        : mediaProvider === "animated"
          ? "Generate one prompt-conditioned 1080p motion-graphics clip per scene with a distinct setting, cast, props, actions, and stable background. Do not represent it as Wan/LTX diffusion output."
          : mediaProvider === "ltx-desktop" || mediaProvider === "local-adapter" || mediaProvider === "comfyui"
            ? `Generate one true motion-video clip per scene through the configured loopback-only ${mediaProvider === "ltx-desktop" ? "LTX Desktop engine" : mediaProvider === "comfyui" ? "ComfyUI workflow" : "adapter"}, then preserve model and prompt provenance.`
            : `Use locked still artwork only because the legacy still compositor was explicitly selected.`,
      motionStandard: motionStandard(mediaProvider),
      narration: narrationEnabled,
      musicOrAmbience: musicEnabled,
    },
    creativeDirection: {
      visualStyle: input.mode === "cartoon" && mediaProvider === "animated"
        ? "Prompt-conditioned 2D motion graphics with scene-specific subjects, props, actions, articulated bodies, and stable 1080p backgrounds"
        : direction.visualStyle,
      pacing: direction.pacing,
      composition: direction.composition,
      characterDirection: suppliedCharacters.length
        ? `Stage the supplied open cast (${suppliedCharacters.map((character) => cleanText(character.name)).join(", ")}) with role-appropriate motion; do not imply an identity or endorsement beyond the supplied rights.`
        : presenter === "none"
          ? "No host is fixed or required. Use no character, any authorized supplied character, or output from a configured local image/video generator as the brief requires."
          : "Use the selected bundled fictional synthetic character as an optional starter with subtle motion; do not imply a real spokesperson.",
      effects: [...direction.effects],
    },
    scenes: sceneWeights.map((weight, index) => {
      const narration = narrationEnabled
        ? authoredNarration
          ? authoredNarration[index] || "No narration; visuals carry this scene."
          : sceneBeatValues[index] ?? sceneNarration
        : sceneNarration;
      // Authored narration is the source of truth for visible teaching copy.
      // Using raw prompt beats here can expose production directions such as
      // "move the characters" instead of the topic currently being spoken.
      const onScreenText = input.mode === "asmr"
        ? (index === 0 ? title : undefined)
        : authoredNarration?.[index]
          ? narrationOverlayText(authoredNarration[index]!, index)
          : narrationOverlayText(sceneBeatValues[index] ?? narration, index);
      const plannedScene = {
        id: `scene-${index + 1}`,
        title: sceneTitles[index]!,
        purpose: index === 0 ? "Earn attention and establish context." : index === 1 ? "Deliver the core idea with visual progression." : "Resolve the message and leave a clear final impression.",
        durationSeconds: Number((duration * weight).toFixed(2)),
        visual: sceneVisuals[index]!,
        narration,
        onScreenText,
        transition: transitions[index]!,
      };
      return mediaProvider === "animated"
        ? { ...plannedScene, animation: analyzeAnimatedScene(input.mode, plannedScene, index, prompt) }
        : plannedScene;
    }),
    resources,
    productionRules: [
      { id: "plan-first", rule: "Write and persist the complete production plan before generating audio, editing media, or rendering.", qualityGate: "production-plan.json exists and contains requirements, scenes, resources, workflow, assumptions, and QA." },
      { id: "open-assets", rule: "Never lock a request to bundled characters or scenes; choose no character, supplied assets, or configured local generators according to the brief.", qualityGate: "Every cast and scene choice traces to the user brief and resource list." },
      { id: "rights-first", rule: "Track source, generation method, rights, consent, and required disclosure for every external or synthetic asset.", qualityGate: "No undeclared media enters the render timeline." },
      { id: "story-sync", rule: "Match each visual, caption, effect, and character action to the narration or intended sensory beat.", qualityGate: "Scene-to-audio review finds no topic drift or mistimed reveal." },
      { id: "semantic-scenes", rule: "The motion-graphics engine must resolve every scene into its own setting, subjects, actions, and props; changing only words is a failed render.", qualityGate: "semantic-quality.json passes and scene semantic signatures are distinct." },
      { id: "real-motion", rule: "When animation or generative video is requested, use moving video clips and never imitate motion by shaking, panning, or zooming a still image.", qualityGate: "Every generated scene passes the temporal-motion probe and the generator returns one video per planned scene." },
      { id: "stable-generation", rule: "Keep subjects structurally consistent and camera movement intentional; reject frozen, flickering, jittering, or isolated-jump outputs.", qualityGate: "Motion QA passes and representative frames show continuous subject action without visible frame instability." },
      { id: "safe-layout", rule: "Keep text, faces, product UI, captions, logos, and CTAs inside each export's safe zones without overlap.", qualityGate: "Representative-frame QA passes for every aspect ratio." },
      { id: "natural-audio", rule: "Use natural speech pacing and mix music, ambience, and effects below intelligible narration without harsh peaks.", qualityGate: "Duration, loudness, true peak, and listening QA pass." },
      { id: "local-first", rule: "Prefer on-device planning, speech, procedural audio, asset generation, and FFmpeg rendering; paid LTX API generation is allowed only after explicit opt-in.", qualityGate: "The plan records its local provider or explicit cloud-media choice." },
      { id: "review-before-publish", rule: "Complete technical and visual QA before any external publishing action.", qualityGate: "Publishing remains a separate, explicit reviewed operation." },
    ],
    workflow: [
      { order: 1, stage: "Requirements", action: "Interpret the goal, audience, duration, formats, source strategy, narration, and disclosure needs.", output: "Approved or agent-confirmed production plan", qualityGate: "No contradictory timing, source, or output assumptions." },
      { order: 2, stage: "Storyboard", action: "Convert the brief into timed beats, visuals, text, character blocking, and transitions.", output: "Shot-by-shot scene plan", qualityGate: "Every planned line has a relevant visual and readable text placement." },
      { order: 3, stage: "Resources", action: "Resolve supplied, bundled, generated, and optional assets with provenance.", output: "Resource and rights list", qualityGate: "No missing required source and no undeclared third-party rights." },
      { order: 4, stage: "Audio", action: "Generate paced voice, captions, score, ambience, and sound effects as requested.", output: "Aligned audio and caption files", qualityGate: "Narration duration fits; speech remains intelligible above the mix." },
      { order: 5, stage: "Timeline", action: "Build the editable creator manifest with motion, overlays, VFX, and delivery profiles.", output: "creator-project.json", qualityGate: "Manifest validation passes without errors." },
      { order: 6, stage: "Render", action: "Render locally with FFmpeg and create thumbnails, chapters, sidecars, and rights reports.", output: "Platform-ready media files", qualityGate: "Codec, dimensions, duration, frame rate, audio, and file presence pass." },
      { order: 7, stage: "Visual QA", action: "Inspect representative frames and transitions for clipping, overlap, black bands, and safe-zone errors.", output: "Visual QA result", qualityGate: "Text is legible and visuals match the active narration beat." },
      { order: 8, stage: "Delivery", action: "Package reviewed outputs and publishing metadata with synthetic-media disclosure.", output: "Review-first delivery package", qualityGate: "Human review remains required before external publishing." },
    ],
    assumptions: [
      visualSources.length ? "The supplied or locally generated scene sources are authorized for use." : mediaProvider === "ltx-desktop" || mediaProvider === "local-adapter" || mediaProvider === "comfyui" ? "The configured generator, workflow, checkpoints, and models permit the intended use." : mediaProvider === "animated" ? "The user explicitly accepted prompt-conditioned 2D motion graphics rather than Wan/LTX-style model inference." : "The user explicitly selected a still-image composition rather than true animation.",
      "The prompt is treated as the creative brief; an agent may refine audience, claims, brand assets, and CTA before render.",
      narrationEnabled ? "Narration timing may extend the target duration so speech is not unnaturally rushed." : "The video intentionally uses no generated narration.",
      "Fictional synthetic characters are not real spokespersons and should be disclosed where platform rules require it.",
      ...(input.voiceProvider === "local-clone" ? ["The named speaker has authorized creation and use of the cloned voice for the declared scope."] : []),
    ],
    qualityChecklist: [
      "Visuals match the narration or intended sensory beat at every scene.",
      "Captions, titles, lower thirds, characters, and CTAs do not overlap.",
      "Motion feels intentional and contains no exposed transparent padding or black bands.",
      "Generated scenes contain continuous subject motion; no still-only, jittering, or shaking-photo substitute is accepted.",
      "Every motion-graphics scene visibly contains its planned subjects, props, setting, and action instead of reusing a mode-level card or loop.",
      "Voice pacing is natural; music and ambience do not mask speech.",
      "Every external asset has provenance, rights, and attribution metadata.",
      "Each export matches its platform dimensions, frame rate, safe zones, and duration guidance.",
      "Synthetic characters and altered media carry the required disclosure metadata.",
    ],
  };
}

/**
 * Adds one bounded, local-only Qwen planning pass when Ollama is available.
 * The deterministic plan remains the trusted source for resources, rights,
 * workflow, timings, effects, and export settings.
 */
export async function createSmartPromptVideoPlan(input: CreatorPromptVideoInput, runtime: PromptPlanningRuntime = {}): Promise<CreatorProductionPlan> {
  const mediaProvider = resolvePromptMediaProvider(input);
  const enhancedPlan = await enhancePromptVideoPlan(input, createPromptVideoPlan(input), runtime);
  const plan = mediaProvider === "animated"
    ? {
      ...enhancedPlan,
      scenes: enhancedPlan.scenes.map((scene, index) => ({
        ...scene,
        animation: analyzeAnimatedScene(input.mode, scene, index, input.prompt),
      })),
    }
    : enhancedPlan;
  const capabilities = await inspectCapabilities({
    plannerProvider: input.plannerProvider ?? "auto",
    plannerProfile: input.plannerProfile ?? "fast",
    plannerModel: input.plannerModel,
    plannerBaseUrl: input.plannerBaseUrl,
    mediaProvider,
    mediaAdapterUrl: input.mediaAdapterUrl,
    comfyuiUrl: input.comfyuiUrl,
    comfyuiWorkflow: input.comfyuiWorkflow,
    ltxDesktopUrl: input.ltxDesktopUrl,
    allowCloudMedia: input.allowCloudMedia,
    generateVoice: input.generateVoice !== false && input.mode !== "asmr",
    voiceProvider: input.voiceProvider ?? "local",
    voiceCloneUrl: input.voiceCloneUrl,
    voiceReferenceAvailable: Boolean(input.voiceReference),
    voiceConsentConfirmed: input.voiceConsent?.confirmed === true,
    voiceSpeakerName: input.voiceConsent?.speakerName,
    generateMusic: input.generateMusic !== false,
    suppliedMusic: Boolean(input.musicSource),
    render: input.render === true,
  }, {
    ...runtime.capabilityRuntime,
    fetchImpl: runtime.capabilityRuntime?.fetchImpl ?? runtime.fetchImpl,
  });
  return { ...plan, capabilities };
}

function retimeProductionPlan(plan: CreatorProductionPlan, durationSeconds: number, speechDurations: number[] = []): CreatorProductionPlan {
  const targetDuration = Math.max(6, Math.min(600, durationSeconds));
  const existingDuration = plan.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  const equalShare = 1 / Math.max(1, plan.scenes.length);
  const sceneDurations = plan.scenes.map((scene, index) => {
    const planned = targetDuration * (existingDuration > 0 ? scene.durationSeconds / existingDuration : equalShare);
    // Keep a small lead-in and tail after every spoken scene. Only extend the
    // affected beat; never speed up narration to force it into the target.
    const speechMinimum = (speechDurations[index] ?? 0) > 0 ? speechDurations[index]! + 1.1 : 0;
    return Number(Math.max(planned, speechMinimum).toFixed(2));
  });
  const duration = Number(sceneDurations.reduce((sum, value) => sum + value, 0).toFixed(2));
  return {
    ...plan,
    requirements: { ...plan.requirements, targetDurationSeconds: duration },
    scenes: plan.scenes.map((scene, index) => ({
      ...scene,
      durationSeconds: sceneDurations[index]!,
    })),
  };
}

function visibleSceneDurations(sceneCount: number, duration: number, plannedScenes?: CreatorProductionPlan["scenes"]): number[] {
  if (plannedScenes?.length === sceneCount) {
    const plannedTotal = plannedScenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
    if (plannedTotal > 0) return plannedScenes.map((scene) => Number((duration * scene.durationSeconds / plannedTotal).toFixed(5)));
  }
  return Array.from({ length: sceneCount }, () => duration / Math.max(1, sceneCount));
}

function imageClips(source: string, mode: CreatorPromptVideoInput["mode"], duration: number, plannedScenes?: CreatorProductionPlan["scenes"]): CreatorClip[] {
  // Legacy still composition remains available when explicitly selected, but
  // its frames stay locked. Random zoom/pan was the source of visible shaking
  // and must never masquerade as generated character motion.
  const motions: CreatorClip["motion"][] = ["none", "none", "none"];
  const vfx = mode === "cartoon" ? ["comic" as const] : mode === "story" ? ["dream" as const] : mode === "asmr" ? ["asmr-soft" as const] : mode === "vfx" ? ["neon" as const, "glitch" as const] : ["cinematic" as const, "glow" as const];
  const transitionDuration = mode === "asmr" ? 1.1 : 0.5;
  const sceneDurations = visibleSceneDurations(motions.length, duration, plannedScenes);
  return motions.map((motion, index) => ({
    id: `scene-${index + 1}`,
    source,
    kind: "image",
    durationSeconds: Number((sceneDurations[index]! + (index < motions.length - 1 ? transitionDuration : 0)).toFixed(5)),
    motion,
    reframe: "fill",
    effects: { vfx: index === 1 && mode === "vfx" ? ["vhs"] : vfx },
    transition: { type: index === 0 ? "fade" : mode === "cartoon" || mode === "asmr" ? "dissolve" : "fade-black", durationSeconds: transitionDuration },
    chapter: index === 0 ? "Opening" : index === 1 ? "Development" : "Finale",
  }));
}

function imageSource(source: string): boolean {
  return /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(source);
}

function sourceClips(input: CreatorPromptVideoInput, duration: number, plannedScenes?: CreatorProductionPlan["scenes"]): CreatorClip[] {
  const supplied = [...new Set([...(input.source ? [input.source] : []), ...(input.sceneSources ?? []).filter(Boolean)])];
  if (!supplied.length) return imageClips(builtInScene(input.mode), input.mode, duration, plannedScenes);
  const vfx = input.mode === "vfx" ? ["neon" as const, "glitch" as const] : input.mode === "asmr" ? ["asmr-soft" as const] : ["cinematic" as const];
  const transitionDuration = input.mode === "asmr" ? 1.1 : 0.5;
  const sceneDurations = visibleSceneDurations(supplied.length, duration, plannedScenes);
  return supplied.map((source, index) => ({
    id: `source-${index + 1}`,
    source,
    kind: imageSource(source) ? "image" : undefined,
    durationSeconds: imageSource(source) ? Number((sceneDurations[index]! + (index < supplied.length - 1 ? transitionDuration : 0)).toFixed(5)) : undefined,
    // Uploaded and generated plates may contain carefully positioned text,
    // faces, or UI. Keep them locked by default; transitions still animate the
    // edit without cropping safe-zone content.
    motion: imageSource(source) ? "none" : undefined,
    reframe: input.mode === "product-launch"
      ? "fit"
      : input.mediaProvider === "animated" && Boolean(input.presets?.length) && input.presets!.every((preset) => ["shorts", "reels", "tiktok"].includes(preset))
        ? "fill"
        : "blur-background",
    effects: { vfx },
    transition: { type: index === 0 ? "fade" : input.mode === "cartoon" || input.mode === "asmr" ? "dissolve" : "fade-black", durationSeconds: transitionDuration },
    chapter: index === 0 ? "Opening" : index === supplied.length - 1 ? "Finale" : `Scene ${index + 1}`,
    licenseId: `provided-scene-${index + 1}`,
  }));
}

function promptOverlays(input: CreatorPromptVideoInput, title: string, duration: number, productionPlan?: CreatorProductionPlan): CreatorOverlay[] {
  const plannedBeats = productionPlan?.scenes
    .map((scene) => cleanText(scene.onScreenText || scene.narration))
    .filter(Boolean);
  const beats = plannedBeats?.length ? plannedBeats : promptBeats(input.prompt);
  const timing = launchTimings(duration);
  const overlays: CreatorOverlay[] = [];
  const visualProvider = resolvePromptMediaProvider(input);
  const suppliedCharacters = (input.characters ?? []).filter((character) => cleanText(character.name) && character.source.trim());
  const charactersRenderedInVideo = (visualProvider === "animated" && suppliedCharacters.length === 0 && plannedPresenter(input) === "none")
    || ((visualProvider === "ltx-desktop" || visualProvider === "comfyui" || visualProvider === "local-adapter") && input.mediaTask !== "text-to-image");
  const cartoonNovaStart = Math.min(1.2, duration * 0.12);
  const cartoonLineStart = Math.max(cartoonNovaStart + 0.45, duration * 0.18);
  const titleEnd = input.mode === "cartoon"
    ? Math.min(duration, 3.4, Math.max(0.9, cartoonLineStart - 0.12))
    : Math.min(duration, 3.4);
  // The animated provider already owns a dedicated title-safe region inside
  // every scene. A second compositor title would overlap the board/panel.
  if (input.mode !== "asmr" && visualProvider !== "animated") overlays.push({
    id: "opening-title", type: "text", text: title, subtitle: input.mode === "product-launch" ? "Introducing what comes next" : undefined,
    startSeconds: 0.15, endSeconds: titleEnd, x: 0.5, y: 0.17,
    animation: { enter: "pop", exit: "slide-up", durationSeconds: 0.55, loop: "none", intensity: 0.55 },
  });
  if (input.mode === "product-launch" || input.mode === "vfx") {
    overlays.push(
      { id: "launch-beat", type: "lower-third", text: beats[0] ?? title, subtitle: beats[1] ?? "Built for the next step", startSeconds: timing.beatStart, endSeconds: timing.beatEnd, x: 0.32, y: 0.65, animation: { enter: "slide-left", exit: "fade", durationSeconds: 0.45 } },
      { id: "launch-cta", type: "cta", text: beats[2] ?? "See it in action", startSeconds: timing.ctaStart, endSeconds: duration, x: 0.5, y: 0.68, animation: { enter: "rise", exit: "fade", loop: "pulse", durationSeconds: 0.45, intensity: 0.65 } },
    );
  }
  if (suppliedCharacters.length && input.mode !== "asmr" && !charactersRenderedInVideo) {
    const segment = Math.max(1.2, duration / suppliedCharacters.length);
    suppliedCharacters.forEach((character, index) => {
      const startSeconds = Math.min(Math.max(0.8, index * segment), Math.max(0.8, duration - 1.1));
      const endSeconds = Math.min(duration - 0.2, Math.max(startSeconds + 0.9, (index + 1) * segment + 0.35));
      const x = character.x ?? (index % 2 === 0 ? 0.22 : 0.78);
      overlays.push({
        id: character.id?.trim() || `custom-character-${index + 1}`,
        type: character.role ?? "character",
        source: character.source,
        startSeconds,
        endSeconds,
        x,
        y: character.y ?? 0.65,
        licenseId: `provided-character-${index + 1}`,
        flipHorizontal: index % 2 === 1,
        animation: { enter: index % 2 === 0 ? "slide-left" : "slide-right", exit: "fade", loop: "talk", durationSeconds: 0.55, intensity: 0.65 },
      });
      if (input.mode === "cartoon" || input.mode === "story") overlays.push({
        id: `${character.id?.trim() || `custom-character-${index + 1}`}-line`,
        type: "speech-bubble",
        text: compactOverlayText(beats[index % beats.length] ?? title),
        startSeconds: Math.min(endSeconds - 0.5, startSeconds + 0.35),
        endSeconds,
        x: x < 0.5 ? 0.68 : 0.32,
        y: 0.2,
        animation: { enter: "pop", exit: "fade", loop: "float", intensity: 0.3 },
      });
    });
  } else if (input.mode === "cartoon" && !charactersRenderedInVideo) {
    const cast = cartoonCast(plannedPresenter(input));
    const novaStart = cartoonNovaStart;
    const novaEnd = Math.max(novaStart + 0.8, duration * 0.55);
    const novaLineStart = cartoonLineStart;
    const novaLineEnd = Math.max(novaLineStart + 0.65, duration * 0.45);
    const miloStart = Math.max(novaEnd - 0.4, duration * 0.48);
    const miloEnd = Math.max(miloStart + 0.8, duration - 0.25);
    const miloLineStart = Math.max(miloStart + 0.45, duration * 0.55);
    const miloLineEnd = Math.max(miloLineStart + 0.65, duration - 0.45);
    const primary = cast[0] ? presenterSource(cast[0]) : undefined;
    const secondary = cast[1] ? presenterSource(cast[1]) : undefined;
    if (primary) overlays.push(
      { id: cast[0]!, type: primary.type, source: primary.source, startSeconds: novaStart, endSeconds: secondary ? novaEnd : miloEnd, x: 0.24, y: 0.65, animation: { enter: "slide-left", exit: "slide-left", loop: "talk", durationSeconds: 0.55 } },
      { id: `${cast[0]}-line`, type: "speech-bubble", text: compactOverlayText(beats[0] ?? "Let's discover something new!"), startSeconds: novaLineStart, endSeconds: secondary ? novaLineEnd : miloLineEnd, x: 0.68, y: 0.2, animation: { enter: "pop", exit: "fade", loop: "float", intensity: 0.35 } },
    );
    if (secondary) overlays.push(
      { id: cast[1]!, type: secondary.type, source: secondary.source, startSeconds: miloStart, endSeconds: miloEnd, x: 0.76, y: 0.65, animation: { enter: "slide-right", exit: "slide-right", loop: "talk", durationSeconds: 0.55 } },
      { id: `${cast[1]}-line`, type: "speech-bubble", text: compactOverlayText(beats[1] ?? "And here's what happens next."), startSeconds: miloLineStart, endSeconds: miloLineEnd, x: 0.3, y: 0.2, animation: { enter: "pop", exit: "fade", loop: "float", intensity: 0.35 } },
    );
  }
  if (input.mode === "story") overlays.push({ id: "story-line", type: "speech-bubble", text: beats[0] ?? "Every path begins with a choice.", startSeconds: 4, endSeconds: Math.min(duration, 11), x: 0.5, y: 0.2, animation: { enter: "fade", exit: "fade", loop: "float", intensity: 0.35 } });
  if (input.mode === "asmr") overlays.push({ id: "asmr-title", type: "text", text: title, startSeconds: 0.2, endSeconds: Math.min(duration, 2.4), x: 0.5, y: 0.15, opacity: 0.82, animation: { enter: "fade", exit: "fade", durationSeconds: 0.8 } });

  const chosen = suppliedCharacters.length ? undefined : presenterSource(plannedPresenter(input));
  if (chosen && input.mode !== "cartoon" && !charactersRenderedInVideo) overlays.push({
    id: "prompt-presenter", type: chosen.type, source: chosen.source, startSeconds: 1, endSeconds: Math.min(duration - 0.3, 12), x: 0.82, y: 0.64,
    animation: { enter: "slide-right", exit: "fade", loop: "talk", durationSeconds: 0.55, intensity: 0.7 },
  });
  if (input.logoSource) overlays.push({
    id: "brand-logo",
    type: "watermark",
    source: input.logoSource,
    startSeconds: 0,
    endSeconds: duration,
    x: 0.9,
    y: 0.08,
    opacity: 0.88,
    licenseId: "provided-logo",
    animation: { enter: "fade", exit: "fade", durationSeconds: 0.35 },
  });
  return overlays;
}

function builtInLicenses(manifest: CreatorManifest): NonNullable<CreatorManifest["licenses"]> {
  const sources = [
    ...manifest.clips.map((clip) => clip.source),
    ...(manifest.overlays ?? []).flatMap((overlay) => overlay.source ? [overlay.source] : []),
  ];
  const unique = new Map<string, NonNullable<CreatorManifest["licenses"]>[number]>();
  for (const source of sources) {
    const license = bundledAssetLicense(source);
    if (license) unique.set(license.id, license);
  }
  return [...unique.values()];
}

function providedLicenses(input: CreatorPromptVideoInput): NonNullable<CreatorManifest["licenses"]> {
  const licenses: NonNullable<CreatorManifest["licenses"]> = [];
  const visualSources = [...new Set([...(input.source ? [input.source] : []), ...(input.sceneSources ?? []).filter(Boolean)])];
  visualSources.forEach((source, index) => licenses.push({
    id: `provided-scene-${index + 1}`,
    source,
    title: `Provided scene ${index + 1}`,
    creator: "User-provided or configured local generator",
    license: "User-declared authorized media",
    attribution: "Retain the original source or generation record and confirm publishing rights before delivery.",
  }));
  (input.characters ?? []).filter((character) => character.source.trim()).forEach((character, index) => licenses.push({
    id: `provided-character-${index + 1}`,
    source: character.source,
    title: cleanText(character.name) || `Provided character ${index + 1}`,
    creator: "User-provided or configured local generator",
    license: character.rights?.trim() || "User-declared authorized character",
    attribution: "Retain source, consent, and synthetic-media disclosure records where applicable.",
  }));
  if (input.logoSource) licenses.push({ id: "provided-logo", source: input.logoSource, title: "Provided logo", creator: "User-provided", license: "User-declared authorized brand asset" });
  if (input.musicSource) licenses.push({ id: "provided-music", source: input.musicSource, title: "Provided music or ambience", creator: "User-provided", license: "User-declared authorized audio", attribution: "Retain music licensing and attribution records before publishing." });
  return licenses;
}

export function createPromptVideoManifest(input: CreatorPromptVideoInput, productionPlan: CreatorProductionPlan = createPromptVideoPlan(input)): CreatorManifest {
  const title = productionPlan.title;
  const duration = productionPlan.requirements.targetDurationSeconds;
  const timing = launchTimings(duration);
  const manifest: CreatorManifest = {
    schemaVersion: CREATOR_SCHEMA_VERSION,
    title,
    description: `Prompt-to-video ${input.mode} project: ${cleanText(input.prompt)}`,
    outputDirectory: "./renders",
    brand: { name: title, logo: input.logoSource, logoLicenseId: input.logoSource ? "provided-logo" : undefined, primary: "#8B5CF6", secondary: "#22D3EE", text: "#FFFFFF" },
    clips: sourceClips(input, duration, productionPlan.scenes),
    overlays: promptOverlays(input, title, duration, productionPlan),
    captions: { burn: input.mode !== "asmr", sidecar: true, language: input.language ?? "en", style: { position: "bottom", accent: input.mode === "cartoon" ? "#F59E0B" : "#22D3EE" } },
    audio: {
      keepClipAudio: Boolean(input.source), clipVolume: input.mode === "asmr" ? 0.55 : 0.82,
      duckMusic: true, targetLufs: input.mode === "asmr" ? -20 : -14, truePeak: -1.5,
      mode: input.mode === "asmr" ? "asmr" : input.mode === "story" || input.mode === "cartoon" ? "voice" : "cinematic",
    },
    chapters: input.mode === "product-launch"
      ? [{ title: "Hook", startSeconds: 0 }, { title: "Reveal", startSeconds: timing.beatStart }, { title: "Proof", startSeconds: Math.min(timing.beatEnd, duration * 0.48) }, { title: "Call to action", startSeconds: timing.ctaStart }]
      : undefined,
    exports: (input.presets ?? (input.mode === "asmr" ? ["youtube-1080p", "reels"] : ["youtube-1080p", "shorts", "reels", "tiktok"]))
      .map((preset, index) => ({ id: index === 0 ? "master" : `${preset}-${index + 1}`, preset, title })),
    metadata: {
      productionMode: input.mode,
      originalPrompt: cleanText(input.prompt),
      syntheticCharacters: Boolean(input.characters?.length || plannedPresenter(input) !== "none"),
      workflow: "prompt-to-video",
      productionPlan,
      productionPlanPath: "./production-plan.json",
    },
  };
  manifest.licenses = [...builtInLicenses(manifest), ...providedLicenses(input)];
  return manifest;
}

function narrationCues(narration: string, duration: number, startSeconds = 0): CaptionCue[] {
  const sentences = cleanText(narration).split(/(?<=[.!?])\s+/).filter(Boolean);
  const parts = sentences.length ? sentences : [cleanText(narration)];
  const weights = parts.map((part) => Math.max(1, part.split(/\s+/).length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const leadIn = Math.min(0.18, duration * 0.08);
  const usableDuration = Math.max(0.35, duration - leadIn);
  let cursor = startSeconds + leadIn;
  return parts.map((text, index) => {
    const share = Math.max(0.35, usableDuration * weights[index]! / total);
    const cue = { index: index + 1, startSeconds: cursor, endSeconds: Math.min(startSeconds + duration, cursor + share), text };
    cursor = cue.endSeconds;
    return cue;
  });
}

function resolveInputSource(source: string): string {
  if (source.startsWith("builtin:") || /^[a-z][a-z\d+.-]*:\/\//i.test(source)) return source;
  return path.resolve(source);
}

function defaultNeuralVoice(language: string | undefined, masculine: boolean): string {
  const base = (language || "en-US").toLowerCase().split("-")[0];
  const voices: Record<string, [string, string]> = {
    ar: ["ar-AE-FatimaNeural", "ar-AE-HamdanNeural"],
    de: ["de-DE-KatjaNeural", "de-DE-ConradNeural"],
    en: ["en-US-AvaMultilingualNeural", "en-US-AndrewMultilingualNeural"],
    es: ["es-ES-ElviraNeural", "es-ES-AlvaroNeural"],
    fr: ["fr-FR-DeniseNeural", "fr-FR-HenriNeural"],
    hi: ["hi-IN-SwaraNeural", "hi-IN-MadhurNeural"],
    it: ["it-IT-ElsaNeural", "it-IT-DiegoNeural"],
    ja: ["ja-JP-NanamiNeural", "ja-JP-KeitaNeural"],
    ko: ["ko-KR-SunHiNeural", "ko-KR-InJoonNeural"],
    pt: ["pt-BR-FranciscaNeural", "pt-BR-AntonioNeural"],
    ur: ["ur-PK-UzmaNeural", "ur-PK-AsadNeural"],
    zh: ["zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural"],
  };
  const pair = voices[base || "en"] ?? voices.en!;
  return pair[masculine ? 1 : 0];
}

export async function createPromptVideoProject(input: CreatorPromptVideoInput, report: ProgressReporter = () => undefined): Promise<CreatorPromptVideoResult> {
  if (!cleanText(input.prompt)) throw new Error("A prompt is required.");
  const selectedMediaProvider = resolvePromptMediaProvider(input);
  const normalizedInput: CreatorPromptVideoInput = {
    ...input,
    mediaProvider: selectedMediaProvider,
    mediaAdapterUrl: selectedMediaProvider === "local-adapter"
      ? input.mediaAdapterUrl || process.env.AGENT_DEMO_MEDIA_ADAPTER_URL || process.env.AGENT_DEMO_WAN_VIDEO_ADAPTER_URL
      : input.mediaAdapterUrl,
    source: input.source ? resolveInputSource(input.source) : undefined,
    sceneSources: input.sceneSources?.map(resolveInputSource),
    characters: input.characters?.map((character) => ({ ...character, source: resolveInputSource(character.source) })),
    logoSource: input.logoSource ? resolveInputSource(input.logoSource) : undefined,
    musicSource: input.musicSource ? resolveInputSource(input.musicSource) : undefined,
    voiceReference: input.voiceReference ? resolveInputSource(input.voiceReference) : undefined,
    comfyuiWorkflow: input.comfyuiWorkflow ? path.resolve(input.comfyuiWorkflow) : undefined,
  };
  const directoryTitle = projectTitle(normalizedInput);
  const projectRoot = path.resolve(normalizedInput.outputDirectory ?? path.join("creator-output", slugify(directoryTitle) || "prompt-video"));
  await mkdir(projectRoot, { recursive: true });
  report(2, "Planning locally with fast Qwen and an instant fallback");
  const planPath = path.join(projectRoot, "production-plan.json");
  let initialPlan = await createSmartPromptVideoPlan(normalizedInput);
  const title = initialPlan.title;
  await writeFile(planPath, `${JSON.stringify(initialPlan, null, 2)}\n`, "utf8");
  if (!initialPlan.capabilities?.readyForRequest) {
    const blockers = initialPlan.capabilities?.blockers.map((item) => `${item.id}: ${item.detail}`).join("; ") || "Unknown local capability";
    report(100, "Production plan saved; required local capability is unavailable");
    throw new Error(`Production plan saved at ${planPath}, but production cannot start until these requirements are resolved: ${blockers}`);
  }
  let projectInput = normalizedInput;
  const sceneNarrations = initialPlan.scenes.map((scene) => {
    const line = cleanText(scene.narration);
    return projectInput.mode === "asmr" || /^no narration\b/i.test(line) ? "" : line;
  });
  interface GeneratedSceneVoice { sceneIndex: number; text: string; path: string; durationSeconds: number }
  let voiceAssets: GeneratedSceneVoice[] = [];
  let captionsPath: string | undefined;
  if (projectInput.generateVoice !== false && sceneNarrations.some(Boolean)) {
    report(8, "Generating scene-aligned narration");
    if (projectInput.voiceProvider === "local-clone" && (!projectInput.voiceReference || !projectInput.voiceConsent)) {
      throw new Error("Local voice cloning requires a reference recording and named speaker consent metadata.");
    }
    const defaultVoice = defaultNeuralVoice(projectInput.language, projectInput.presenter === "leo" || projectInput.presenter === "milo");
    const generateSceneVoice = async (text: string, sceneIndex: number): Promise<GeneratedSceneVoice | undefined> => {
      if (!text) return undefined;
      report(8 + sceneIndex * 3, `Generating narration for scene ${sceneIndex + 1}`);
      const extension = projectInput.voiceProvider === "neural" ? "mp3" : "wav";
      let outputPath = path.join(projectRoot, `voiceover-scene-${String(sceneIndex + 1).padStart(2, "0")}.${extension}`);
      if (projectInput.voiceProvider === "neural") {
        await generateNeuralSpeech(text, outputPath, { voice: projectInput.voice ?? defaultVoice, rate: projectInput.voiceRate ?? 0 });
      } else if (projectInput.voiceProvider === "local-clone") {
        outputPath = await generateLocalClonedSpeech(text, outputPath, {
          referencePath: projectInput.voiceReference!,
          consent: projectInput.voiceConsent!,
          endpoint: projectInput.voiceCloneUrl,
          voice: projectInput.voice,
          rate: projectInput.voiceRate,
          language: projectInput.language,
        });
      } else {
        await generateLocalSpeech(text, outputPath, { voice: projectInput.voice, rate: projectInput.voiceRate });
      }
      return { sceneIndex, text, path: outputPath, durationSeconds: (await probeMediaInfo(outputPath)).durationSeconds };
    };
    const generated: Array<GeneratedSceneVoice | undefined> = [];
    if (projectInput.voiceProvider === "local-clone") {
      // Most local clone backends keep one large model in VRAM. Serialize those
      // calls to avoid duplicate model loads and out-of-memory failures.
      for (const [sceneIndex, text] of sceneNarrations.entries()) generated.push(await generateSceneVoice(text, sceneIndex));
    } else {
      generated.push(...await Promise.all(sceneNarrations.map(generateSceneVoice)));
    }
    voiceAssets = generated.filter((asset): asset is GeneratedSceneVoice => Boolean(asset));
  }
  const requestedDuration = projectInput.durationSeconds ?? DEFAULT_DURATIONS[projectInput.mode];
  const speechDurations = initialPlan.scenes.map((_, index) => voiceAssets.find((asset) => asset.sceneIndex === index)?.durationSeconds ?? 0);
  let plan = retimeProductionPlan(initialPlan, requestedDuration, speechDurations);
  const timelineDuration = plan.requirements.targetDurationSeconds;
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  let mediaGeneration: SceneMediaGenerationResult | undefined;
  const generatedMediaRoot = path.join(projectRoot, "generated-media");
  const sceneAudioPaths = plan.scenes.map((_, index) => voiceAssets.find((asset) => asset.sceneIndex === index)?.path);
  if (projectInput.mediaProvider === "animated") {
    report(25, "Creating stable 1080p scenes with real vector character animation");
    mediaGeneration = await generateAnimatedSceneMedia(projectInput, plan, generatedMediaRoot, report);
  } else if (projectInput.mediaProvider === "comfyui") {
    report(25, "Sending the timed scene plan to the local ComfyUI video workflow");
    mediaGeneration = await generateComfyUiSceneMedia(projectInput, plan, generatedMediaRoot, sceneAudioPaths, report);
  } else if (projectInput.mediaProvider === "ltx-desktop") {
    report(25, "Sending the timed scene and narration plan to LTX Desktop");
    mediaGeneration = await generateLtxDesktopSceneMedia(projectInput, plan, generatedMediaRoot, sceneAudioPaths, report);
  } else if (projectInput.mediaProvider === "local-adapter") {
    report(25, "Generating one real motion clip per scene with the local video adapter");
    mediaGeneration = await generateLocalSceneMedia(projectInput, plan, generatedMediaRoot, {}, { audioPaths: sceneAudioPaths });
  }
  if (mediaGeneration) {
    projectInput = { ...projectInput, source: undefined, sceneSources: mediaGeneration.outputs.map((output) => output.path) };
    const generatedResources: CreatorProductionPlan["resources"] = mediaGeneration.outputs.map((output, index) => ({
      id: `locally-generated-scene-${index + 1}`,
      category: "source-media",
      requirement: `${mediaGeneration!.qualityTier === "generative-video" ? "Generative" : "Animated"} ${output.kind} for planned scene ${index + 1}`,
      source: output.path,
      status: "generated",
      rights: output.rights || `Generated locally${output.model ? ` with ${output.model}` : ""}; retain model-license, prompt, and disclosure records.`,
    }));
    plan = {
      ...plan,
      resources: [
        ...plan.resources.filter((resource) => !["generated-scene-media", "animated-scene-media", "local-media-adapter"].includes(resource.id)),
        ...generatedResources,
      ],
    };
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  }
  const manifest = createPromptVideoManifest({ ...projectInput, title, durationSeconds: timelineDuration }, plan);
  if (mediaGeneration) manifest.metadata = { ...(manifest.metadata ?? {}), localMediaGeneration: mediaGeneration };
  if (voiceAssets.length) {
    const sceneStarts: number[] = [];
    let sceneCursor = 0;
    for (const scene of plan.scenes) {
      sceneStarts.push(sceneCursor);
      sceneCursor = Number((sceneCursor + scene.durationSeconds).toFixed(3));
    }
    const voiceStartSeconds = (sceneIndex: number): number => Number(((sceneStarts[sceneIndex] ?? 0) + 0.35).toFixed(3));
    const voiceLicenseBase = projectInput.voiceProvider === "neural" ? "generated-neural-voiceover" : projectInput.voiceProvider === "local-clone" ? "generated-consented-local-clone" : "generated-local-voiceover";
    manifest.audio = {
      ...(manifest.audio ?? {}),
      voices: voiceAssets.map((asset) => ({
        source: asset.path,
        startSeconds: voiceStartSeconds(asset.sceneIndex),
        volume: 1,
        fadeInSeconds: 0.1,
        fadeOutSeconds: 0.2,
        licenseId: `${voiceLicenseBase}-scene-${asset.sceneIndex + 1}`,
      })),
    };
    manifest.licenses = [...(manifest.licenses ?? []), ...voiceAssets.map((asset) => ({
      id: `${voiceLicenseBase}-scene-${asset.sceneIndex + 1}`,
      source: asset.path,
      title: `Generated narration · scene ${asset.sceneIndex + 1}`,
      creator: projectInput.voiceConsent?.speakerName ?? projectInput.voice ?? (projectInput.voiceProvider === "neural" ? "Selected neural voice" : "Selected operating-system voice"),
      license: projectInput.voiceProvider === "neural" ? "Generated speech; neural voice provider terms apply" : projectInput.voiceProvider === "local-clone" ? `Authorized local voice clone for ${projectInput.voiceConsent?.scope || "this project"}` : "Generated speech; operating-system voice terms apply",
      attribution: projectInput.voiceProvider === "local-clone" ? "Consent metadata is recorded in the production plan; retain the original authorization and disclose synthetic speech where required." : "Narration generated from the project brief; confirm voice-provider commercial-use and disclosure terms before publishing.",
    }))];
    const cues = voiceAssets.flatMap((asset) => narrationCues(asset.text, asset.durationSeconds, voiceStartSeconds(asset.sceneIndex)));
    cues.forEach((cue, index) => { cue.index = index + 1; });
    captionsPath = path.join(projectRoot, "captions.srt");
    await writeFile(captionsPath, serializeSrt(cues), "utf8");
    manifest.captions = { ...(manifest.captions ?? {}), source: captionsPath, format: "srt", language: projectInput.language ?? "en" };
  }
  let musicPath: string | undefined;
  if (projectInput.musicSource) {
    report(68, "Attaching authorized local music or ambience");
    musicPath = projectInput.musicSource;
    if (projectInput.mode === "asmr") {
      manifest.audio = { ...(manifest.audio ?? {}), ambience: { source: musicPath, loop: true, volume: 0.72, fadeInSeconds: 1.2, fadeOutSeconds: 1.8, licenseId: "provided-music" } };
    } else {
      manifest.audio = { ...(manifest.audio ?? {}), music: { source: musicPath, loop: true, volume: projectInput.mode === "product-launch" ? 0.08 : 0.055, fadeInSeconds: 0.8, fadeOutSeconds: 1.2, licenseId: "provided-music" } };
    }
  } else if (projectInput.generateMusic !== false) {
    report(68, projectInput.mode === "asmr" ? "Generating ASMR soundscape" : "Generating ambient score");
    musicPath = path.join(projectRoot, projectInput.mode === "asmr" ? "asmr-soundscape.wav" : "ambient-score.wav");
    if (projectInput.mode === "asmr") {
      await generateAsmrSoundscape(musicPath, timelineDuration);
      manifest.audio = { ...(manifest.audio ?? {}), ambience: { source: musicPath, loop: true, volume: 0.72, fadeInSeconds: 1.2, fadeOutSeconds: 1.8, licenseId: "agent-demo-procedural-audio" } };
    } else {
      await generateAmbientMusic(musicPath, timelineDuration);
      manifest.audio = { ...(manifest.audio ?? {}), music: { source: musicPath, loop: true, volume: projectInput.mode === "product-launch" ? 0.08 : 0.055, fadeInSeconds: 0.8, fadeOutSeconds: 1.2, licenseId: "agent-demo-procedural-audio" } };
    }
    manifest.licenses = [...(manifest.licenses ?? []), {
      id: "agent-demo-procedural-audio",
      source: musicPath,
      title: projectInput.mode === "asmr" ? "Procedural ASMR soundscape" : "Procedural ambient score",
      creator: "Agent Demo Studio contributors",
      license: "MIT (procedurally generated project audio)",
      attribution: "Synthesized locally from Agent Demo Studio code without sampled recordings.",
    }];
  }
  const manifestPath = path.join(projectRoot, "creator-project.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  let renderResult;
  if (projectInput.render) {
    report(72, `Rendering ${projectInput.mode} video`);
    renderResult = await renderCreatorManifest(manifestPath, (progress, message) => report(72 + progress * 0.28, message));
  } else report(100, "Prompt video project ready");
  const voicePaths = voiceAssets.map((asset) => asset.path);
  return { mode: projectInput.mode, title, prompt: projectInput.prompt, planPath, plan, manifestPath, manifest, voicePath: voicePaths[0], voicePaths, captionsPath, musicPath, renderResult };
}
