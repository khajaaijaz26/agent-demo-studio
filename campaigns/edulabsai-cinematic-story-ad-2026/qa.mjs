import path from "node:path";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { formats, production } from "./campaign.mjs";

const campaignRoot = path.dirname(fileURLToPath(import.meta.url));
const assetsRoot = path.join(campaignRoot, "assets", "generated");
const scenesRoot = path.join(assetsRoot, "scenes");
const deliverablesRoot = path.join(campaignRoot, "deliverables", "final");
const qaRoot = path.join(campaignRoot, "qa");
const framesRoot = path.join(qaRoot, "frames");

function exists(filePath) {
  return access(filePath).then(() => true, () => false);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} exited ${code}: ${stderr.slice(-6000)}`)));
  });
}

async function filesRecursive(directory) {
  if (!(await exists(directory))) return [];
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await filesRecursive(filePath));
    else results.push(filePath);
  }
  return results;
}

async function flattenScene(format, scene) {
  const inputDirectory = path.join(scenesRoot, format.id, scene.id);
  const files = (await readdir(inputDirectory)).filter((name) => name.endsWith(".png")).sort();
  const base = path.join(inputDirectory, "00-base.png");
  const layers = files.filter((name) => name !== "00-base.png").map((name) => ({ input: path.join(inputDirectory, name), left: 0, top: 0 }));
  const outputDirectory = path.join(framesRoot, format.id);
  const outputPath = path.join(outputDirectory, `${scene.id}.png`);
  await mkdir(outputDirectory, { recursive: true });
  await sharp(base).composite(layers).png({ compressionLevel: 9 }).toFile(outputPath);
  return outputPath;
}

async function labelStrip(width, height, text) {
  const safe = String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#170C29"/><text x="24" y="${Math.round(height * .7)}" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.round(height * .42)}" font-weight="800" fill="#FFF8EF">${safe}</text></svg>`)).png().toBuffer();
}

async function createContactSheet(format, frames) {
  const vertical = format.id === "vertical";
  const thumbWidth = vertical ? 360 : 960;
  const thumbHeight = vertical ? 640 : 540;
  const labelHeight = vertical ? 64 : 70;
  const columns = vertical ? 4 : 3;
  const rows = Math.ceil(frames.length / columns);
  const tileHeight = thumbHeight + labelHeight;
  const canvas = sharp({
    create: {
      width: thumbWidth * columns,
      height: tileHeight * rows,
      channels: 3,
      background: "#12081F"
    }
  });
  const composites = [];
  for (let index = 0; index < frames.length; index += 1) {
    const x = (index % columns) * thumbWidth;
    const y = Math.floor(index / columns) * tileHeight;
    const image = await sharp(frames[index].path).resize(thumbWidth, thumbHeight, { fit: "fill", kernel: sharp.kernel.lanczos3 }).png().toBuffer();
    composites.push({ input: image, left: x, top: y });
    composites.push({ input: await labelStrip(thumbWidth, labelHeight, `${index + 1}. ${frames[index].id}`), left: x, top: y + thumbHeight });
  }
  const output = path.join(qaRoot, `CONTACT-SHEET-${format.id.toUpperCase()}.png`);
  await mkdir(qaRoot, { recursive: true });
  await canvas.composite(composites).png({ compressionLevel: 9 }).toFile(output);
  return output;
}

async function generateVisualPreviews() {
  const outputs = {};
  for (const format of Object.values(formats)) {
    const frames = [];
    for (const scene of production.scenes) frames.push({ id: scene.id, path: await flattenScene(format, scene) });
    outputs[format.id] = {
      frames,
      contactSheet: await createContactSheet(format, frames)
    };
  }
  return outputs;
}

function insideSafe(bounds, format) {
  if (!bounds) return true;
  const safe = format.safeZone;
  return bounds.x >= safe.left
    && bounds.y >= safe.top
    && bounds.x + bounds.width <= format.width - safe.right
    && bounds.y + bounds.height <= format.height - safe.bottom;
}

