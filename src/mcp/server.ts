import { pathToFileURL } from "node:url";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { AGENT_DEMO_VERSION } from "../config.js";
import { createProject, listProjects, loadProject, resolveArtifact } from "../project-store.js";
import { jobs } from "../jobs.js";
import {
  captureBrowserSnapshot,
  finishBrowserSession,
  listActiveBrowserSessions,
  performBrowserAction,
  startBrowserSession,
} from "../browser/recorder.js";
import { generateVoiceover } from "../audio/tts.js";
import { generateAmbientMusic, generateAsmrSoundscape } from "../audio/music.js";
import { renderDemo } from "../render/renderer.js";
import { renderSynchronizedManifest } from "../render/synchronized.js";
import { recordDemoFlow } from "../workflow.js";
import { runDoctor } from "../installer/agents.js";
import { startStudioServer, type StudioServerHandle } from "../studio/server.js";
import type { BrowserAction, DemoProject, RecordFlowInput, RenderDemoInput } from "../types.js";
import { analyzeMedia } from "../creator/media.js";
import { transcribeMedia } from "../creator/captions.js";
import { listCreatorPresets } from "../creator/presets.js";
import { createTemplateManifest, listCreatorTemplates } from "../creator/templates.js";
import { loadCreatorManifest, validateCreatorManifest } from "../creator/schema.js";
import { remixMedia, renderCreatorManifest } from "../creator/renderer.js";
import { createSocialPackage } from "../creator/social.js";
import { publishMetadataFromOutput, publishToInstagram, publishToTikTok, publishToYouTube } from "../creator/publish.js";
import { listCreatorAssets } from "../creator/assets.js";
import { getLocalAiStatus, warmLocalPlanner } from "../creator/local-ai.js";
import { createPromptVideoProject, createSmartPromptVideoPlan } from "../creator/prompt.js";
import {
  CREATOR_IMAGE_MOTIONS,
  CREATOR_LOOP_ANIMATIONS,
  CREATOR_OVERLAY_ANIMATIONS,
  CREATOR_PROMPT_MODES,
  CREATOR_TRANSITIONS,
  CREATOR_VFX_PRESETS,
} from "../creator/types.js";
import type { CreatorManifest, CreatorPresetId, CreatorPromptVideoResult, CreatorRenderResult, CreatorRenderedOutput } from "../creator/types.js";

const themeSchema = z
  .object({
    backgroundStart: z.string().optional(),
    backgroundEnd: z.string().optional(),
    frame: z.string().optional(),
    frameBorder: z.string().optional(),
    accent: z.string().optional(),
    highlight: z.string().optional(),
    text: z.string().optional(),
    mutedText: z.string().optional(),
    browserTitle: z.string().optional(),
    badge: z.string().optional(),
  })
  .optional();

const renderSchema = z
  .object({
    width: z.number().int().min(640).max(3840).optional(),
    height: z.number().int().min(360).max(2160).optional(),
    fps: z.number().int().min(24).max(60).optional(),
    quality: z.number().int().min(14).max(30).optional(),
    introSeconds: z.number().min(0).max(10).optional(),
    outroSeconds: z.number().min(0).max(10).optional(),
    trimStartSeconds: z.number().min(0).optional(),
    trimEndSeconds: z.number().min(0).optional(),
    captions: z.boolean().optional(),
  })
  .optional();

const actionSchema = z.object({
  type: z.enum(["navigate", "click", "fill", "press", "hover", "scroll", "wait", "chapter"]),
  selector: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  text: z.string().optional(),
  value: z.string().optional(),
  key: z.string().optional(),
  url: z.string().optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  milliseconds: z.number().int().min(0).max(60_000).optional(),
  deltaX: z.number().optional(),
  deltaY: z.number().optional(),
});

const promptCharacterSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  source: z.string().min(1),
  role: z.enum(["presenter", "character"]).default("character"),
  style: z.string().optional(),
  rights: z.string().optional(),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
});

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function result(value: unknown) {
  const safe = jsonSafe(value);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(safe, null, 2) }],
    structuredContent: safe as Record<string, unknown>,
  };
}

function projectResult(project: DemoProject, root?: string) {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "resource_link"; uri: string; name: string; description: string; mimeType: string }
  > = [{ type: "text", text: JSON.stringify(jsonSafe(project), null, 2) }];
  if (project.artifacts.finalVideo) {
    const videoPath = resolveArtifact(project, project.artifacts.finalVideo, root);
    content.push({
      type: "resource_link",
      uri: pathToFileURL(videoPath).href,
      name: `${project.title}.mp4`,
      description: "Rendered 1080p product demo",
      mimeType: "video/mp4",
    });
  }
  return { content, structuredContent: jsonSafe(project) as unknown as Record<string, unknown> };
}

function creatorRenderResult(value: CreatorRenderResult) {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "resource_link"; uri: string; name: string; description: string; mimeType: string }
  > = [{ type: "text", text: JSON.stringify(jsonSafe(value), null, 2) }];
  for (const item of value.outputs) {
    content.push({
      type: "resource_link",
      uri: pathToFileURL(item.videoPath).href,
      name: `${item.id}.mp4`,
      description: `${item.preset} creator export`,
      mimeType: "video/mp4",
    });
  }
  return { content, structuredContent: jsonSafe(value) as unknown as Record<string, unknown> };
}

function isCreatorRenderResult(value: unknown): value is CreatorRenderResult {
  return Boolean(value && typeof value === "object" && Array.isArray((value as CreatorRenderResult).outputs) && typeof (value as CreatorRenderResult).outputDirectory === "string");
}

function isCreatorPromptVideoResult(value: unknown): value is CreatorPromptVideoResult {
  return Boolean(value && typeof value === "object" && typeof (value as CreatorPromptVideoResult).manifestPath === "string" && typeof (value as CreatorPromptVideoResult).mode === "string");
}

function creatorPromptResult(value: CreatorPromptVideoResult) {
  if (!value.renderResult) return result(value);
  const rendered = creatorRenderResult(value.renderResult);
  rendered.content[0] = { type: "text", text: JSON.stringify(jsonSafe(value), null, 2) };
  rendered.structuredContent = jsonSafe(value) as unknown as Record<string, unknown>;
  return rendered;
}

async function loadCreatorResult(filePath: string): Promise<CreatorRenderResult> {
  return JSON.parse(await readFile(filePath, "utf8")) as CreatorRenderResult;
}

function selectCreatorOutput(render: CreatorRenderResult, outputId: string): CreatorRenderedOutput {
  const selected = render.outputs.find((item) => item.id === outputId);
  if (!selected) throw new Error(`Output '${outputId}' was not found. Available: ${render.outputs.map((item) => item.id).join(", ")}`);
  return selected;
}

function requiredToken(environmentName: string): string {
  const value = process.env[environmentName];
  if (!value) throw new Error(`Environment variable ${environmentName} is required.`);
  return value;
}

let studio: StudioServerHandle | undefined;

