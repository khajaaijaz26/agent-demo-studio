import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { renderCreatorManifest } from "../dist/creator/renderer.js";
import { analyzeMedia } from "../dist/creator/media.js";
import { createSocialPackage } from "../dist/creator/social.js";
import { runCommand } from "../dist/utils/process.js";
import sharp from "sharp";

async function command(command, args) {
  const result = await runCommand(command, args, { timeoutMs: 120_000 });
  if (result.code !== 0) throw new Error(result.stderr || `${command} failed with exit code ${result.code}.`);
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-demo-creator-smoke-"));
try {
  const first = path.join(temporaryRoot, "first.mp4");
  const second = path.join(temporaryRoot, "second.mp4");
  const music = path.join(temporaryRoot, "music.m4a");
  const captions = path.join(temporaryRoot, "captions.srt");
  const logo = path.join(temporaryRoot, "logo.png");
  const outputDirectory = path.join(temporaryRoot, "output");

  await command("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "1.25", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", first,
  ]);
  await command("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000",
    "-t", "1.1", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", second,
  ]);
  await command("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "sine=frequency=180:sample_rate=48000",
    "-t", "3", "-c:a", "aac", music,
  ]);
  await writeFile(captions, "1\n00:00:00,050 --> 00:00:01,000\nCreator engine smoke test\n\n2\n00:00:01,050 --> 00:00:02,200\nOne edit, every format.\n", "utf8");
  await sharp(Buffer.from('<svg width="240" height="80" xmlns="http://www.w3.org/2000/svg"><rect width="240" height="80" rx="20" fill="#7C3AED"/><text x="120" y="51" text-anchor="middle" font-family="Arial" font-size="28" font-weight="700" fill="white">DEMO</text></svg>')).png().toFile(logo);

  const analysis = await analyzeMedia(first, { sceneThreshold: 0.2 });
  if (!analysis.hasVideo || !analysis.hasAudio || analysis.durationSeconds < 1) throw new Error(`Unexpected media analysis: ${JSON.stringify(analysis)}`);

  const manifest = {
    schemaVersion: 2,
    title: "Creator engine smoke test",
    outputDirectory,
    brand: { name: "Agent Demo Studio", logo, logoLicenseId: "generated-logo", primary: "#7C3AED", secondary: "#22D3EE", text: "#FFFFFF" },
    clips: [
      { id: "landscape", source: first, speedRamp: { from: 1, to: 1.35, steps: 3 }, reframe: "blur-background", effects: { saturation: 1.08, vfx: ["cinematic"] }, chapter: "Landscape source", licenseId: "generated-fixture" },
      { id: "portrait", source: second, reframe: "fill", transition: { type: "blur", durationSeconds: 0.25 }, chapter: "Portrait source", licenseId: "generated-fixture-2" },
      { id: "image-finale", source: logo, kind: "image", durationSeconds: 0.8, motion: "ken-burns-in", reframe: "blur-background", effects: { vfx: ["glow"] }, transition: { type: "zoom-in", durationSeconds: 0.2 }, chapter: "Animated image", licenseId: "generated-logo" },
    ],
    overlays: [
      { id: "cta", type: "cta", text: "Create everywhere", startSeconds: 0.2, endSeconds: 1.9, x: 0.5, y: 0.24 },
      { id: "character", type: "character", source: "builtin:character/nova", startSeconds: 0.35, endSeconds: 2.25, x: 0.78, y: 0.58, width: 280, animation: { enter: "pop", exit: "fade", loop: "talk", durationSeconds: 0.25 } },
      { id: "video-layer", type: "video", source: second, startSeconds: 0.55, endSeconds: 1.55, x: 0.23, y: 0.54, width: 250, height: 444, opacity: 0.85, loop: true, flipHorizontal: true, chromaKey: { color: "#00FF00", similarity: 0.08, blend: 0.03 }, animation: { enter: "rise", exit: "fade", durationSeconds: 0.2 }, licenseId: "generated-fixture-2" },
    ],
    captions: { source: captions, burn: true, sidecar: true, style: { position: "bottom", maxCharactersPerLine: 28 } },
    audio: {
      keepClipAudio: true,
      music: { source: music, loop: true, volume: 0.08, licenseId: "generated-music" },
      ambience: { source: music, loop: true, volume: 0.025, pan: -0.25, licenseId: "generated-music" },
      soundEffects: [{ source: music, startSeconds: 0.75, trimEndSeconds: 0.25, volume: 0.04, pan: 0.35, licenseId: "generated-music" }],
      mode: "cinematic",
      duckMusic: true,
      targetLufs: -14,
    },
    exports: [{ id: "vertical", preset: "shorts", quality: 24, thumbnailAtSeconds: 0.7 }],
    licenses: [
      { id: "generated-fixture", source: first, license: "Generated test fixture" },
      { id: "generated-fixture-2", source: second, license: "Generated test fixture" },
      { id: "generated-music", source: music, license: "Generated test fixture" },
      { id: "generated-logo", source: logo, license: "Generated test fixture" },
    ],
  };
  const result = await renderCreatorManifest(manifest, (progress, message) => process.stderr.write(`\r[creator ${String(Math.round(progress)).padStart(3)}%] ${message.padEnd(54)}`), { baseDirectory: temporaryRoot });
  process.stderr.write("\n");

  const output = result.outputs[0];
  if (!output) throw new Error("Creator smoke test produced no output.");
  if (output.width !== 1080 || output.height !== 1920 || output.fps !== 30) throw new Error(`Unexpected output profile: ${JSON.stringify(output)}`);
  if (!output.validation.some((issue) => issue.code === "PROFILE_OK")) throw new Error(`Profile validation failed: ${JSON.stringify(output.validation)}`);
  if ((await stat(output.thumbnailPath)).size > 2 * 1024 * 1024) throw new Error("Creator thumbnail exceeds the 2 MB publishing limit.");
  const packaged = await createSocialPackage(manifest, result, path.join(temporaryRoot, "publish-package"));
  const packagedOutput = packaged.outputs[0];
  if (!packagedOutput?.captions || !packagedOutput.chapters) throw new Error(`Publishing package omitted sidecars: ${JSON.stringify(packagedOutput)}`);
  await Promise.all([packagedOutput.video, packagedOutput.thumbnail, packagedOutput.captions, packagedOutput.chapters, packagedOutput.publishingPlan].map((file) => stat(file)));
  const licenseReport = await readFile(result.licenseReportPath, "utf8");
  if (!licenseReport.includes("agent-demo-nova")) throw new Error("Bundled character provenance was omitted from the license report.");

  const probe = await runCommand("ffprobe", [
    "-v", "error", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "json", output.videoPath,
  ], { timeoutMs: 30_000 });
  if (probe.code !== 0) throw new Error(probe.stderr);
  const details = JSON.parse(probe.stdout);
  const video = details.streams?.find((stream) => stream.width);
  const audio = details.streams?.find((stream) => stream.codec_name === "aac");
  if (video?.codec_name !== "h264" || video.width !== 1080 || video.height !== 1920 || !audio) {
    throw new Error(`Unexpected encoded streams: ${JSON.stringify(details.streams)}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, profile: output.preset, durationSeconds: output.durationSeconds, streams: details.streams }, null, 2)}\n`);
} finally {
  const resolved = path.resolve(temporaryRoot);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("agent-demo-creator-smoke-")) {
    await rm(resolved, { recursive: true, force: true });
  }
}
