import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BITS = 16;

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

function midi(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

function softClip(value) {
  return Math.tanh(value * 1.08) * 0.8;
}

export async function generateClassroomScore(outputPath, durationSeconds) {
  const duration = Math.max(1, Math.min(120, durationSeconds));
  const frames = Math.ceil(duration * SAMPLE_RATE);
  const pcm = Buffer.allocUnsafe(frames * 4);
  const bpm = 102;
  const beatSeconds = 60 / bpm;
  const chords = [
    [60, 64, 67],
    [57, 60, 64],
    [65, 69, 72],
    [67, 71, 74]
  ];
  const melody = [72, 76, 79, 76, 74, 72, 69, 71];
  let randomState = 0x5eed2026;
  let brushedNoise = 0;
  const random = () => {
    randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
    return randomState / 0xffff_ffff * 2 - 1;
  };

  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / SAMPLE_RATE;
    const beat = time / beatSeconds;
    const beatIndex = Math.floor(beat);
    const beatPhase = beat - beatIndex;
    const halfBeat = beat * 2;
    const halfIndex = Math.floor(halfBeat);
    const halfPhase = halfBeat - halfIndex;
    const chord = chords[Math.floor(beat / 8) % chords.length];
    const globalFade = Math.max(0, Math.min(1, time / 1.4, (duration - time) / 2.2));
    const phraseLift = 0.86 + 0.14 * Math.sin(Math.PI * Math.min(1, (beat % 8) / 8));

    const pad = chord.reduce((sum, note, index) => {
      const frequency = midi(note - 12);
      return sum + Math.sin(2 * Math.PI * frequency * time + index * 0.48) * (0.034 - index * 0.004);
    }, 0);
    const bassFrequency = midi(chord[0] - 24);
    const bass = Math.sin(2 * Math.PI * bassFrequency * time) * Math.exp(-beatPhase * 3.4) * 0.065;
    const melodyFrequency = midi(melody[halfIndex % melody.length]);
    const mallet = (
      Math.sin(2 * Math.PI * melodyFrequency * time)
      + Math.sin(4 * Math.PI * melodyFrequency * time) * 0.24
    ) * Math.exp(-halfPhase * 7.8) * 0.047;
    brushedNoise = brushedNoise * 0.88 + random() * 0.12;
    const softBrush = beatIndex % 4 === 1 || beatIndex % 4 === 3
      ? brushedNoise * Math.exp(-beatPhase * 20) * 0.022
      : 0;
    const sparkle = Math.sin(2 * Math.PI * (880 + Math.sin(time * 0.25) * 26) * time) * 0.0028;
    const center = (pad + bass + softBrush + sparkle) * phraseLift;
    const pan = Math.sin(halfIndex * 1.1) * 0.2;
    const left = softClip((center + mallet * (1 - pan)) * globalFade);
    const right = softClip((center + mallet * (1 + pan)) * globalFade);
    const offset = frame * 4;
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left)) * 32_767), offset);
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right)) * 32_767), offset + 2);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.concat([wavHeader(pcm.length), pcm]));
  return outputPath;
}
