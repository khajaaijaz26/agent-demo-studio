import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { createSocialPackage, renderCreatorManifest } from "../../../dist/index.js";

import { campaign } from "../campaign.mjs";
import { generateSceneSpeech, generateScore, prepareSoundEffects, writeCaptions } from "./audio.mjs";
import { prepareVisualAssets } from "./assets.mjs";

const LEAD = 0.34;
const TAIL = 0.62;
const TRANSITION_DURATION = 0.46;

function relative(fromDirectory, filePath) {
  const value = path.relative(fromDirectory, filePath).replaceAll("\\", "/");
  return value.startsWith(".") ? value : `./${value}`;
}

function safeSceneDuration(speechDuration, format) {
  const minimum = format === "vertical" ? 3.8 : 4.4;
  return Math.max(minimum, speechDuration + LEAD + TAIL);
}

function computeTimeline(production, speech) {
  const entries = [];
  let timeline = 0;
  for (let index = 0; index < production.scenes.length; index += 1) {
    const scene = production.scenes[index];
    const voice = speech.find((item) => item.sceneId === scene.id);
    if (!voice) throw new Error(`Missing voice for scene '${scene.id}'.`);
    const duration = safeSceneDuration(voice.duration, production.format);
    const transition = index === 0 ? 0 : TRANSITION_DURATION;
    const start = index === 0 ? 0 : timeline - transition;
    const end = start + duration;
    entries.push({ scene, voice, start, end, duration, transition });
    timeline = end;
  }
  return { entries, duration: timeline };
}

function positionFor(production, scene, role, index = 0) {
  const vertical = production.format === "vertical";
  if (vertical) {
    if (role === "headline") return { x: 0.5, y: 0.2, width: 980 };
    if (role === "video" || role === "frame") return { x: 0.5, y: index ? 0.68 : 0.585, width: 980, height: 551 };
    if (role === "art") return { x: 0.5, y: scene.visual ? 0.78 : 0.64, width: scene.visual ? 420 : 860 };
    if (role === "logo") return { x: 0.5, y: 0.055, width: 300 };
  }
  if (scene.layout === "dual") {
    if (role === "headline") return { x: 0.5, y: 0.205, width: 790 };
    if (role === "video" || role === "frame") return { x: index ? 0.71 : 0.29, y: 0.625, width: 720, height: 405 };
    if (role === "art") return { x: 0.5, y: 0.49, width: 250 };
  }
  if (scene.layout === "screen-left") {
    // Keep a clean gutter between the product frame and right-hand copy.
    if (role === "headline") return { x: 0.805, y: 0.49, width: 720 };
    if (role === "video" || role === "frame") return { x: 0.315, y: 0.515, width: 1080, height: 608 };
    if (role === "art") return { x: 0.82, y: 0.79, width: 260 };
  }
  if (scene.layout === "screen-right" || scene.visual) {
    if (role === "headline") return { x: 0.235, y: 0.49, width: 760 };
    if (role === "video" || role === "frame") return { x: 0.69, y: 0.515, width: 1080, height: 608 };
    if (role === "art") return { x: 0.15, y: 0.79, width: 260 };
  }
  if (role === "headline") return { x: 0.255, y: 0.5, width: 790 };
  if (role === "art") return { x: 0.73, y: 0.52, width: 840 };
  if (role === "logo") return { x: 0.115, y: 0.07, width: 250 };
  return { x: 0.5, y: 0.5 };
}

function sourceScene(sourceRoot, fileName) {
  if (!fileName) return undefined;
  return path.join(sourceRoot, fileName);
}

function artOverlay(production, entry, assets) {
  if (!entry.scene.art) return undefined;
  const placement = positionFor(production, entry.scene, "art");
  const start = entry.start + 0.12;
  const end = entry.end - 0.12;
  return {
    id: `${entry.scene.id}-art`,
    type: "image",
    source: assets.art[entry.scene.art],
    startSeconds: start,
    endSeconds: end,
    ...placement,
    opacity: entry.scene.visual ? 0.9 : 1,
    animation: {
      enter: entry.scene.art === "finale" ? "pop" : "rise",
      exit: "fade",
      loop: entry.scene.art === "connected-loop" || entry.scene.art === "logo-orbit" ? "drift" : "float",
      durationSeconds: 0.52,
      exitDurationSeconds: 0.35,
      intensity: entry.scene.visual ? 0.18 : 0.32,
    },
    licenseId: "edulabsai-original-motion-art",
  };
}

