import path from "node:path";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { generateAmbientMusic } from "../audio/music.js";
import { generateNeuralSpeech } from "../audio/neural-tts.js";
import { ffmpegCommand, pathExists } from "../config.js";
import { AgentDemoError } from "../errors.js";
import { runCommand } from "../utils/process.js";
import { probeDuration } from "./renderer.js";

export interface SynchronizedScene {
  id: string;
  videoPath: string;
  narration: string;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  minimumDurationSeconds?: number;
}

export interface SynchronizedVoice {
  id: string;
  name?: string;
  voice: string;
  rate?: number | string;
  volume?: number | string;
  pitch?: number | string;
}

export interface SynchronizedManifest {
  title: string;
  outputDirectory?: string;
  width?: number;
  height?: number;
  fps?: number;
  quality?: number;
  speechLeadSeconds?: number;
  speechTailSeconds?: number;
  maximumSlowdown?: number;
  musicPath?: string;
  musicVolume?: number;
  generatedMusic?: boolean;
  voices: SynchronizedVoice[];
  scenes: SynchronizedScene[];
}

export interface SynchronizedOutput {
  voiceId: string;
  voiceName: string;
  videoPath: string;
  subtitlesPath: string;
  durationSeconds: number;
}

export interface SynchronizedRenderResult {
  title: string;
  manifestPath: string;
  outputs: SynchronizedOutput[];
}

type ProgressReporter = (progress: number, message: string) => void;

function ffNumber(value: number): string {
  return value.toFixed(3).replace(/\.0+$/, "");
}

function safeId(value: string): string {
  const result = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  if (!result) throw new AgentDemoError("INVALID_ID", `Cannot use '${value}' as a file identifier.`);
  return result;
}

function resolveFrom(baseDirectory: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDirectory, filePath);
}

function validateManifest(value: unknown): asserts value is SynchronizedManifest {
  if (!value || typeof value !== "object") {
    throw new AgentDemoError("INVALID_SYNC_MANIFEST", "The synchronized manifest must be an object.");
  }
  const manifest = value as Partial<SynchronizedManifest>;
  if (!manifest.title?.trim()) throw new AgentDemoError("INVALID_SYNC_MANIFEST", "title is required.");
  if (!Array.isArray(manifest.voices) || manifest.voices.length === 0) {
    throw new AgentDemoError("INVALID_SYNC_MANIFEST", "At least one voice is required.");
  }
  if (!Array.isArray(manifest.scenes) || manifest.scenes.length === 0) {
    throw new AgentDemoError("INVALID_SYNC_MANIFEST", "At least one scene is required.");
  }
  for (const voice of manifest.voices) {
    if (!voice?.id?.trim() || !voice.voice?.trim()) {
      throw new AgentDemoError("INVALID_SYNC_MANIFEST", "Every voice needs id and voice values.");
    }
  }
  for (const scene of manifest.scenes) {
    if (!scene?.id?.trim() || !scene.videoPath?.trim() || !scene.narration?.trim()) {
      throw new AgentDemoError(
        "INVALID_SYNC_MANIFEST",
        "Every scene needs id, videoPath, and narration values.",
      );
    }
  }
}

export async function loadSynchronizedManifest(manifestPath: string): Promise<SynchronizedManifest> {
  const payload = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  validateManifest(payload);
  return payload;
}

export function formatSrtTimestamp(seconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1_000));
  const milliseconds = totalMilliseconds % 1_000;
  const totalSeconds = Math.floor(totalMilliseconds / 1_000);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

