import path from "node:path";
import { spawn } from "node:child_process";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  createSocialPackage,
  generateNeuralSpeech,
  renderCreatorManifest,
  serializeSrt,
  validateCreatorManifest
} from "../../dist/index.js";
import { production } from "./campaign.mjs";
import { generateClassroomScore } from "./lib/audio.mjs";

const campaignRoot = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(campaignRoot, "../..");
const scenesRoot = path.join(campaignRoot, "assets", "generated", "scenes");
const audioRoot = path.join(campaignRoot, "assets", "generated", "audio");
const workRoot = path.join(campaignRoot, ".work");
const manifestsRoot = path.join(campaignRoot, "manifests");
const deliverablesRoot = path.join(campaignRoot, "deliverables", "final");
const manifestPath = path.join(manifestsRoot, `${production.id}.creator.json`);
const captionsPath = path.join(audioRoot, "raindrop-classroom-captions.srt");
const musicPath = path.join(audioRoot, "curious-classroom-score.wav");

function exists(filePath) {
  return access(filePath).then(() => true, () => false);
}

function relativeFromManifest(filePath) {
  return path.relative(manifestsRoot, filePath).replaceAll("\\", "/");
}

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
      : reject(new Error(`${command} exited ${code}: ${stderr.slice(-3000)}`)));
  });
}

