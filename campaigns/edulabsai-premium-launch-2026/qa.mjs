import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const campaignDirectory = dirname(fileURLToPath(import.meta.url));
const deliverablesDirectory = join(campaignDirectory, "deliverables");
const qaDirectory = join(campaignDirectory, ".work", "qa");
const sheetsDirectory = join(qaDirectory, "contact-sheets");

mkdirSync(sheetsDirectory, { recursive: true });

function collectFiles(directory, extension, files = []) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) collectFiles(path, extension, files);
    else if (path.toLowerCase().endsWith(extension)) files.push(path);
  }
  return files;
}

function run(binary, args, includeStderr = false) {
  const result = spawnSync(binary, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return `${result.stdout ?? ""}${includeStderr ? `\n${result.stderr ?? ""}` : ""}`;
}

function inspectMedia(videoPath) {
  const probe = JSON.parse(run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,size,bit_rate:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels",
    "-of", "json",
    videoPath,
  ]));

  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  const duration = Number(probe.format.duration);
  const isVertical = video.height > video.width;
  const targetLufs = isVertical ? -14 : -15;
  const analysis = run("ffmpeg", [
    "-hide_banner", "-i", videoPath,
    "-vf", "blackdetect=d=0.25:pix_th=0.02",
    "-af", `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11:print_format=json,silencedetect=n=-50dB:d=1.25`,
    "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null",
  ], true);

  const loudnessMatches = [...analysis.matchAll(/\{\s*"input_i"[\s\S]*?\}/g)];
  const loudness = loudnessMatches.length
    ? JSON.parse(loudnessMatches.at(-1)[0])
    : null;
  const blackFrames = [...analysis.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)]
    .map((match) => ({ start: Number(match[1]), end: Number(match[2]), duration: Number(match[3]) }));
  const longSilences = [...analysis.matchAll(/silence_duration: ([\d.]+)/g)]
    .map((match) => Number(match[1]));

  const productionId = relative(deliverablesDirectory, videoPath).split(/[\\/]/)[0];
  const subtitlePath = join(dirname(videoPath), `${basename(videoPath, ".mp4")}.srt`);
  const fpsParts = video.r_frame_rate.split("/").map(Number);
  const fps = fpsParts[1] ? fpsParts[0] / fpsParts[1] : fpsParts[0];
  const expectedDimensions = isVertical ? [1080, 1920] : [1920, 1080];
  const checks = {
    h264Video: video.codec_name === "h264",
    aacAudio: audio?.codec_name === "aac",
    dimensions: video.width === expectedDimensions[0] && video.height === expectedDimensions[1],
    frameRate: Math.abs(fps - 30) < 0.01,
    stereo48k: Number(audio?.sample_rate) === 48000 && audio?.channels === 2,
    duration: isVertical ? duration <= 60 : duration <= 120,
    subtitleSidecar: existsSync(subtitlePath) && statSync(subtitlePath).size > 0,
    noBlackHold: blackFrames.length === 0,
    noLongSilence: longSilences.length === 0,
    loudness: loudness && Number(loudness.input_i) >= -18 && Number(loudness.input_i) <= -12,
    truePeak: loudness && Number(loudness.input_tp) <= -1,
  };

  const frameRate = 6 / duration;
  const sheetPath = join(sheetsDirectory, `${productionId}.jpg`);
  const scale = isVertical ? "180:320" : "320:180";
  run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", "-i", videoPath,
    "-vf", `fps=${frameRate.toFixed(8)},scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale}:(ow-iw)/2:(oh-ih)/2:color=0x140D2B,tile=3x2:padding=8:margin=8:color=0x140D2B`,
    "-frames:v", "1", sheetPath,
  ]);

  return {
    productionId,
    master: relative(campaignDirectory, videoPath).replaceAll("\\", "/"),
    subtitle: relative(campaignDirectory, subtitlePath).replaceAll("\\", "/"),
    contactSheet: relative(campaignDirectory, sheetPath).replaceAll("\\", "/"),
    durationSeconds: Number(duration.toFixed(3)),
    dimensions: `${video.width}x${video.height}`,
    fps: Number(fps.toFixed(3)),
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name,
    audioSampleRate: Number(audio?.sample_rate),
    audioChannels: audio?.channels,
    integratedLufs: loudness ? Number(loudness.input_i) : null,
    truePeakDbtp: loudness ? Number(loudness.input_tp) : null,
    blackFrames,
    longSilences,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

const results = collectFiles(deliverablesDirectory, ".mp4")
  .sort()
  .map(inspectMedia);
const report = {
  generatedAt: new Date().toISOString(),
  campaign: "Meet EdulabsAI — premium launch campaign",
  masters: results.length,
  passed: results.filter((result) => result.passed).length,
  failed: results.filter((result) => !result.passed).length,
  results,
};

writeFileSync(join(campaignDirectory, "QA-REPORT.json"), `${JSON.stringify(report, null, 2)}\n`);

const rows = results.map((result) => [
  result.passed ? "PASS" : "FAIL",
  result.productionId,
  result.dimensions,
  `${result.durationSeconds}s`,
  `${result.integratedLufs} LUFS`,
  `${result.truePeakDbtp} dBTP`,
].join(" | "));
const failures = results.flatMap((result) => Object.entries(result.checks)
  .filter(([, passed]) => !passed)
  .map(([check]) => `- ${result.productionId}: ${check}`));

const markdown = `# Final media QA\n\n` +
  `Generated: ${report.generatedAt}\n\n` +
  `Result: **${report.passed}/${report.masters} masters passed**.\n\n` +
  `Status | Production | Dimensions | Duration | Loudness | True peak\n` +
  `--- | --- | --- | ---: | ---: | ---:\n` +
  `${rows.join("\n")}\n\n` +
  `## Automated checks\n\n` +
  `H.264 video, AAC stereo 48 kHz audio, exact platform dimensions, 30 fps, duration limits, SRT sidecar, no black hold longer than 0.25 seconds, no silence longer than 1.25 seconds, practical social loudness, and encoded true peak at or below -1 dBTP.\n\n` +
  `## Failures\n\n${failures.length ? failures.join("\n") : "None."}\n`;

writeFileSync(join(campaignDirectory, "QA-REPORT.md"), markdown);
console.log(JSON.stringify(report, null, 2));

if (report.failed > 0) process.exitCode = 1;