export function createAgentDemoMcpServer(): McpServer {
  const server = new McpServer(
    { name: "agent-demo-studio", version: AGENT_DEMO_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "Agent Demo Studio records websites and creates product launches, fictional presenter videos, cartoons, narrated stories, ASMR, VFX edits, long-form videos, Shorts, Reels, TikTok, square/portrait posts, and 4K masters. Before producing a requested video, use demo_creator_plan to define requirements, visual direction, storyboard, resources, workflow, assumptions, and quality gates; demo_creator_from_prompt also saves this plan automatically before generation. Use demo_creator_assets for bundled characters and effects, and demo_browser_* for live capture. Editing tools include templates, validate, render, remix, analyze, transcribe, and package. Long jobs return job_id; poll demo_job_status. Never put passwords, access tokens, or secrets in tool arguments; publishing tools read tokens from environment variables and require confirmPublish=true.",
    },
  );

  server.registerTool(
    "demo_create_project",
    {
      title: "Create demo project",
      description: "Create a portable browser-demo project before starting a live recording.",
      inputSchema: z.object({
        id: z.string().optional(),
        title: z.string().min(1),
        subtitle: z.string().optional(),
        url: z.url(),
        root: z.string().optional(),
        theme: themeSchema,
        render: renderSchema,
        narration: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      const project = await createProject({
        id: input.id,
        title: input.title,
        subtitle: input.subtitle,
        url: input.url,
        root: input.root,
        theme: input.theme,
        render: input.render,
        audio: input.narration ? { narration: input.narration } : undefined,
      });
      return projectResult(project, input.root);
    },
  );

  server.registerTool(
    "demo_browser_start",
    {
      title: "Start live browser recording",
      description:
        "Open a visible Chromium browser, navigate to the project URL, and begin a high-quality screencast with cursor and action annotations.",
      inputSchema: z.object({
        projectId: z.string(),
        root: z.string().optional(),
        headless: z.boolean().default(false),
        slowMotionMs: z.number().int().min(0).max(2_000).default(120),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => result(await startBrowserSession(input)),
  );

  server.registerTool(
    "demo_browser_act",
    {
      title: "Perform recorded browser action",
      description:
        "Perform one browser action while recording. Use role/name when possible; call demo_browser_snapshot if the next element is uncertain.",
      inputSchema: z.object({
        sessionId: z.string(),
        action: actionSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ sessionId, action }) =>
      result(await performBrowserAction(sessionId, action as BrowserAction)),
  );

  server.registerTool(
    "demo_browser_snapshot",
    {
      title: "Inspect live browser",
      description: "Capture the current recorded browser viewport so the agent can inspect it before acting.",
      inputSchema: z.object({ sessionId: z.string() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sessionId }) => {
      const snapshot = await captureBrowserSnapshot(sessionId);
      return {
        content: [
          { type: "image" as const, data: snapshot.data, mimeType: snapshot.mimeType },
          {
            type: "text" as const,
            text: JSON.stringify({ path: snapshot.path, url: snapshot.url }, null, 2),
          },
        ],
        structuredContent: { path: snapshot.path, url: snapshot.url },
      };
    },
  );

  server.registerTool(
    "demo_browser_finish",
    {
      title: "Finish live browser recording",
      description: "Stop the live screencast, close the browser, and save the raw recording.",
      inputSchema: z.object({
        sessionId: z.string(),
        root: z.string().optional(),
        autoRender: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ sessionId, root, autoRender }) => {
      const project = await finishBrowserSession(sessionId);
      if (!autoRender) return projectResult(project, root);
      const job = jobs.start("render", (report) => renderDemo({ projectId: project.id, root }, report));
      return result({ project, job });
    },
  );

  server.registerTool(
    "demo_record_flow",
    {
      title: "Record and produce complete demo",
      description:
        "Start an asynchronous end-to-end job that opens a browser, performs scripted actions, generates optional voice/music/captions, and renders a 1080p MP4.",
      inputSchema: z.object({
        id: z.string().optional(),
        title: z.string().min(1),
        subtitle: z.string().optional(),
        url: z.url(),
        root: z.string().optional(),
        actions: z.array(actionSchema).default([]),
        headless: z.boolean().default(false),
        slowMotionMs: z.number().int().min(0).max(2_000).default(120),
        narration: z.string().optional(),
        generateVoice: z.boolean().default(true),
        autoRender: z.boolean().default(true),
        theme: themeSchema,
        render: renderSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => {
      const job = jobs.start("record-flow", (report) =>
        recordDemoFlow(input as unknown as RecordFlowInput, report),
      );
      return result(job);
    },
  );

  server.registerTool(
    "demo_generate_voice",
    {
      title: "Generate local voice-over",
      description:
        "Generate narration with the operating system's local speech engine and attach it to the demo project.",
      inputSchema: z.object({
        projectId: z.string(),
        narration: z.string().min(1),
        root: z.string().optional(),
        voice: z.string().optional(),
        rate: z.number().int().min(-10).max(10).default(0),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ projectId, narration, root, voice, rate }) => {
      const job = jobs.start("voice-over", async (report) => {
        report(20, "Generating voice-over");
        const output = await generateVoiceover(projectId, narration, { root, voice, rate });
        report(100, "Voice-over ready");
        return { projectId, output };
      });
      return result(job);
    },
  );

  server.registerTool(
    "demo_render_synchronized",
    {
      title: "Render synchronized multi-voice demo",
      description:
        "Render a scene manifest with neural narration locked to each matching clip. Produces one 1080p master and optional subtitle sidecar per voice without burning text over the product UI.",
      inputSchema: z.object({ manifestPath: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ manifestPath }) => {
      const job = jobs.start("synchronized-render", (report) =>
        renderSynchronizedManifest(manifestPath, report),
      );
      return result(job);
    },
  );

  server.registerTool(
    "demo_render",
    {
      title: "Render polished 1080p demo",
      description:
        "Start an asynchronous edit and render job with branded background, browser frame, intro/outro, captions, voice, music, and H.264 output.",
      inputSchema: z.object({
        projectId: z.string(),
        root: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        narration: z.string().optional(),
        voicePath: z.string().optional(),
        musicPath: z.string().optional(),
        useGeneratedMusic: z.boolean().optional(),
        theme: themeSchema,
        render: renderSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const job = jobs.start("render", (report) =>
        renderDemo(input as unknown as RenderDemoInput, report),
      );
      return result(job);
    },
  );

  server.registerTool(
    "demo_creator_presets",
    {
      title: "List creator export presets",
      description: "List YouTube, Shorts, Reels, TikTok, story, square, portrait, LinkedIn, podcast, and 4K profiles including safe zones.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => result({
      presets: listCreatorPresets(),
      transitions: CREATOR_TRANSITIONS,
      overlayAnimations: CREATOR_OVERLAY_ANIMATIONS,
      loopAnimations: CREATOR_LOOP_ANIMATIONS,
      imageMotions: CREATOR_IMAGE_MOTIONS,
      vfx: CREATOR_VFX_PRESETS,
      promptModes: CREATOR_PROMPT_MODES,
    }),
  );

  server.registerTool(
    "demo_creator_assets",
    {
      title: "List characters, scenes, animation, and VFX",
      description: "List bundled fictional synthetic presenters, cartoon characters, backgrounds, overlay animation, image motion, and VFX presets.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => result({
      assets: listCreatorAssets(),
      overlayAnimations: CREATOR_OVERLAY_ANIMATIONS,
      loopAnimations: CREATOR_LOOP_ANIMATIONS,
      imageMotions: CREATOR_IMAGE_MOTIONS,
      vfx: CREATOR_VFX_PRESETS,
      promptModes: CREATOR_PROMPT_MODES,
    }),
  );

  server.registerTool(
    "demo_creator_templates",
    {
      title: "List or create video templates",
      description: "Return reusable product demo, launch, cartoon, story, ASMR, VFX, tutorial, podcast, testimonial, and social video manifests.",
      inputSchema: z.object({
        templateId: z.enum(["product-demo", "product-launch", "feature-reel", "launch-short", "cartoon-story", "narrated-story", "asmr", "vfx-showcase", "tutorial", "talking-head", "podcast-clip", "testimonial", "before-after"]).optional(),
        title: z.string().optional(),
        source: z.string().optional(),
        secondarySource: z.string().optional(),
        outputDirectory: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => result(input.templateId ? { template: createTemplateManifest(input.templateId, input) } : { templates: listCreatorTemplates() }),
  );

  server.registerTool(
    "demo_local_ai",
    {
      title: "Inspect or warm local Qwen",
      description: "Check the loopback-only Ollama planner, choose the fastest or quality Qwen model, and optionally keep it warm. Never calls a hosted model or uses API tokens.",
      inputSchema: z.object({
        profile: z.enum(["fast", "quality"]).default("fast"),
        model: z.string().optional(),
        baseUrl: z.string().optional(),
        warm: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const status = await getLocalAiStatus(input);
      return result(input.warm ? { status, warmup: await warmLocalPlanner(input) } : { status });
    },
  );

  server.registerTool(
    "demo_creator_music",
    {
      title: "Generate free local music",
      description: "Generate an original procedural ambient score or stereo ASMR soundscape locally with no samples, account, network service, or paid token.",
      inputSchema: z.object({
        style: z.enum(["ambient", "asmr"]).default("ambient"),
        durationSeconds: z.number().min(1).max(600).default(45),
        outputPath: z.string().default("creator-output/ambient-music.wav"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => result(jobs.start(`creator-music-${input.style}`, async () => {
      const outputPath = path.resolve(input.outputPath);
      await (input.style === "asmr" ? generateAsmrSoundscape(outputPath, input.durationSeconds) : generateAmbientMusic(outputPath, input.durationSeconds));
      return { style: input.style, durationSeconds: input.durationSeconds, outputPath, local: true, rights: "Original procedural Agent Demo Studio audio" };
    })),
  );

  server.registerTool(
    "demo_creator_plan",
    {
      title: "Plan a video before production",
      description: "Turn a user request into a local-Qwen-assisted requirements brief, open-cast storyboard, resource/provenance list, fixed production rules, staged workflow, assumptions, and quality checklist without generating media.",
      inputSchema: z.object({
        prompt: z.string().min(1),
        mode: z.enum(["product-launch", "cartoon", "story", "asmr", "vfx"]).default("product-launch"),
        title: z.string().optional(),
        source: z.string().optional(),
        sceneSources: z.array(z.string().min(1)).optional(),
        characters: z.array(promptCharacterSchema).optional(),
        logoSource: z.string().optional(),
        musicSource: z.string().optional(),
        narration: z.string().optional(),
        durationSeconds: z.number().min(6).max(600).optional(),
        presenter: z.enum(["none", "aria", "leo", "nova", "milo"]).optional(),
        voiceProvider: z.enum(["local", "neural", "local-clone"]).default("local"),
        voiceReference: z.string().optional(),
        voiceConsent: z.object({ speakerName: z.string().min(1), confirmed: z.boolean(), scope: z.string().optional() }).optional(),
        presets: z.array(z.enum(["youtube-1080p", "youtube-4k", "shorts", "reels", "tiktok", "story", "square", "portrait", "linkedin", "podcast-vertical"])).min(1).default(["youtube-1080p"]),
        generateVoice: z.boolean().default(true),
        generateMusic: z.boolean().default(true),
        plannerProvider: z.enum(["auto", "deterministic", "ollama"]).default("auto"),
        plannerProfile: z.enum(["fast", "quality"]).default("fast"),
        plannerModel: z.string().optional(),
        plannerBaseUrl: z.string().optional(),
        mediaProvider: z.enum(["builtin", "local-adapter"]).default("builtin"),
        mediaTask: z.enum(["auto", "text-to-image", "image-to-video", "text-to-video"]).default("auto"),
        mediaAdapterUrl: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => result({ plan: await createSmartPromptVideoPlan({ ...input, presets: input.presets as CreatorPresetId[] }) }),
  );

  server.registerTool(
    "demo_creator_from_prompt",
    {
      title: "Create a complete video project from a prompt",
      description: "Plan first, then generate an editable product-launch, cartoon, narrated-story, ASMR, or VFX timeline from bundled, uploaded, or loopback-generated media; supports open characters, local/neural/consented-clone voice, captions, music, and immediate multi-format rendering. Saves production-plan.json before media generation.",
      inputSchema: z.object({
        prompt: z.string().min(1),
        mode: z.enum(["product-launch", "cartoon", "story", "asmr", "vfx"]).default("product-launch"),
        title: z.string().optional(),
        source: z.string().optional(),
        sceneSources: z.array(z.string().min(1)).optional(),
        characters: z.array(promptCharacterSchema).optional(),
        logoSource: z.string().optional(),
        musicSource: z.string().optional(),
        outputDirectory: z.string().optional(),
        narration: z.string().optional(),
        durationSeconds: z.number().min(6).max(600).optional(),
        presenter: z.enum(["none", "aria", "leo", "nova", "milo"]).optional(),
        voice: z.string().optional(),
        voiceProvider: z.enum(["local", "neural", "local-clone"]).default("local"),
        voiceRate: z.number().min(-10).max(10).optional(),
        voiceReference: z.string().optional(),
        voiceConsent: z.object({ speakerName: z.string().min(1), confirmed: z.boolean(), scope: z.string().optional() }).optional(),
        voiceCloneUrl: z.string().optional(),
        presets: z.array(z.enum(["youtube-1080p", "youtube-4k", "shorts", "reels", "tiktok", "story", "square", "portrait", "linkedin", "podcast-vertical"])).min(1).default(["youtube-1080p"]),
        generateVoice: z.boolean().default(true),
        generateMusic: z.boolean().default(true),
        plannerProvider: z.enum(["auto", "deterministic", "ollama"]).default("auto"),
        plannerProfile: z.enum(["fast", "quality"]).default("fast"),
        plannerModel: z.string().optional(),
        plannerBaseUrl: z.string().optional(),
        mediaProvider: z.enum(["builtin", "local-adapter"]).default("builtin"),
        mediaTask: z.enum(["auto", "text-to-image", "image-to-video", "text-to-video"]).default("auto"),
        mediaAdapterUrl: z.string().optional(),
        render: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input) => result(jobs.start(`creator-prompt-${input.mode}`, (report) => createPromptVideoProject({ ...input, presets: input.presets as CreatorPresetId[] }, report))),
  );

  server.registerTool(
    "demo_creator_validate",
    {
      title: "Validate creator timeline",
      description: "Validate a portable creator manifest, clip operations, overlays, licenses, and social exports without rendering.",
      inputSchema: z.object({ manifest: z.record(z.string(), z.unknown()) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ manifest }) => result(validateCreatorManifest(manifest)),
  );

  server.registerTool(
    "demo_creator_render",
    {
      title: "Render creator timeline",
      description: "Render every output in a creator manifest with transitions, reframing, overlays, captions, music ducking, loudness normalization, thumbnails, chapters, and rights report.",
      inputSchema: z.object({
        manifestPath: z.string().optional(),
        manifest: z.record(z.string(), z.unknown()).optional(),
        baseDirectory: z.string().optional(),
        keepWork: z.boolean().default(false),
      }).refine((value) => Boolean(value.manifestPath || value.manifest), { message: "Provide manifestPath or manifest." }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (input) => {
      const job = jobs.start("creator-render", (report) => renderCreatorManifest((input.manifestPath ?? input.manifest) as string | CreatorManifest, report, { baseDirectory: input.baseDirectory, keepWork: input.keepWork }));
      return result(job);
    },
  );

  server.registerTool(
    "demo_creator_remix",
    {
      title: "Create social variants",
      description: "Turn one existing video into several platform-ready formats with optional captions and music.",
      inputSchema: z.object({
        source: z.string().min(1),
        presets: z.array(z.enum(["youtube-1080p", "youtube-4k", "shorts", "reels", "tiktok", "story", "square", "portrait", "linkedin", "podcast-vertical"])).min(1).default(["shorts", "reels", "tiktok"]),
        title: z.string().optional(),
        outputDirectory: z.string().optional(),
        captionsPath: z.string().optional(),
        musicPath: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => result(jobs.start("creator-remix", (report) => remixMedia(input.source, input.presets as CreatorPresetId[], input, report))),
  );

  server.registerTool(
    "demo_creator_analyze",
    {
      title: "Analyze media for highlights",
      description: "Detect silence, scene changes, media properties, and candidate clips for Shorts and Reels.",
      inputSchema: z.object({ source: z.string().min(1), silenceNoiseDb: z.number().min(-90).max(-5).optional(), silenceDurationSeconds: z.number().min(0.1).max(10).optional(), sceneThreshold: z.number().min(0.05).max(0.95).optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ source, ...options }) => result(jobs.start("creator-analysis", () => analyzeMedia(source, options))),
  );

  server.registerTool(
    "demo_creator_transcribe",
    {
      title: "Generate local captions",
      description: "Run an installed local Whisper CLI and generate normalized SRT or VTT captions.",
      inputSchema: z.object({ source: z.string().min(1), outputDirectory: z.string().optional(), language: z.string().optional(), model: z.string().default("turbo"), format: z.enum(["srt", "vtt"]).default("srt") }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ source, ...options }) => result(jobs.start("creator-transcription", async () => ({ captionsPath: await transcribeMedia(source, options) }))),
  );

  server.registerTool(
    "demo_creator_package",
    {
      title: "Package social exports",
      description: "Create self-contained platform folders with video, thumbnail, captions, chapters, metadata plans, and asset-license report.",
      inputSchema: z.object({ manifestPath: z.string().min(1), renderResultPath: z.string().min(1), destination: z.string().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ manifestPath, renderResultPath, destination }) => result(await createSocialPackage(await loadCreatorManifest(manifestPath), await loadCreatorResult(renderResultPath), destination)),
  );

  server.registerTool(
    "demo_creator_publish",
    {
      title: "Publish a reviewed social export",
      description: "Explicitly publish through YouTube, TikTok, or Instagram official APIs. Uses the platform's fixed access-token environment variable and never accepts a token in the MCP payload.",
      inputSchema: z.object({
        platform: z.enum(["youtube", "tiktok", "instagram"]),
        renderResultPath: z.string().min(1),
        outputId: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional(),
        tags: z.array(z.string()).default([]),
        accessTokenEnvironment: z.enum(["YOUTUBE_ACCESS_TOKEN", "TIKTOK_ACCESS_TOKEN", "INSTAGRAM_ACCESS_TOKEN"]).optional(),
        confirmPublish: z.literal(true),
        privacy: z.string().optional(),
        notifySubscribers: z.boolean().optional(),
        madeForKids: z.boolean().optional(),
        containsSyntheticMedia: z.boolean().optional(),
        captionLanguage: z.string().min(2).optional(),
        uploadThumbnail: z.boolean().optional(),
        uploadCaptions: z.boolean().optional(),
        disableComment: z.boolean().optional(),
        disableDuet: z.boolean().optional(),
        disableStitch: z.boolean().optional(),
        brandOrganic: z.boolean().optional(),
        coverTimestampMs: z.number().int().min(0).optional(),
        instagramAccountId: z.string().optional(),
        publicVideoUrl: z.url().optional(),
        instagramCoverUrl: z.url().optional(),
        shareToFeed: z.boolean().optional(),
        metaApiVersion: z.string().regex(/^v\d+\.\d+$/).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (input) => {
      const render = await loadCreatorResult(input.renderResultPath);
      const selected = selectCreatorOutput(render, input.outputId);
      const metadata = publishMetadataFromOutput(selected, input.title, input.description, input.tags);
      const tokenEnvironment = input.platform === "youtube" ? "YOUTUBE_ACCESS_TOKEN" : input.platform === "tiktok" ? "TIKTOK_ACCESS_TOKEN" : "INSTAGRAM_ACCESS_TOKEN";
      if (input.accessTokenEnvironment && input.accessTokenEnvironment !== tokenEnvironment) throw new Error(`${input.platform} publishing only reads ${tokenEnvironment}.`);
      const accessToken = requiredToken(tokenEnvironment);
      const job = jobs.start(`creator-publish-${input.platform}`, async () => {
        if (input.platform === "youtube") return publishToYouTube(selected, metadata, {
          accessToken, confirmPublish: true, privacyStatus: (input.privacy ?? "private") as "private" | "unlisted" | "public",
          notifySubscribers: input.notifySubscribers, madeForKids: input.madeForKids, containsSyntheticMedia: input.containsSyntheticMedia,
          captionLanguage: input.captionLanguage, uploadThumbnail: input.uploadThumbnail, uploadCaptions: input.uploadCaptions,
        });
        if (input.platform === "tiktok") return publishToTikTok(selected, metadata, {
          accessToken, confirmPublish: true, privacyLevel: input.privacy ?? "SELF_ONLY",
          disableComment: input.disableComment, disableDuet: input.disableDuet, disableStitch: input.disableStitch,
          isAigc: input.containsSyntheticMedia, brandOrganic: input.brandOrganic, coverTimestampMs: input.coverTimestampMs,
        });
        if (!input.instagramAccountId || !input.publicVideoUrl) throw new Error("Instagram publishing requires instagramAccountId and publicVideoUrl.");
        return publishToInstagram(selected, metadata, {
          accessToken, confirmPublish: true, instagramAccountId: input.instagramAccountId, publicVideoUrl: input.publicVideoUrl,
          coverUrl: input.instagramCoverUrl, shareToFeed: input.shareToFeed, apiVersion: input.metaApiVersion,
        });
      });
      return result(job);
    },
  );

  server.registerTool(
    "demo_job_status",
    {
      title: "Get background job status",
      description: "Poll a recording, voice-over, or rendering job until it completes or fails.",
      inputSchema: z.object({ jobId: z.string() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ jobId }) => {
      const job = jobs.get(jobId);
      if (!job) return result({ error: "JOB_NOT_FOUND", jobId });
      if (job.state === "completed" && isCreatorRenderResult(job.result)) return creatorRenderResult(job.result);
      if (job.state === "completed" && isCreatorPromptVideoResult(job.result)) return creatorPromptResult(job.result);
      return result(job);
    },
  );

  server.registerTool(
    "demo_get_project",
    {
      title: "Get demo project",
      description: "Read a project's storyboard events, design, audio settings, status, and artifacts.",
      inputSchema: z.object({ projectId: z.string(), root: z.string().optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ projectId, root }) => projectResult(await loadProject(projectId, root), root),
  );

  server.registerTool(
    "demo_list_projects",
    {
      title: "List demo projects",
      description: "List all Agent Demo Studio projects, newest first.",
      inputSchema: z.object({ root: z.string().optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ root }) => result({ projects: await listProjects(root) }),
  );

  server.registerTool(
    "demo_open_studio",
    {
      title: "Open visual demo studio",
      description: "Open the one-place local editor for previewing, styling, narrating, and rendering demos.",
      inputSchema: z.object({ root: z.string().optional(), port: z.number().int().min(1024).max(65_535).optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ root, port }) => {
      if (!studio) studio = await startStudioServer({ root, port, open: true });
      return result({ url: studio.url });
    },
  );

  server.registerTool(
    "demo_doctor",
    {
      title: "Check demo studio installation",
      description: "Check browser, FFmpeg, Codex, Claude Code, and active recording sessions.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => result({ checks: await runDoctor(), sessions: listActiveBrowserSessions() }),
  );

  return server;
}
