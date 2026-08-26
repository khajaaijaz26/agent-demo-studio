import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { generateAmbientMusic, generateAsmrSoundscape } from "../audio/music.js";
import { generateNeuralSpeech } from "../audio/neural-tts.js";
import { generateLocalSpeech } from "../audio/tts.js";
import { slugify } from "../utils/text.js";
import { bundledAssetLicense } from "./assets.js";
import { serializeSrt } from "./captions.js";
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
  return input.presenter ?? (input.mode === "product-launch" ? "aria" : input.mode === "story" || input.mode === "cartoon" ? "nova" : "none");
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
  const selectedCartoonCast = input.mode === "cartoon" ? cartoonCast(presenter) : [];
  const cartoonCastLabel = selectedCartoonCast.map((id) => id[0]!.toUpperCase() + id.slice(1)).join(" and ");
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
    ? selectedCartoonCast.length > 1
      ? [`Reveal the workshop and introduce ${cartoonCastLabel}`, `Let ${cartoonCastLabel} exchange the central idea`, "Land both characters on the final lesson or CTA"]
      : selectedCartoonCast.length === 1
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
  const musicEnabled = input.generateMusic !== false;
  const sceneNarration = narrationEnabled ? cleanText(input.narration ?? prompt) : "No narration; visuals and sound carry this scene.";
  const resources: CreatorProductionPlan["resources"] = [{
    id: "primary-visual",
    category: input.source ? "source-media" : "scene",
    requirement: input.source ? "Primary user-supplied image or video" : `Primary ${input.mode} environment`,
    source: input.source ?? builtInScene(input.mode),
    status: input.source ? "provided" : "bundled",
    rights: input.source ? "User must own or license this source; add proof in manifest licenses." : "Original synthetic Agent Demo Studio asset, bundled under MIT.",
  }];
  if (input.mode === "cartoon") {
    for (const [index, id] of cartoonCast(presenter).entries()) {
      const selected = presenterSource(id)!;
      resources.push({ id, category: "character", requirement: `${index === 0 ? "Primary" : "Secondary"} fictional ${selected.type === "character" ? "cartoon host" : "presenter"}`, source: selected.source, status: "bundled", rights: "Original synthetic Agent Demo Studio character, bundled under MIT." });
    }
  } else if (presenter !== "none") {
    const selected = presenterSource(presenter)!;
    resources.push({ id: presenter, category: "character", requirement: `${selected.type === "presenter" ? "Fictional product presenter" : "Fictional story character"}`, source: selected.source, status: "bundled", rights: "Original synthetic Agent Demo Studio character, bundled under MIT; disclose synthetic use where required." });
  }
  if (narrationEnabled) resources.push(
    { id: "voiceover", category: "voice", requirement: "Paced narration matched to the planned story", source: input.voiceProvider === "neural" ? `neural:${input.voice ?? "automatic voice"}` : `local:${input.voice ?? "system default"}`, status: "generated", rights: "Generated speech; provider terms apply when a cloud/neural provider is selected." },
    { id: "captions", category: "captions", requirement: "Readable captions aligned to narration", source: "generated:captions.srt", status: "generated", rights: "Derived from the user prompt or narration." },
  );
  if (musicEnabled) resources.push({ id: "score", category: input.mode === "asmr" ? "sound" : "music", requirement: input.mode === "asmr" ? "Quiet stereo ASMR soundscape" : "Original supporting score below narration", source: input.mode === "asmr" ? "generated:local-asmr-soundscape" : "generated:local-ambient-score", status: "generated", rights: "Procedurally generated by Agent Demo Studio for this project." });
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
      sourceStrategy: input.source ? "Use the supplied source as the visual foundation and preserve its aspect safely." : `Use the bundled ${input.mode} art direction, then allow agents to replace individual shots with approved generated or licensed media.`,
      narration: narrationEnabled,
      musicOrAmbience: musicEnabled,
    },
    creativeDirection: {
      visualStyle: direction.visualStyle,
      pacing: direction.pacing,
      composition: direction.composition,
      characterDirection: presenter === "none" ? "No host; let imagery, typography, and sound lead." : "Use only the selected fictional synthetic character assets with subtle motion; do not imply a real spokesperson.",
      effects: [...direction.effects],
    },
    scenes: sceneWeights.map((weight, index) => ({
      id: `scene-${index + 1}`,
      title: sceneTitles[index]!,
      purpose: index === 0 ? "Earn attention and establish context." : index === 1 ? "Deliver the core idea with visual progression." : "Resolve the message and leave a clear final impression.",
      durationSeconds: Number((duration * weight).toFixed(2)),
      visual: sceneVisuals[index]!,
      narration: narrationEnabled ? (index === 1 ? sceneNarration : beats[index] ?? sceneNarration) : sceneNarration,
      onScreenText: input.mode === "asmr" ? (index === 0 ? title : undefined) : beats[index] ?? (index === 2 ? title : undefined),
      transition: transitions[index]!,
    })),
    resources,
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
      input.source ? "The supplied source is authorized for use." : "Bundled scene art is an acceptable starting point until the user or agent provides shot-specific media.",
      "The prompt is treated as the creative brief; an agent may refine audience, claims, brand assets, and CTA before render.",
      narrationEnabled ? "Narration timing may extend the target duration so speech is not unnaturally rushed." : "The video intentionally uses no generated narration.",
      "Fictional synthetic characters are not real spokespersons and should be disclosed where platform rules require it.",
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

