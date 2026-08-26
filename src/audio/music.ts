import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SAMPLE_RATE = 44_100;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;

const CHORDS = [
  [130.81, 164.81, 196.0],
  [110.0, 130.81, 164.81],
  [146.83, 174.61, 220.0],
  [98.0, 123.47, 146.83],
];

function wavHeader(dataLength: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE((SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8, 28);
  header.writeUInt16LE((CHANNELS * BITS_PER_SAMPLE) / 8, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

export async function generateAmbientMusic(
  outputPath: string,
  durationSeconds: number,
): Promise<string> {
  const safeDuration = Math.max(1, Math.min(durationSeconds, 600));
  const frames = Math.ceil(safeDuration * SAMPLE_RATE);
  const dataLength = frames * CHANNELS * (BITS_PER_SAMPLE / 8);
  const pcm = Buffer.allocUnsafe(dataLength);
  const chordSeconds = 4;

  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / SAMPLE_RATE;
    const chordIndex = Math.floor(time / chordSeconds) % CHORDS.length;
    const chord = CHORDS[chordIndex] ?? CHORDS[0]!;
    const withinChord = time % chordSeconds;
    const attack = Math.min(1, withinChord / 1.1);
    const release = Math.min(1, (chordSeconds - withinChord) / 1.1);
    const envelope = Math.max(0, Math.min(attack, release));
    const slowPulse = 0.74 + Math.sin(time * Math.PI * 0.34) * 0.08;

    let left = 0;
    let right = 0;
    chord.forEach((frequency, index) => {
      const weight = 0.23 / (index + 1);
      left += Math.sin(2 * Math.PI * frequency * time + index * 0.18) * weight;
      right += Math.sin(2 * Math.PI * frequency * 1.002 * time + index * 0.31) * weight;
      left += Math.sin(2 * Math.PI * frequency * 0.5 * time) * weight * 0.34;
      right += Math.sin(2 * Math.PI * frequency * 0.501 * time) * weight * 0.34;
    });

    const globalFadeIn = Math.min(1, time / 1.4);
    const globalFadeOut = Math.min(1, (safeDuration - time) / 1.8);
    const gain = envelope * slowPulse * Math.max(0, Math.min(globalFadeIn, globalFadeOut));
    const leftSample = Math.max(-1, Math.min(1, left * gain));
    const rightSample = Math.max(-1, Math.min(1, right * gain));
    const offset = frame * 4;
    pcm.writeInt16LE(Math.round(leftSample * 32_767), offset);
    pcm.writeInt16LE(Math.round(rightSample * 32_767), offset + 2);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.concat([wavHeader(dataLength), pcm]));
  return outputPath;
}

export async function generateAsmrSoundscape(
  outputPath: string,
  durationSeconds: number,
): Promise<string> {
  const safeDuration = Math.max(1, Math.min(durationSeconds, 600));
  const frames = Math.ceil(safeDuration * SAMPLE_RATE);
  const dataLength = frames * CHANNELS * (BITS_PER_SAMPLE / 8);
  const pcm = Buffer.allocUnsafe(dataLength);
  const drops = Array.from({ length: Math.max(3, Math.floor(safeDuration / 2.7)) }, (_, index) => ({
    time: 1.2 + index * 2.7 + (index % 3) * 0.19,
    pan: (index % 5) / 2 - 1,
    frequency: 620 + (index % 4) * 115,
  }));
  let randomState = 0x51f15e;
  let softNoise = 0;
  const random = (): number => {
    randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
    return randomState / 0xffff_ffff;
  };

  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / SAMPLE_RATE;
    softNoise = softNoise * 0.997 + (random() * 2 - 1) * 0.003;
    const breath = softNoise * 0.42 + Math.sin(2 * Math.PI * 83 * time) * 0.012;
    let left = breath;
    let right = breath * 0.98;
    for (const drop of drops) {
      const age = time - drop.time;
      if (age < 0 || age > 0.42) continue;
      const envelope = Math.exp(-age * 13) * (1 - Math.exp(-age * 90));
      const chirp = Math.sin(2 * Math.PI * (drop.frequency - age * 240) * age) * envelope * 0.32;
      left += chirp * (1 - Math.max(0, drop.pan)) * 0.75;
      right += chirp * (1 + Math.min(0, drop.pan)) * 0.75;
    }
    const shimmer = Math.sin(2 * Math.PI * 1_760 * time + Math.sin(time * 0.31) * 2.1) * 0.004;
    left += shimmer * (0.72 + Math.sin(time * 0.7) * 0.2);
    right += shimmer * (0.72 + Math.cos(time * 0.63) * 0.2);
    const fade = Math.max(0, Math.min(1, time / 1.6, (safeDuration - time) / 2));
    const offset = frame * 4;
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left * fade * 0.46)) * 32_767), offset);
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right * fade * 0.46)) * 32_767), offset + 2);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.concat([wavHeader(dataLength), pcm]));
  return outputPath;
}
