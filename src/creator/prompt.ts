import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { generateAmbientMusic, generateAsmrSoundscape } from "../audio/music.js";
import { generateNeuralSpeech } from "../audio/neural-tts.js";
import { generateLocalSpeech } from "../audio/tts.js";
import { generateLocalClonedSpeech } from "../audio/voice-clone.js";
import { slugify } from "../utils/text.js";
import { bundledAssetLicense } from "./assets.js";
import { serializeSrt } from "./captions.js";
import { enhancePromptVideoPlan, type LocalAiRuntime } from "./local-ai.js";
import { generateLocalSceneMedia, type LocalMediaGenerationResult } from "./local-media.js";
import { probeMediaInfo } from "./media.js";
import { renderCreatorManifest } from "./renderer.js";
import {
  CREATOR_SCHEMA_VERSION,
  type CaptionCue,
  type CreatorClip,
  type CreatorManifest,
  type CreatorOverlay,
  type CreatorProductionPlan,
  type CreatorPromptVideoInput,
  type CreatorPromptVideoResult,
} from "./types.js";

type ProgressReporter = (progress: number, message: string) => void;

const DEFAULT_DURATIONS = {
  "product-launch": 24,
  cartoon: 36,
  story: 45,
  asmr: 30,
  vfx: 18,
} as const;

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
  const title = projectTitle(input);
  const duration = Math.max(6, Math.min(600, input.durationSeconds ?? DEFAULT_DURATIONS[input.mode]));
  const presets = input.presets ?? (input.mode === "asmr" ? ["youtube-1080p", "reels"] : ["youtube-1080p", "shorts", "reels", "tiktok"]);
  const beats = promptBeats(prompt);
  const presenter = plannedPresenter(input);
  const suppliedCharacters = (input.characters ?? []).filter((character) => cleanText(character.name) && character.source.trim());
  const selectedCartoonCast = input.mode === "cartoon" ? cartoonCast(presenter) : [];
  const cartoonCastNames = suppliedCharacters.length
    ? suppliedCharacters.map((character) => cleanText(character.name))
    : selectedCartoonCast.map((id) => id[0]!.toUpperCase() + id.slice(1));
  const cartoonCastLabel = cartoonCastNames.join(" and ");
  const direction = {
    "product-launch": { visualStyle: "Premium cinematic product reveal with controlled glow and confident typography", pacing: "Hook quickly, establish value, show proof, then hold a clear CTA", composition: "Product-first widescreen stage with presenter balanced against readable copy", effects: ["cinematic", "glow"] as const },
    cartoon: { visualStyle: "Colorful original 3D cartoon world with expressive fictional hosts", pacing: "Playful setup, discovery, response, and satisfying resolution", composition: "Alternating character staging, speech bubbles, and generous caption-safe space", effects: ["comic"] as const },
    story: { visualStyle: "Atmospheric illustrated storybook with gentle depth and light", pacing: "Calm opening, rising curiosity, meaningful turn, reflective ending", composition: "Layered scenic motion with a narrator character and uncluttered story text", effects: ["dream"] as const },
    asmr: { visualStyle: "Macro glass, water, ceramic, and soft luminous texture", pacing: "Slow, continuous, low-stimulation sensory progression", composition: "Centered tactile detail with minimal typography and spacious negative space", effects: ["asmr-soft"] as const },
    vfx: { visualStyle: "High-contrast cinematic transformation reel with neon and analog texture", pacing: "Immediate visual hook, escalating transformations, clean final reveal", composition: "Full-frame effects showcase with concise overlays kept clear of captions", effects: ["neon", "glitch", "vhs"] as const },
  }[input.mode];
  const sceneWeights = [0.28, 0.4, 0.32];
  const sceneTitles = ["Hook and establish", "Develop and demonstrate", "Resolve and remember"];
  const transitions = input.mode === "cartoon" || input.mode === "asmr" ? ["fade", "dissolve", "dissolve"] as const : ["fade", "fade-black", "fade-black"] as const;
  const sceneVisuals = input.mode === "cartoon"
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
    : input.mediaProvider === "local-adapter"
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
  if (input.mediaProvider === "local-adapter" && visualSources.length) resources.push({
    id: "local-media-adapter",
    category: "scene",
    requirement: `Transform the supplied media with the loopback local adapter (${input.mediaTask ?? "auto"})`,
    source: `local-adapter:${input.mediaTask ?? "auto"}`,
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
      requirement: "Paced narration matched to the planned story",
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
      audience: "The intended product or story audience; refine this field when the brief names a specific viewer.",
      targetDurationSeconds: duration,
      outputPresets: presets,
      sourceStrategy: input.mediaProvider === "local-adapter" && visualSources.length
        ? `Transform ${visualSources.length} supplied source${visualSources.length === 1 ? "" : "s"} through the configured loopback-only ${input.mediaTask ?? "automatic"} adapter and preserve both source and model provenance.`
        : visualSources.length
        ? `Use ${visualSources.length} supplied or locally generated scene source${visualSources.length === 1 ? "" : "s"}, preserving aspect and provenance.`
        : input.mediaProvider === "local-adapter"
          ? `Generate the scene batch through the configured loopback-only ${input.mediaTask ?? "automatic"} adapter, then preserve its model and prompt provenance.`
          : `Use the bundled ${input.mode} starter art, then allow agents to replace every shot with approved local-generation output or licensed media.`,
      narration: narrationEnabled,
      musicOrAmbience: musicEnabled,
    },
    creativeDirection: {
      visualStyle: direction.visualStyle,
      pacing: direction.pacing,
      composition: direction.composition,
      characterDirection: suppliedCharacters.length
        ? `Stage the supplied open cast (${suppliedCharacters.map((character) => cleanText(character.name)).join(", ")}) with role-appropriate motion; do not imply an identity or endorsement beyond the supplied rights.`
        : presenter === "none"
          ? "No host is fixed or required. Use no character, any authorized supplied character, or output from a configured local image/video generator as the brief requires."
          : "Use the selected bundled fictional synthetic character as an optional starter with subtle motion; do not imply a real spokesperson.",
      effects: [...direction.effects],
    },
    scenes: sceneWeights.map((weight, index) => ({
      id: `scene-${index + 1}`,
      title: sceneTitles[index]!,
      purpose: index === 0 ? "Earn attention and establish context." : index === 1 ? "Deliver the core idea with visual progression." : "Resolve the message and leave a clear final impression.",
      durationSeconds: Number((duration * weight).toFixed(2)),
      visual: sceneVisuals[index]!,
      narration: narrationEnabled
        ? authoredNarration
          ? authoredNarration[index] || "No narration; visuals carry this scene."
          : (index === 1 ? sceneNarration : beats[index] ?? sceneNarration)
        : sceneNarration,
      onScreenText: input.mode === "asmr" ? (index === 0 ? title : undefined) : beats[index] ?? (index === 2 ? title : undefined),
      transition: transitions[index]!,
    })),
    resources,
    productionRules: [
      { id: "plan-first", rule: "Write and persist the complete production plan before generating audio, editing media, or rendering.", qualityGate: "production-plan.json exists and contains requirements, scenes, resources, workflow, assumptions, and QA." },
      { id: "open-assets", rule: "Never lock a request to bundled characters or scenes; choose no character, supplied assets, or configured local generators according to the brief.", qualityGate: "Every cast and scene choice traces to the user brief and resource list." },
      { id: "rights-first", rule: "Track source, generation method, rights, consent, and required disclosure for every external or synthetic asset.", qualityGate: "No undeclared media enters the render timeline." },
      { id: "story-sync", rule: "Match each visual, caption, effect, and character action to the narration or intended sensory beat.", qualityGate: "Scene-to-audio review finds no topic drift or mistimed reveal." },
      { id: "safe-layout", rule: "Keep text, faces, product UI, captions, logos, and CTAs inside each export's safe zones without overlap.", qualityGate: "Representative-frame QA passes for every aspect ratio." },
      { id: "natural-audio", rule: "Use natural speech pacing and mix music, ambience, and effects below intelligible narration without harsh peaks.", qualityGate: "Duration, loudness, true peak, and listening QA pass." },
      { id: "local-first", rule: "Prefer on-device planning, speech, procedural audio, asset generation, and FFmpeg rendering; never require a paid model token.", qualityGate: "The plan records its local provider or deterministic fallback." },
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
      visualSources.length ? "The supplied or locally generated scene sources are authorized for use." : input.mediaProvider === "local-adapter" ? "The configured local generator and installed model permit the intended use." : "Bundled scene art is only a replaceable starting point until shot-specific media is provided or generated.",
      "The prompt is treated as the creative brief; an agent may refine audience, claims, brand assets, and CTA before render.",
      narrationEnabled ? "Narration timing may extend the target duration so speech is not unnaturally rushed." : "The video intentionally uses no generated narration.",
      "Fictional synthetic characters are not real spokespersons and should be disclosed where platform rules require it.",
      ...(input.voiceProvider === "local-clone" ? ["The named speaker has authorized creation and use of the cloned voice for the declared scope."] : []),
    ],
    qualityChecklist: [
      "Visuals match the narration or intended sensory beat at every scene.",
      "Captions, titles, lower thirds, characters, and CTAs do not overlap.",
      "Motion feels intentional and contains no exposed transparent padding or black bands.",
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
export async function createSmartPromptVideoPlan(input: CreatorPromptVideoInput, runtime: LocalAiRuntime = {}): Promise<CreatorProductionPlan> {
  return enhancePromptVideoPlan(input, createPromptVideoPlan(input), runtime);
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
  const motions: CreatorClip["motion"][] = ["ken-burns-in", "pan-right", "ken-burns-out"];
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
    reframe: input.mode === "product-launch" ? "fit" : "blur-background",
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
  const cartoonNovaStart = Math.min(1.2, duration * 0.12);
  const cartoonLineStart = Math.max(cartoonNovaStart + 0.45, duration * 0.18);
  const titleEnd = input.mode === "cartoon"
    ? Math.min(duration, 3.4, Math.max(0.9, cartoonLineStart - 0.12))
    : Math.min(duration, 3.4);
  if (input.mode !== "asmr") overlays.push({
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
  const suppliedCharacters = (input.characters ?? []).filter((character) => cleanText(character.name) && character.source.trim());
  if (suppliedCharacters.length && input.mode !== "asmr") {
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
  } else if (input.mode === "cartoon") {
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
  if (chosen && input.mode !== "cartoon") overlays.push({
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
    captions: { burn: input.mode !== "asmr", sidecar: true, language: "en", style: { position: "bottom", accent: input.mode === "cartoon" ? "#F59E0B" : "#22D3EE" } },
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

export async function createPromptVideoProject(input: CreatorPromptVideoInput, report: ProgressReporter = () => undefined): Promise<CreatorPromptVideoResult> {
  if (!cleanText(input.prompt)) throw new Error("A prompt is required.");
  const normalizedInput: CreatorPromptVideoInput = {
    ...input,
    source: input.source ? resolveInputSource(input.source) : undefined,
    sceneSources: input.sceneSources?.map(resolveInputSource),
    characters: input.characters?.map((character) => ({ ...character, source: resolveInputSource(character.source) })),
    logoSource: input.logoSource ? resolveInputSource(input.logoSource) : undefined,
    musicSource: input.musicSource ? resolveInputSource(input.musicSource) : undefined,
    voiceReference: input.voiceReference ? resolveInputSource(input.voiceReference) : undefined,
  };
  const directoryTitle = projectTitle(normalizedInput);
  const projectRoot = path.resolve(normalizedInput.outputDirectory ?? path.join("creator-output", slugify(directoryTitle) || "prompt-video"));
  await mkdir(projectRoot, { recursive: true });
  report(2, "Planning locally with fast Qwen and an instant fallback");
  const planPath = path.join(projectRoot, "production-plan.json");
  let initialPlan = await createSmartPromptVideoPlan(normalizedInput);
  const title = initialPlan.title;
  await writeFile(planPath, `${JSON.stringify(initialPlan, null, 2)}\n`, "utf8");
  let projectInput = normalizedInput;
  let mediaGeneration: LocalMediaGenerationResult | undefined;
  if (normalizedInput.mediaProvider === "local-adapter") {
    report(5, "Generating the planned scene batch with the local media adapter");
    mediaGeneration = await generateLocalSceneMedia(normalizedInput, initialPlan, path.join(projectRoot, "generated-media"));
    projectInput = { ...normalizedInput, source: undefined, sceneSources: mediaGeneration.outputs.map((output) => output.path) };
    const generatedResources: CreatorProductionPlan["resources"] = mediaGeneration.outputs.map((output, index) => ({
      id: `locally-generated-scene-${index + 1}`,
      category: "source-media",
      requirement: `Locally generated ${output.kind} for planned scene ${index + 1}`,
      source: output.path,
      status: "generated",
      rights: output.rights || `Generated locally${output.model ? ` with ${output.model}` : ""}; retain model-license, prompt, and disclosure records.`,
    }));
    initialPlan = {
      ...initialPlan,
      resources: [...initialPlan.resources.filter((resource) => resource.id !== "generated-scene-media"), ...generatedResources],
    };
    await writeFile(planPath, `${JSON.stringify(initialPlan, null, 2)}\n`, "utf8");
  }
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
    const defaultVoice = projectInput.presenter === "leo" || projectInput.presenter === "milo" ? "en-US-AndrewMultilingualNeural" : "en-US-AvaMultilingualNeural";
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
  const plan = retimeProductionPlan(initialPlan, requestedDuration, speechDurations);
  const timelineDuration = plan.requirements.targetDurationSeconds;
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
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
    manifest.captions = { ...(manifest.captions ?? {}), source: captionsPath, format: "srt" };
  }
  let musicPath: string | undefined;
  if (projectInput.musicSource) {
    report(22, "Attaching authorized local music or ambience");
    musicPath = projectInput.musicSource;
    if (projectInput.mode === "asmr") {
      manifest.audio = { ...(manifest.audio ?? {}), ambience: { source: musicPath, loop: true, volume: 0.72, fadeInSeconds: 1.2, fadeOutSeconds: 1.8, licenseId: "provided-music" } };
    } else {
      manifest.audio = { ...(manifest.audio ?? {}), music: { source: musicPath, loop: true, volume: projectInput.mode === "product-launch" ? 0.08 : 0.055, fadeInSeconds: 0.8, fadeOutSeconds: 1.2, licenseId: "provided-music" } };
    }
  } else if (projectInput.generateMusic !== false) {
    report(22, projectInput.mode === "asmr" ? "Generating ASMR soundscape" : "Generating ambient score");
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
    report(30, `Rendering ${projectInput.mode} video`);
    renderResult = await renderCreatorManifest(manifestPath, (progress, message) => report(30 + progress * 0.7, message));
  } else report(100, "Prompt video project ready");
  const voicePaths = voiceAssets.map((asset) => asset.path);
  return { mode: projectInput.mode, title, prompt: projectInput.prompt, planPath, plan, manifestPath, manifest, voicePath: voicePaths[0], voicePaths, captionsPath, musicPath, renderResult };
}