function videoOverlays(production, entry, sourceRoot, framePath) {
  const sources = [entry.scene.visual, entry.scene.secondaryVisual].filter(Boolean);
  const overlays = [];
  for (const [index, source] of sources.entries()) {
    const placement = positionFor(production, entry.scene, "video", index);
    const framePlacement = positionFor(production, entry.scene, "frame", index);
    const start = entry.start + 0.2 + index * 0.12;
    const end = entry.end - 0.16;
    const enter = production.format === "vertical" ? "rise" : index ? "slide-right" : entry.scene.layout === "screen-left" ? "slide-left" : "slide-right";
    overlays.push({
      id: `${entry.scene.id}-product-${index + 1}`,
      type: "video",
      source: sourceScene(sourceRoot, source),
      startSeconds: start,
      endSeconds: end,
      ...placement,
      loop: true,
      animation: { enter, exit: "fade", durationSeconds: 0.48, exitDurationSeconds: 0.3 },
      licenseId: "edulabsai-verified-product-recording",
    });
    overlays.push({
      id: `${entry.scene.id}-frame-${index + 1}`,
      type: "image",
      source: framePath,
      startSeconds: start,
      endSeconds: end,
      ...framePlacement,
      animation: { enter, exit: "fade", durationSeconds: 0.48, exitDurationSeconds: 0.3 },
      licenseId: "edulabsai-original-motion-art",
    });
  }
  return overlays;
}

function headlineOverlay(production, entry, headlinePath) {
  return {
    id: `${entry.scene.id}-headline`,
    type: "image",
    source: headlinePath,
    startSeconds: entry.start + 0.08,
    endSeconds: entry.end - 0.1,
    ...positionFor(production, entry.scene, "headline"),
    animation: {
      enter: production.format === "vertical" ? "rise" : "slide-left",
      exit: "fade",
      durationSeconds: 0.5,
      exitDurationSeconds: 0.3,
      loop: "none",
      intensity: 0.72,
    },
    licenseId: "edulabsai-original-motion-art",
  };
}

function logoOverlay(production, entry, logoPath) {
  const placement = positionFor(production, entry.scene, "logo");
  return {
    id: `${entry.scene.id}-brand`,
    type: "image",
    source: logoPath,
    startSeconds: entry.start + 0.04,
    endSeconds: entry.end - 0.04,
    ...placement,
    opacity: 0.94,
    animation: { enter: "fade", exit: "fade", durationSeconds: 0.3, exitDurationSeconds: 0.25 },
    licenseId: "edulabsai-brand",
  };
}

function captionStyle(format) {
  return format === "vertical"
    ? { position: "bottom", fontSize: 50, background: "#160B2AEF", accent: campaign.palette.coral, color: campaign.palette.cream, maxCharactersPerLine: 30, maxLines: 2, margin: 210 }
    : { position: "bottom", fontSize: 39, background: "#160B2AEF", accent: campaign.palette.coral, color: campaign.palette.cream, maxCharactersPerLine: 52, maxLines: 2, margin: 78 };
}

async function makePortablePackage(packageDirectory, production, renderResult, timeline) {
  const releasePath = path.join(packageDirectory, "release-manifest.json");
  const portable = {
    schemaVersion: 2,
    campaign: campaign.name,
    productionId: production.id,
    title: production.title,
    format: production.format,
    generatedAt: new Date().toISOString(),
    durationSeconds: renderResult.outputs[0]?.durationSeconds,
    outputs: renderResult.outputs.map((output) => ({
      id: output.id,
      preset: output.preset,
      video: path.basename(output.videoPath),
      thumbnail: path.basename(output.thumbnailPath),
      captions: output.captionsPath ? path.basename(output.captionsPath) : undefined,
      chapters: output.chaptersPath ? path.basename(output.chaptersPath) : undefined,
      validation: output.validation,
    })),
    sceneTimeline: timeline.entries.map((entry) => ({
      id: entry.scene.id,
      startSeconds: Number(entry.start.toFixed(3)),
      endSeconds: Number(entry.end.toFixed(3)),
      narration: entry.scene.narration,
    })),
    rights: [
      "EdulabsAI-owned brand and verified product recordings",
      "Original campaign motion graphics, score, and sound effects",
      "Microsoft Edge neural speech subject to provider terms",
    ],
    reviewRequiredBeforePublishing: true,
  };
  await writeFile(releasePath, `${JSON.stringify(portable, null, 2)}\n`, "utf8");
}

