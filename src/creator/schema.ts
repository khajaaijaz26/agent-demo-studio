import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AgentDemoError } from "../errors.js";
import { CREATOR_PRESETS } from "./presets.js";
import {
  CREATOR_SCHEMA_VERSION,
  CREATOR_TRANSITIONS,
  type CreatorManifest,
  type CreatorValidationIssue,
  type CreatorValidationResult,
} from "./types.js";

const presetIds = Object.keys(CREATOR_PRESETS) as [keyof typeof CREATOR_PRESETS, ...(keyof typeof CREATOR_PRESETS)[]];
const finiteNumber = z.number().finite();
const color = z.string().regex(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i, "Use a #RRGGBB or #RRGGBBAA color.");

const transitionSchema = z.object({
  type: z.enum(CREATOR_TRANSITIONS),
  durationSeconds: finiteNumber.min(0).max(5).optional(),
});

const effectsSchema = z.object({
  brightness: finiteNumber.min(-1).max(1).optional(),
  contrast: finiteNumber.min(0).max(3).optional(),
  saturation: finiteNumber.min(0).max(3).optional(),
  gamma: finiteNumber.min(0.1).max(10).optional(),
  blur: finiteNumber.min(0).max(50).optional(),
  sharpen: finiteNumber.min(0).max(5).optional(),
  vignette: z.boolean().optional(),
  fadeInSeconds: finiteNumber.min(0).max(10).optional(),
  fadeOutSeconds: finiteNumber.min(0).max(10).optional(),
}).optional();

const clipSchema = z.object({
  id: z.string().trim().min(1),
  source: z.string().trim().min(1),
  kind: z.enum(["video", "image"]).optional(),
  trimStartSeconds: finiteNumber.min(0).optional(),
  trimEndSeconds: finiteNumber.min(0).optional(),
  durationSeconds: finiteNumber.positive().max(86_400).optional(),
  speed: finiteNumber.min(0.1).max(16).optional(),
  speedRamp: z.object({
    from: finiteNumber.min(0.1).max(16),
    to: finiteNumber.min(0.1).max(16),
    steps: z.number().int().min(2).max(16).optional(),
  }).optional(),
  volume: finiteNumber.min(0).max(4).optional(),
  muted: z.boolean().optional(),
  reframe: z.enum(["fit", "fill", "blur-background"]).optional(),
  focusX: finiteNumber.min(0).max(1).optional(),
  focusY: finiteNumber.min(0).max(1).optional(),
  freezeAfterSeconds: finiteNumber.min(0).max(300).optional(),
  transition: transitionSchema.optional(),
  effects: effectsSchema,
  chapter: z.string().trim().min(1).optional(),
  licenseId: z.string().trim().min(1).optional(),
});

const overlaySchema = z.object({
  id: z.string().trim().min(1),
  type: z.enum(["text", "lower-third", "cta", "image", "watermark"]),
  text: z.string().optional(),
  subtitle: z.string().optional(),
  source: z.string().optional(),
  startSeconds: finiteNumber.min(0),
  endSeconds: finiteNumber.positive(),
  x: finiteNumber.min(0).max(1).optional(),
  y: finiteNumber.min(0).max(1).optional(),
  width: finiteNumber.positive().optional(),
  height: finiteNumber.positive().optional(),
  opacity: finiteNumber.min(0).max(1).optional(),
  color: color.optional(),
  background: color.optional(),
  accent: color.optional(),
  fontSize: finiteNumber.min(12).max(240).optional(),
  cornerRadius: finiteNumber.min(0).max(200).optional(),
  licenseId: z.string().optional(),
});

const audioTrackSchema = z.object({
  source: z.string().trim().min(1),
  startSeconds: finiteNumber.min(0).optional(),
  trimStartSeconds: finiteNumber.min(0).optional(),
  trimEndSeconds: finiteNumber.min(0).optional(),
  volume: finiteNumber.min(0).max(4).optional(),
  loop: z.boolean().optional(),
  fadeInSeconds: finiteNumber.min(0).max(30).optional(),
  fadeOutSeconds: finiteNumber.min(0).max(30).optional(),
  licenseId: z.string().optional(),
});

