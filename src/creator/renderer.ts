import path from "node:path";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { ffmpegCommand, pathExists } from "../config.js";
import { AgentDemoError } from "../errors.js";
import { runCommand } from "../utils/process.js";
import { slugify } from "../utils/text.js";
import { loadCaptions, serializeAss, serializeSrt } from "./captions.js";
import { renderOverlayAssets, type TimedRasterAsset } from "./design.js";
import { writeLicenseReport } from "./licensing.js";
import { probeMediaInfo } from "./media.js";
import { getCreatorPreset } from "./presets.js";
import { loadCreatorManifest, parseCreatorManifest } from "./schema.js";
import { validateSocialOutput } from "./social.js";
import type {
  CreatorAudioTrack,
  CreatorClip,
  CreatorExport,
  CreatorManifest,
  CreatorPreset,
  CreatorRenderResult,
  CreatorRenderedOutput,
  CreatorTransition,
  CreatorValidationIssue,
  TransitionType,
} from "./types.js";

type ProgressReporter = (progress: number, message: string) => void;

export interface CreatorRenderOptions {
  baseDirectory?: string;
  keepWork?: boolean;
}

interface SegmentResult {
  clip: CreatorClip;
  path: string;
  durationSeconds: number;
}

function ffNumber(value: number): string {
  return value.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

function resolveFrom(baseDirectory: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDirectory, filePath);
}

function safeOutputName(value: string): string {
  return slugify(value).slice(0, 80);
}

function isImageSource(clip: CreatorClip): boolean {
  if (clip.kind) return clip.kind === "image";
  return /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(clip.source);
}

function atempoFilters(speed: number): string[] {
  const filters: string[] = [];
  let remaining = speed;
  while (remaining < 0.5 - 0.0001) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  while (remaining > 2 + 0.0001) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  filters.push(`atempo=${ffNumber(remaining)}`);
  return filters;
}

function transitionName(type: TransitionType): string {
  const names: Record<TransitionType, string> = {
    cut: "fade",
    fade: "fade",
    dissolve: "dissolve",
    "wipe-left": "wipeleft",
    "wipe-right": "wiperight",
    "wipe-up": "wipeup",
    "wipe-down": "wipedown",
    "slide-left": "slideleft",
    "slide-right": "slideright",
    "slide-up": "slideup",
    "slide-down": "slidedown",
    "smooth-left": "smoothleft",
    "smooth-right": "smoothright",
    "circle-open": "circleopen",
    "circle-close": "circleclose",
    radial: "radial",
    pixelize: "pixelize",
  };
  return names[type];
}

function videoReframeFilters(input: string, output: string, preset: CreatorPreset, clip: CreatorClip, filters: string[]): void {
  const width = preset.width;
  const height = preset.height;
  const focusX = clip.focusX ?? 0.5;
  const focusY = clip.focusY ?? 0.5;
  if ((clip.reframe ?? "fit") === "blur-background") {
    filters.push(
      `[${input}]split=2[${output}bgsource][${output}fgsource]`,
      `[${output}bgsource]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}:(iw-ow)*${ffNumber(focusX)}:(ih-oh)*${ffNumber(focusY)},gblur=sigma=28[${output}bg]`,
      `[${output}fgsource]scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos[${output}fg]`,
      `[${output}bg][${output}fg]overlay=(W-w)/2:(H-h)/2[${output}]`,
    );
    return;
  }
  if (clip.reframe === "fill") {
    filters.push(`[${input}]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}:(iw-ow)*${ffNumber(focusX)}:(ih-oh)*${ffNumber(focusY)}[${output}]`);
    return;
  }
  filters.push(`[${input}]scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x070A15[${output}]`);
}