export async function renderProduction({ production, campaignRoot, studioRoot, sourceRoot, workRoot, assetsRoot, deliverablesRoot, manifestsRoot, report = console.log }) {
  report(`[${production.id}] generating scene-locked neural narration`);
  const speech = await generateSceneSpeech(production, workRoot, campaign.voice, campaign.voiceRate);
  const timeline = computeTimeline(production, speech);
  report(`[${production.id}] ${timeline.duration.toFixed(1)} seconds across ${timeline.entries.length} scenes`);
  const assets = await prepareVisualAssets(assetsRoot, production);
  const soundEffects = await prepareSoundEffects(path.join(assetsRoot, "audio"));
  const productionWork = path.join(workRoot, production.id);
  const musicPath = path.join(productionWork, "connected-spark.wav");
  await generateScore(musicPath, timeline.duration, production.musicProfile, timeline.entries.slice(1).map((entry) => entry.start));
  const captionsPath = path.join(productionWork, `${production.id}.srt`);
  await writeCaptions(captionsPath, timeline.entries.map((entry) => ({
    start: entry.start + LEAD,
    end: Math.min(entry.end - TAIL * 0.5, entry.start + LEAD + entry.voice.duration),
    text: entry.scene.narration,
    maxWords: production.format === "vertical" ? 7 : 10,
  })));

  const manifestDirectory = manifestsRoot;
  await mkdir(manifestDirectory, { recursive: true });
  const manifestPath = path.join(manifestDirectory, `${production.id}.creator.json`);
  const clipStarts = timeline.entries.map((entry) => entry.start);
  const clips = timeline.entries.map((entry, index) => ({
    id: entry.scene.id,
    source: relative(manifestDirectory, assets.backgrounds[index % assets.backgrounds.length]),
    kind: "image",
    durationSeconds: Number(entry.duration.toFixed(3)),
    motion: "none",
    reframe: "fill",
    effects: { saturation: 1.04, contrast: 1.02, vfx: index === 0 || index === timeline.entries.length - 1 ? ["cinematic", "glow"] : ["cinematic"] },
    transition: { type: index === 0 ? "cut" : entry.scene.transition ?? "dissolve", durationSeconds: TRANSITION_DURATION },
    chapter: entry.scene.eyebrow,
    licenseId: "edulabsai-original-motion-art",
  }));
  const overlays = [];
  for (const entry of timeline.entries) {
    const art = artOverlay(production, entry, assets);
    if (art) overlays.push({ ...art, source: relative(manifestDirectory, art.source) });
    for (const overlay of videoOverlays(production, entry, sourceRoot, assets.frame)) {
      overlays.push({ ...overlay, source: relative(manifestDirectory, overlay.source) });
    }
    const headline = headlineOverlay(production, entry, assets.headlines[entry.scene.id]);
    overlays.push({ ...headline, source: relative(manifestDirectory, headline.source) });
    const logo = logoOverlay(production, entry, assets.logo);
    overlays.push({ ...logo, source: relative(manifestDirectory, logo.source) });
  }
  const voices = timeline.entries.map((entry) => ({
    source: relative(manifestDirectory, entry.voice.path),
    startSeconds: Number((entry.start + LEAD).toFixed(3)),
    volume: 1,
    licenseId: "microsoft-edge-neural-speech",
  }));
  const sfx = [];
  for (const [index, entry] of timeline.entries.entries()) {
    const effect = index === 0 || index === timeline.entries.length - 1 ? soundEffects.impact : index % 3 === 0 ? soundEffects.sparkle : soundEffects.whoosh;
    sfx.push({ source: relative(manifestDirectory, effect), startSeconds: Number(entry.start.toFixed(3)), volume: index === 0 || index === timeline.entries.length - 1 ? 0.2 : 0.12, licenseId: "edulabsai-original-sound-design" });
  }
  const preset = production.format === "vertical" ? "reels" : "youtube-1080p";
  const manifest = {
    schemaVersion: 2,
    title: production.title,
    description: `${production.description} ${campaign.website}`,
    outputDirectory: relative(manifestDirectory, path.join(workRoot, "renders", production.id)),
    brand: {
      name: "EdulabsAI",
      primary: campaign.palette.coral,
      secondary: campaign.palette.gold,
      text: campaign.palette.cream,
      fontFamily: "Segoe UI",
    },
    clips,
    overlays,
    captions: {
      source: relative(manifestDirectory, captionsPath),
      format: "srt",
      burn: production.captionBurn !== false,
      sidecar: true,
      language: "en",
      style: captionStyle(production.format),
    },
    audio: {
      voices,
      music: { source: relative(manifestDirectory, musicPath), loop: false, volume: production.format === "vertical" ? 0.25 : 0.22, fadeInSeconds: 0.8, fadeOutSeconds: 1.4, licenseId: "edulabsai-connected-spark-score" },
      soundEffects: sfx,
      mode: "cinematic",
      keepClipAudio: false,
      duckMusic: true,
      duckingThreshold: 0.035,
      targetLufs: production.format === "vertical" ? -14 : -15,
      // Extra headroom prevents AAC encoding overshoot in social-platform masters.
      truePeak: -2.3,
    },
    chapters: timeline.entries.map((entry) => ({ title: entry.scene.eyebrow, startSeconds: Number(entry.start.toFixed(3)) })),
    exports: [{
      id: production.format === "vertical" ? "reels-master" : "landscape-master",
      preset,
      fileName: production.id,
      title: production.title,
      description: production.description,
      tags: ["EdulabsAI", "AI for teachers", "lesson planning", "K-12", production.format === "vertical" ? "Reels" : "product launch"],
      quality: 18,
      burnCaptions: production.captionBurn !== false,
      thumbnailAtSeconds: Number(Math.min(timeline.duration - 0.2, clipStarts[Math.min(1, clipStarts.length - 1)] + 1.1).toFixed(3)),
    }],
    licenses: [
      { id: "edulabsai-brand", source: "EdulabsAI brand identity", title: "EdulabsAI brand", creator: "EdulabsAI", license: "Owner-provided", attribution: "EdulabsAI", proofUrl: campaign.website },
      { id: "edulabsai-verified-product-recording", source: "Verified EdulabsAI browser recordings", title: "EdulabsAI product UI", creator: "EdulabsAI", license: "Owner-provided", attribution: "EdulabsAI", proofUrl: "test-output/edulabs-v2/recorded-scenes.json" },
      { id: "edulabsai-original-motion-art", source: "Generated campaign SVG and PNG motion art", title: "EdulabsAI campaign motion system", creator: "EdulabsAI with Agent Demo Studio", license: "Original work", attribution: "EdulabsAI" },
      { id: "edulabsai-connected-spark-score", source: "Generated Connected Spark score", title: "Connected Spark", creator: "EdulabsAI with Agent Demo Studio", license: "Original procedural composition", attribution: "EdulabsAI" },
      { id: "edulabsai-original-sound-design", source: "Generated impact, whoosh, sparkle, and click cues", title: "EdulabsAI campaign sound design", creator: "EdulabsAI with Agent Demo Studio", license: "Original procedural sound", attribution: "EdulabsAI" },
      { id: "microsoft-edge-neural-speech", source: campaign.voice, title: campaign.voiceName, creator: "Microsoft", license: "Provider terms", attribution: "Neural narration" },
    ],
    metadata: {
      campaign: campaign.name,
      campaignVersion: 2,
      productionId: production.id,
      creativeDirection: "CREATIVE-DIRECTION.md",
      sourceTourUsedAsFootageOnly: true,
      syntheticVoice: true,
      originalMusic: true,
      sceneTimeline: timeline.entries.map((entry) => ({ id: entry.scene.id, startSeconds: entry.start, endSeconds: entry.end })),
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  report(`[${production.id}] rendering with Agent Demo Studio creator engine`);
  const renderResult = await renderCreatorManifest(manifestPath, (progress, message) => report(`[${production.id}] ${Math.round(progress)}% ${message}`));
  const packageDirectory = path.join(deliverablesRoot, production.id);
  await createSocialPackage(manifest, renderResult, packageDirectory);
  await makePortablePackage(packageDirectory, production, renderResult, timeline);
  const packageSummaryPath = path.join(packageDirectory, "PACKAGE-SUMMARY.json");
  const packageSummary = JSON.parse(await readFile(packageSummaryPath, "utf8"));
  await writeFile(packageSummaryPath, `${JSON.stringify({ productionId: production.id, title: production.title, format: production.format, durationSeconds: renderResult.outputs[0]?.durationSeconds, outputs: packageSummary }, null, 2)}\n`, "utf8");
  report(`[${production.id}] package ready: ${packageDirectory}`);
  return { production, manifestPath, manifest, timeline, renderResult, packageDirectory };
}
