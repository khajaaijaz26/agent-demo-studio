import path from "node:path";
import { copyFile } from "node:fs/promises";
import { AgentDemoError, errorMessage } from "../errors.js";
import { ffmpegCommand, ffprobeCommand, pathExists } from "../config.js";
import { generateAmbientMusic } from "../audio/music.js";
import {
  loadProject,
  projectDirectory,
  resolveArtifact,
  saveProject,
} from "../project-store.js";
import type { DemoProject, RenderDemoInput } from "../types.js";
import { runCommand } from "../utils/process.js";
import { renderCaptionAssets, renderDesignAssets } from "./design.js";

type ProgressReporter = (progress: number, message: string) => void;

function relativeArtifact(project: DemoProject, filePath: string, root?: string): string {
  return path.relative(projectDirectory(project.id, root), filePath).replaceAll("\\", "/");
}

export async function probeDuration(filePath: string): Promise<number> {
  const result = await runCommand(
    ffprobeCommand(),
    ["-v", "error", "-show_entries", "format=duration", "-of", "json", filePath],
    { timeoutMs: 30_000 },
  );
  if (result.code !== 0) {
    throw new AgentDemoError("PROBE_FAILED", result.stderr.trim() || "Could not inspect media duration.");
  }
  const payload = JSON.parse(result.stdout) as { format?: { duration?: string } };
  const duration = Number(payload.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new AgentDemoError("INVALID_MEDIA", `Could not determine duration for ${filePath}`);
  }
  return duration;
}

function addLoopedImageInput(args: string[], filePath: string, fps: number): number {
  const index = args.filter((value) => value === "-i").length;
  args.push("-loop", "1", "-framerate", String(fps), "-i", filePath);
  return index;
}

function ffNumber(value: number): string {
  return value.toFixed(3).replace(/\.0+$/, "");
}

