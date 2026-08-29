export const CREATOR_SCHEMA_VERSION = 2;

export type CreatorPresetId =
  | "youtube-1080p"
  | "youtube-4k"
  | "shorts"
  | "reels"
  | "tiktok"
  | "story"
  | "square"
  | "portrait"
  | "linkedin"
  | "podcast-vertical";

export const CREATOR_TRANSITIONS = [
  "cut", "fade", "dissolve", "wipe-left", "wipe-right", "wipe-up", "wipe-down",
  "slide-left", "slide-right", "slide-up", "slide-down", "smooth-left", "smooth-right",
  "circle-open", "circle-close", "radial", "pixelize", "fade-black", "fade-white",
  "zoom-in", "squeeze-horizontal", "squeeze-vertical", "diagonal", "blur",
  "reveal-left", "reveal-right", "reveal-up", "reveal-down",
] as const;

export type TransitionType = typeof CREATOR_TRANSITIONS[number];

export const CREATOR_OVERLAY_ANIMATIONS = [
  "none", "fade", "slide-left", "slide-right", "slide-up", "slide-down", "pop", "rise", "drop",
] as const;

export type CreatorOverlayAnimationPreset = typeof CREATOR_OVERLAY_ANIMATIONS[number];

export const CREATOR_LOOP_ANIMATIONS = [
  "none", "float", "bounce", "drift", "shake", "pulse", "talk",
] as const;

export type CreatorLoopAnimation = typeof CREATOR_LOOP_ANIMATIONS[number];

export const CREATOR_IMAGE_MOTIONS = [
  "none", "ken-burns-in", "ken-burns-out", "pan-left", "pan-right", "pan-up", "pan-down",
] as const;

export type CreatorImageMotion = typeof CREATOR_IMAGE_MOTIONS[number];

export const CREATOR_VFX_PRESETS = [
  "cinematic", "glow", "neon", "glitch", "vhs", "dream", "vintage", "noir", "comic", "asmr-soft",
] as const;

export type CreatorVfxPreset = typeof CREATOR_VFX_PRESETS[number];

export const CREATOR_PROMPT_MODES = [
  "product-launch", "cartoon", "story", "asmr", "vfx",
] as const;

export type CreatorPromptMode = typeof CREATOR_PROMPT_MODES[number];

export type ReframeMode = "fit" | "fill" | "blur-background";

