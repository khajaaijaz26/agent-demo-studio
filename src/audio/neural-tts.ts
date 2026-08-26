import os from "node:os";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { AgentDemoError } from "../errors.js";
import { pathExists } from "../config.js";
import { commandExists, runCommand } from "../utils/process.js";

export interface NeuralSpeechOptions {
  voice: string;
  rate?: number | string;
  volume?: number | string;
  pitch?: number | string;
  subtitlesPath?: string;
  timeoutMs?: number;
}

function signedValue(value: number | string | undefined, unit: "%" | "Hz"): string {
  if (value === undefined) return `+0${unit}`;
  if (typeof value === "number") return `${value >= 0 ? "+" : ""}${value}${unit}`;
  const normalized = value.trim();
  if (new RegExp(`^[+-]\\d+(?:\\.\\d+)?${unit}$`, "i").test(normalized)) return normalized;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
    return `${Number(normalized) >= 0 ? "+" : ""}${normalized}${unit}`;
  }
  throw new AgentDemoError("INVALID_TTS_SETTING", `Invalid speech value: ${value}`);
}

export function normalizeSpeechRate(value: number | string | undefined): string {
  return signedValue(value, "%");
}

async function edgeTtsCommand(): Promise<string> {
  if (process.env.AGENT_DEMO_EDGE_TTS) return process.env.AGENT_DEMO_EDGE_TTS;
  if (await commandExists("edge-tts")) return "edge-tts";

  const executable = process.platform === "win32" ? "edge-tts.exe" : "edge-tts";
  const uvToolPath = path.join(os.homedir(), ".local", "bin", executable);
  if (await pathExists(uvToolPath)) return uvToolPath;

  throw new AgentDemoError(
    "NEURAL_TTS_UNAVAILABLE",
    "edge-tts is required for neural narration. Install it with `uv tool install edge-tts` or set AGENT_DEMO_EDGE_TTS.",
  );
}

export async function generateNeuralSpeech(
  narration: string,
  outputPath: string,
  options: NeuralSpeechOptions,
): Promise<string> {
  if (!narration.trim()) {
    throw new AgentDemoError("NARRATION_REQUIRED", "Narration cannot be empty.");
  }
  if (!options.voice.trim()) {
    throw new AgentDemoError("VOICE_REQUIRED", "A neural voice name is required.");
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  if (options.subtitlesPath) await mkdir(path.dirname(options.subtitlesPath), { recursive: true });

  const command = await edgeTtsCommand();
  const args = [
    "--voice",
    options.voice,
    `--rate=${normalizeSpeechRate(options.rate)}`,
    `--volume=${signedValue(options.volume, "%")}`,
    `--pitch=${signedValue(options.pitch, "Hz")}`,
    "--text",
    narration,
    "--write-media",
    outputPath,
  ];
  if (options.subtitlesPath) args.push("--write-subtitles", options.subtitlesPath);

  const result = await runCommand(command, args, { timeoutMs: options.timeoutMs ?? 5 * 60_000 });
  if (result.code !== 0 || !(await pathExists(outputPath))) {
    throw new AgentDemoError(
      "NEURAL_TTS_FAILED",
      result.stderr.trim() || "Neural speech generation did not create an audio file.",
    );
  }
  return outputPath;
}
