import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const SAMPLE_RATE = 48_000;

function exists(filePath) {
  return access(filePath).then(() => true, () => false);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited ${code}: ${stderr.slice(-4000)}`)));
  });
}

export async function probeDuration(filePath) {
  const result = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath]);
  const duration = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not measure duration: ${filePath}`);
  return duration;
}

export async function generateSceneSpeech(production, workDirectory, voice, rate) {
  const directory = path.join(workDirectory, production.id, "voice");
  await mkdir(directory, { recursive: true });
  const results = [];
  for (const [index, scene] of production.scenes.entries()) {
    const outputPath = path.join(directory, `${String(index + 1).padStart(2, "0")}-${scene.id}.mp3`);
    if (!(await exists(outputPath))) {
      await run("edge-tts", [
        "--voice", voice,
        `--rate=${rate}`,
        "--volume=+0%",
        "--pitch=+0Hz",
        "--text", scene.narration,
        "--write-media", outputPath,
      ]);
    }
    results.push({ sceneId: scene.id, path: outputPath, duration: await probeDuration(outputPath) });
  }
  return results;
}

function wavHeader(dataLength, sampleRate = SAMPLE_RATE, channels = 2, bits = 16) {
  const header = Buffer.alloc(44);
  const blockAlign = channels * bits / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

function midi(number) {
  return 440 * 2 ** ((number - 69) / 12);
}

function softClip(value) {
  return Math.tanh(value * 1.18) * 0.72;
}

function sectionEnergy(time, duration, profile) {
  const opening = Math.min(1, time / (profile === "reel" ? 1.2 : 4));
  const outro = Math.min(1, Math.max(0, (duration - time) / 2.2));
  const build = profile === "evidence" && time > duration * 0.42 && time < duration * 0.58 ? 0.74 : 1;
  return opening * outro * build;
}

function riserAt(time, markers) {
  let value = 0;
  for (const marker of markers) {
    const age = marker - time;
    if (age > 0 && age < 1.15) value = Math.max(value, (1 - age / 1.15) ** 2);
  }
  return value;
}

export async function generateScore(outputPath, durationSeconds, profile = "launch", markers = []) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const bpm = profile === "community" ? 118 : profile === "evidence" ? 120 : profile === "reel" ? 126 : 124;
  const beatSeconds = 60 / bpm;
  const frames = Math.ceil(durationSeconds * SAMPLE_RATE);
  const pcm = Buffer.allocUnsafe(frames * 4);
  const progressions = {
    launch: [[52, 55, 59], [48, 52, 55], [55, 59, 62], [50, 54, 57]],
    product: [[50, 54, 57], [47, 50, 54], [52, 55, 59], [45, 49, 52]],
    evidence: [[45, 48, 52], [41, 45, 48], [48, 52, 55], [43, 47, 50]],
    community: [[55, 59, 62], [52, 55, 59], [48, 52, 55], [50, 54, 57]],
    reel: [[52, 55, 59], [48, 52, 55], [55, 59, 62], [50, 54, 57]],
  };
  const chords = progressions[profile] ?? progressions.launch;
  let randomState = 0xc0ffee ^ Math.round(durationSeconds * 100);
  const random = () => {
    randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
    return randomState / 0xffff_ffff * 2 - 1;
  };
  let smoothNoise = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / SAMPLE_RATE;
    const beat = time / beatSeconds;
    const beatIndex = Math.floor(beat);
    const beatPhase = beat - beatIndex;
    const eighth = beat * 2;
    const eighthIndex = Math.floor(eighth);
    const eighthPhase = eighth - eighthIndex;
    const chord = chords[Math.floor(beat / 8) % chords.length];
    const energy = sectionEnergy(time, durationSeconds, profile);
    const intro = Math.min(1, Math.max(0, (time - (profile === "reel" ? 0.7 : 3)) / 6));
    const finalLift = time > durationSeconds - 12 ? 1.14 : 1;
    const pad = chord.reduce((sum, note, noteIndex) => {
      const frequency = midi(note - 12);
      return sum + Math.sin(2 * Math.PI * frequency * time + noteIndex * 0.7) * (0.033 - noteIndex * 0.004);
    }, 0) * (0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, beatPhase + 0.2)));
    const root = midi(chord[0] - 24);
    const bassEnvelope = Math.exp(-beatPhase * 3.6);
    const bass = (Math.sin(2 * Math.PI * root * time) + 0.24 * Math.sin(4 * Math.PI * root * time)) * 0.105 * bassEnvelope * intro;
    const arpNote = chord[eighthIndex % chord.length] + 12 + (eighthIndex % 6 >= 3 ? 12 : 0);
    const arpFrequency = midi(arpNote);
    const arpEnvelope = Math.exp(-eighthPhase * 8.8);
    const arp = (Math.sin(2 * Math.PI * arpFrequency * time) + 0.22 * Math.sin(4 * Math.PI * arpFrequency * time)) * 0.052 * arpEnvelope * (0.35 + intro * 0.65);
    const kickFrequency = 48 + 92 * Math.exp(-beatPhase * 26);
    const kick = Math.sin(2 * Math.PI * kickFrequency * beatPhase * beatSeconds) * Math.exp(-beatPhase * 18) * 0.28 * (profile === "evidence" ? 0.72 : 1) * intro;
    smoothNoise = smoothNoise * 0.82 + random() * 0.18;
    const backbeat = beatIndex % 4 === 1 || beatIndex % 4 === 3;
    const snare = backbeat ? smoothNoise * Math.exp(-beatPhase * 23) * 0.125 * intro : 0;
    const hat = random() * Math.exp(-eighthPhase * 34) * 0.027 * (0.45 + intro * 0.55);
    const riser = riserAt(time, markers);
    const riseNoise = smoothNoise * riser * 0.095;
    const shimmer = Math.sin(2 * Math.PI * (1_120 + Math.sin(time * 0.4) * 90) * time) * 0.006 * (0.35 + intro * 0.65);
    const impactAge = Math.min(...[0, ...markers].map((marker) => Math.abs(time - marker)));
    const impact = impactAge < 0.42 ? Math.sin(2 * Math.PI * 62 * impactAge) * Math.exp(-impactAge * 10) * 0.16 : 0;
    const center = (pad + bass + kick + snare + hat + riseNoise + shimmer + impact) * energy * finalLift;
    const pan = Math.sin(eighthIndex * 1.7) * 0.36;
    const left = softClip(center + arp * (1 - pan));
    const right = softClip(center + arp * (1 + pan));
    const offset = frame * 4;
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left)) * 32_767), offset);
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right)) * 32_767), offset + 2);
  }
  await writeFile(outputPath, Buffer.concat([wavHeader(pcm.length), pcm]));
  return outputPath;
}

