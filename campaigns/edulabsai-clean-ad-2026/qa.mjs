import path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { production } from "./campaign.mjs";

const campaignRoot = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.join(campaignRoot, "deliverables", production.id);
const manifestPath = path.join(campaignRoot, "manifests", `${production.id}.creator.json`);
const stabilityPath = path.join(campaignRoot, "manifests", `${production.id}.stability-audit.json`);
const qaDirectory = path.join(campaignRoot, "qa");
const manualReviewPath = path.join(campaignRoot, "MANUAL-VISUAL-QA.md");

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
      : reject(new Error(`${command} exited ${code}: ${stderr.slice(-5000)}`)));
  });
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(fullPath));
    else output.push(fullPath);
  }
  return output;
}

function rate(value) {
  const [top, bottom] = String(value).split("/").map(Number);
  return bottom ? top / bottom : top;
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

function loudnessJson(stderr) {
  const matches = stderr.match(/\{\s*"input_i"[\s\S]*?\}/g);
  if (!matches?.length) return undefined;
  return JSON.parse(matches.at(-1));
}

async function createContactSheet(masterPath, timeline) {
  const framesDirectory = path.join(qaDirectory, "frames");
  await mkdir(framesDirectory, { recursive: true });
  const tiles = [];
  for (const [index, scene] of timeline.entries()) {
    const duration = scene.endSeconds - scene.startSeconds;
    const timestamp = scene.startSeconds + Math.min(2.5, duration * 0.55);
    const outputPath = path.join(framesDirectory, `${String(index + 1).padStart(2, "0")}-${scene.id}.png`);
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", timestamp.toFixed(3), "-i", masterPath, "-frames:v", "1", "-vf", "scale=960:540:flags=lanczos", outputPath]);
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="44" fill="#170C29E8"/><text x="18" y="29" font-family="Segoe UI,Arial,sans-serif" font-size="20" font-weight="700" fill="#FFF8EF">${index + 1}. ${scene.id}</text></svg>`);
    tiles.push(await sharp(outputPath).resize(640, 360).composite([{ input: label, left: 0, top: 0 }]).png().toBuffer());
  }
  const contactSheetPath = path.join(qaDirectory, "CONTACT-SHEET.png");
  await sharp({ create: { width: 1920, height: 1080, channels: 4, background: "#170C29" } })
    .composite(tiles.map((input, index) => ({ input, left: index % 3 * 640, top: Math.floor(index / 3) * 360 })))
    .png({ compressionLevel: 9 })
    .toFile(contactSheetPath);
  return contactSheetPath;
}

const packageFiles = await walk(packageDirectory);
const masterPath = packageFiles.find((filePath) => filePath.toLowerCase().endsWith(".mp4"));
if (!masterPath) throw new Error(`No MP4 master found under ${packageDirectory}`);

await mkdir(qaDirectory, { recursive: true });
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const stabilityAudit = JSON.parse(await readFile(stabilityPath, "utf8"));
const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration,format_name,bit_rate:stream=index,codec_name,codec_type,width,height,r_frame_rate,pix_fmt,sample_rate,channels", "-of", "json", masterPath])).stdout);
const video = probe.streams.find((stream) => stream.codec_type === "video");
const audio = probe.streams.find((stream) => stream.codec_type === "audio");

const blackResult = await run("ffmpeg", ["-hide_banner", "-i", masterPath, "-vf", "blackdetect=d=0.25:pix_th=0.02:pic_th=0.98", "-an", "-f", "null", "-"]);
const blackSegments = [...blackResult.stderr.matchAll(/black_start:([0-9.]+).*?black_end:([0-9.]+)/g)].map((match) => ({ start: Number(match[1]), end: Number(match[2]) }));
const silenceResult = await run("ffmpeg", ["-hide_banner", "-i", masterPath, "-af", "silencedetect=noise=-50dB:d=1.25", "-vn", "-f", "null", "-"]);
const silenceStarts = [...silenceResult.stderr.matchAll(/silence_start:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
const loudnessResult = await run("ffmpeg", ["-hide_banner", "-i", masterPath, "-af", "loudnorm=I=-16:TP=-2.5:LRA=11:print_format=json", "-f", "null", "-"]);
const loudness = loudnessJson(loudnessResult.stderr);
const manualReviewExists = await readFile(manualReviewPath, "utf8").then(() => true, () => false);

const sceneAssetPaths = (await walk(path.join(campaignRoot, "assets", "generated", "scenes"))).filter((filePath) => filePath.endsWith(".png"));
const invalidSceneAssets = [];
for (const filePath of sceneAssetPaths) {
  const metadata = await sharp(filePath).metadata();
  if (metadata.width !== 1920 || metadata.height !== 1080) invalidSceneAssets.push({ filePath, width: metadata.width, height: metadata.height });
}

const timeline = manifest.metadata.sceneTimeline;
const contactSheetPath = await createContactSheet(masterPath, timeline);
const checksum = await sha256(masterPath);
const measuredLufs = Number(loudness?.input_i);
const measuredTruePeak = Number(loudness?.input_tp);
const fps = rate(video?.r_frame_rate);
const durationSeconds = Number(probe.format.duration);

const checks = {
  stabilityManifestPassed: stabilityAudit.passed === true,
  exactResolution: video?.width === 1920 && video?.height === 1080,
  exactFrameRate: Math.abs(fps - 30) < 0.001,
  h264Video: video?.codec_name === "h264",
  yuv420pPixelFormat: video?.pix_fmt === "yuv420p",
  aacStereoAudio: audio?.codec_name === "aac" && audio?.channels === 2,
  durationInAdvertisingRange: durationSeconds >= 40 && durationSeconds <= 65,
  noDetectedBlackFrames: blackSegments.length === 0,
  noUnexpectedLongSilence: silenceStarts.length === 0,
  loudnessNearTarget: Number.isFinite(measuredLufs) && measuredLufs >= -17.5 && measuredLufs <= -14.5,
  truePeakHasHeadroom: Number.isFinite(measuredTruePeak) && measuredTruePeak <= -1.5,
  allSceneAssetsAreFullCanvas: invalidSceneAssets.length === 0,
  noSoundEffectsInManifest: (manifest.audio?.soundEffects ?? []).length === 0,
  noContinuousOverlayMotion: manifest.overlays.every((overlay) => overlay.animation?.loop === "none"),
  allSceneChangesAreCuts: manifest.clips.every((clip) => clip.transition?.type === "cut"),
  manualVisualReviewRecorded: manualReviewExists,
};
const passed = Object.values(checks).every(Boolean);
const report = {
  passed,
  generatedAt: new Date().toISOString(),
  masterPath,
  checksum: { algorithm: "sha256", value: checksum },
  media: {
    durationSeconds,
    width: video?.width,
    height: video?.height,
    fps,
    videoCodec: video?.codec_name,
    pixelFormat: video?.pix_fmt,
    audioCodec: audio?.codec_name,
    audioChannels: audio?.channels,
    integratedLufs: measuredLufs,
    truePeakDbtp: measuredTruePeak,
  },
  checks,
  findings: {
    blackSegments,
    silenceStarts,
    invalidSceneAssets,
    soundEffectsCount: (manifest.audio?.soundEffects ?? []).length,
    continuousMotionCount: manifest.overlays.filter((overlay) => overlay.animation?.loop !== "none").length,
  },
  contactSheetPath,
  manualVisualReview: manualReviewExists ? { passed: true, report: manualReviewPath } : { passed: false, required: true },
};

const reportJsonPath = path.join(qaDirectory, "QA-REPORT.json");
const reportMarkdownPath = path.join(qaDirectory, "QA-REPORT.md");
await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(reportMarkdownPath, `# Technical QA report\n\nOverall technical result: **${passed ? "PASS" : "FAIL"}**\n\n- Master: \`${path.relative(campaignRoot, masterPath).replaceAll("\\", "/")}\`\n- Duration: ${durationSeconds.toFixed(3)} seconds\n- Video: ${video?.width}×${video?.height}, ${fps.toFixed(3)} fps, ${video?.codec_name}/${video?.pix_fmt}\n- Audio: ${audio?.codec_name}, ${audio?.channels} channels, ${measuredLufs.toFixed(2)} LUFS, ${measuredTruePeak.toFixed(2)} dBTP\n- SHA-256: \`${checksum}\`\n- Black segments: ${blackSegments.length}\n- Long silences: ${silenceStarts.length}\n- Sound effects: ${(manifest.audio?.soundEffects ?? []).length}\n- Continuous-motion overlays: ${manifest.overlays.filter((overlay) => overlay.animation?.loop !== "none").length}\n- Manual visual review: ${manualReviewExists ? "PASS" : "PENDING"}\n\n## Checks\n\n${Object.entries(checks).map(([name, value]) => `- ${value ? "PASS" : "FAIL"}: ${name}`).join("\n")}\n`, "utf8");
await copyFile(reportJsonPath, path.join(packageDirectory, "QA-REPORT.json"));
await copyFile(reportMarkdownPath, path.join(packageDirectory, "QA-REPORT.md"));
await copyFile(contactSheetPath, path.join(packageDirectory, "CONTACT-SHEET.png"));
if (manualReviewExists) await copyFile(manualReviewPath, path.join(packageDirectory, "MANUAL-VISUAL-QA.md"));

const releasePath = path.join(packageDirectory, "release-manifest.json");
const release = JSON.parse(await readFile(releasePath, "utf8"));
release.checksum = report.checksum;
release.technicalQa = { passed, report: "QA-REPORT.json" };
await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`, "utf8");

console.log(JSON.stringify(report, null, 2));
if (!passed) process.exitCode = 1;