function timedSourceFilters(clip: CreatorClip, rawDuration: number, audioIndex: number, filters: string[]): { video: string; audio: string; duration: number } {
  if (clip.speedRamp) {
    const steps = clip.speedRamp.steps ?? 8;
    const videoInputs = Array.from({ length: steps }, (_, index) => `[rvi${index}]`).join("");
    const audioInputs = Array.from({ length: steps }, (_, index) => `[rai${index}]`).join("");
    filters.push(`[0:v]split=${steps}${videoInputs}`, `[${audioIndex}:a]asplit=${steps}${audioInputs}`);
    const concatInputs: string[] = [];
    let duration = 0;
    for (let index = 0; index < steps; index += 1) {
      const start = rawDuration * index / steps;
      const end = rawDuration * (index + 1) / steps;
      const progress = (index + 0.5) / steps;
      const speed = clip.speedRamp.from + (clip.speedRamp.to - clip.speedRamp.from) * progress;
      duration += (end - start) / speed;
      filters.push(
        `[rvi${index}]trim=start=${ffNumber(start)}:end=${ffNumber(end)},setpts=(PTS-STARTPTS)/${ffNumber(speed)}[rvo${index}]`,
        `[rai${index}]atrim=start=${ffNumber(start)}:end=${ffNumber(end)},asetpts=PTS-STARTPTS,${atempoFilters(speed).join(",")}[rao${index}]`,
      );
      concatInputs.push(`[rvo${index}][rao${index}]`);
    }
    filters.push(`${concatInputs.join("")}concat=n=${steps}:v=1:a=1[timedv][timeda]`);
    return { video: "timedv", audio: "timeda", duration };
  }
  const speed = clip.speed ?? 1;
  filters.push(
    `[0:v]setpts=(PTS-STARTPTS)/${ffNumber(speed)}[timedv]`,
    `[${audioIndex}:a]asetpts=PTS-STARTPTS,${atempoFilters(speed).join(",")}[timeda]`,
  );
  return { video: "timedv", audio: "timeda", duration: rawDuration / speed };
}