function wrapSubtitle(text: string, width = 72): string {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

async function renderSceneSegment(input: {
  scene: SynchronizedScene;
  videoPath: string;
  audioPath: string;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  quality: number;
  speechLead: number;
  speechTail: number;
  maximumSlowdown: number;
}): Promise<number> {
  const sourceDuration = await probeDuration(input.videoPath);
  const audioDuration = await probeDuration(input.audioPath);
  const trimStart = Math.max(0, Math.min(input.scene.trimStartSeconds ?? 0, sourceDuration - 0.05));
  const trimEnd = Math.max(
    trimStart + 0.05,
    Math.min(input.scene.trimEndSeconds ?? sourceDuration, sourceDuration),
  );
  const availableDuration = trimEnd - trimStart;
  const targetDuration = Math.max(
    audioDuration + input.speechLead + input.speechTail,
    input.scene.minimumDurationSeconds ?? 0,
  );
  const slowdown = Math.min(
    Math.max(1, input.maximumSlowdown),
    Math.max(1, targetDuration / availableDuration),
  );
  const playedDuration = Math.min(targetDuration, availableDuration * slowdown);
  const padDuration = Math.max(0, targetDuration - playedDuration);
  const delayMs = Math.round(input.speechLead * 1_000);

  await mkdir(path.dirname(input.outputPath), { recursive: true });
  const videoFilter = [
    `trim=start=${ffNumber(trimStart)}:end=${ffNumber(trimEnd)}`,
    `setpts=${ffNumber(slowdown)}*(PTS-STARTPTS)`,
    `fps=${input.fps}`,
    `scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${input.width}:${input.height}:(ow-iw)/2:(oh-ih)/2:color=#090d1b`,
    padDuration > 0 ? `tpad=stop_mode=clone:stop_duration=${ffNumber(padDuration)}` : "null",
    `trim=duration=${ffNumber(targetDuration)}`,
    "format=yuv420p",
  ].join(",");
  const audioFilter = [
    "aresample=48000",
    "aformat=sample_fmts=fltp:channel_layouts=stereo",
    "loudnorm=I=-16:LRA=7:TP=-1.5",
    `adelay=${delayMs}|${delayMs}`,
    "apad",
    `atrim=duration=${ffNumber(targetDuration)}`,
  ].join(",");

  const result = await runCommand(
    ffmpegCommand(),
    [
      "-y",
      "-i",
      input.videoPath,
      "-i",
      input.audioPath,
      "-filter_complex",
      `[0:v]${videoFilter}[v];[1:a]${audioFilter}[a]`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-t",
      ffNumber(targetDuration),
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      String(input.quality),
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      input.outputPath,
    ],
    { timeoutMs: 20 * 60_000 },
  );
  if (result.code !== 0) {
    throw new AgentDemoError(
      "SYNC_SCENE_FAILED",
      result.stderr.trim().split("\n").slice(-20).join("\n") || `Could not render ${input.scene.id}.`,
    );
  }
  return targetDuration;
}

async function concatenateSegments(segmentPaths: string[], listPath: string, outputPath: string): Promise<void> {
  const list = segmentPaths
    .map((segmentPath) => `file '${segmentPath.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`)
    .join("\n");
  await writeFile(listPath, `${list}\n`, "utf8");
  const result = await runCommand(
    ffmpegCommand(),
    ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath],
    { timeoutMs: 20 * 60_000 },
  );
  if (result.code !== 0) {
    throw new AgentDemoError("SYNC_CONCAT_FAILED", result.stderr.trim().split("\n").slice(-20).join("\n"));
  }
}

async function mixFinalAudio(
  speechVideo: string,
  musicPath: string | undefined,
  outputPath: string,
  duration: number,
  musicVolume: number,
): Promise<void> {
  if (!musicPath) {
    await copyFile(speechVideo, outputPath);
    return;
  }
  const fadeOutStart = Math.max(0, duration - 1.5);
  const result = await runCommand(
    ffmpegCommand(),
    [
      "-y",
      "-i",
      speechVideo,
      "-stream_loop",
      "-1",
      "-i",
      musicPath,
      "-filter_complex",
      `[0:a]aresample=48000:async=1:first_pts=0,asetpts=N/SR/TB,apad,atrim=duration=${ffNumber(duration)},volume=1[voice];[1:a]atrim=duration=${ffNumber(duration)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${ffNumber(musicVolume)},afade=t=in:st=0:d=1,afade=t=out:st=${ffNumber(fadeOutStart)}:d=${ffNumber(duration - fadeOutStart)}[music];[voice][music]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-16:LRA=7:TP=-1.5,alimiter=limit=0.95[a]`,
      "-map",
      "0:v",
      "-map",
      "[a]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      "-metadata",
      "comment=Scene-synchronized with Agent Demo Studio",
      outputPath,
    ],
    { timeoutMs: 20 * 60_000 },
  );
  if (result.code !== 0) {
    throw new AgentDemoError("SYNC_AUDIO_FAILED", result.stderr.trim().split("\n").slice(-20).join("\n"));
  }
}

