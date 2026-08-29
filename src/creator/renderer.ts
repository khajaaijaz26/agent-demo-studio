import path from "node:path";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { ffmpegCommand, pathExists } from "../config.js";
import { AgentDemoError } from "../errors.js";
import { runCommand } from "../utils/process.js";
import { slugify } from "../utils/text.js";
import { loadCaptions, serializeAss, serializeSrt } from "./captions.js";
import { resolveBundledCreatorAsset } from "./assets.js";
import { renderOverlayAssets, type TimedVisualAsset } from "./design.js";
import { writeLicenseReport } from "./licensing.js";
import { probeMediaInfo } from "./media.js";
import { getCreatorPreset } from "./presets.js";
import { loadCreatorManifest, parseCreatorManifest } from "./schema.js";
import { validateSocialOutput } from "./social.js";
import {
  CREATOR_SCHEMA_VERSION,
  type CreatorAudioTrack,
  type CreatorClip,
  type CreatorExport,
  type CreatorManifest,
  type CreatorPreset,
  type CreatorRenderResult,
  type CreatorRenderedOutput,
  type CreatorTransition,
  type CreatorValidationIssue,
  type CreatorVfxPreset,
  type TransitionType,
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

let filterComplexFileOptionPromise: Promise<string> | undefined;

export function filterComplexFileOptionForVersion(versionText: string): "-filter_complex_script" | "-/filter_complex" {
  const match = versionText.match(/ffmpeg version\s+(?:n-)?(\d+)/i);
  return match && Number(match[1]) < 7 ? "-filter_complex_script" : "-/filter_complex";
}

async function filterComplexFileOption(): Promise<string> {
  filterComplexFileOptionPromise ??= runCommand(ffmpegCommand(), ["-hide_banner", "-version"], { timeoutMs: 30_000 })
    .then((result) => {
      // FFmpeg 7 replaced the long-standing -filter_complex_script alias with
      // the generic -/filter_complex file-loading syntax. Support both sides of
      // that migration because Ubuntu 24.04 still ships FFmpeg 6.x.
      return filterComplexFileOptionForVersion(`${result.stdout}\n${result.stderr}`);
    });
  return filterComplexFileOptionPromise;
}

function ffNumber(value: number): string {
  return value.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

function resolveFrom(baseDirectory: string, filePath: string): string {
  return resolveBundledCreatorAsset(filePath) ?? (path.isAbsolute(filePath) ? filePath : path.resolve(baseDirectory, filePath));
}

function safeOutputName(value: string): string {
  return slugify(value).slice(0, 80);
}

function isImageSource(clip: CreatorClip): boolean {
  if (clip.kind) return clip.kind === "image";
  return /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(clip.source);
}

async function prepareVisualSource(source: string, clip: CreatorClip, index: number, preset: CreatorPreset, outputDirectory: string): Promise<string> {
  if (path.extname(source).toLowerCase() !== ".svg") return source;
  const rasterPath = path.join(outputDirectory, `${String(index + 1).padStart(3, "0")}-${safeOutputName(clip.id)}-source.png`);
  try {
    // FFmpeg SVG support varies by distribution. Rasterize vectors with the
    // bundled Sharp dependency so the same project renders on Windows, macOS,
    // and Linux while keeping dimensions bounded to the selected export.
    await sharp(source, { limitInputPixels: 100_000_000 })
      .resize({ width: preset.width, height: preset.height, fit: "inside" })
      .png({ compressionLevel: 9 })
      .toFile(rasterPath);
    return rasterPath;
  } catch (error) {
    throw new AgentDemoError("SVG_RASTERIZE_FAILED", `Could not prepare SVG clip '${clip.id}': ${error instanceof Error ? error.message : String(error)}`);
  }
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
    "fade-black": "fadeblack",
    "fade-white": "fadewhite",
    "zoom-in": "zoomin",
    "squeeze-horizontal": "squeezeh",
    "squeeze-vertical": "squeezev",
    diagonal: "diagbr",
    blur: "hblur",
    "reveal-left": "revealleft",
    "reveal-right": "revealright",
    "reveal-up": "revealup",
    "reveal-down": "revealdown",
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

function imageMotionFilter(clip: CreatorClip, preset: CreatorPreset, duration: number): string | undefined {
  const motion = clip.motion ?? "none";
  if (motion === "none") return undefined;
  const frames = Math.max(2, Math.round(duration * preset.fps));
  const zoomStep = 0.12 / frames;
  const common = `d=1:s=${preset.width}x${preset.height}:fps=${preset.fps}`;
  if (motion === "ken-burns-in") return `zoompan=z='min(max(zoom,pzoom)+${ffNumber(zoomStep)},1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':${common}`;
  if (motion === "ken-burns-out") return `zoompan=z='max(1.001,1.12-on*${ffNumber(zoomStep)})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':${common}`;
  const progress = `min(on/${frames},1)`;
  if (motion === "pan-left") return `zoompan=z=1.12:x='(iw-iw/zoom)*(1-${progress})':y='ih/2-(ih/zoom/2)':${common}`;
  if (motion === "pan-right") return `zoompan=z=1.12:x='(iw-iw/zoom)*${progress}':y='ih/2-(ih/zoom/2)':${common}`;
  if (motion === "pan-up") return `zoompan=z=1.12:x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-${progress})':${common}`;
  return `zoompan=z=1.12:x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*${progress}':${common}`;
}

function vfxFilters(presets: CreatorVfxPreset[] | undefined): string[] {
  return (presets ?? []).flatMap((preset): string[] => {
    switch (preset) {
      case "cinematic": return ["eq=contrast=1.08:saturation=0.94:brightness=-0.01", "vignette=PI/5"];
      case "glow": return ["eq=gamma=1.05:saturation=1.12", "unsharp=5:5:0.55:5:5:0"];
      case "neon": return ["eq=contrast=1.16:saturation=1.42:gamma=1.03", "unsharp=5:5:0.8:5:5:0"];
      case "glitch": return ["rgbashift=rh=5:bh=-5:edge=smear", "noise=alls=5:allf=t+u"];
      case "vhs": return ["rgbashift=rh=2:bh=-2:edge=smear", "noise=alls=8:allf=t+u", "eq=contrast=1.05:saturation=0.84"];
      case "dream": return ["gblur=sigma=0.7", "eq=gamma=1.08:saturation=1.1"];
      case "vintage": return ["colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131"];
      case "noir": return ["hue=s=0", "eq=contrast=1.24:brightness=-0.02", "vignette=PI/5"];
      case "comic": return ["eq=contrast=1.2:saturation=1.38", "unsharp=7:7:1.1:7:7:0", "noise=alls=2:allf=u"];
      case "asmr-soft": return ["gblur=sigma=0.25", "eq=gamma=1.05:saturation=0.9", "vignette=PI/7"];
    }
  });
}

async function renderClipSegment(clip: CreatorClip, index: number, preset: CreatorPreset, baseDirectory: string, outputDirectory: string): Promise<SegmentResult> {
  const resolvedSource = resolveFrom(baseDirectory, clip.source);
  if (!(await pathExists(resolvedSource))) throw new AgentDemoError("CLIP_MISSING", `Clip '${clip.id}' is missing: ${resolvedSource}`);
  await mkdir(outputDirectory, { recursive: true });
  const source = await prepareVisualSource(resolvedSource, clip, index, preset, outputDirectory);
  const image = isImageSource(clip);
  const probe = await probeMediaInfo(source);
  if (!probe.hasVideo) throw new AgentDemoError("VIDEO_STREAM_REQUIRED", `Clip '${clip.id}' has no visual stream.`);
  const trimStart = image ? 0 : Math.max(0, Math.min(clip.trimStartSeconds ?? 0, Math.max(0, probe.durationSeconds - 0.02)));
  const trimEnd = image ? (clip.durationSeconds ?? 3) : Math.max(trimStart + 0.02, Math.min(clip.trimEndSeconds ?? probe.durationSeconds, probe.durationSeconds));
  const rawDuration = Math.max(0.02, image ? (clip.durationSeconds ?? 3) : trimEnd - trimStart);
  const outputPath = path.join(outputDirectory, `${String(index + 1).padStart(3, "0")}-${safeOutputName(clip.id)}.mp4`);
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
  let visualInput = "reframed";
  const motion = image ? imageMotionFilter(clip, preset, duration) : undefined;
  if (motion) {
    filters.push(`[reframed]${motion}[motion]`);
    visualInput = "motion";
  }
  const visual: string[] = [`fps=${preset.fps}`];
  if (effects && [effects.brightness, effects.contrast, effects.saturation, effects.gamma].some((value) => value !== undefined)) {
    visual.push(`eq=brightness=${ffNumber(effects.brightness ?? 0)}:contrast=${ffNumber(effects.contrast ?? 1)}:saturation=${ffNumber(effects.saturation ?? 1)}:gamma=${ffNumber(effects.gamma ?? 1)}`);
  }
  if ((effects?.blur ?? 0) > 0) visual.push(`gblur=sigma=${ffNumber(effects!.blur!)}`);
  if ((effects?.sharpen ?? 0) > 0) visual.push(`unsharp=5:5:${ffNumber(effects!.sharpen!)}:5:5:0`);
  if (effects?.vignette) visual.push("vignette=PI/5");
  visual.push(...vfxFilters(effects?.vfx));
  if (freeze > 0) visual.push(`tpad=stop_mode=clone:stop_duration=${ffNumber(freeze)}`);
  if ((effects?.fadeInSeconds ?? 0) > 0) visual.push(`fade=t=in:st=0:d=${ffNumber(Math.min(duration, effects!.fadeInSeconds!))}`);
  if ((effects?.fadeOutSeconds ?? 0) > 0) {
    const fade = Math.min(duration, effects!.fadeOutSeconds!);
    visual.push(`fade=t=out:st=${ffNumber(Math.max(0, duration - fade))}:d=${ffNumber(fade)}`);
  }
  visual.push(`trim=duration=${ffNumber(duration)}`, "setpts=PTS-STARTPTS", "format=yuv420p");
  filters.push(`[${visualInput}]${visual.join(",")}[vout]`);
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
  if ((track.pan ?? 0) !== 0) parts.push(`stereotools=balance_out=${ffNumber(track.pan!)},`);
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

function visualAssetPosition(asset: TimedVisualAsset, preset: CreatorPreset): { x: string; y: string; enterDuration: number; exitDuration: number } {
  const animation = asset.animation;
  const totalDuration = Math.max(0.05, asset.endSeconds - asset.startSeconds);
  const enterDuration = Math.min(totalDuration / 2, animation?.durationSeconds ?? 0.45);
  const exitDuration = Math.min(totalDuration / 2, animation?.exitDurationSeconds ?? animation?.durationSeconds ?? 0.4);
  const intensity = animation?.intensity ?? 1;
  const enterProgress = `clip((t-${ffNumber(asset.startSeconds)})/${ffNumber(enterDuration)},0,1)`;
  const exitStart = Math.max(asset.startSeconds, asset.endSeconds - exitDuration);
  const exitProgress = `clip((t-${ffNumber(exitStart)})/${ffNumber(exitDuration)},0,1)`;
  const xParts = [`${asset.x}+((${asset.width}-overlay_w)/2)`];
  const yParts = [`${asset.y}+((${asset.height}-overlay_h)/2)`];
  const enter = animation?.enter ?? "none";
  const exit = animation?.exit ?? "none";

  if (enter === "slide-left") xParts.push(`-${preset.width}*(1-${enterProgress})`);
  if (enter === "slide-right") xParts.push(`${preset.width}*(1-${enterProgress})`);
  if (enter === "slide-up") yParts.push(`-${preset.height}*(1-${enterProgress})`);
  if (enter === "slide-down") yParts.push(`${preset.height}*(1-${enterProgress})`);
  if (enter === "rise") yParts.push(`${ffNumber(72 * intensity)}*(1-${enterProgress})`);
  if (enter === "drop") yParts.push(`-${ffNumber(72 * intensity)}*(1-${enterProgress})`);
  if (enter === "pop") yParts.push(`-${ffNumber(34 * intensity)}*sin(PI*${enterProgress})`);

  const localTime = `(t-${ffNumber(asset.startSeconds)})`;
  const amplitude = ffNumber(12 * intensity);
  switch (animation?.loop ?? "none") {
    case "float": yParts.push(`${amplitude}*sin(2*PI*${localTime}/2.8)`); break;
    case "bounce": yParts.push(`-${ffNumber(16 * intensity)}*abs(sin(2*PI*${localTime}/1.6))`); break;
    case "drift":
      xParts.push(`${amplitude}*sin(2*PI*${localTime}/3.8)`);
      yParts.push(`${ffNumber(7 * intensity)}*cos(2*PI*${localTime}/3.1)`);
      break;
    case "shake":
      xParts.push(`${ffNumber(5 * intensity)}*sin(2*PI*${localTime}*8)`);
      yParts.push(`${ffNumber(3 * intensity)}*cos(2*PI*${localTime}*11)`);
      break;
    case "pulse":
      xParts.push(`${ffNumber(3 * intensity)}*sin(2*PI*${localTime}/1.2)`);
      yParts.push(`${ffNumber(3 * intensity)}*cos(2*PI*${localTime}/1.2)`);
      break;
    case "talk":
      xParts.push(`${ffNumber(1.5 * intensity)}*sin(2*PI*${localTime}*1.4)`);
      yParts.push(`-${ffNumber(4 * intensity)}*abs(sin(2*PI*${localTime}*1.4))`);
      break;
  }

  if (exit === "slide-left") xParts.push(`-${preset.width}*${exitProgress}`);
  if (exit === "slide-right") xParts.push(`${preset.width}*${exitProgress}`);
  if (exit === "slide-up") yParts.push(`-${preset.height}*${exitProgress}`);
  if (exit === "slide-down") yParts.push(`${preset.height}*${exitProgress}`);
  if (exit === "rise") yParts.push(`-${ffNumber(72 * intensity)}*${exitProgress}`);
  if (exit === "drop") yParts.push(`${ffNumber(72 * intensity)}*${exitProgress}`);
  if (exit === "pop") yParts.push(`${ffNumber(34 * intensity)}*sin(PI*${exitProgress})`);
  return { x: xParts.join("+"), y: yParts.join("+"), enterDuration, exitDuration };
}

async function finalComposite(input: {
  timelinePath: string;
  outputPath: string;
  exportConfig: CreatorExport;
  preset: CreatorPreset;
  manifest: CreatorManifest;
  duration: number;
  rasterAssets: TimedVisualAsset[];
  captionsAssPath?: string;
  baseDirectory: string;
}): Promise<void> {
  const args = ["-y", "-i", input.timelinePath];
  const filters: string[] = [];
  let nextInput = 1;
  const rasterInputs: number[] = [];
  for (const asset of input.rasterAssets) {
    rasterInputs.push(nextInput++);
    if (asset.kind === "raster") args.push("-loop", "1", "-framerate", String(input.preset.fps));
    else if (asset.loop !== false) args.push("-stream_loop", "-1");
    args.push("-i", asset.path);
  }
  const audioConfig = input.manifest.audio;
  const addAudioInput = (track: CreatorAudioTrack, loopDefault: boolean): number => {
    const index = nextInput++;
    if (track.loop ?? loopDefault) args.push("-stream_loop", "-1");
    args.push("-i", resolveFrom(input.baseDirectory, track.source));
    return index;
  };
  const voiceTracks = [audioConfig?.voice, ...(audioConfig?.voices ?? [])].filter((track): track is CreatorAudioTrack => Boolean(track));
  const voiceInputs = voiceTracks.map((track) => ({ track, index: addAudioInput(track, false) }));
  const musicInput = audioConfig?.music ? { track: audioConfig.music, index: addAudioInput(audioConfig.music, true) } : undefined;
  const ambienceInput = audioConfig?.ambience ? { track: audioConfig.ambience, index: addAudioInput(audioConfig.ambience, true) } : undefined;
  const soundEffectInputs = (audioConfig?.soundEffects ?? []).map((track) => ({ track, index: addAudioInput(track, false) }));
  filters.push("[0:v]setpts=PTS-STARTPTS[vbase]");
  let video = "vbase";
  input.rasterAssets.forEach((asset, index) => {
    const prepared = `overlay${index}`;
    const output = `vover${index}`;
    const duration = Math.max(0.05, asset.endSeconds - asset.startSeconds);
    const assetFilters = [`trim=duration=${ffNumber(duration)}`, `setpts=PTS-STARTPTS+${ffNumber(asset.startSeconds)}/TB`];
    if (asset.chromaKey) assetFilters.push(`chromakey=${(asset.chromaKey.color ?? "#00FF00").replace("#", "0x")}:${ffNumber(asset.chromaKey.similarity ?? 0.18)}:${ffNumber(asset.chromaKey.blend ?? 0.08)}`);
    assetFilters.push(`scale=${asset.width}:${asset.height}:force_original_aspect_ratio=decrease:flags=lanczos`, "format=rgba");
    if (asset.flipHorizontal) assetFilters.push("hflip");
    if (asset.opacity < 1) assetFilters.push(`colorchannelmixer=aa=${ffNumber(asset.opacity)}`);
    const position = visualAssetPosition(asset, input.preset);
    if ((asset.animation?.enter ?? "none") !== "none") assetFilters.push(`fade=t=in:st=${ffNumber(asset.startSeconds)}:d=${ffNumber(position.enterDuration)}:alpha=1`);
    if ((asset.animation?.exit ?? "none") !== "none") assetFilters.push(`fade=t=out:st=${ffNumber(Math.max(asset.startSeconds, asset.endSeconds - position.exitDuration))}:d=${ffNumber(position.exitDuration)}:alpha=1`);
    filters.push(
      `[${rasterInputs[index]}:v]${assetFilters.join(",")}[${prepared}]`,
      `[${video}][${prepared}]overlay=x='${position.x}':y='${position.y}':eval=frame:eof_action=pass:enable='between(t,${ffNumber(asset.startSeconds)},${ffNumber(asset.endSeconds)})'[${output}]`,
    );
    video = output;
  });
  if (input.captionsAssPath) {
    filters.push(`[${video}]subtitles=filename='${filterPath(input.captionsAssPath)}'[vcaptions]`);
    video = "vcaptions";
  }
  filters.push(`[${video}]fps=${input.preset.fps},scale=${input.preset.width}:${input.preset.height}:flags=lanczos,format=yuv420p[vout]`);

  const speechSources: string[] = [];
  if (audioConfig?.keepClipAudio !== false) {
    filters.push(`[0:a]aresample=48000,aformat=channel_layouts=stereo,volume=${ffNumber(audioConfig?.clipVolume ?? 1)},apad,atrim=duration=${ffNumber(input.duration)}[clipaudio]`);
    speechSources.push("clipaudio");
  }
  voiceInputs.forEach(({ track, index }, voiceIndex) => {
    const label = `voiceaudio${voiceIndex}`;
    filters.push(trackFilter(track, index, input.duration, label));
    speechSources.push(label);
  });
  let speech: string | undefined;
  if (speechSources.length > 1) {
    filters.push(`${speechSources.map((label) => `[${label}]`).join("")}amix=inputs=${speechSources.length}:duration=longest:dropout_transition=1[speech]`);
    speech = "speech";
  } else speech = speechSources[0];
  const backgroundSources: string[] = [];
  if (musicInput) {
    filters.push(trackFilter(musicInput.track, musicInput.index, input.duration, "music"));
    backgroundSources.push("music");
  }
  if (ambienceInput) {
    filters.push(trackFilter(ambienceInput.track, ambienceInput.index, input.duration, "ambience"));
    backgroundSources.push("ambience");
  }
  let background: string | undefined;
  if (backgroundSources.length > 1) {
    filters.push(`${backgroundSources.map((label) => `[${label}]`).join("")}amix=inputs=${backgroundSources.length}:duration=longest:dropout_transition=2[background]`);
    background = "background";
  } else background = backgroundSources[0];
  let mixed: string;
  if (background) {
    if (speech && audioConfig?.duckMusic !== false) {
      filters.push(
        `[${speech}]asplit=2[speechmix][speechside]`,
        `[${background}][speechside]sidechaincompress=threshold=${ffNumber(audioConfig?.duckingThreshold ?? 0.04)}:ratio=8:attack=15:release=350[ducked]`,
        `[speechmix][ducked]amix=inputs=2:duration=longest:dropout_transition=2[mixed]`,
      );
      mixed = "mixed";
    } else if (speech) {
      filters.push(`[${speech}][${background}]amix=inputs=2:duration=longest:dropout_transition=2[mixed]`);
      mixed = "mixed";
    } else mixed = background;
  } else if (speech) mixed = speech;
  else {
    filters.push(`[0:a]volume=0,apad,atrim=duration=${ffNumber(input.duration)}[silent]`);
    mixed = "silent";
  }
  if (soundEffectInputs.length) {
    const soundLabels: string[] = [];
    soundEffectInputs.forEach(({ track, index }, soundIndex) => {
      const label = `soundeffect${soundIndex}`;
      filters.push(trackFilter(track, index, input.duration, label));
      soundLabels.push(label);
    });
    filters.push(`[${mixed}]${soundLabels.map((label) => `[${label}]`).join("")}amix=inputs=${soundLabels.length + 1}:duration=longest:dropout_transition=1[withsfx]`);
    mixed = "withsfx";
  }
  const audioTone = audioConfig?.mode === "asmr"
    ? "highpass=f=28,lowpass=f=18500,"
    : audioConfig?.mode === "voice"
      ? "highpass=f=55,lowpass=f=16500,"
      : "";
  const defaultLufs = audioConfig?.mode === "asmr" ? -20 : audioConfig?.mode === "voice" ? -16 : -14;
  const truePeak = audioConfig?.truePeak ?? -1.5;
  // Lossy AAC encoding can introduce small inter-sample overshoots. Leave a
  // half-decibel codec margin so the decoded delivery file still respects the
  // requested true-peak ceiling.
  const limiterCeiling = Math.pow(10, (truePeak - 0.5) / 20);
  filters.push(`[${mixed}]atrim=duration=${ffNumber(input.duration)},${audioTone}loudnorm=I=${ffNumber(audioConfig?.targetLufs ?? defaultLufs)}:LRA=9:TP=${ffNumber(truePeak)},alimiter=limit=${ffNumber(limiterCeiling)}:attack=5:release=50:level=false[aout]`);
  const codec = input.exportConfig.videoCodec === "hevc" ? "libx265" : "libx264";
  // Rich timelines can contain dozens of animated overlays and audio layers.
  // Passing that graph inline exceeds Windows' command-line limit long before
  // FFmpeg reaches its own filter parser, so keep the graph in a UTF-8 script.
  const filterScriptPath = path.join(path.dirname(input.timelinePath), `${safeOutputName(input.exportConfig.id)}-final-composite.filter`);
  await writeFile(filterScriptPath, filters.join(";"), "utf8");
  args.push(
    await filterComplexFileOption(), filterScriptPath, "-map", "[vout]", "-map", "[aout]", "-t", ffNumber(input.duration),
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
    schemaVersion: CREATOR_SCHEMA_VERSION,
    title: options.title ?? path.parse(source).name,
    outputDirectory: options.outputDirectory ?? "creator-output",
    clips: [{ id: "source", source: absoluteSource, reframe: "blur-background" }],
    captions: options.captionsPath ? { source: path.resolve(options.captionsPath), burn: true, sidecar: true } : undefined,
    audio: { keepClipAudio: true, music: options.musicPath ? { source: path.resolve(options.musicPath), loop: true, volume: 0.12 } : undefined, duckMusic: true },
    exports: presets.map((preset, index) => ({ id: `${preset}-${index + 1}`, preset })),
  };
  return renderCreatorManifest(manifest, report, { baseDirectory: options.baseDirectory });
}