async function renderClipSegment(clip: CreatorClip, index: number, preset: CreatorPreset, baseDirectory: string, outputDirectory: string): Promise<SegmentResult> {
  const source = resolveFrom(baseDirectory, clip.source);
  if (!(await pathExists(source))) throw new AgentDemoError("CLIP_MISSING", `Clip '${clip.id}' is missing: ${source}`);
  const image = isImageSource(clip);
  const probe = await probeMediaInfo(source);
  if (!probe.hasVideo) throw new AgentDemoError("VIDEO_STREAM_REQUIRED", `Clip '${clip.id}' has no visual stream.`);
  const trimStart = image ? 0 : Math.max(0, Math.min(clip.trimStartSeconds ?? 0, Math.max(0, probe.durationSeconds - 0.02)));
  const trimEnd = image ? (clip.durationSeconds ?? 3) : Math.max(trimStart + 0.02, Math.min(clip.trimEndSeconds ?? probe.durationSeconds, probe.durationSeconds));
  const rawDuration = Math.max(0.02, image ? (clip.durationSeconds ?? 3) : trimEnd - trimStart);
  const outputPath = path.join(outputDirectory, `${String(index + 1).padStart(3, "0")}-${safeOutputName(clip.id)}.mp4`);
  await mkdir(outputDirectory, { recursive: true });
  const args = ["-y"];
  if (image) args.push("-loop", "1", "-framerate", String(preset.fps), "-t", ffNumber(rawDuration), "-i", source);
  else args.push("-ss", ffNumber(trimStart), "-t", ffNumber(rawDuration), "-i", source);
  let audioIndex = 0;
  if (!probe.hasAudio || image) {
    audioIndex = 1;
    args.push("-f", "lavfi", "-t", ffNumber(rawDuration), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  }
  const filters: string[] = [];
  const timed = timedSourceFilters(clip, rawDuration, audioIndex, filters);
  videoReframeFilters(timed.video, "reframed", preset, clip, filters);
  const freeze = clip.freezeAfterSeconds ?? 0;
  const duration = timed.duration + freeze;
  const effects = clip.effects;
  const visual: string[] = [`fps=${preset.fps}`];
  if (effects && [effects.brightness, effects.contrast, effects.saturation, effects.gamma].some((value) => value !== undefined)) {
    visual.push(`eq=brightness=${ffNumber(effects.brightness ?? 0)}:contrast=${ffNumber(effects.contrast ?? 1)}:saturation=${ffNumber(effects.saturation ?? 1)}:gamma=${ffNumber(effects.gamma ?? 1)}`);
  }
  if ((effects?.blur ?? 0) > 0) visual.push(`gblur=sigma=${ffNumber(effects!.blur!)}`);
  if ((effects?.sharpen ?? 0) > 0) visual.push(`unsharp=5:5:${ffNumber(effects!.sharpen!)}:5:5:0`);
  if (effects?.vignette) visual.push("vignette=PI/5");
  if (freeze > 0) visual.push(`tpad=stop_mode=clone:stop_duration=${ffNumber(freeze)}`);
  if ((effects?.fadeInSeconds ?? 0) > 0) visual.push(`fade=t=in:st=0:d=${ffNumber(Math.min(duration, effects!.fadeInSeconds!))}`);
  if ((effects?.fadeOutSeconds ?? 0) > 0) {
    const fade = Math.min(duration, effects!.fadeOutSeconds!);
    visual.push(`fade=t=out:st=${ffNumber(Math.max(0, duration - fade))}:d=${ffNumber(fade)}`);
  }
  visual.push(`trim=duration=${ffNumber(duration)}`, "setpts=PTS-STARTPTS", "format=yuv420p");
  filters.push(`[reframed]${visual.join(",")}[vout]`);
  const audio: string[] = ["aresample=48000", "aformat=sample_fmts=fltp:channel_layouts=stereo", `volume=${ffNumber(clip.muted ? 0 : clip.volume ?? 1)}`];
  if (freeze > 0) audio.push("apad");
  if ((effects?.fadeInSeconds ?? 0) > 0) audio.push(`afade=t=in:st=0:d=${ffNumber(Math.min(duration, effects!.fadeInSeconds!))}`);
  if ((effects?.fadeOutSeconds ?? 0) > 0) {
    const fade = Math.min(duration, effects!.fadeOutSeconds!);
    audio.push(`afade=t=out:st=${ffNumber(Math.max(0, duration - fade))}:d=${ffNumber(fade)}`);
  }
  audio.push("apad", `atrim=duration=${ffNumber(duration)}`, "asetpts=PTS-STARTPTS");
  filters.push(`[${timed.audio}]${audio.join(",")}[aout]`);
  args.push(
    "-filter_complex", filters.join(";"), "-map", "[vout]", "-map", "[aout]", "-t", ffNumber(duration),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", outputPath,
  );
  const result = await runCommand(ffmpegCommand(), args, { timeoutMs: 30 * 60_000 });
  if (result.code !== 0) throw new AgentDemoError("CLIP_RENDER_FAILED", result.stderr.trim().split("\n").slice(-24).join("\n") || `Could not render clip '${clip.id}'.`);
  const rendered = await probeMediaInfo(outputPath);
  return { clip, path: outputPath, durationSeconds: rendered.durationSeconds || duration };
}

function transitionFor(previous: SegmentResult, current: SegmentResult): { type: TransitionType; duration: number } {
  const transition: CreatorTransition = current.clip.transition ?? { type: "cut" };
  const requested = transition.type === "cut" ? 0.001 : transition.durationSeconds ?? 0.35;
  return { type: transition.type, duration: Math.max(0.001, Math.min(requested, previous.durationSeconds * 0.45, current.durationSeconds * 0.45)) };
}

async function combineSegments(segments: SegmentResult[], preset: CreatorPreset, workDirectory: string): Promise<{ path: string; duration: number; clipStarts: number[] }> {
  if (segments.length === 1) return { path: segments[0]!.path, duration: segments[0]!.durationSeconds, clipStarts: [0] };
  const outputPath = path.join(workDirectory, "timeline.mp4");
  const hasTransitions = segments.slice(1).some((segment) => (segment.clip.transition?.type ?? "cut") !== "cut");
  const clipStarts = [0];
  if (!hasTransitions) {
    const listPath = path.join(workDirectory, "segments.txt");
    const contents = segments.map((segment) => `file '${segment.path.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`).join("\n");
    await writeFile(listPath, `${contents}\n`, "utf8");
    const result = await runCommand(ffmpegCommand(), ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath], { timeoutMs: 30 * 60_000 });
    if (result.code !== 0) throw new AgentDemoError("TIMELINE_CONCAT_FAILED", result.stderr.trim().split("\n").slice(-24).join("\n"));
    let duration = segments[0]!.durationSeconds;
    for (const segment of segments.slice(1)) { clipStarts.push(duration); duration += segment.durationSeconds; }
    return { path: outputPath, duration, clipStarts };
  }
  const args = ["-y"];
  for (const segment of segments) args.push("-i", segment.path);
  const filters: string[] = [];
  segments.forEach((_, index) => filters.push(`[${index}:v]settb=AVTB,setpts=PTS-STARTPTS,fps=${preset.fps}[vin${index}]`, `[${index}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[ain${index}]`));
  let video = "vin0";
  let audio = "ain0";
  let duration = segments[0]!.durationSeconds;
  for (let index = 1; index < segments.length; index += 1) {
    const transition = transitionFor(segments[index - 1]!, segments[index]!);
    const offset = Math.max(0, duration - transition.duration);
    const nextVideo = `vx${index}`;
    const nextAudio = `ax${index}`;
    filters.push(
      `[${video}][vin${index}]xfade=transition=${transitionName(transition.type)}:duration=${ffNumber(transition.duration)}:offset=${ffNumber(offset)}[${nextVideo}]`,
      `[${audio}][ain${index}]acrossfade=d=${ffNumber(transition.duration)}:c1=tri:c2=tri[${nextAudio}]`,
    );
    clipStarts.push(offset);
    duration += segments[index]!.durationSeconds - transition.duration;
    video = nextVideo;
    audio = nextAudio;
  }
  args.push(
    "-filter_complex", filters.join(";"), "-map", `[${video}]`, "-map", `[${audio}]`, "-t", ffNumber(duration),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", outputPath,
  );
  const result = await runCommand(ffmpegCommand(), args, { timeoutMs: 30 * 60_000 });
  if (result.code !== 0) throw new AgentDemoError("TIMELINE_TRANSITION_FAILED", result.stderr.trim().split("\n").slice(-28).join("\n"));
  return { path: outputPath, duration, clipStarts };
}

