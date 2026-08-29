import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentDemoError } from "../errors.js";
import { commandExists, runCommand } from "../utils/process.js";
import type { CaptionCue, CreatorCaptionStyle, CreatorPreset } from "./types.js";

export function parseTimestamp(value: string): number {
  const match = /^(?:(\d{1,3}):)?([0-5]\d):([0-5]\d)[,.](\d{1,3})$/.exec(value.trim());
  if (!match) throw new AgentDemoError("INVALID_CAPTION_TIME", `Invalid caption timestamp '${value}'.`);
  return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]!.padEnd(3, "0")) / 1000;
}

export function formatCaptionTimestamp(seconds: number, separator: "," | "." = ","): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const milliseconds = total % 1000;
  const allSeconds = Math.floor(total / 1000);
  const secs = allSeconds % 60;
  const allMinutes = Math.floor(allSeconds / 60);
  const minutes = allMinutes % 60;
  const hours = Math.floor(allMinutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}${separator}${String(milliseconds).padStart(3, "0")}`;
}

export function parseCaptions(content: string): CaptionCue[] {
  const normalized = content.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n").trim();
  const withoutHeader = normalized.replace(/^WEBVTT[^\n]*\n+/i, "");
  const blocks = withoutHeader.split(/\n{2,}/);
  const cues: CaptionCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const timing = /^((?:\d{1,3}:)?[0-5]\d:[0-5]\d[,.]\d{1,3})\s+-->\s+((?:\d{1,3}:)?[0-5]\d:[0-5]\d[,.]\d{1,3})/.exec(lines[timingIndex]!);
    if (!timing) continue;
    const text = lines.slice(timingIndex + 1).join("\n").replace(/<[^>]+>/g, "").trim();
    if (!text) continue;
    cues.push({ index: cues.length + 1, startSeconds: parseTimestamp(timing[1]!), endSeconds: parseTimestamp(timing[2]!), text });
  }
  return cues;
}

export async function loadCaptions(filePath: string): Promise<CaptionCue[]> {
  return parseCaptions(await readFile(filePath, "utf8"));
}

export function serializeSrt(cues: CaptionCue[]): string {
  return `${cues.map((cue, index) => `${index + 1}\n${formatCaptionTimestamp(cue.startSeconds)} --> ${formatCaptionTimestamp(cue.endSeconds)}\n${cue.text.trim()}\n`).join("\n")}\n`;
}

export function serializeVtt(cues: CaptionCue[]): string {
  return `WEBVTT\n\n${cues.map((cue) => `${formatCaptionTimestamp(cue.startSeconds, ".")} --> ${formatCaptionTimestamp(cue.endSeconds, ".")}\n${cue.text.trim()}\n`).join("\n")}\n`;
}

function assColor(value: string | undefined, fallback: string): string {
  const normalized = (value ?? fallback).replace(/^#/, "");
  const red = normalized.slice(0, 2);
  const green = normalized.slice(2, 4);
  const blue = normalized.slice(4, 6);
  const alpha = normalized.length >= 8 ? normalized.slice(6, 8) : "00";
  return `&H${alpha}${blue}${green}${red}`.toUpperCase();
}

function assTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const cs = centiseconds % 100;
  const totalSeconds = Math.floor(centiseconds / 100);
  const secs = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export function serializeAss(cues: CaptionCue[], preset: CreatorPreset, style: CreatorCaptionStyle | undefined): string {
  const fontSize = Math.round(style?.fontSize ?? (preset.height > preset.width ? 58 : 52));
  const alignment = style?.position === "top" ? 8 : style?.position === "middle" ? 5 : 2;
  const marginV = Math.round(style?.margin ?? (alignment === 8 ? preset.safeZone.top : preset.safeZone.bottom));
  const maxCharacters = style?.maxCharactersPerLine ?? (preset.height > preset.width ? 30 : 54);
  const maxLines = style?.maxLines ?? 3;
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${preset.width}\nPlayResY: ${preset.height}\nScaledBorderAndShadow: yes\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Creator,Arial,${fontSize},${assColor(style?.color, "#FFFFFF")},${assColor(style?.accent, "#22D3EE")},&HCC000000,${assColor(style?.background, "#050711D9")},-1,0,0,0,100,100,0,0,3,2,1,${alignment},${preset.safeZone.left},${preset.safeZone.right},${marginV},1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`;
  const events = cues.flatMap((cue) => {
    const pages = captionPages(cue.text, maxCharacters, maxLines);
    const weights = pages.map((page) => Math.max(1, page.replaceAll("\\N", " ").length));
    const totalWeight = weights.reduce((total, weight) => total + weight, 0);
    const duration = Math.max(0.01, cue.endSeconds - cue.startSeconds);
    let completedWeight = 0;
    return pages.map((page, index) => {
      const start = cue.startSeconds + duration * completedWeight / totalWeight;
      completedWeight += weights[index]!;
      const end = index === pages.length - 1 ? Math.max(start + 0.01, cue.endSeconds) : cue.startSeconds + duration * completedWeight / totalWeight;
      const text = page.replaceAll("\\", "\\\\").replaceAll("{", "\\{").replaceAll("}", "\\}").replaceAll("\\\\N", "\\N");
      return `Dialogue: 0,${assTime(start)},${assTime(end)},Creator,,0,0,0,,${text}`;
    });
  });
  return `${header}${events.join("\n")}\n`;
}

function wrapCaptionLines(value: string, width: number): string[] {
  const words = value.replaceAll("\n", " ").trim().split(/\s+/).flatMap((word) => {
    if (word.length <= width) return [word];
    const pieces: string[] = [];
    for (let index = 0; index < word.length; index += width) pieces.push(word.slice(index, index + width));
    return pieces;
  });
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > width && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

function captionPages(value: string, width: number, maxLines: number): string[] {
  const lines = wrapCaptionLines(value, width);
  const pages: string[] = [];
  for (let index = 0; index < lines.length; index += maxLines) pages.push(lines.slice(index, index + maxLines).join("\\N"));
  return pages.length ? pages : [""];
}

async function whisperCommand(): Promise<string> {
  if (process.env.AGENT_DEMO_WHISPER) return process.env.AGENT_DEMO_WHISPER;
  for (const candidate of ["whisper", "whisper-cli"]) {
    if (await commandExists(candidate)) return candidate;
  }
  throw new AgentDemoError("WHISPER_UNAVAILABLE", "Local transcription requires the `whisper` or `whisper-cli` command. Install OpenAI Whisper or set AGENT_DEMO_WHISPER.");
}

export async function transcribeMedia(inputPath: string, options: {
  outputDirectory?: string;
  language?: string;
  model?: string;
  format?: "srt" | "vtt";
} = {}): Promise<string> {
  const command = await whisperCommand();
  const outputDirectory = path.resolve(options.outputDirectory ?? path.dirname(inputPath));
  const format = options.format ?? "srt";
  const args = [inputPath, "--output_dir", outputDirectory, "--output_format", format, "--model", options.model ?? "turbo", "--verbose", "False"];
  if (options.language) args.push("--language", options.language);
  const result = await runCommand(command, args, { timeoutMs: 60 * 60_000 });
  if (result.code !== 0) throw new AgentDemoError("TRANSCRIPTION_FAILED", result.stderr.trim() || "Whisper transcription failed.");
  const outputPath = path.join(outputDirectory, `${path.parse(inputPath).name}.${format}`);
  const cues = await loadCaptions(outputPath);
  await writeFile(outputPath, format === "srt" ? serializeSrt(cues) : serializeVtt(cues), "utf8");
  return outputPath;
}
