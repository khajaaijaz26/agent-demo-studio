export const CREATOR_SCHEMA_VERSION = 1;

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
  "circle-open", "circle-close", "radial", "pixelize",
] as const;

export type TransitionType = typeof CREATOR_TRANSITIONS[number];

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
  transition?: CreatorTransition;
  effects?: CreatorEffects;
  chapter?: string;
  licenseId?: string;
}

export interface CreatorOverlay {
  id: string;
  type: "text" | "lower-third" | "cta" | "image" | "watermark";
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
  licenseId?: string;
}

export interface CreatorAudioMix {
  voice?: CreatorAudioTrack;
  music?: CreatorAudioTrack;
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
  | "feature-reel"
  | "launch-short"
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
