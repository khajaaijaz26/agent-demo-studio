import path from "node:path";
import { ffmpegCommand, ffprobeCommand, pathExists } from "../config.js";
import { AgentDemoError } from "../errors.js";
import { runCommand } from "../utils/process.js";
import type { MediaAnalysis } from "./types.js";

export interface MediaProbe {
  source: string;
  durationSeconds: number;
  width?: number;
  height?: number;
  fps?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  formatName?: string;
  videoCodec?: string;
  audioCodec?: string;
}

function parseRate(value?: string): number | undefined {
  if (!value) return undefined;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || !denominator) return undefined;
  return numerator! / denominator!;
}

export async function probeMediaInfo(filePath: string): Promise<MediaProbe> {
  const source = path.resolve(filePath);
  if (!(await pathExists(source))) throw new AgentDemoError("MEDIA_MISSING", `Media file is missing: ${source}`);
  const result = await runCommand(ffprobeCommand(), [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", source,
  ], { timeoutMs: 60_000 });
  if (result.code !== 0) throw new AgentDemoError("PROBE_FAILED", result.stderr.trim() || `Could not inspect ${source}.`);
  const payload = JSON.parse(result.stdout) as {
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; duration?: string }>;
    format?: { duration?: string; format_name?: string };
  };
  const video = payload.streams?.find((stream) => stream.codec_type === "video");
  const audio = payload.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(payload.format?.duration ?? video?.duration ?? audio?.duration ?? 0);
  return {
    source,
    durationSeconds: Number.isFinite(duration) ? duration : 0,
    width: video?.width,
    height: video?.height,
    fps: parseRate(video?.avg_frame_rate) ?? parseRate(video?.r_frame_rate),
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    formatName: payload.format?.format_name,
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
  };
}

function parseSilence(stderr: string, duration: number): MediaAnalysis["silence"] {
  const events = [...stderr.matchAll(/silence_(start|end):\s*(-?\d+(?:\.\d+)?)(?:\s*\|\s*silence_duration:\s*(\d+(?:\.\d+)?))?/g)];
  const silence: MediaAnalysis["silence"] = [];
  let openStart: number | undefined;
  for (const event of events) {
    const value = Math.max(0, Number(event[2]));
    if (event[1] === "start") openStart = value;
    else {
      const declaredDuration = event[3] ? Number(event[3]) : undefined;
      const start = openStart ?? Math.max(0, value - (declaredDuration ?? 0));
      silence.push({ startSeconds: start, endSeconds: value, durationSeconds: Math.max(0, value - start) });
      openStart = undefined;
    }
  }
  if (openStart !== undefined && duration > openStart) silence.push({ startSeconds: openStart, endSeconds: duration, durationSeconds: duration - openStart });
  return silence;
}

function parseSceneChanges(stderr: string): number[] {
  const values = [...stderr.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)].map((match) => Number(match[1]));
  return [...new Set(values.filter(Number.isFinite).map((value) => Math.round(value * 1000) / 1000))].sort((a, b) => a - b);
}

function suggestedHighlights(duration: number, silence: MediaAnalysis["silence"], scenes: number[]): MediaAnalysis["suggestedHighlights"] {
  const audible: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const gap of silence) {
    if (gap.startSeconds - cursor >= 2) audible.push({ start: cursor, end: gap.startSeconds });
    cursor = Math.max(cursor, gap.endSeconds);
  }
  if (duration - cursor >= 2) audible.push({ start: cursor, end: duration });
  const candidates = audible.length ? audible : [{ start: 0, end: duration }];
  const highlights: MediaAnalysis["suggestedHighlights"] = [];
  for (const candidate of candidates) {
    let start = candidate.start;
    while (candidate.end - start > 0.25) {
      const end = Math.min(candidate.end, start + 45);
      if (end - start >= 2) {
        const sceneCount = scenes.filter((scene) => scene >= start && scene <= end).length;
        highlights.push({
          startSeconds: Math.round(start * 1000) / 1000,
          endSeconds: Math.round(end * 1000) / 1000,
          durationSeconds: Math.round((end - start) * 1000) / 1000,
          reason: sceneCount ? `${sceneCount} visual change${sceneCount === 1 ? "" : "s"} with continuous audio` : "continuous non-silent section",
        });
      }
      start = end;
    }
  }
  return highlights.sort((a, b) => {
    const aScenes = scenes.filter((scene) => scene >= a.startSeconds && scene <= a.endSeconds).length;
    const bScenes = scenes.filter((scene) => scene >= b.startSeconds && scene <= b.endSeconds).length;
    return bScenes - aScenes || b.durationSeconds - a.durationSeconds;
  }).slice(0, 12);
}

export async function analyzeMedia(filePath: string, options: {
  silenceNoiseDb?: number;
  silenceDurationSeconds?: number;
  sceneThreshold?: number;
} = {}): Promise<MediaAnalysis> {
  const probe = await probeMediaInfo(filePath);
  const duration = probe.durationSeconds;
  let silence: MediaAnalysis["silence"] = [];
  let sceneChanges: number[] = [];
  if (probe.hasAudio) {
    const audio = await runCommand(ffmpegCommand(), [
      "-hide_banner", "-nostats", "-i", probe.source,
      "-af", `silencedetect=noise=${options.silenceNoiseDb ?? -35}dB:d=${options.silenceDurationSeconds ?? 0.65}`,
      "-f", "null", "-",
    ], { timeoutMs: 30 * 60_000 });
    if (audio.code !== 0) throw new AgentDemoError("AUDIO_ANALYSIS_FAILED", audio.stderr.trim().split("\n").slice(-18).join("\n") || `Could not analyze audio in ${probe.source}.`);
    silence = parseSilence(audio.stderr, duration);
  }
  if (probe.hasVideo) {
    const threshold = Math.max(0.05, Math.min(0.95, options.sceneThreshold ?? 0.32));
    const video = await runCommand(ffmpegCommand(), [
      "-hide_banner", "-nostats", "-i", probe.source,
      "-vf", `select='gt(scene,${threshold})',showinfo`, "-an", "-f", "null", "-",
    ], { timeoutMs: 30 * 60_000 });
    if (video.code !== 0) throw new AgentDemoError("SCENE_ANALYSIS_FAILED", video.stderr.trim().split("\n").slice(-18).join("\n") || `Could not analyze scenes in ${probe.source}.`);
    sceneChanges = parseSceneChanges(video.stderr);
  }
  return {
    source: probe.source,
    durationSeconds: duration,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    hasVideo: probe.hasVideo,
    hasAudio: probe.hasAudio,
    silence,
    sceneChanges,
    suggestedHighlights: suggestedHighlights(duration, silence, sceneChanges),
  };
}
