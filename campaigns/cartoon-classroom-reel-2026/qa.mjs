import path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const campaignRoot = path.dirname(fileURLToPath(import.meta.url));
const qaRoot = path.join(campaignRoot, "qa");
const framesRoot = path.join(qaRoot, "frames");
const deliverablesRoot = path.join(campaignRoot, "deliverables", "final");
const qaDeliveryRoot = path.join(deliverablesRoot, "qa");
const buildSummary = JSON.parse(await readFile(path.join(campaignRoot, "BUILD-SUMMARY.json"), "utf8"));
const manifest = JSON.parse(await readFile(buildSummary.manifest, "utf8"));
const videoPath = buildSummary.finalVideo;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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

async function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function frameRate(value) {
  const [numerator, denominator] = String(value).split("/").map(Number);
  return denominator ? numerator / denominator : numerator;
}

async function probe(filePath) {
  const result = await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath]);
  const data = JSON.parse(result.stdout);
  const video = data.streams.find((stream) => stream.codec_type === "video");
  const audio = data.streams.find((stream) => stream.codec_type === "audio");
  return {
    width: video.width,
    height: video.height,
    fps: frameRate(video.avg_frame_rate || video.r_frame_rate),
    videoCodec: video.codec_name,
    pixelFormat: video.pix_fmt,
    audioCodec: audio?.codec_name,
    audioSampleRate: Number(audio?.sample_rate),
    audioChannels: audio?.channels,
    durationSeconds: Number(data.format.duration),
    bitRate: Number(data.format.bit_rate)
  };
}

async function loudness(filePath) {
  const result = await run("ffmpeg", ["-hide_banner", "-i", filePath, "-af", "loudnorm=I=-15:TP=-1.5:LRA=11:print_format=json", "-f", "null", "NUL"]);
  const match = /\{\s*"input_i"[\s\S]*?\}/.exec(result.stderr);
  if (!match) throw new Error("Could not parse loudness analysis.");
  const data = JSON.parse(match[0]);
  return {
    integratedLufs: Number(data.input_i),
    truePeakDbtp: Number(data.input_tp),
    loudnessRange: Number(data.input_lra)
  };
}