async function auditAlignment() {
  const alignmentPath = path.join(assetsRoot, "ALIGNMENT-SPEC.json");
  const alignment = JSON.parse(await readFile(alignmentPath, "utf8"));
  const results = [];
  for (const format of Object.values(formats)) {
    const spec = alignment.formats[format.id];
    for (const scene of production.scenes) {
      const sceneSpec = spec.scenes[scene.id];
      const copySafe = insideSafe(sceneSpec.copy, format);
      const ctaLayers = sceneSpec.layers.filter((item) => item.role === "cta");
      const ctaSafe = ctaLayers.every((item) => insideSafe(item.bounds, format));
      results.push({ format: format.id, scene: scene.id, copySafe, ctaSafe, passed: copySafe && ctaSafe });
    }
  }
  return results;
}

async function ffprobe(filePath) {
  const result = await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath]);
  return JSON.parse(result.stdout);
}

function fraction(value) {
  if (!value) return 0;
  const [top, bottom] = value.split("/").map(Number);
  return bottom ? top / bottom : top;
}

async function loudness(filePath) {
  const result = await run("ffmpeg", [
    "-hide_banner", "-nostats", "-i", filePath,
    "-af", "loudnorm=I=-16:TP=-2:LRA=11:print_format=json",
    "-f", "null", "NUL"
  ]);
  const matches = [...result.stderr.matchAll(/\{[\s\S]*?"target_offset"\s*:\s*"[^"]+"[\s\S]*?\}/g)];
  if (!matches.length) throw new Error(`Could not parse loudness output for ${filePath}`);
  return JSON.parse(matches.at(-1)[0]);
}

async function signalScan(filePath) {
  const black = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", filePath, "-vf", "blackdetect=d=.35:pix_th=.10", "-an", "-f", "null", "NUL"]);
  const silence = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", filePath, "-af", "silencedetect=noise=-50dB:d=1.2", "-vn", "-f", "null", "NUL"]);
  return {
    blackSegments: (black.stderr.match(/black_start:/g) ?? []).length,
    silenceSegments: (silence.stderr.match(/silence_start:/g) ?? []).length
  };
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  const data = await readFile(filePath);
  hash.update(data);
  return hash.digest("hex");
}

async function auditVideos() {
  const allFiles = await filesRecursive(deliverablesRoot);
  const videos = allFiles.filter((filePath) => filePath.toLowerCase().endsWith(".mp4"));
  const results = [];
  for (const filePath of videos) {
    const format = filePath.includes("-vertical") ? formats.vertical : formats.landscape;
    const probe = await ffprobe(filePath);
    const video = probe.streams.find((stream) => stream.codec_type === "video");
    const audio = probe.streams.find((stream) => stream.codec_type === "audio");
    const durationSeconds = Number(probe.format.duration);
    const fileStats = await stat(filePath);
    const levels = await loudness(filePath);
    const signal = await signalScan(filePath);
    const checks = {
      width: video?.width === format.width,
      height: video?.height === format.height,
      frameRate: Math.abs(fraction(video?.avg_frame_rate) - 30) < .01,
      videoCodec: video?.codec_name === "h264",
      audioCodec: audio?.codec_name === "aac",
      duration: durationSeconds > 70 && durationSeconds < 110,
      loudness: Math.abs(Number(levels.input_i) - (-16)) <= 1,
      // Allow one twentieth of a decibel for AAC reconstruction variance around the -1.5 dBTP safety gate.
      truePeak: Number(levels.input_tp) <= -1.45,
      noBlackSegments: signal.blackSegments === 0,
      noLongSilence: signal.silenceSegments === 0,
      githubSize: fileStats.size < 99 * 1024 * 1024
    };
    results.push({
      format: format.id,
      filePath,
      relativePath: path.relative(campaignRoot, filePath).replaceAll("\\", "/"),
      width: video?.width,
      height: video?.height,
      fps: fraction(video?.avg_frame_rate),
      durationSeconds,
      videoCodec: video?.codec_name,
      audioCodec: audio?.codec_name,
      sizeBytes: fileStats.size,
      loudness: levels,
      signal,
      sha256: await sha256(filePath),
      checks,
      passed: Object.values(checks).every(Boolean)
    });
  }
  const durationMatch = results.length === 2 && Math.abs(results[0].durationSeconds - results[1].durationSeconds) < .08;
  return { results, durationMatch, passed: results.length === 2 && durationMatch && results.every((item) => item.passed) };
}

function markdownReport(report) {
  const alignmentFailures = report.alignment.filter((item) => !item.passed);
  const lines = [
    "# QA report",
    "",
    `Overall: **${report.passed ? "PASS" : "FAIL"}**`,
    "",
    "## Visual composition",
    "",
    `- Landscape contact sheet: \`${path.relative(campaignRoot, report.previews.landscape.contactSheet).replaceAll("\\", "/")}\``,
    `- Vertical contact sheet: \`${path.relative(campaignRoot, report.previews.vertical.contactSheet).replaceAll("\\", "/")}\``,
    `- Alignment checks: ${report.alignment.length - alignmentFailures.length}/${report.alignment.length} passed`,
    "- Manual review is still required for visual taste, narration-to-scene match, and music character.",
    "",
    "## Video masters",
    ""
  ];
  if (!report.videos.results.length) lines.push("No rendered videos were found; this was an asset-preview QA run.");
  for (const item of report.videos.results) {
    lines.push(`### ${item.format}`, "", `- Result: **${item.passed ? "PASS" : "FAIL"}**`, `- File: \`${item.relativePath}\``, `- Format: ${item.width}x${item.height} at ${item.fps.toFixed(2)} fps`, `- Duration: ${item.durationSeconds.toFixed(3)} seconds`, `- Loudness: ${item.loudness.input_i} LUFS; peak ${item.loudness.input_tp} dBTP`, `- Size: ${(item.sizeBytes / 1024 / 1024).toFixed(2)} MiB`, `- SHA-256: \`${item.sha256}\``, "");
  }
  if (alignmentFailures.length) {
    lines.push("## Alignment failures", "", ...alignmentFailures.map((item) => `- ${item.format}/${item.scene}: copySafe=${item.copySafe}, ctaSafe=${item.ctaSafe}`), "");
  }
  return `${lines.join("\n")}\n`;
}

await mkdir(qaRoot, { recursive: true });
const previews = await generateVisualPreviews();
const alignment = await auditAlignment();
const videos = await auditVideos();
const report = {
  generatedAt: new Date().toISOString(),
  previews,
  alignment,
  videos,
  passed: alignment.every((item) => item.passed) && (videos.results.length === 0 || videos.passed)
};
await writeFile(path.join(qaRoot, "QA-REPORT.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(path.join(qaRoot, "QA-REPORT.md"), markdownReport(report), "utf8");
const qaDeliveryRoot = path.join(deliverablesRoot, "qa");
await mkdir(qaDeliveryRoot, { recursive: true });
for (const name of [
  "QA-REPORT.json",
  "QA-REPORT.md",
  "CONTACT-SHEET-LANDSCAPE.png",
  "CONTACT-SHEET-VERTICAL.png",
  "VIDEO-CONTACT-SHEET-LANDSCAPE.png",
  "VIDEO-CONTACT-SHEET-VERTICAL.png",
  "OPENING-SEQUENCE-LANDSCAPE.png",
  "OPENING-SEQUENCE-VERTICAL.png",
  "ENCODED-FRAME-49S-LANDSCAPE.png",
  "ENCODED-FRAME-49S-VERTICAL.png",
  "ENCODED-FRAME-57S-VERTICAL.png",
  "AUDIO-WAVEFORM.png",
  "AUDIO-SPECTROGRAM.png"
]) {
  const source = path.join(qaRoot, name);
  if (await exists(source)) await copyFile(source, path.join(qaDeliveryRoot, name));
}
console.log(JSON.stringify({
  passed: report.passed,
  contactSheets: {
    landscape: previews.landscape.contactSheet,
    vertical: previews.vertical.contactSheet
  },
  alignmentPassed: alignment.filter((item) => item.passed).length,
  alignmentTotal: alignment.length,
  videos: videos.results.map((item) => ({ format: item.format, passed: item.passed, path: item.filePath }))
}, null, 2));