export const creatorManifestSchema = z.object({
  schemaVersion: z.number().int().min(1).default(CREATOR_SCHEMA_VERSION),
  title: z.string().trim().min(1),
  description: z.string().optional(),
  outputDirectory: z.string().optional(),
  brand: z.object({
    name: z.string().optional(),
    logo: z.string().optional(),
    logoLicenseId: z.string().optional(),
    primary: color.optional(),
    secondary: color.optional(),
    text: color.optional(),
    fontFamily: z.string().optional(),
  }).optional(),
  clips: z.array(clipSchema).min(1),
  overlays: z.array(overlaySchema).optional(),
  captions: z.object({
    source: z.string().optional(),
    format: z.enum(["srt", "vtt"]).optional(),
    burn: z.boolean().optional(),
    sidecar: z.boolean().optional(),
    language: z.string().optional(),
    style: z.object({
      position: z.enum(["top", "middle", "bottom"]).optional(),
      fontSize: finiteNumber.min(16).max(160).optional(),
      color: color.optional(),
      background: color.optional(),
      accent: color.optional(),
      maxCharactersPerLine: z.number().int().min(12).max(100).optional(),
      maxLines: z.number().int().min(1).max(5).optional(),
      margin: finiteNumber.min(0).max(600).optional(),
    }).optional(),
  }).optional(),
  audio: z.object({
    voice: audioTrackSchema.optional(),
    music: audioTrackSchema.optional(),
    keepClipAudio: z.boolean().optional(),
    clipVolume: finiteNumber.min(0).max(4).optional(),
    duckMusic: z.boolean().optional(),
    duckingThreshold: finiteNumber.min(0.001).max(1).optional(),
    targetLufs: finiteNumber.min(-30).max(-5).optional(),
    truePeak: finiteNumber.min(-9).max(0).optional(),
  }).optional(),
  chapters: z.array(z.object({
    title: z.string().trim().min(1),
    startSeconds: finiteNumber.min(0),
  })).optional(),
  exports: z.array(z.object({
    id: z.string().trim().min(1),
    preset: z.enum(presetIds),
    fileName: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    quality: z.number().int().min(14).max(32).optional(),
    videoCodec: z.enum(["h264", "hevc"]).optional(),
    thumbnailAtSeconds: finiteNumber.min(0).optional(),
    burnCaptions: z.boolean().optional(),
  })).optional(),
  licenses: z.array(z.object({
    id: z.string().trim().min(1),
    source: z.string().trim().min(1),
    title: z.string().optional(),
    creator: z.string().optional(),
    license: z.string().trim().min(1),
    licenseUrl: z.string().optional(),
    attribution: z.string().optional(),
    proofUrl: z.string().optional(),
  })).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function zodIssues(error: z.ZodError): CreatorValidationIssue[] {
  return error.issues.map((issue) => ({
    level: "error",
    code: "SCHEMA_INVALID",
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function semanticIssues(manifest: CreatorManifest): CreatorValidationIssue[] {
  const issues: CreatorValidationIssue[] = [];
  const ids = new Set<string>();
  const licenseIds = new Set<string>();
  for (const [index, asset] of (manifest.licenses ?? []).entries()) {
    if (licenseIds.has(asset.id)) issues.push({ level: "error", code: "DUPLICATE_LICENSE_ID", path: `licenses.${index}.id`, message: `Duplicate license id '${asset.id}'.` });
    licenseIds.add(asset.id);
  }
  for (const [index, clip] of manifest.clips.entries()) {
    if (ids.has(clip.id)) issues.push({ level: "error", code: "DUPLICATE_ID", path: `clips.${index}.id`, message: `Duplicate clip id '${clip.id}'.` });
    ids.add(clip.id);
    if (clip.trimEndSeconds !== undefined && clip.trimEndSeconds <= (clip.trimStartSeconds ?? 0)) {
      issues.push({ level: "error", code: "INVALID_TRIM", path: `clips.${index}`, message: `Clip '${clip.id}' must end after its trim start.` });
    }
    if (clip.kind === "image" && !clip.durationSeconds) {
      issues.push({ level: "error", code: "IMAGE_DURATION_REQUIRED", path: `clips.${index}.durationSeconds`, message: `Image clip '${clip.id}' needs durationSeconds.` });
    }
  }
  for (const [index, overlay] of (manifest.overlays ?? []).entries()) {
    if (overlay.endSeconds <= overlay.startSeconds) issues.push({ level: "error", code: "INVALID_OVERLAY_RANGE", path: `overlays.${index}`, message: `Overlay '${overlay.id}' must end after it starts.` });
    if ((overlay.type === "image" || overlay.type === "watermark") && !overlay.source) issues.push({ level: "error", code: "OVERLAY_SOURCE_REQUIRED", path: `overlays.${index}.source`, message: `Overlay '${overlay.id}' needs a source image.` });
    if (!["image", "watermark"].includes(overlay.type) && !overlay.text?.trim()) issues.push({ level: "error", code: "OVERLAY_TEXT_REQUIRED", path: `overlays.${index}.text`, message: `Overlay '${overlay.id}' needs text.` });
  }
  const exportIds = new Set<string>();
  for (const [index, output] of (manifest.exports ?? []).entries()) {
    if (exportIds.has(output.id)) issues.push({ level: "error", code: "DUPLICATE_EXPORT_ID", path: `exports.${index}.id`, message: `Duplicate export id '${output.id}'.` });
    exportIds.add(output.id);
  }
  const usedLicensedSources = [
    ...manifest.clips.map((clip) => ({ source: clip.source, licenseId: clip.licenseId })),
    ...(manifest.brand?.logo ? [{ source: manifest.brand.logo, licenseId: manifest.brand.logoLicenseId }] : []),
    ...(manifest.overlays ?? []).filter((item) => item.source).map((item) => ({ source: item.source!, licenseId: item.licenseId })),
    ...(manifest.audio?.voice ? [manifest.audio.voice] : []),
    ...(manifest.audio?.music ? [manifest.audio.music] : []),
  ];
  for (const asset of usedLicensedSources) {
    if (!asset.licenseId) issues.push({ level: "info", code: "ASSET_LICENSE_UNDECLARED", message: `No license metadata is declared for '${asset.source}'. Confirm that you own or may use it.` });
    else if (!licenseIds.has(asset.licenseId)) issues.push({ level: "warning", code: "LICENSE_REFERENCE_MISSING", message: `'${asset.source}' references unknown license entry '${asset.licenseId}'.` });
  }
  return issues;
}

export function validateCreatorManifest(value: unknown): CreatorValidationResult {
  const parsed = creatorManifestSchema.safeParse(value);
  if (!parsed.success) return { valid: false, issues: zodIssues(parsed.error) };
  const manifest = parsed.data as CreatorManifest;
  if (!manifest.exports?.length) {
    manifest.exports = [{ id: "youtube", preset: "youtube-1080p" }];
  }
  const issues = semanticIssues(manifest);
  return { valid: !issues.some((issue) => issue.level === "error"), manifest, issues };
}

export function parseCreatorManifest(value: unknown): CreatorManifest {
  const validation = validateCreatorManifest(value);
  if (!validation.valid || !validation.manifest) {
    throw new AgentDemoError(
      "INVALID_CREATOR_MANIFEST",
      validation.issues.filter((issue) => issue.level === "error").map((issue) => `${issue.path ? `${issue.path}: ` : ""}${issue.message}`).join("\n"),
    );
  }
  return validation.manifest;
}

export async function loadCreatorManifest(filePath: string): Promise<CreatorManifest> {
  const absolutePath = path.resolve(filePath);
  return parseCreatorManifest(JSON.parse(await readFile(absolutePath, "utf8")) as unknown);
}