function imageClips(source: string, mode: CreatorPromptVideoInput["mode"], duration: number): CreatorClip[] {
  const motions: CreatorClip["motion"][] = ["ken-burns-in", "pan-right", "ken-burns-out"];
  const vfx = mode === "cartoon" ? ["comic" as const] : mode === "story" ? ["dream" as const] : mode === "asmr" ? ["asmr-soft" as const] : mode === "vfx" ? ["neon" as const, "glitch" as const] : ["cinematic" as const, "glow" as const];
  const transitionDuration = mode === "asmr" ? 1.1 : 0.5;
  const clipDuration = (duration + transitionDuration * (motions.length - 1)) / motions.length;
  return motions.map((motion, index) => ({
    id: `scene-${index + 1}`,
    source,
    kind: "image",
    durationSeconds: clipDuration,
    motion,
    reframe: "fill",
    effects: { vfx: index === 1 && mode === "vfx" ? ["vhs"] : vfx },
    transition: { type: index === 0 ? "fade" : mode === "cartoon" || mode === "asmr" ? "dissolve" : "fade-black", durationSeconds: transitionDuration },
    chapter: index === 0 ? "Opening" : index === 1 ? "Development" : "Finale",
  }));
}

function sourceClips(input: CreatorPromptVideoInput, duration: number): CreatorClip[] {
  if (!input.source) return imageClips(builtInScene(input.mode), input.mode, duration);
  const vfx = input.mode === "vfx" ? ["neon" as const, "glitch" as const] : input.mode === "asmr" ? ["asmr-soft" as const] : ["cinematic" as const];
  return [{ id: "source", source: input.source, reframe: input.mode === "product-launch" ? "fit" : "blur-background", effects: { vfx }, chapter: "Main story" }];
}