function trackFilter(track: CreatorAudioTrack, inputIndex: number, duration: number, label: string): string {
  const parts = [`[${inputIndex}:a]`];
  const trim: string[] = [];
  if (track.trimStartSeconds !== undefined) trim.push(`start=${ffNumber(track.trimStartSeconds)}`);
  if (track.trimEndSeconds !== undefined) trim.push(`end=${ffNumber(track.trimEndSeconds)}`);
  if (trim.length) parts.push(`atrim=${trim.join(":")},`);
  parts.push("asetpts=PTS-STARTPTS,");
  const delay = Math.round((track.startSeconds ?? 0) * 1000);
  if (delay) parts.push(`adelay=${delay}|${delay},`);
  parts.push("aresample=48000,aformat=channel_layouts=stereo,", `volume=${ffNumber(track.volume ?? 1)},`);
  if ((track.fadeInSeconds ?? 0) > 0) parts.push(`afade=t=in:st=0:d=${ffNumber(track.fadeInSeconds!)},`);
  if ((track.fadeOutSeconds ?? 0) > 0) {
    const fade = Math.min(duration, track.fadeOutSeconds!);
    parts.push(`afade=t=out:st=${ffNumber(Math.max(0, duration - fade))}:d=${ffNumber(fade)},`);
  }
  parts.push(`apad,atrim=duration=${ffNumber(duration)}[${label}]`);
  return parts.join("");
}

function filterPath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'");
}