async function signalScans(filePath) {
  const silence = await run("ffmpeg", ["-hide_banner", "-i", filePath, "-af", "silencedetect=noise=-48dB:d=1.8", "-f", "null", "NUL"]);
  const silenceDurations = [...silence.stderr.matchAll(/silence_duration:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
  const black = await run("ffmpeg", ["-hide_banner", "-i", filePath, "-vf", "blackdetect=d=0.45:pix_th=0.10", "-an", "-f", "null", "NUL"]);
  const blackDurations = [...black.stderr.matchAll(/black_duration:([0-9.]+)/g)].map((match) => Number(match[1]));
  return {
    maximumSilenceSeconds: silenceDurations.length ? Math.max(...silenceDurations) : 0,
    maximumBlackSeconds: blackDurations.length ? Math.max(...blackDurations) : 0,
    silenceEvents: silenceDurations.length,
    blackEvents: blackDurations.length
  };
}

async function extractFrames() {
  await mkdir(framesRoot, { recursive: true });
  const frames = [];
  for (const scene of manifest.metadata.sceneTimeline) {
    const midpoint = scene.startSeconds + (scene.endSeconds - scene.startSeconds) / 2;
    const outputPath = path.join(framesRoot, `${scene.id}.png`);
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", midpoint.toFixed(3), "-i", videoPath, "-frames:v", "1", "-an", outputPath]);
    frames.push({ id: scene.id, midpointSeconds: midpoint, path: outputPath });
  }
  return frames;
}

async function labelBar(text) {
  const safe = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="58"><rect width="360" height="58" fill="#0B2545"/><text x="18" y="38" font-family="Segoe UI, Arial, sans-serif" font-size="23" font-weight="750" fill="#FFF8E8">${safe}</text></svg>`)).png().toBuffer();
}

async function contactSheet(frames) {
  const width = 1080;
  const cellHeight = 698;
  const canvas = sharp({ create: { width, height: cellHeight * 2, channels: 3, background: "#0B2545" } });
  const composites = [];
  for (const [index, frame] of frames.entries()) {
    const x = index % 3 * 360;
    const y = Math.floor(index / 3) * cellHeight;
    const image = await sharp(frame.path).resize(360, 640, { fit: "cover" }).jpeg({ quality: 88 }).toBuffer();
    composites.push({ input: image, left: x, top: y });
    composites.push({ input: await labelBar(`${index + 1}. ${frame.id}`), left: x, top: y + 640 });
  }
  const outputPath = path.join(qaRoot, "ENCODED-CONTACT-SHEET.png");
  await canvas.composite(composites).png({ compressionLevel: 9 }).toFile(outputPath);
  return outputPath;
}

function overlayWithinSafeZone(overlay) {
  const canvas = { width: 1080, height: 1920 };
  const safe = { left: 90, top: 180, right: 120, bottom: 320 };
  const width = overlay.width ?? canvas.width * 0.82;
  const height = overlay.height ?? canvas.height * 0.17;
  const centerX = (overlay.x ?? 0.5) * canvas.width;
  const centerY = (overlay.y ?? 0.5) * canvas.height;
  const bounds = { left: centerX - width / 2, top: centerY - height / 2, right: centerX + width / 2, bottom: centerY + height / 2 };
  return {
    id: overlay.id,
    bounds,
    passed: bounds.left >= safe.left && bounds.top >= safe.top && bounds.right <= canvas.width - safe.right && bounds.bottom <= canvas.height - safe.bottom
  };
}

async function sourceImageAudit() {
  const results = [];
  for (const clip of manifest.clips) {
    const source = path.resolve(path.dirname(buildSummary.manifest), clip.source);
    const metadata = await sharp(source).metadata();
    const aspect = metadata.width / metadata.height;
    results.push({
      id: clip.id,
      width: metadata.width,
      height: metadata.height,
      aspectRatio: aspect,
      passed: metadata.width >= 900 && metadata.height >= 1600 && Math.abs(aspect - 9 / 16) < 0.01
    });
  }
  return results;
}

async function createAudioEvidence() {
  const waveform = path.join(qaRoot, "AUDIO-WAVEFORM.png");
  const spectrogram = path.join(qaRoot, "AUDIO-SPECTROGRAM.png");
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", videoPath, "-filter_complex", "showwavespic=s=1080x300:colors=#42B7E9", "-frames:v", "1", waveform]);
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", videoPath, "-lavfi", "showspectrumpic=s=1080x700:legend=1:color=channel:scale=log", "-frames:v", "1", spectrogram]);
  return { waveform, spectrogram };
}

await Promise.all([mkdir(qaRoot, { recursive: true }), mkdir(qaDeliveryRoot, { recursive: true })]);
const [media, audio, scans, size, checksum, frames, imageAudit] = await Promise.all([
  probe(videoPath),
  loudness(videoPath),
  signalScans(videoPath),
  stat(videoPath),
  sha256(videoPath),
  extractFrames(),
  sourceImageAudit()
]);
const sheet = await contactSheet(frames);
const audioEvidence = await createAudioEvidence();
const overlayAudit = manifest.overlays.map(overlayWithinSafeZone);
const checks = {
  dimensions: media.width === 1080 && media.height === 1920,
  frameRate: Math.abs(media.fps - 30) < 0.02,
  videoCodec: media.videoCodec === "h264",
  pixelFormat: media.pixelFormat === "yuv420p",
  audioCodec: media.audioCodec === "aac",
  audioSampleRate: media.audioSampleRate === 48_000,
  stereoAudio: media.audioChannels === 2,
  requestedDuration: media.durationSeconds >= 60 && media.durationSeconds <= 75,
  loudness: audio.integratedLufs >= -16.5 && audio.integratedLufs <= -13.5,
  truePeak: audio.truePeakDbtp <= -1.2,
  noLongSilence: scans.maximumSilenceSeconds < 1.8,
  noLongBlack: scans.maximumBlackSeconds < 0.45,
  githubFileSize: size.size < 100 * 1024 * 1024,
  sixScenes: manifest.clips.length === 6 && frames.length === 6,
  portraitSources: imageAudit.every((item) => item.passed),
  overlaysSafe: overlayAudit.every((item) => item.passed),
  captionsSafe: manifest.captions.style.margin >= 320 && manifest.captions.style.maxLines <= 2,
  fictionalDisclosure: manifest.metadata.fictionalPeopleOnly === true && manifest.metadata.syntheticMedia === true,
  rightsRecords: manifest.licenses.length === 4 && manifest.clips.every((clip) => clip.licenseId)
};
const passed = Object.values(checks).every(Boolean);
const report = {
  generatedAt: new Date().toISOString(),
  passed,
  video: {
    path: videoPath,
    bytes: size.size,
    sha256: checksum,
    ...media,
    ...audio,
    ...scans
  },
  checks,
  overlayAudit,
  imageAudit,
  frames: frames.map((frame) => ({ id: frame.id, midpointSeconds: frame.midpointSeconds, path: frame.path })),
  artifacts: { contactSheet: sheet, ...audioEvidence }
};
await writeFile(path.join(qaRoot, "QA-REPORT.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
const markdown = [
  "# Cartoon classroom release QA",
  "",
  `Overall: **${passed ? "PASS" : "FAIL"}**`,
  "",
  `- Video: \`${path.relative(campaignRoot, videoPath).replaceAll("\\", "/")}\``,
  `- Format: ${media.width}×${media.height}, ${media.fps.toFixed(2)} fps, ${media.videoCodec}/${media.audioCodec}`,
  `- Duration: ${media.durationSeconds.toFixed(3)} seconds`,
  `- Loudness: ${audio.integratedLufs.toFixed(2)} LUFS; true peak ${audio.truePeakDbtp.toFixed(2)} dBTP`,
  `- Size: ${(size.size / 1024 / 1024).toFixed(2)} MiB`,
  `- SHA-256: \`${checksum}\``,
  `- Checks passed: ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`,
  `- Scene midpoint review: \`${path.relative(campaignRoot, sheet).replaceAll("\\", "/")}\``,
  `- Waveform: \`${path.relative(campaignRoot, audioEvidence.waveform).replaceAll("\\", "/")}\``,
  `- Spectrogram: \`${path.relative(campaignRoot, audioEvidence.spectrogram).replaceAll("\\", "/")}\``,
  "",
  "## Automated checks",
  "",
  ...Object.entries(checks).map(([key, value]) => `- ${value ? "PASS" : "FAIL"}: ${key}`),
  ""
].join("\n");
await writeFile(path.join(qaRoot, "QA-REPORT.md"), markdown, "utf8");
for (const file of ["QA-REPORT.json", "QA-REPORT.md", "ENCODED-CONTACT-SHEET.png", "AUDIO-WAVEFORM.png", "AUDIO-SPECTROGRAM.png"]) {
  await copyFile(path.join(qaRoot, file), path.join(qaDeliveryRoot, file));
}
console.log(JSON.stringify({ passed, checksPassed: Object.values(checks).filter(Boolean).length, checksTotal: Object.keys(checks).length, video: videoPath, contactSheet: sheet }, null, 2));
if (!passed) process.exitCode = 1;