async function probeDuration(filePath) {
  const result = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath]);
  const duration = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not measure ${filePath}`);
  return duration;
}

async function preflight() {
  if (!(await exists(path.join(studioRoot, "dist", "index.js")))) throw new Error("Run npm run build from the repository root first.");
  const missing = [];
  for (const scene of production.scenes) {
    const source = path.join(scenesRoot, scene.image);
    if (!(await exists(source))) missing.push(source);
  }
  if (missing.length) throw new Error(`Missing generated scene plates:\n${missing.join("\n")}`);
  await Promise.all([audioRoot, workRoot, manifestsRoot, deliverablesRoot].map((directory) => mkdir(directory, { recursive: true })));
}

async function generateDialogueAudio() {
  const results = [];
  for (const [sceneIndex, scene] of production.scenes.entries()) {
    for (const [lineIndex, line] of scene.dialogue.entries()) {
      const id = `${String(sceneIndex + 1).padStart(2, "0")}-${scene.id}-${line.speaker}-${lineIndex + 1}`;
      const outputPath = path.join(audioRoot, `${id}.mp3`);
      if (!(await exists(outputPath))) {
        const student = line.speaker === "student";
        await generateNeuralSpeech(line.text, outputPath, {
          voice: student ? production.studentVoice : production.teacherVoice,
          rate: student ? "-4%" : "-7%",
          pitch: student ? "+5Hz" : "+0Hz",
          volume: "+0%",
          timeoutMs: 180_000
        });
      }
      results.push({ sceneId: scene.id, lineIndex, speaker: line.speaker, text: line.text, path: outputPath, duration: await probeDuration(outputPath) });
    }
  }
  return results;
}

function createTimeline(dialogueAssets) {
  const scenes = [];
  const voices = [];
  const captions = [];
  let timelineEnd = 0;
  let captionIndex = 1;

  for (const [sceneIndex, scene] of production.scenes.entries()) {
    const transitionDuration = sceneIndex === 0 ? 0 : scene.transition.durationSeconds;
    const start = sceneIndex === 0 ? 0 : timelineEnd - transitionDuration;
    const lines = dialogueAssets.filter((item) => item.sceneId === scene.id).sort((a, b) => a.lineIndex - b.lineIndex);
    let localCursor = 0.78;
    for (const [lineIndex, line] of lines.entries()) {
      if (lineIndex > 0) localCursor += 0.42;
      const lineStart = start + localCursor;
      const lineEnd = lineStart + line.duration;
      voices.push({
        source: relativeFromManifest(line.path),
        startSeconds: Number(lineStart.toFixed(3)),
        volume: line.speaker === "student" ? 0.98 : 1,
        fadeInSeconds: 0.025,
        fadeOutSeconds: 0.035,
        licenseId: "synthetic-neural-voices"
      });
      captions.push({ index: captionIndex, startSeconds: lineStart, endSeconds: lineEnd, text: line.text });
      captionIndex += 1;
      localCursor += line.duration;
    }
    const duration = Math.max(scene.minimumDuration, localCursor + 1.05);
    const end = start + duration;
    scenes.push({ ...scene, start, end, duration });
    timelineEnd = end;
  }

  return { scenes, voices, captions, duration: timelineEnd };
}

function buildOverlays(timeline) {
  const labelOverlays = timeline.scenes.map((scene, index) => ({
    id: `${scene.id}-label`,
    type: "text",
    text: scene.label,
    startSeconds: Number((scene.start + 0.28).toFixed(3)),
    endSeconds: Number(Math.min(scene.end - 0.5, scene.start + (index === 0 ? 4.4 : 3.25)).toFixed(3)),
    x: 0.5,
    y: 0.135,
    width: 840,
    height: 132,
    fontSize: index === 0 || index === timeline.scenes.length - 1 ? 50 : 54,
    color: production.palette.cream,
    background: "#0B2545E6",
    accent: index % 2 ? production.palette.sky : production.palette.yellow,
    cornerRadius: 42,
    animation: { enter: index === 0 ? "drop" : "rise", exit: "fade", loop: "none", durationSeconds: 0.5, exitDurationSeconds: 0.28 }
  }));
  const first = timeline.scenes[0];
  const last = timeline.scenes.at(-1);
  const dropSource = relativeFromManifest(path.join(campaignRoot, "assets", "water-drop.svg"));
  return [
    ...labelOverlays,
    {
      id: "opening-water-drop",
      type: "image",
      source: dropSource,
      startSeconds: 0.25,
      endSeconds: 4.4,
      x: 0.81,
      y: 0.32,
      width: 112,
      height: 140,
      licenseId: "campaign-motion-design",
      animation: { enter: "drop", exit: "fade", loop: "none", durationSeconds: 0.62, exitDurationSeconds: 0.25 }
    },
    {
      id: "closing-water-drop",
      type: "image",
      source: dropSource,
      startSeconds: Number((last.start + 10.2).toFixed(3)),
      endSeconds: Number((last.end - 0.15).toFixed(3)),
      x: 0.81,
      y: 0.3,
      width: 124,
      height: 155,
      licenseId: "campaign-motion-design",
      animation: { enter: "pop", exit: "fade", loop: "pulse", durationSeconds: 0.5, exitDurationSeconds: 0.2, intensity: 0.035 }
    }
  ];
}

await preflight();
const startedAt = new Date();
console.log(`${startedAt.toISOString()} Generating and measuring natural scene dialogue`);
const dialogueAssets = await generateDialogueAudio();
const timeline = createTimeline(dialogueAssets);
console.log(`${new Date().toISOString()} Timeline measured at ${timeline.duration.toFixed(2)} seconds`);
await writeFile(captionsPath, `${serializeSrt(timeline.captions).trimEnd()}\n`, "utf8");
await generateClassroomScore(musicPath, timeline.duration + 0.4);
const productionPlan = JSON.parse(await readFile(path.join(campaignRoot, "production-plan.json"), "utf8"));

const manifest = {
  schemaVersion: 2,
  title: production.title,
  description: production.description,
  outputDirectory: relativeFromManifest(path.join(workRoot, "render")),
  brand: {
    name: "Curious Classroom",
    primary: production.palette.yellow,
    secondary: production.palette.sky,
    text: production.palette.cream,
    fontFamily: "Segoe UI, Arial, sans-serif"
  },
  clips: timeline.scenes.map((scene) => ({
    id: scene.id,
    source: relativeFromManifest(path.join(scenesRoot, scene.image)),
    kind: "image",
    durationSeconds: Number(scene.duration.toFixed(3)),
    reframe: "fill",
    focusX: 0.5,
    focusY: scene.id === "complete-cycle" ? 0.54 : 0.5,
    motion: scene.motion,
    transition: scene.transition,
    effects: { saturation: 1.04, contrast: 1.015, sharpen: 0.18, fadeInSeconds: scene.id === "welcome" ? 0.35 : undefined, fadeOutSeconds: scene.id === "complete-cycle" ? 0.55 : undefined },
    chapter: scene.label.replace(/^\d\s+/, ""),
    licenseId: "original-generated-classroom-art"
  })),
  overlays: buildOverlays(timeline),
  captions: {
    source: relativeFromManifest(captionsPath),
    format: "srt",
    burn: true,
    sidecar: true,
    language: "en",
    style: {
      position: "bottom",
      fontSize: 50,
      color: "#FFFDF7",
      background: "#071B32E8",
      accent: production.palette.yellow,
      maxCharactersPerLine: 27,
      maxLines: 2,
      margin: 330
    }
  },
  audio: {
    voices: timeline.voices,
    music: {
      source: relativeFromManifest(musicPath),
      startSeconds: 0,
      volume: 0.17,
      loop: false,
      fadeInSeconds: 1.1,
      fadeOutSeconds: 2.1,
      licenseId: "original-procedural-score"
    },
    keepClipAudio: false,
    duckMusic: true,
    duckingThreshold: 0.025,
    mode: "voice",
    targetLufs: -15,
    truePeak: -2
  },
  chapters: timeline.scenes.map((scene) => ({ title: scene.label.replace(/^\d\s+/, ""), startSeconds: Number(scene.start.toFixed(3)) })),
  exports: [
    {
      id: "master",
      preset: "shorts",
      fileName: "raindrop-classroom-cartoon-short.mp4",
      title: "The Journey of a Raindrop | Animated Classroom Short",
      description: "Ms. Maya and her class discover evaporation, condensation, precipitation, and collection in one original animated mini-lesson.",
      tags: ["water cycle", "animated classroom", "science for kids", "education", "shorts", "reels"],
      quality: 18,
      videoCodec: "h264",
      thumbnailAtSeconds: Number((timeline.scenes.at(-1).start + 2.2).toFixed(3)),
      burnCaptions: true
    }
  ],
  licenses: [
    {
      id: "original-generated-classroom-art",
      source: "OpenAI built-in image generation",
      title: "Original fictional classroom cast and six scene plates",
      creator: "Generated for the Agent Demo Studio campaign",
      license: "Original synthetic campaign artwork; review platform synthetic-media disclosure requirements",
      attribution: "No real people, students, brands, or copyrighted characters depicted"
    },
    {
      id: "synthetic-neural-voices",
      source: "Microsoft Edge neural text-to-speech",
      title: "Ms. Maya and student synthetic voices",
      creator: "Microsoft neural voice service",
      license: "Synthetic speech generated from original campaign text",
      attribution: "No identity cloning"
    },
    {
      id: "original-procedural-score",
      source: "campaigns/cartoon-classroom-reel-2026/lib/audio.mjs",
      title: "Curious Classroom",
      creator: "Agent Demo Studio procedural synthesizer",
      license: "Original code-generated music with no samples"
    },
    {
      id: "campaign-motion-design",
      source: "campaigns/cartoon-classroom-reel-2026/assets/water-drop.svg",
      title: "Original water-drop motion graphic",
      creator: "Agent Demo Studio campaign",
      license: "Original campaign artwork"
    }
  ],
  metadata: {
    productionId: production.id,
    productionMode: "cartoon",
    workflow: "plan-first-original-animation",
    productionPlanPath: "../production-plan.json",
    productionPlan,
    sceneTimeline: timeline.scenes.map((scene) => ({ id: scene.id, startSeconds: scene.start, endSeconds: scene.end, durationSeconds: scene.duration })),
    targetPlatforms: ["youtube-shorts", "instagram-reels"],
    syntheticMedia: true,
    fictionalPeopleOnly: true,
    imageGenerationProvider: "OpenAI built-in image generation"
  }
};

const validation = validateCreatorManifest(manifest);
if (!validation.valid) throw new Error(`Manifest validation failed:\n${validation.issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n")}`);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`${new Date().toISOString()} Rendering native 1080x1920 animated master`);
const renderResult = await renderCreatorManifest(manifestPath, (progress, message) => {
  console.log(`${new Date().toISOString()} ${Math.round(progress)}% ${message}`);
});
const socialPackage = await createSocialPackage(manifest, renderResult, deliverablesRoot);
await Promise.all([
  copyFile(path.join(campaignRoot, "production-plan.json"), path.join(deliverablesRoot, "production-plan.json")),
  copyFile(path.join(campaignRoot, "RESOURCE-LIST.md"), path.join(deliverablesRoot, "RESOURCE-LIST.md")),
  copyFile(path.join(campaignRoot, "IMAGE-ASSET-PROVENANCE.md"), path.join(deliverablesRoot, "IMAGE-ASSET-PROVENANCE.md")),
  copyFile(path.join(campaignRoot, "MANUAL-VISUAL-QA.md"), path.join(deliverablesRoot, "MANUAL-VISUAL-QA.md")),
  copyFile(manifestPath, path.join(deliverablesRoot, path.basename(manifestPath)))
]);
const summary = {
  productionId: production.id,
  title: production.title,
  startedAt: startedAt.toISOString(),
  completedAt: new Date().toISOString(),
  elapsedSeconds: Number(((Date.now() - startedAt.getTime()) / 1000).toFixed(1)),
  measuredTimelineSeconds: Number(timeline.duration.toFixed(3)),
  voices: { teacher: production.teacherVoice, student: production.studentVoice },
  renderResult,
  packageDirectory: socialPackage.directory,
  finalVideo: socialPackage.outputs[0]?.video,
  finalThumbnail: socialPackage.outputs[0]?.thumbnail,
  finalCaptions: socialPackage.outputs[0]?.captions,
  manifest: manifestPath,
  validation: validation.issues
};
await writeFile(path.join(campaignRoot, "BUILD-SUMMARY.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
await copyFile(path.join(campaignRoot, "BUILD-SUMMARY.json"), path.join(deliverablesRoot, "BUILD-SUMMARY.json"));
console.log(JSON.stringify(summary, null, 2));