export interface CreatorSafeZone {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CreatorPreset {
  id: CreatorPresetId;
  label: string;
  platform: "youtube" | "instagram" | "tiktok" | "generic" | "linkedin";
  width: number;
  height: number;
  fps: number;
  aspectRatio: string;
  videoBitrate: string;
  audioBitrate: string;
  advisoryMaxDurationSeconds?: number;
  safeZone: CreatorSafeZone;
  description: string;
}

export interface CreatorTransition {
  type: TransitionType;
  durationSeconds?: number;
}

export interface CreatorEffects {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  gamma?: number;
  blur?: number;
  sharpen?: number;
  vignette?: boolean;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  vfx?: CreatorVfxPreset[];
}

export interface CreatorSpeedRamp {
  from: number;
  to: number;
  steps?: number;
}

export interface CreatorClip {
  id: string;
  source: string;
  kind?: "video" | "image";
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  durationSeconds?: number;
  speed?: number;
  speedRamp?: CreatorSpeedRamp;
  volume?: number;
  muted?: boolean;
  reframe?: ReframeMode;
  focusX?: number;
  focusY?: number;
  freezeAfterSeconds?: number;
  motion?: CreatorImageMotion;
  transition?: CreatorTransition;
  effects?: CreatorEffects;
  chapter?: string;
  licenseId?: string;
}

export interface CreatorOverlayAnimation {
  enter?: CreatorOverlayAnimationPreset;
  exit?: CreatorOverlayAnimationPreset;
  loop?: CreatorLoopAnimation;
  durationSeconds?: number;
  exitDurationSeconds?: number;
  intensity?: number;
}

export interface CreatorChromaKey {
  color?: string;
  similarity?: number;
  blend?: number;
}

export interface CreatorOverlay {
  id: string;
  type: "text" | "lower-third" | "cta" | "speech-bubble" | "image" | "watermark" | "presenter" | "character" | "video";
  text?: string;
  subtitle?: string;
  source?: string;
  startSeconds: number;
  endSeconds: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  color?: string;
  background?: string;
  accent?: string;
  fontSize?: number;
  cornerRadius?: number;
  animation?: CreatorOverlayAnimation;
  flipHorizontal?: boolean;
  loop?: boolean;
  chromaKey?: CreatorChromaKey;
  licenseId?: string;
}

export interface CreatorCaptionStyle {
  position?: "top" | "middle" | "bottom";
  fontSize?: number;
  color?: string;
  background?: string;
  accent?: string;
  maxCharactersPerLine?: number;
  maxLines?: number;
  margin?: number;
}

export interface CreatorCaptions {
  source?: string;
  format?: "srt" | "vtt";
  burn?: boolean;
  sidecar?: boolean;
  language?: string;
  style?: CreatorCaptionStyle;
}

export interface CreatorAudioTrack {
  source: string;
  startSeconds?: number;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  volume?: number;
  loop?: boolean;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  pan?: number;
  licenseId?: string;
}

export interface CreatorAudioMix {
  voice?: CreatorAudioTrack;
  voices?: CreatorAudioTrack[];
  music?: CreatorAudioTrack;
  ambience?: CreatorAudioTrack;
  soundEffects?: CreatorAudioTrack[];
  mode?: "standard" | "voice" | "cinematic" | "asmr";
  keepClipAudio?: boolean;
  clipVolume?: number;
  duckMusic?: boolean;
  duckingThreshold?: number;
  targetLufs?: number;
  truePeak?: number;
}

export interface CreatorChapter {
  title: string;
  startSeconds: number;
}

export interface CreatorExport {
  id: string;
  preset: CreatorPresetId;
  fileName?: string;
  title?: string;
  description?: string;
  tags?: string[];
  quality?: number;
  videoCodec?: "h264" | "hevc";
  thumbnailAtSeconds?: number;
  burnCaptions?: boolean;
}

export interface CreatorAssetLicense {
  id: string;
  source: string;
  title?: string;
  creator?: string;
  license: string;
  licenseUrl?: string;
  attribution?: string;
  proofUrl?: string;
}

export interface CreatorBrand {
  name?: string;
  logo?: string;
  logoLicenseId?: string;
  primary?: string;
  secondary?: string;
  text?: string;
  fontFamily?: string;
}

export interface CreatorManifest {
  schemaVersion: number;
  title: string;
  description?: string;
  outputDirectory?: string;
  brand?: CreatorBrand;
  clips: CreatorClip[];
  overlays?: CreatorOverlay[];
  captions?: CreatorCaptions;
  audio?: CreatorAudioMix;
  chapters?: CreatorChapter[];
  exports?: CreatorExport[];
  licenses?: CreatorAssetLicense[];
  metadata?: Record<string, unknown>;
}

export interface CreatorValidationIssue {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
  path?: string;
  exportId?: string;
}

export interface CreatorValidationResult {
  valid: boolean;
  manifest?: CreatorManifest;
  issues: CreatorValidationIssue[];
}

export interface CreatorRenderedOutput {
  id: string;
  preset: CreatorPresetId;
  platform: CreatorPreset["platform"];
  videoPath: string;
  thumbnailPath: string;
  captionsPath?: string;
  chaptersPath?: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  fileSizeBytes: number;
  validation: CreatorValidationIssue[];
}

export interface CreatorRenderResult {
  title: string;
  manifestPath?: string;
  outputDirectory: string;
  outputs: CreatorRenderedOutput[];
  licenseReportPath?: string;
  createdAt: string;
}

export interface CaptionCue {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface MediaAnalysis {
  source: string;
  durationSeconds: number;
  width?: number;
  height?: number;
  fps?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  silence: Array<{ startSeconds: number; endSeconds: number; durationSeconds: number }>;
  sceneChanges: number[];
  suggestedHighlights: Array<{
    startSeconds: number;
    endSeconds: number;
    durationSeconds: number;
    reason: string;
  }>;
}

export type CreatorTemplateId =
  | "product-demo"
  | "product-launch"
  | "feature-reel"
  | "launch-short"
  | "cartoon-story"
  | "narrated-story"
  | "asmr"
  | "vfx-showcase"
  | "tutorial"
  | "talking-head"
  | "podcast-clip"
  | "testimonial"
  | "before-after";

export interface CreatorTemplate {
  id: CreatorTemplateId;
  label: string;
  description: string;
  recommendedPresets: CreatorPresetId[];
  manifest: CreatorManifest;
}

export interface CreatorPromptVideoInput {
  prompt: string;
  mode: CreatorPromptMode;
  title?: string;
  source?: string;
  outputDirectory?: string;
  narration?: string;
  durationSeconds?: number;
  presenter?: "none" | "aria" | "leo" | "nova" | "milo";
  voice?: string;
  voiceProvider?: "local" | "neural" | "local-clone";
  voiceRate?: number;
  /** Reference recording for a consented, loopback-only voice-clone adapter. */
  voiceReference?: string;
  voiceConsent?: CreatorVoiceConsent;
  voiceCloneUrl?: string;
  presets?: CreatorPresetId[];
  generateVoice?: boolean;
  generateMusic?: boolean;
  render?: boolean;
  /** Selects the local planning engine. Auto prefers an installed local Qwen model. */
  plannerProvider?: CreatorPlannerProvider;
  /** Fast prefers the smallest useful local model; quality prefers a larger installed model. */
  plannerProfile?: CreatorPlannerProfile;
  /** Optional exact Ollama model name. Cloud-tagged models are rejected. */
  plannerModel?: string;
  /** Optional loopback-only Ollama endpoint. */
  plannerBaseUrl?: string;
  /** Any number of user-provided or locally generated scene images/videos. */
  sceneSources?: string[];
  /** Open character contract; bundled characters are only optional examples. */
  characters?: CreatorPromptCharacterInput[];
  logoSource?: string;
  musicSource?: string;
  /** Optional loopback media adapter for local diffusion/image/video engines. */
  mediaProvider?: "builtin" | "local-adapter";
  mediaTask?: "auto" | "text-to-image" | "image-to-video" | "text-to-video";
  mediaAdapterUrl?: string;
}

export interface CreatorPromptCharacterInput {
  id?: string;
  name: string;
  source: string;
  role?: "presenter" | "character";
  style?: string;
  rights?: string;
  x?: number;
  y?: number;
}

export interface CreatorVoiceConsent {
  speakerName: string;
  confirmed: boolean;
  scope?: string;
}

export type CreatorPlannerProvider = "auto" | "deterministic" | "ollama";

export type CreatorPlannerProfile = "fast" | "quality";

export interface CreatorPlanIntelligence {
  provider: "deterministic" | "ollama";
  local: true;
  profile: CreatorPlannerProfile;
  model?: string;
  promptTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  cacheHit?: boolean;
  fallbackReason?: string;
}

export interface CreatorProductionPlanResource {
  id: string;
  category: "source-media" | "scene" | "character" | "voice" | "captions" | "music" | "sound" | "vfx" | "export";
  requirement: string;
  source: string;
  status: "provided" | "bundled" | "generated" | "optional";
  rights: string;
}

export interface CreatorProductionPlanScene {
  id: string;
  title: string;
  purpose: string;
  durationSeconds: number;
  visual: string;
  narration: string;
  onScreenText?: string;
  transition: TransitionType;
}

export interface CreatorProductionPlan {
  planVersion: 1;
  title: string;
  originalPrompt: string;
  mode: CreatorPromptMode;
  requirements: {
    objective: string;
    audience: string;
    targetDurationSeconds: number;
    outputPresets: CreatorPresetId[];
    sourceStrategy: string;
    narration: boolean;
    musicOrAmbience: boolean;
  };
  creativeDirection: {
    visualStyle: string;
    pacing: string;
    composition: string;
    characterDirection: string;
    effects: CreatorVfxPreset[];
  };
  scenes: CreatorProductionPlanScene[];
  resources: CreatorProductionPlanResource[];
  productionRules: Array<{ id: string; rule: string; qualityGate: string }>;
  workflow: Array<{ order: number; stage: string; action: string; output: string; qualityGate: string }>;
  assumptions: string[];
  qualityChecklist: string[];
  /** Transparent provenance for the optional local planning pass. */
  intelligence?: CreatorPlanIntelligence;
}

export interface CreatorPromptVideoResult {
  mode: CreatorPromptMode;
  title: string;
  prompt: string;
  planPath: string;
  plan: CreatorProductionPlan;
  manifestPath: string;
  manifest: CreatorManifest;
  /** First narration file retained for backward compatibility. */
  voicePath?: string;
  /** Scene-aligned narration files in timeline order. */
  voicePaths?: string[];
  captionsPath?: string;
  musicPath?: string;
  renderResult?: CreatorRenderResult;
}
