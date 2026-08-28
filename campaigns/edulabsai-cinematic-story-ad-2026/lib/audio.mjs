import path from "node:path";
import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BITS = 16;

const CHORDS = [
  [130.81, 164.81, 196.0, 246.94],
  [110.0, 130.81, 164.81, 196.0],
  [87.31, 130.81, 164.81, 220.0],
  [98.0, 146.83, 196.0, 246.94]
];

const MELODY = [329.63, 392.0, 440.0, 392.0, 349.23, 329.63, 293.66, 329.63];

function exists(filePath) {
  return access(filePath).then(() => true, () => false);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} exited ${code}: ${stderr.slice(-4000)}`)));
  });
}

async function probeDuration(filePath) {
  const result = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath
  ]);
  const duration = Number(result.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not measure audio duration: ${filePath}`);
  return duration;
}

export async function generateSceneSpeech(production, workDirectory, voice, rate) {
  const directory = path.join(workDirectory, production.id, "voice");
  await mkdir(directory, { recursive: true });
  const results = [];
  for (const [index, scene] of production.scenes.entries()) {
    const fingerprint = createHash("sha256").update(`${voice}\n${rate}\n${scene.narration}`).digest("hex").slice(0, 10);
    const outputPath = path.join(directory, `${String(index + 1).padStart(2, "0")}-${scene.id}-${fingerprint}.mp3`);
    if (!(await exists(outputPath))) {
      await run("edge-tts", [
        "--voice", voice,
        `--rate=${rate}`,
        "--volume=+0%",
        "--pitch=-2Hz",
        "--text", scene.narration,
        "--write-media", outputPath
      ]);
    }
    results.push({ sceneId: scene.id, path: outputPath, duration: await probeDuration(outputPath) });
  }
  return results;
}

function wavHeader(dataLength) {
  const header = Buffer.alloc(44);
  const blockAlign = CHANNELS * BITS / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value) {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
}

function padSample(chord, time, detune) {
  let value = 0;
  for (let index = 0; index < chord.length; index += 1) {
    const frequency = chord[index] * detune;
    const weight = [0.36, 0.27, 0.21, 0.15][index];
    value += Math.sin(2 * Math.PI * frequency * time + index * .19) * weight;
    value += Math.sin(2 * Math.PI * frequency * .5 * time + index * .11) * weight * .18;
  }
  return value;
}

function softNote(time, start, frequency) {
  const age = time - start;
  if (age < 0 || age > 2.8) return 0;
  const attack = smoothstep(age / .16);
  const release = Math.exp(-age * 1.22);
  const fundamental = Math.sin(2 * Math.PI * frequency * time);
  const warmth = Math.sin(2 * Math.PI * frequency * .5 * time + .2) * .28;
  const overtone = Math.sin(2 * Math.PI * frequency * 2 * time + .1) * .035;
  return (fundamental + warmth + overtone) * attack * release;
}

function roundedPulse(time) {
  const beatSeconds = 1.5;
  const age = time % beatSeconds;
  if (age > .9) return 0;
  const attack = smoothstep(age / .14);
  const release = Math.exp(-age * 5.2);
  return Math.sin(2 * Math.PI * 65.41 * time) * attack * release;
}

export async function generateCinematicScore(outputPath, durationSeconds) {
  const duration = Math.max(1, Math.min(600, durationSeconds));
  const frames = Math.ceil(duration * SAMPLE_RATE);
  const dataLength = frames * CHANNELS * (BITS / 8);
  const pcm = Buffer.allocUnsafe(dataLength);
  const chordSeconds = 7.5;
  const crossfadeSeconds = 2.4;
  const noteSeconds = 3.75;

  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / SAMPLE_RATE;
    const chordIndex = Math.floor(time / chordSeconds) % CHORDS.length;
    const nextIndex = (chordIndex + 1) % CHORDS.length;
    const chordAge = time % chordSeconds;
    const chordBlend = smoothstep((chordAge - (chordSeconds - crossfadeSeconds)) / crossfadeSeconds);
    const leftPad = padSample(CHORDS[chordIndex], time, .9993) * (1 - chordBlend) + padSample(CHORDS[nextIndex], time, .9993) * chordBlend;
    const rightPad = padSample(CHORDS[chordIndex], time, 1.0007) * (1 - chordBlend) + padSample(CHORDS[nextIndex], time, 1.0007) * chordBlend;

    const noteIndex = Math.floor(time / noteSeconds) % MELODY.length;
    const noteStart = Math.floor(time / noteSeconds) * noteSeconds;
    const note = softNote(time, noteStart, MELODY[noteIndex]);
    const delayedNote = softNote(time, noteStart + .22, MELODY[noteIndex] * .5);
    const solutionLift = .78 + smoothstep((time - 22) / 10) * .22;
    const pulse = roundedPulse(time) * (.45 + smoothstep((time - 18) / 12) * .55);
    const breath = .96 + Math.sin(2 * Math.PI * .0625 * time) * .025;
    const fade = Math.min(clamp01(time / 2.8), clamp01((duration - time) / 3.8));

    const left = Math.tanh((leftPad * .078 + note * .023 + delayedNote * .008 + pulse * .012) * breath * solutionLift) * fade;
    const right = Math.tanh((rightPad * .078 + note * .021 + delayedNote * .010 + pulse * .011) * breath * solutionLift) * fade;
    const offset = frame * 4;
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left)) * 32767), offset);
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right)) * 32767), offset + 2);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.concat([wavHeader(dataLength), pcm]));
  await writeFile(path.join(path.dirname(outputPath), "AUDIO-DESIGN.json"), `${JSON.stringify({
    title: "Connected Light",
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    durationSeconds: duration,
    synthesis: "continuous sine pads, rounded low pulse, and slow soft-note melody",
    sampledAudio: false,
    percussion: false,
    isolatedSoundEffects: false,
    harshTransientPolicy: "No clicks, impacts, risers, cymbals, or high-frequency cue sounds."
  }, null, 2)}\n`, "utf8");
  return outputPath;
}

function splitCaptionText(text, maxWords) {
  const words = text.trim().split(/\s+/);
  const groups = [];
  let current = [];
  for (const word of words) {
    current.push(word);
    const boundary = /[.!?,;:]$/.test(word);
    if (current.length >= maxWords || (boundary && current.length >= Math.max(3, maxWords - 2))) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  if (groups.length > 1) {
    const last = groups.at(-1);
    const previous = groups.at(-2);
    while (last.length < 3 && previous.length > 4) last.unshift(previous.pop());
  }
  return groups.map((group) => group.join(" "));
}

function stamp(seconds) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const ms = milliseconds % 1000;
  const totalSeconds = Math.floor(milliseconds / 1000);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export async function writeCaptions(outputPath, cues, maxWords = 7) {
  const blocks = [];
  let index = 1;
  for (const cue of cues) {
    const phrases = splitCaptionText(cue.text, cue.maxWords ?? maxWords);
    const weights = phrases.map((phrase) => phrase.split(/\s+/).length);
    const total = weights.reduce((sum, value) => sum + value, 0);
    let cursor = cue.start;
    for (let phraseIndex = 0; phraseIndex < phrases.length; phraseIndex += 1) {
      const share = (cue.end - cue.start) * weights[phraseIndex] / total;
      const end = phraseIndex === phrases.length - 1 ? cue.end : cursor + share;
      blocks.push(`${index}\n${stamp(cursor)} --> ${stamp(end)}\n${phrases[phraseIndex]}\n`);
      cursor = end;
      index += 1;
    }
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${blocks.join("\n").trimEnd()}\n`, "utf8");
  return outputPath;
}