async function finalComposite(input: {
  timelinePath: string;
  outputPath: string;
  exportConfig: CreatorExport;
  preset: CreatorPreset;
  manifest: CreatorManifest;
  duration: number;
  rasterAssets: TimedRasterAsset[];
  captionsAssPath?: string;
  baseDirectory: string;
}): Promise<void> {
  const args = ["-y", "-i", input.timelinePath];
  const filters: string[] = [];
  let nextInput = 1;
  const rasterInputs: number[] = [];
  for (const asset of input.rasterAssets) {
    rasterInputs.push(nextInput++);
    args.push("-loop", "1", "-framerate", String(input.preset.fps), "-i", asset.path);
  }
  let voiceIndex: number | undefined;
  if (input.manifest.audio?.voice) {
    voiceIndex = nextInput++;
    args.push("-i", resolveFrom(input.baseDirectory, input.manifest.audio.voice.source));
  }
  let musicIndex: number | undefined;
  if (input.manifest.audio?.music) {
    musicIndex = nextInput++;
    if (input.manifest.audio.music.loop !== false) args.push("-stream_loop", "-1");
    args.push("-i", resolveFrom(input.baseDirectory, input.manifest.audio.music.source));
  }
  filters.push("[0:v]setpts=PTS-STARTPTS[vbase]");
  let video = "vbase";
  input.rasterAssets.forEach((asset, index) => {
    const prepared = `overlay${index}`;
    const output = `vover${index}`;
    filters.push(
      `[${rasterInputs[index]}:v]scale=${input.preset.width}:${input.preset.height}:flags=lanczos,format=rgba,setpts=PTS-STARTPTS[${prepared}]`,
      `[${video}][${prepared}]overlay=0:0:eof_action=pass:enable='between(t,${ffNumber(asset.startSeconds)},${ffNumber(asset.endSeconds)})'[${output}]`,
    );
    video = output;
  });
  if (input.captionsAssPath) {
    filters.push(`[${video}]subtitles=filename='${filterPath(input.captionsAssPath)}'[vcaptions]`);
    video = "vcaptions";
  }
  filters.push(`[${video}]fps=${input.preset.fps},scale=${input.preset.width}:${input.preset.height}:flags=lanczos,format=yuv420p[vout]`);

  const audioConfig = input.manifest.audio;
  const speechSources: string[] = [];
  if (audioConfig?.keepClipAudio !== false) {
    filters.push(`[0:a]aresample=48000,aformat=channel_layouts=stereo,volume=${ffNumber(audioConfig?.clipVolume ?? 1)},apad,atrim=duration=${ffNumber(input.duration)}[clipaudio]`);
    speechSources.push("clipaudio");
  }
  if (voiceIndex !== undefined && audioConfig?.voice) {
    filters.push(trackFilter(audioConfig.voice, voiceIndex, input.duration, "voiceaudio"));
    speechSources.push("voiceaudio");
  }
  let speech: string | undefined;
  if (speechSources.length === 2) {
    filters.push(`[${speechSources[0]}][${speechSources[1]}]amix=inputs=2:duration=longest:dropout_transition=1[speech]`);
    speech = "speech";
  } else speech = speechSources[0];
  let mixed: string;
  if (musicIndex !== undefined && audioConfig?.music) {
    filters.push(trackFilter(audioConfig.music, musicIndex, input.duration, "music"));
    if (speech && audioConfig.duckMusic !== false) {
      filters.push(`[music][${speech}]sidechaincompress=threshold=${ffNumber(audioConfig.duckingThreshold ?? 0.04)}:ratio=8:attack=15:release=350[ducked]`, `[${speech}][ducked]amix=inputs=2:duration=longest:dropout_transition=2[mixed]`);
      mixed = "mixed";
    } else if (speech) {
      filters.push(`[${speech}][music]amix=inputs=2:duration=longest:dropout_transition=2[mixed]`);
      mixed = "mixed";
    } else mixed = "music";
  } else if (speech) mixed = speech;
  else {
    filters.push(`[0:a]volume=0,apad,atrim=duration=${ffNumber(input.duration)}[silent]`);
    mixed = "silent";
  }
  filters.push(`[${mixed}]atrim=duration=${ffNumber(input.duration)},loudnorm=I=${ffNumber(audioConfig?.targetLufs ?? -14)}:LRA=9:TP=${ffNumber(audioConfig?.truePeak ?? -1.5)},alimiter=limit=0.95[aout]`);
  const codec = input.exportConfig.videoCodec === "hevc" ? "libx265" : "libx264";
  args.push(
    "-filter_complex", filters.join(";"), "-map", "[vout]", "-map", "[aout]", "-t", ffNumber(input.duration),
    "-c:v", codec, "-preset", "medium", "-crf", String(input.exportConfig.quality ?? 18), "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", input.preset.audioBitrate, "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", "-metadata", `title=${input.exportConfig.title ?? input.manifest.title}`,
    "-metadata", "comment=Created with Agent Demo Studio Creator Engine", input.outputPath,
  );
  const result = await runCommand(ffmpegCommand(), args, { timeoutMs: 60 * 60_000 });
  if (result.code !== 0) throw new AgentDemoError("CREATOR_RENDER_FAILED", result.stderr.trim().split("\n").slice(-32).join("\n") || `Could not render ${input.exportConfig.id}.`);
}

function chaptersFor(manifest: CreatorManifest, segments: SegmentResult[], starts: number[], duration: number): Array<{ title: string; start: number; end: number }> {
  const source = manifest.chapters?.length
    ? manifest.chapters.map((chapter) => ({ title: chapter.title, start: chapter.startSeconds }))
    : segments.flatMap((segment, index) => segment.clip.chapter ? [{ title: segment.clip.chapter, start: starts[index] ?? 0 }] : []);
  const ordered = source
    .map((chapter) => ({ ...chapter, start: Math.max(0, Math.min(duration, chapter.start)) }))
    .filter((chapter) => chapter.start < duration)
    .sort((a, b) => a.start - b.start)
    .filter((chapter, index, all) => index === 0 || chapter.start > all[index - 1]!.start + 0.001);
  return ordered.map((chapter, index, all) => ({ ...chapter, end: Math.max(chapter.start + 0.001, all[index + 1]?.start ?? duration) }));
}