export async function renderSynchronizedManifest(
  manifestPath: string,
  report: ProgressReporter = () => undefined,
): Promise<SynchronizedRenderResult> {
  const absoluteManifestPath = path.resolve(manifestPath);
  const manifest = await loadSynchronizedManifest(absoluteManifestPath);
  const baseDirectory = path.dirname(absoluteManifestPath);
  const outputDirectory = resolveFrom(baseDirectory, manifest.outputDirectory ?? "synchronized-output");
  const workDirectory = path.join(outputDirectory, ".work");
  const width = Math.max(640, Math.min(3840, manifest.width ?? 1920));
  const height = Math.max(360, Math.min(2160, manifest.height ?? 1080));
  const fps = Math.max(24, Math.min(60, manifest.fps ?? 30));
  const quality = Math.max(14, Math.min(30, manifest.quality ?? 18));
  const speechLead = Math.max(0, manifest.speechLeadSeconds ?? 0.55);
  const speechTail = Math.max(0, manifest.speechTailSeconds ?? 0.75);
  const maximumSlowdown = Math.max(1, Math.min(1.25, manifest.maximumSlowdown ?? 1.08));
  const musicVolume = Math.max(0, Math.min(0.35, manifest.musicVolume ?? 0.055));
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(workDirectory, { recursive: true });

  const scenePaths = new Map<string, string>();
  for (const scene of manifest.scenes) {
    const videoPath = resolveFrom(baseDirectory, scene.videoPath);
    if (!(await pathExists(videoPath))) {
      throw new AgentDemoError("SYNC_SCENE_MISSING", `Scene video is missing: ${videoPath}`);
    }
    scenePaths.set(scene.id, videoPath);
  }

  let sharedMusicPath: string | undefined;
  if (manifest.musicPath) {
    sharedMusicPath = resolveFrom(baseDirectory, manifest.musicPath);
    if (!(await pathExists(sharedMusicPath))) {
      throw new AgentDemoError("MUSIC_MISSING", `Music file is missing: ${sharedMusicPath}`);
    }
  }

  const outputs: SynchronizedOutput[] = [];
  const totalUnits = manifest.voices.length * manifest.scenes.length;
  let completedUnits = 0;

  for (const voice of manifest.voices) {
    const voiceId = safeId(voice.id);
    const voiceDirectory = path.join(workDirectory, voiceId);
    const audioDirectory = path.join(voiceDirectory, "audio");
    const segmentDirectory = path.join(voiceDirectory, "segments");
    await mkdir(audioDirectory, { recursive: true });
    await mkdir(segmentDirectory, { recursive: true });

    const segmentPaths: string[] = [];
    const cues: Array<{ start: number; end: number; text: string }> = [];
    let timeline = 0;

    for (const [index, scene] of manifest.scenes.entries()) {
      const sceneId = safeId(scene.id);
      report(
        Math.round((completedUnits / Math.max(1, totalUnits)) * 88),
        `${voice.name ?? voice.id}: narrating ${scene.id}`,
      );
      const audioPath = path.join(audioDirectory, `${String(index + 1).padStart(3, "0")}-${sceneId}.mp3`);
      await generateNeuralSpeech(scene.narration, audioPath, {
        voice: voice.voice,
        rate: voice.rate,
        volume: voice.volume,
        pitch: voice.pitch,
      });

      const segmentPath = path.join(
        segmentDirectory,
        `${String(index + 1).padStart(3, "0")}-${sceneId}.mp4`,
      );
      const duration = await renderSceneSegment({
        scene,
        videoPath: scenePaths.get(scene.id)!,
        audioPath,
        outputPath: segmentPath,
        width,
        height,
        fps,
        quality,
        speechLead,
        speechTail,
        maximumSlowdown,
      });
      segmentPaths.push(segmentPath);
      cues.push({
        start: timeline + speechLead,
        end: Math.max(timeline + speechLead + 0.1, timeline + duration - speechTail),
        text: scene.narration,
      });
      timeline += duration;
      completedUnits += 1;
    }

    const speechVideo = path.join(voiceDirectory, "speech-master.mp4");
    await concatenateSegments(segmentPaths, path.join(voiceDirectory, "segments.txt"), speechVideo);

    if (!sharedMusicPath && manifest.generatedMusic !== false) {
      sharedMusicPath = path.join(workDirectory, "ambient.wav");
      if (!(await pathExists(sharedMusicPath))) await generateAmbientMusic(sharedMusicPath, timeline);
    }

    const baseName = `${safeId(manifest.title)}-${voiceId}-1080p`;
    const videoPath = path.join(outputDirectory, `${baseName}.mp4`);
    const subtitlesPath = path.join(outputDirectory, `${baseName}.srt`);
    report(Math.round((completedUnits / Math.max(1, totalUnits)) * 88), `Mixing ${voice.name ?? voice.id}`);
    await mixFinalAudio(speechVideo, sharedMusicPath, videoPath, timeline, musicVolume);
    const srt = cues
      .map(
        (cue, index) =>
          `${index + 1}\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}\n${wrapSubtitle(cue.text)}\n`,
      )
      .join("\n");
    await writeFile(subtitlesPath, srt, "utf8");
    outputs.push({
      voiceId: voice.id,
      voiceName: voice.name ?? voice.voice,
      videoPath,
      subtitlesPath,
      durationSeconds: await probeDuration(videoPath),
    });
  }

  const result: SynchronizedRenderResult = {
    title: manifest.title,
    manifestPath: absoluteManifestPath,
    outputs,
  };
  await writeFile(path.join(outputDirectory, "render-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  report(100, "Scene-synchronized masters ready");
  return result;
}