function synthEffect(kind, duration) {
  const frames = Math.ceil(duration * SAMPLE_RATE);
  const pcm = Buffer.allocUnsafe(frames * 4);
  let state = 0xdecafbad;
  const random = () => {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    return state / 0xffff_ffff * 2 - 1;
  };
  for (let frame = 0; frame < frames; frame += 1) {
    const t = frame / SAMPLE_RATE;
    const p = t / duration;
    let left = 0;
    let right = 0;
    if (kind === "impact") {
      const body = Math.sin(2 * Math.PI * (72 - p * 34) * t) * Math.exp(-t * 5.5);
      const air = random() * Math.exp(-t * 12);
      left = right = body * 0.58 + air * 0.13;
    } else if (kind === "whoosh") {
      const envelope = Math.sin(Math.PI * p) ** 1.8;
      const carrier = random() * 0.45 + Math.sin(2 * Math.PI * (240 + p * 1_600) * t) * 0.18;
      left = carrier * envelope * (0.7 + p * 0.3);
      right = carrier * envelope * (1 - p * 0.22);
    } else if (kind === "sparkle") {
      const envelope = Math.exp(-t * 5.5);
      left = Math.sin(2 * Math.PI * 1_046.5 * t) * envelope * 0.38 + Math.sin(2 * Math.PI * 1_568 * t) * envelope * 0.16;
      right = Math.sin(2 * Math.PI * 1_318.5 * t) * envelope * 0.34 + Math.sin(2 * Math.PI * 2_093 * t) * envelope * 0.13;
    } else {
      const envelope = Math.exp(-t * 38);
      left = right = (Math.sin(2 * Math.PI * 1_180 * t) + random() * 0.22) * envelope * 0.42;
    }
    const fade = Math.min(1, t / 0.008, (duration - t) / 0.02);
    const offset = frame * 4;
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, softClip(left) * fade)) * 32_767), offset);
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, softClip(right) * fade)) * 32_767), offset + 2);
  }
  return Buffer.concat([wavHeader(pcm.length), pcm]);
}

export async function prepareSoundEffects(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const definitions = { impact: 1.35, whoosh: 0.9, sparkle: 0.8, click: 0.22 };
  const result = {};
  for (const [kind, duration] of Object.entries(definitions)) {
    const outputPath = path.join(outputDirectory, `${kind}.wav`);
    if (!(await exists(outputPath))) await writeFile(outputPath, synthEffect(kind, duration));
    result[kind] = outputPath;
  }
  return result;
}

export function splitCaptionText(text, maxWords) {
  const words = text.trim().split(/\s+/);
  const parts = [];
  let current = [];
  for (const word of words) {
    current.push(word);
    const boundary = /[.!?,;:]$/.test(word);
    if (current.length >= maxWords || (boundary && current.length >= Math.max(4, maxWords - 3))) {
      parts.push(current.join(" "));
      current = [];
    }
  }
  if (current.length) parts.push(current.join(" "));
  return parts;
}

function stamp(seconds) {
  const milliseconds = Math.max(0, Math.round(seconds * 1_000));
  const ms = milliseconds % 1_000;
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export async function writeCaptions(outputPath, cues) {
  let index = 1;
  const blocks = [];
  for (const cue of cues) {
    const phrases = splitCaptionText(cue.text, cue.maxWords ?? 9);
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
  await writeFile(outputPath, `${blocks.join("\n")}\n`, "utf8");
  return outputPath;
}