function ffmetadataText(value: string): string {
  return value.replaceAll("\\", "\\\\").replace(/[\r\n]+/g, " ").replace(/([=;#])/g, "\\$1");
}

async function writeChapters(manifest: CreatorManifest, segments: SegmentResult[], starts: number[], duration: number, outputPath: string): Promise<string | undefined> {
  const chapters = chaptersFor(manifest, segments, starts, duration);
  if (!chapters.length) return undefined;
  const content = [";FFMETADATA1", ...chapters.flatMap((chapter) => ["[CHAPTER]", "TIMEBASE=1/1000", `START=${Math.round(chapter.start * 1000)}`, `END=${Math.round(chapter.end * 1000)}`, `title=${ffmetadataText(chapter.title)}`])].join("\n");
  await writeFile(outputPath, `${content}\n`, "utf8");
  return outputPath;
}

async function optimizeThumbnail(sourcePath: string, outputPath: string): Promise<void> {
  const maximumBytes = 2 * 1024 * 1024;
  let maximumDimension = 1_920;
  let quality = 88;
  let encoded = Buffer.alloc(0);
  for (let attempt = 0; attempt < 7; attempt += 1) {
    encoded = await sharp(sourcePath)
      .resize({ width: maximumDimension, height: maximumDimension, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (encoded.length <= maximumBytes) break;
    maximumDimension = Math.max(720, Math.round(maximumDimension * 0.82));
    quality = Math.max(52, quality - 7);
  }
  await writeFile(outputPath, encoded);
}

async function renderOneExport(manifest: CreatorManifest, config: CreatorExport, baseDirectory: string, outputDirectory: string, workRoot: string, report: ProgressReporter, progressStart: number, progressSpan: number): Promise<CreatorRenderedOutput> {
  const preset = getCreatorPreset(config.preset);
  const workDirectory = path.join(workRoot, safeOutputName(config.id));
  const segmentDirectory = path.join(workDirectory, "segments");
  await mkdir(segmentDirectory, { recursive: true });
  const segments: SegmentResult[] = [];
  for (const [index, clip] of manifest.clips.entries()) {
    report(progressStart + progressSpan * 0.48 * (index / Math.max(1, manifest.clips.length)), `${config.id}: preparing ${clip.id}`);
    segments.push(await renderClipSegment(clip, index, preset, baseDirectory, segmentDirectory));
  }
  report(progressStart + progressSpan * 0.52, `${config.id}: transitions and timeline`);
  const timeline = await combineSegments(segments, preset, workDirectory);
  const overlays = [...(manifest.overlays ?? [])];
  if (manifest.brand?.logo && !overlays.some((overlay) => overlay.source === manifest.brand!.logo)) {
    overlays.push({ id: "brand-logo", type: "watermark", source: manifest.brand.logo, startSeconds: 0, endSeconds: timeline.duration, opacity: 0.82, licenseId: manifest.brand.logoLicenseId });
  }
  const rasterAssets = await renderOverlayAssets(overlays, preset, path.join(workDirectory, "overlays"), manifest.brand, (source) => resolveFrom(baseDirectory, source));
  let captionsPath: string | undefined;
  let captionsAssPath: string | undefined;
  if (manifest.captions?.source) {
    const cues = await loadCaptions(resolveFrom(baseDirectory, manifest.captions.source));
    captionsPath = path.join(outputDirectory, `${safeOutputName(config.fileName ?? `${manifest.title}-${config.id}`)}.srt`);
    if (manifest.captions.sidecar !== false) await writeFile(captionsPath, serializeSrt(cues), "utf8");
    else captionsPath = undefined;
    if (config.burnCaptions ?? manifest.captions.burn ?? true) {
      captionsAssPath = path.join(workDirectory, "captions.ass");
      await writeFile(captionsAssPath, serializeAss(cues, preset, manifest.captions.style), "utf8");
    }
  }
  const baseName = safeOutputName(config.fileName ?? `${manifest.title}-${config.id}`);
  const videoPath = path.join(outputDirectory, `${baseName}.mp4`);
  report(progressStart + progressSpan * 0.64, `${config.id}: compositing and audio mix`);
  await finalComposite({ timelinePath: timeline.path, outputPath: videoPath, exportConfig: config, preset, manifest, duration: timeline.duration, rasterAssets, captionsAssPath, baseDirectory });
  const thumbnailPath = path.join(outputDirectory, `${baseName}-thumbnail.jpg`);
  const rawThumbnailPath = path.join(workDirectory, "thumbnail-source.jpg");
  const thumbnailAt = Math.max(0, Math.min(config.thumbnailAtSeconds ?? Math.min(2, timeline.duration * 0.2), Math.max(0, timeline.duration - 0.05)));
  const thumbnail = await runCommand(ffmpegCommand(), ["-y", "-ss", ffNumber(thumbnailAt), "-i", videoPath, "-frames:v", "1", "-q:v", "2", rawThumbnailPath], { timeoutMs: 120_000 });
  if (thumbnail.code !== 0) throw new AgentDemoError("THUMBNAIL_FAILED", thumbnail.stderr.trim().split("\n").slice(-16).join("\n"));
  await optimizeThumbnail(rawThumbnailPath, thumbnailPath);
  const chaptersPath = await writeChapters(manifest, segments, timeline.clipStarts, timeline.duration, path.join(outputDirectory, `${baseName}-chapters.ffmetadata`));
  const probe = await probeMediaInfo(videoPath);
  const fileSizeBytes = (await stat(videoPath)).size;
  const partial = { id: config.id, preset: config.preset, durationSeconds: probe.durationSeconds, width: probe.width ?? preset.width, height: probe.height ?? preset.height, fps: probe.fps ?? preset.fps, fileSizeBytes };
  const validation: CreatorValidationIssue[] = validateSocialOutput(partial);
  return { ...partial, platform: preset.platform, videoPath, thumbnailPath, captionsPath, chaptersPath, validation };
}

export async function renderCreatorManifest(input: string | CreatorManifest, report: ProgressReporter = () => undefined, options: CreatorRenderOptions = {}): Promise<CreatorRenderResult> {
  const manifestPath = typeof input === "string" ? path.resolve(input) : undefined;
  const manifest = typeof input === "string" ? await loadCreatorManifest(manifestPath!) : parseCreatorManifest(input);
  const baseDirectory = path.resolve(options.baseDirectory ?? (manifestPath ? path.dirname(manifestPath) : process.cwd()));
  const outputDirectory = resolveFrom(baseDirectory, manifest.outputDirectory ?? "creator-output");
  const workRoot = path.join(outputDirectory, ".work");
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(workRoot, { recursive: true });
  const outputs: CreatorRenderedOutput[] = [];
  const exportConfigs = manifest.exports!;
  try {
    for (const [index, config] of exportConfigs.entries()) {
      const start = 3 + index / exportConfigs.length * 90;
      const span = 90 / exportConfigs.length;
      outputs.push(await renderOneExport(manifest, config, baseDirectory, outputDirectory, workRoot, report, start, span));
    }
    const licenseReportPath = await writeLicenseReport(manifest, outputDirectory);
    const result: CreatorRenderResult = { title: manifest.title, manifestPath, outputDirectory, outputs, licenseReportPath, createdAt: new Date().toISOString() };
    await writeFile(path.join(outputDirectory, "creator-render-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    report(100, `${outputs.length} creator export${outputs.length === 1 ? "" : "s"} ready`);
    return result;
  } finally {
    if (!options.keepWork) await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function remixMedia(source: string, presets: CreatorExport["preset"][], options: { title?: string; outputDirectory?: string; captionsPath?: string; musicPath?: string; baseDirectory?: string } = {}, report: ProgressReporter = () => undefined): Promise<CreatorRenderResult> {
  const absoluteSource = path.resolve(options.baseDirectory ?? process.cwd(), source);
  const manifest: CreatorManifest = {
    schemaVersion: 1,
    title: options.title ?? path.parse(source).name,
    outputDirectory: options.outputDirectory ?? "creator-output",
    clips: [{ id: "source", source: absoluteSource, reframe: "blur-background" }],
    captions: options.captionsPath ? { source: path.resolve(options.captionsPath), burn: true, sidecar: true } : undefined,
    audio: { keepClipAudio: true, music: options.musicPath ? { source: path.resolve(options.musicPath), loop: true, volume: 0.12 } : undefined, duckMusic: true },
    exports: presets.map((preset, index) => ({ id: `${preset}-${index + 1}`, preset })),
  };
  return renderCreatorManifest(manifest, report, { baseDirectory: options.baseDirectory });
}
