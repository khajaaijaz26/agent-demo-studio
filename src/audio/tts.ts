import path from "node:path";
import { unlink } from "node:fs/promises";
import { commandExists, runCommand } from "../utils/process.js";
import { AgentDemoError } from "../errors.js";
import { projectDirectory, updateProject } from "../project-store.js";
import { ffmpegCommand } from "../config.js";

export interface VoiceoverOptions {
  root?: string;
  voice?: string;
  rate?: number;
}

async function windowsTts(
  outputPath: string,
  narration: string,
  voice: string,
  rate: number,
): Promise<void> {
  const script = [
    "Add-Type -AssemblyName System.Speech",
    "$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$speaker.Rate = [Math]::Max(-10, [Math]::Min(10, [int]$env:AGENT_DEMO_TTS_RATE))",
    "if ($env:AGENT_DEMO_TTS_VOICE) { try { $speaker.SelectVoice($env:AGENT_DEMO_TTS_VOICE) } catch {} }",
    "$speaker.SetOutputToWaveFile($env:AGENT_DEMO_TTS_OUTPUT)",
    "$speaker.Speak($env:AGENT_DEMO_TTS_TEXT)",
    "$speaker.Dispose()",
  ].join("; ");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = await runCommand(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    {
      timeoutMs: 120_000,
      env: {
        ...process.env,
        AGENT_DEMO_TTS_OUTPUT: outputPath,
        AGENT_DEMO_TTS_RATE: String(rate),
        AGENT_DEMO_TTS_VOICE: voice,
        AGENT_DEMO_TTS_TEXT: narration,
      },
    },
  );
  if (result.code !== 0) {
    throw new AgentDemoError("TTS_FAILED", result.stderr.trim() || "Windows speech synthesis failed.");
  }
}

async function macTts(outputPath: string, narration: string, voice: string): Promise<void> {
  const temporary = outputPath.replace(/\.wav$/i, ".aiff");
  const args = voice ? ["-v", voice, "-o", temporary, narration] : ["-o", temporary, narration];
  const speech = await runCommand("say", args, { timeoutMs: 120_000 });
  if (speech.code !== 0) throw new AgentDemoError("TTS_FAILED", speech.stderr.trim());
  const conversion = await runCommand(
    ffmpegCommand(),
    ["-y", "-i", temporary, "-ar", "44100", "-ac", "2", outputPath],
    { timeoutMs: 120_000 },
  );
  await unlink(temporary).catch(() => undefined);
  if (conversion.code !== 0) throw new AgentDemoError("TTS_FAILED", conversion.stderr.trim());
}

async function linuxTts(outputPath: string, narration: string, voice: string, rate: number): Promise<void> {
  if (!(await commandExists("espeak"))) {
    throw new AgentDemoError(
      "TTS_UNAVAILABLE",
      "No local TTS engine found. Install espeak or provide a voice-over audio file.",
    );
  }
  const wordsPerMinute = Math.max(80, Math.min(300, 175 + rate * 10));
  const args = ["-w", outputPath, "-s", String(wordsPerMinute)];
  if (voice) args.push("-v", voice);
  args.push(narration);
  const result = await runCommand("espeak", args, { timeoutMs: 120_000 });
  if (result.code !== 0) throw new AgentDemoError("TTS_FAILED", result.stderr.trim());
}

export async function generateVoiceover(
  projectId: string,
  narration: string,
  options: VoiceoverOptions = {},
): Promise<string> {
  if (!narration.trim()) {
    throw new AgentDemoError("NARRATION_REQUIRED", "Narration cannot be empty.");
  }
  const outputPath = path.join(projectDirectory(projectId, options.root), "audio", "voiceover.wav");
  const voice = options.voice ?? "";
  const rate = options.rate ?? 0;

  if (process.platform === "win32") {
    await windowsTts(outputPath, narration, voice, rate);
  } else if (process.platform === "darwin") {
    await macTts(outputPath, narration, voice);
  } else {
    await linuxTts(outputPath, narration, voice, rate);
  }

  await updateProject(
    projectId,
    (project) => {
      project.audio.narration = narration;
      project.audio.voicePath = "audio/voiceover.wav";
      project.artifacts.voiceover = "audio/voiceover.wav";
    },
    options.root,
  );
  return outputPath;
}