export async function renderDemo(
  input: RenderDemoInput,
  report: ProgressReporter = () => undefined,
): Promise<DemoProject> {
  const project = await loadProject(input.projectId, input.root);
  if (input.title !== undefined) project.title = input.title;
  if (input.subtitle !== undefined) project.subtitle = input.subtitle;
  if (input.theme) project.theme = { ...project.theme, ...input.theme };
  if (input.render) project.render = { ...project.render, ...input.render };
  if (input.narration !== undefined) project.audio.narration = input.narration;
  if (input.voicePath !== undefined) project.audio.voicePath = input.voicePath;
  if (input.musicPath !== undefined) project.audio.musicPath = input.musicPath;
  if (input.useGeneratedMusic !== undefined) {
    project.audio.useGeneratedMusic = input.useGeneratedMusic;
  }
  project.status = "rendering";
  project.error = undefined;
  await saveProject(project, input.root);

  try {
    report(5, "Inspecting the recording");
    if (!project.artifacts.rawVideo) {
      throw new AgentDemoError("RAW_VIDEO_REQUIRED", "Record the browser before rendering.");
    }
    const rawVideo = resolveArtifact(project, project.artifacts.rawVideo, input.root);
    if (!(await pathExists(rawVideo))) {
      throw new AgentDemoError("RAW_VIDEO_MISSING", `Raw recording is missing: ${rawVideo}`);
    }
    const rawDuration = await probeDuration(rawVideo);
    const trimStart = Math.max(0, Math.min(project.render.trimStartSeconds, rawDuration - 0.1));
    const requestedEnd = project.render.trimEndSeconds ?? rawDuration;
    const trimEnd = Math.max(trimStart + 0.1, Math.min(requestedEnd, rawDuration));
    const contentDuration = trimEnd - trimStart;
    const totalDuration = project.render.introSeconds + contentDuration + project.render.outroSeconds;

    report(15, "Creating the visual design");
    const design = await renderDesignAssets(project, input.root);
    const captions = await renderCaptionAssets(project, contentDuration, input.root);
    const projectDir = projectDirectory(project.id, input.root);

    let musicPath = project.audio.musicPath
      ? path.isAbsolute(project.audio.musicPath)
        ? project.audio.musicPath
        : resolveArtifact(project, project.audio.musicPath, input.root)
      : undefined;
    if (!musicPath && project.audio.useGeneratedMusic) {
      musicPath = path.join(projectDir, "audio", "ambient.wav");
      await generateAmbientMusic(musicPath, totalDuration);
      project.audio.musicPath = "audio/ambient.wav";
      project.artifacts.music = relativeArtifact(project, musicPath, input.root);
    }

    const voicePath = project.audio.voicePath
      ? path.isAbsolute(project.audio.voicePath)
        ? project.audio.voicePath
        : resolveArtifact(project, project.audio.voicePath, input.root)
      : undefined;
    if (voicePath && !(await pathExists(voicePath))) {
      throw new AgentDemoError("VOICEOVER_MISSING", `Voice-over file is missing: ${voicePath}`);
    }
    if (musicPath && !(await pathExists(musicPath))) {
      throw new AgentDemoError("MUSIC_MISSING", `Music file is missing: ${musicPath}`);
    }

    report(30, "Building the edit timeline");
    const args: string[] = ["-y", "-i", rawVideo];
    const frameIndex = addLoopedImageInput(args, design.frame, project.render.fps);
    const introIndex = addLoopedImageInput(args, design.intro, project.render.fps);
    const outroIndex = addLoopedImageInput(args, design.outro, project.render.fps);
    const captionIndexes = captions.map((caption) =>
      addLoopedImageInput(args, caption.path, project.render.fps),
    );

    let voiceIndex: number | undefined;
    if (voicePath) {
      voiceIndex = args.filter((value) => value === "-i").length;
      args.push("-i", voicePath);
    }
    let musicIndex: number | undefined;
    if (musicPath) {
      musicIndex = args.filter((value) => value === "-i").length;
      args.push("-stream_loop", "-1", "-i", musicPath);
    }
    let silenceIndex: number | undefined;
    if (voiceIndex === undefined && musicIndex === undefined) {
      silenceIndex = args.filter((value) => value === "-i").length;
      args.push(
        "-f",
        "lavfi",
        "-t",
        ffNumber(totalDuration),
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=44100",
      );
    }

    const filters: string[] = [
      `[0:v]trim=start=${ffNumber(trimStart)}:end=${ffNumber(trimEnd)},setpts=PTS-STARTPTS,fps=${project.render.fps},scale=1776:888:force_original_aspect_ratio=decrease,pad=1776:888:(ow-iw)/2:(oh-ih)/2:color=#070A15[screen]`,
      `[${frameIndex}:v]trim=duration=${ffNumber(contentDuration)},setpts=PTS-STARTPTS,fps=${project.render.fps},format=rgba[frame]`,
      `[frame][screen]overlay=72:114:shortest=1[main]`,
      `[${introIndex}:v]trim=duration=${ffNumber(project.render.introSeconds)},setpts=PTS-STARTPTS,fps=${project.render.fps},format=yuv420p[intro]`,
      `[${outroIndex}:v]trim=duration=${ffNumber(project.render.outroSeconds)},setpts=PTS-STARTPTS,fps=${project.render.fps},format=yuv420p[outro]`,
      `[main]format=yuv420p[mainfmt]`,
      `[intro][mainfmt][outro]concat=n=3:v=1:a=0[vbase]`,
    ];

    let previousVideo = "vbase";
    captions.forEach((caption, index) => {
      const captionInput = captionIndexes[index]!;
      const output = `vcap${index}`;
      filters.push(
        `[${captionInput}:v]format=rgba[cap${index}]`,
        `[${previousVideo}][cap${index}]overlay=(W-w)/2:H-h-72:enable='between(t,${ffNumber(caption.startSeconds)},${ffNumber(caption.endSeconds)})':shortest=1[${output}]`,
      );
      previousVideo = output;
    });
    filters.push(
      `[${previousVideo}]scale=${project.render.width}:${project.render.height}:flags=lanczos,format=yuv420p[vout]`,
    );

    const audioSources: string[] = [];
    if (voiceIndex !== undefined) {
      const delay = Math.round(project.render.introSeconds * 1_000);
      filters.push(
        `[${voiceIndex}:a]asetpts=PTS-STARTPTS,adelay=${delay}|${delay},volume=${project.audio.voiceVolume},apad,atrim=duration=${ffNumber(totalDuration)}[voice]`,
      );
      audioSources.push("voice");
    }
    if (musicIndex !== undefined) {
      const fadeOutStart = Math.max(0, totalDuration - Math.min(1.5, totalDuration / 3));
      filters.push(
        `[${musicIndex}:a]atrim=duration=${ffNumber(totalDuration)},asetpts=PTS-STARTPTS,volume=${project.audio.musicVolume},afade=t=in:st=0:d=${ffNumber(Math.min(1, totalDuration / 4))},afade=t=out:st=${ffNumber(fadeOutStart)}:d=${ffNumber(totalDuration - fadeOutStart)}[music]`,
      );
      audioSources.push("music");
    }
    if (audioSources.length === 2) {
      filters.push(
        `[voice][music]amix=inputs=2:duration=longest:dropout_transition=2,atrim=duration=${ffNumber(totalDuration)}[aout]`,
      );
    } else if (audioSources.length === 1) {
      filters.push(`[${audioSources[0]}]atrim=duration=${ffNumber(totalDuration)}[aout]`);
    } else {
      filters.push(`[${silenceIndex}:a]atrim=duration=${ffNumber(totalDuration)}[aout]`);
    }

    const outputPath = path.join(projectDir, "exports", `${project.id}.mp4`);
    args.push(
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-t",
      ffNumber(totalDuration),
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      String(Math.max(14, Math.min(30, project.render.quality))),
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      "-metadata",
      "comment=Created with Agent Demo Studio",
      outputPath,
    );

    report(45, "Rendering the 1080p master");
    const render = await runCommand(ffmpegCommand(), args, { timeoutMs: 30 * 60_000 });
    if (render.code !== 0) {
      throw new AgentDemoError(
        "RENDER_FAILED",
        render.stderr.trim().split("\n").slice(-20).join("\n") || "FFmpeg rendering failed.",
      );
    }

    report(90, "Creating the thumbnail");
    const thumbnail = path.join(projectDir, "exports", `${project.id}-thumbnail.jpg`);
    const thumbnailTime = Math.min(totalDuration - 0.1, project.render.introSeconds + 0.8);
    const thumbnailResult = await runCommand(
      ffmpegCommand(),
      [
        "-y",
        "-ss",
        ffNumber(Math.max(0, thumbnailTime)),
        "-i",
        outputPath,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        thumbnail,
      ],
      { timeoutMs: 120_000 },
    );
    if (thumbnailResult.code !== 0) {
      await copyFile(design.intro, thumbnail.replace(/\.jpg$/i, ".png"));
    }

    project.status = "ready";
    project.error = undefined;
    project.artifacts.finalVideo = relativeArtifact(project, outputPath, input.root);
    if (await pathExists(thumbnail)) {
      project.artifacts.thumbnail = relativeArtifact(project, thumbnail, input.root);
    }
    await saveProject(project, input.root);
    report(100, "Demo ready");
    return project;
  } catch (error) {
    project.status = "failed";
    project.error = errorMessage(error);
    await saveProject(project, input.root).catch(() => undefined);
    throw error;
  }
}