function promptOverlays(input: CreatorPromptVideoInput, title: string, duration: number): CreatorOverlay[] {
  const beats = promptBeats(input.prompt);
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
    animation: { enter: "pop", exit: "slide-up", durationSeconds: 0.55, loop: "float", intensity: 0.55 },
  });
  if (input.mode === "product-launch" || input.mode === "vfx") {
    overlays.push(
      { id: "launch-beat", type: "lower-third", text: beats[0] ?? title, subtitle: beats[1] ?? "Built for the next step", startSeconds: timing.beatStart, endSeconds: timing.beatEnd, x: 0.32, y: 0.65, animation: { enter: "slide-left", exit: "fade", durationSeconds: 0.45 } },
      { id: "launch-cta", type: "cta", text: beats[2] ?? "See it in action", startSeconds: timing.ctaStart, endSeconds: duration, x: 0.5, y: 0.68, animation: { enter: "rise", exit: "fade", loop: "pulse", durationSeconds: 0.45, intensity: 0.65 } },
    );
  }
  if (input.mode === "cartoon") {
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

  const chosen = presenterSource(input.presenter ?? (input.mode === "product-launch" ? "aria" : input.mode === "story" ? "nova" : "none"));
  if (chosen && input.mode !== "cartoon") overlays.push({
    id: "prompt-presenter", type: chosen.type, source: chosen.source, startSeconds: 1, endSeconds: Math.min(duration - 0.3, 12), x: 0.82, y: 0.64,
    animation: { enter: "slide-right", exit: "fade", loop: "talk", durationSeconds: 0.55, intensity: 0.7 },
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

export function createPromptVideoManifest(input: CreatorPromptVideoInput, productionPlan: CreatorProductionPlan = createPromptVideoPlan(input)): CreatorManifest {
  const title = productionPlan.title;
  const duration = productionPlan.requirements.targetDurationSeconds;
  const timing = launchTimings(duration);
  const manifest: CreatorManifest = {
    schemaVersion: CREATOR_SCHEMA_VERSION,
    title,
    description: `Prompt-to-video ${input.mode} project: ${cleanText(input.prompt)}`,
    outputDirectory: "./renders",
    brand: { name: title, primary: "#8B5CF6", secondary: "#22D3EE", text: "#FFFFFF" },
    clips: sourceClips(input, duration),
    overlays: promptOverlays(input, title, duration),
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
      syntheticCharacters: ["cartoon", "story", "product-launch"].includes(input.mode),
      workflow: "prompt-to-video",
      productionPlan,
      productionPlanPath: "./production-plan.json",
    },
  };
  manifest.licenses = builtInLicenses(manifest);
  return manifest;
}

function narrationCues(narration: string, duration: number): CaptionCue[] {
  const sentences = cleanText(narration).split(/(?<=[.!?])\s+/).filter(Boolean);
  const parts = sentences.length ? sentences : [cleanText(narration)];
  const weights = parts.map((part) => Math.max(1, part.split(/\s+/).length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0.25;
  return parts.map((text, index) => {
    const share = Math.max(0.35, (duration - 0.5) * weights[index]! / total);
    const cue = { index: index + 1, startSeconds: cursor, endSeconds: Math.min(duration, cursor + share), text };
    cursor = cue.endSeconds;
    return cue;
  });
}

export async function createPromptVideoProject(input: CreatorPromptVideoInput, report: ProgressReporter = () => undefined): Promise<CreatorPromptVideoResult> {
  if (!cleanText(input.prompt)) throw new Error("A prompt is required.");
  const normalizedInput: CreatorPromptVideoInput = input.source && !input.source.startsWith("builtin:")
    ? { ...input, source: path.resolve(input.source) }
    : input;
  const title = projectTitle(normalizedInput);
  const projectRoot = path.resolve(normalizedInput.outputDirectory ?? path.join("creator-output", slugify(title) || "prompt-video"));
  await mkdir(projectRoot, { recursive: true });
  report(2, "Planning requirements, storyboard, resources, and quality gates");
  const planPath = path.join(projectRoot, "production-plan.json");
  const initialPlan = createPromptVideoPlan({ ...normalizedInput, title });
  await writeFile(planPath, `${JSON.stringify(initialPlan, null, 2)}\n`, "utf8");
  const narration = cleanText(normalizedInput.narration ?? (normalizedInput.mode === "asmr" ? "" : normalizedInput.prompt));
  let voicePath: string | undefined;
  let captionsPath: string | undefined;
  let speechDuration = 0;
  if (normalizedInput.generateVoice !== false && narration) {
    report(8, "Generating narration");
    if (normalizedInput.voiceProvider === "neural") {
      voicePath = path.join(projectRoot, "voiceover.mp3");
      const defaultVoice = normalizedInput.presenter === "leo" || normalizedInput.presenter === "milo" ? "en-US-AndrewMultilingualNeural" : "en-US-AvaMultilingualNeural";
      await generateNeuralSpeech(narration, voicePath, { voice: normalizedInput.voice ?? defaultVoice, rate: normalizedInput.voiceRate ?? 0 });
    } else {
      voicePath = path.join(projectRoot, "voiceover.wav");
      await generateLocalSpeech(narration, voicePath, { voice: normalizedInput.voice, rate: normalizedInput.voiceRate });
    }
    speechDuration = (await probeMediaInfo(voicePath)).durationSeconds;
  }
  const requestedDuration = Math.max(normalizedInput.durationSeconds ?? DEFAULT_DURATIONS[normalizedInput.mode], speechDuration ? speechDuration + 1.6 : 0);
  const plan = createPromptVideoPlan({ ...normalizedInput, title, durationSeconds: requestedDuration });
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  const manifest = createPromptVideoManifest({ ...normalizedInput, title, durationSeconds: requestedDuration }, plan);
  if (voicePath) {
    const voiceLicenseId = normalizedInput.voiceProvider === "neural" ? "generated-neural-voiceover" : "generated-local-voiceover";
    manifest.audio = { ...(manifest.audio ?? {}), voice: { source: voicePath, volume: 1, fadeInSeconds: 0.15, fadeOutSeconds: 0.35, licenseId: voiceLicenseId } };
    manifest.licenses = [...(manifest.licenses ?? []), {
      id: voiceLicenseId,
      source: voicePath,
      title: "Generated narration",
      creator: normalizedInput.voice ?? (normalizedInput.voiceProvider === "neural" ? "Selected neural voice" : "Selected operating-system voice"),
      license: normalizedInput.voiceProvider === "neural" ? "Generated speech; neural voice provider terms apply" : "Generated speech; operating-system voice terms apply",
      attribution: "Narration generated from the project brief; confirm voice-provider commercial-use and disclosure terms before publishing.",
    }];
    captionsPath = path.join(projectRoot, "captions.srt");
    await writeFile(captionsPath, serializeSrt(narrationCues(narration, speechDuration)), "utf8");
    manifest.captions = { ...(manifest.captions ?? {}), source: captionsPath, format: "srt" };
  }
  let musicPath: string | undefined;
  if (normalizedInput.generateMusic !== false) {
    report(22, normalizedInput.mode === "asmr" ? "Generating ASMR soundscape" : "Generating ambient score");
    musicPath = path.join(projectRoot, normalizedInput.mode === "asmr" ? "asmr-soundscape.wav" : "ambient-score.wav");
    if (normalizedInput.mode === "asmr") {
      await generateAsmrSoundscape(musicPath, requestedDuration);
      manifest.audio = { ...(manifest.audio ?? {}), ambience: { source: musicPath, loop: true, volume: 0.72, fadeInSeconds: 1.2, fadeOutSeconds: 1.8, licenseId: "agent-demo-procedural-audio" } };
    } else {
      await generateAmbientMusic(musicPath, requestedDuration);
      manifest.audio = { ...(manifest.audio ?? {}), music: { source: musicPath, loop: true, volume: normalizedInput.mode === "product-launch" ? 0.08 : 0.055, fadeInSeconds: 0.8, fadeOutSeconds: 1.2, licenseId: "agent-demo-procedural-audio" } };
    }
    manifest.licenses = [...(manifest.licenses ?? []), {
      id: "agent-demo-procedural-audio",
      source: musicPath,
      title: normalizedInput.mode === "asmr" ? "Procedural ASMR soundscape" : "Procedural ambient score",
      creator: "Agent Demo Studio contributors",
      license: "MIT (procedurally generated project audio)",
      attribution: "Synthesized locally from Agent Demo Studio code without sampled recordings.",
    }];
  }
  const manifestPath = path.join(projectRoot, "creator-project.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  let renderResult;
  if (normalizedInput.render) {
    report(30, `Rendering ${normalizedInput.mode} video`);
    renderResult = await renderCreatorManifest(manifestPath, (progress, message) => report(30 + progress * 0.7, message));
  } else report(100, "Prompt video project ready");
  return { mode: normalizedInput.mode, title, prompt: normalizedInput.prompt, planPath, plan, manifestPath, manifest, voicePath, captionsPath, musicPath, renderResult };
}
