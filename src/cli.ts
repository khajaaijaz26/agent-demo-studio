#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { AGENT_DEMO_VERSION } from "./config.js";
import { createAgentDemoMcpServer } from "./mcp/server.js";
import { createProject, listProjects, loadProject } from "./project-store.js";
import { recordDemoFlow } from "./workflow.js";
import { generateVoiceover } from "./audio/tts.js";
import { renderDemo } from "./render/renderer.js";
import { renderSynchronizedManifest } from "./render/synchronized.js";
import { startStudioServer } from "./studio/server.js";
import {
  ensureChromiumInstalled,
  installAgentIntegrations,
  mcpLaunchConfiguration,
  removeAgentIntegrations,
  runDoctor,
  type AgentTarget,
} from "./installer/agents.js";
import { errorMessage } from "./errors.js";
import type { RecordFlowInput } from "./types.js";
import { analyzeMedia } from "./creator/media.js";
import { transcribeMedia } from "./creator/captions.js";
import { createTemplateManifest, listCreatorTemplates } from "./creator/templates.js";
import { CREATOR_PRESETS, listCreatorPresets } from "./creator/presets.js";
import { loadCreatorManifest, validateCreatorManifest } from "./creator/schema.js";
import { remixMedia, renderCreatorManifest } from "./creator/renderer.js";
import { createSocialPackage } from "./creator/social.js";
import { listCreatorAssets } from "./creator/assets.js";
import { createPromptVideoPlan, createPromptVideoProject } from "./creator/prompt.js";
import {
  CREATOR_IMAGE_MOTIONS,
  CREATOR_LOOP_ANIMATIONS,
  CREATOR_OVERLAY_ANIMATIONS,
  CREATOR_PROMPT_MODES,
  CREATOR_TRANSITIONS,
  CREATOR_VFX_PRESETS,
} from "./creator/types.js";
import {
  publishMetadataFromOutput,
  publishToInstagram,
  publishToTikTok,
  publishToYouTube,
} from "./creator/publish.js";
import type {
  CreatorManifest,
  CreatorPromptMode,
  CreatorPresetId,
  CreatorRenderResult,
  CreatorRenderedOutput,
  CreatorTemplateId,
} from "./creator/types.js";

const program = new Command();

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function progress(value: number, message: string): void {
  const percent = String(Math.round(value)).padStart(3, " ");
  process.stderr.write(`\r[${percent}%] ${message.padEnd(52, " ")}`);
  if (value >= 100) process.stderr.write("\n");
}

function targetsFromOptions(options: { codex?: boolean; claude?: boolean }): AgentTarget[] {
  const selected: AgentTarget[] = [];
  if (options.codex) selected.push("codex");
  if (options.claude) selected.push("claude");
  return selected.length ? selected : ["codex", "claude"];
}

program
  .name("agent-demo")
  .description("Record, animate, narrate, apply VFX, and render polished videos from Codex, Claude Code, or another MCP agent.")
  .version(AGENT_DEMO_VERSION);

function presetList(value: string): CreatorPresetId[] {
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  for (const item of values) {
    if (!(item in CREATOR_PRESETS)) throw new Error(`Unknown preset '${item}'. Run 'agent-demo creator presets'.`);
  }
  return values as CreatorPresetId[];
}

async function readRenderResult(filePath: string): Promise<CreatorRenderResult> {
  return JSON.parse(await readFile(path.resolve(filePath), "utf8")) as CreatorRenderResult;
}

function selectRenderedOutput(result: CreatorRenderResult, outputId: string): CreatorRenderedOutput {
  const selected = result.outputs.find((item) => item.id === outputId);
  if (!selected) throw new Error(`Output '${outputId}' was not found. Available: ${result.outputs.map((item) => item.id).join(", ")}`);
  return selected;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} is required.`);
  return value;
}

program
  .command("setup")
  .description("Install Chromium if needed and register the MCP server with Codex and Claude Code.")
  .option("--codex", "Install only for Codex")
  .option("--claude", "Install only for Claude Code")
  .action(async (options: { codex?: boolean; claude?: boolean }) => {
    process.stderr.write("Checking the browser runtime...\n");
    const browserInstalled = await ensureChromiumInstalled();
    if (browserInstalled) process.stderr.write("Playwright Chromium installed.\n");
    const integrations = await installAgentIntegrations(targetsFromOptions(options));
    output({ integrations, checks: await runDoctor() });
  });

program
  .command("remove-integration")
  .description("Remove MCP registration while preserving all demo projects.")
  .option("--codex", "Remove only from Codex")
  .option("--claude", "Remove only from Claude Code")
  .action(async (options: { codex?: boolean; claude?: boolean }) => {
    output(await removeAgentIntegrations(targetsFromOptions(options)));
  });

program
  .command("doctor")
  .description("Check all local recording and agent integration requirements.")
  .action(async () => {
    const checks = await runDoctor();
    checks.forEach((check) =>
      process.stdout.write(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}\n`),
    );
    if (checks.some((check) => !check.ok && !["Codex", "Claude Code"].includes(check.name))) {
      process.exitCode = 1;
    }
  });

program
  .command("mcp")
  .description("Run the Agent Demo Studio MCP server over stdio.")
  .action(() => {
    serveStdio(() => createAgentDemoMcpServer(), {
      onerror: (error) => console.error(`[agent-demo-studio] ${error.message}`),
    });
  });

program
  .command("mcp-config")
  .description("Print a portable MCP configuration block for other compatible clients.")
  .action(() => output(mcpLaunchConfiguration()));

program
  .command("new")
  .description("Create an empty demo project.")
  .argument("<url>", "Website URL")
  .requiredOption("--title <title>", "Project title")
  .option("--subtitle <subtitle>", "Project subtitle")
  .option("--id <id>", "Stable project ID")
  .option("--root <directory>", "Studio data directory")
  .action(async (url: string, options: { title: string; subtitle?: string; id?: string; root?: string }) => {
    output(await createProject({ ...options, url }));
  });

program
  .command("quick")
  .description("Record and render a simple visible website demo in one command.")
  .argument("<url>", "Website URL")
  .option("--title <title>", "Demo title")
  .option("--subtitle <subtitle>", "Demo subtitle")
  .option("--narration <text>", "Voice-over narration")
  .option("--duration <seconds>", "Time to show the website", "4")
  .option("--headless", "Run without showing the browser", false)
  .option("--root <directory>", "Studio data directory")
  .option("--no-render", "Only save the raw recording")
  .option("--no-voice", "Do not synthesize narration")
  .action(
    async (
      url: string,
      options: {
        title?: string;
        subtitle?: string;
        narration?: string;
        duration: string;
        headless: boolean;
        root?: string;
        render: boolean;
        voice: boolean;
      },
    ) => {
      const hostname = new URL(url).hostname.replace(/^www\./, "");
      const project = await recordDemoFlow(
        {
          title: options.title || `${hostname} product tour`,
          subtitle: options.subtitle,
          url,
          root: options.root,
          narration: options.narration,
          actions: [
            { type: "chapter", label: "Product overview", milliseconds: 1_000 },
            { type: "wait", milliseconds: Math.max(1, Number(options.duration)) * 1_000 },
          ],
          headless: options.headless,
          generateVoice: options.voice,
          autoRender: options.render,
        },
        progress,
      );
      output(project);
    },
  );

program
  .command("record")
  .description("Run an end-to-end demo script from JSON.")
  .argument("<script>", "Path to a JSON recording script")
  .option("--root <directory>", "Override the Studio data directory")
  .option("--headless", "Run without showing the browser")
  .action(async (scriptPath: string, options: { root?: string; headless?: boolean }) => {
    const script = JSON.parse(await readFile(scriptPath, "utf8")) as RecordFlowInput;
    if (options.root) script.root = options.root;
    if (options.headless !== undefined) script.headless = options.headless;
    output(await recordDemoFlow(script, progress));
  });

program
  .command("voice")
  .description("Generate and attach a local voice-over.")
  .argument("<project-id>", "Project ID")
  .option("--text <narration>", "Narration text")
  .option("--file <path>", "Read narration from a text file")
  .option("--voice <name>", "System voice name")
  .option("--rate <number>", "Speaking rate from -10 to 10", "0")
  .option("--root <directory>", "Studio data directory")
  .action(
    async (
      projectId: string,
      options: { text?: string; file?: string; voice?: string; rate: string; root?: string },
    ) => {
      const narration = options.file ? await readFile(options.file, "utf8") : options.text;
      if (!narration) throw new Error("Use --text or --file to provide narration.");
      output({
        output: await generateVoiceover(projectId, narration, {
          root: options.root,
          voice: options.voice,
          rate: Number(options.rate),
        }),
      });
    },
  );

program
  .command("sync")
  .description("Render scene-locked neural narration for every voice in a timeline manifest.")
  .argument("<manifest>", "Path to a synchronized scene manifest")
  .action(async (manifestPath: string) => {
    output(await renderSynchronizedManifest(manifestPath, progress));
  });

program
  .command("render")
  .description("Render a recorded project as a polished 1080p MP4.")
  .argument("<project-id>", "Project ID")
  .option("--voice <path>", "Voice-over audio path")
  .option("--music <path>", "Music audio path")
  .option("--no-generated-music", "Disable generated ambient music")
  .option("--no-captions", "Disable burned-in narration captions")
  .option("--root <directory>", "Studio data directory")
  .action(
    async (
      projectId: string,
      options: {
        voice?: string;
        music?: string;
        generatedMusic: boolean;
        captions: boolean;
        root?: string;
      },
    ) => {
      output(
        await renderDemo(
          {
            projectId,
            root: options.root,
            voicePath: options.voice,
            musicPath: options.music,
            useGeneratedMusic: options.generatedMusic,
            render: { captions: options.captions },
          },
          progress,
        ),
      );
    },
  );

program
  .command("list")
  .description("List all local demo projects.")
  .option("--root <directory>", "Studio data directory")
  .action(async (options: { root?: string }) => output(await listProjects(options.root)));

program
  .command("show")
  .description("Print one project's manifest.")
  .argument("<project-id>", "Project ID")
  .option("--root <directory>", "Studio data directory")
  .action(async (projectId: string, options: { root?: string }) =>
    output(await loadProject(projectId, options.root)),
  );

program
  .command("studio")
  .description("Open the local all-in-one visual editor.")
  .option("--port <number>", "Local port", "4545")
  .option("--root <directory>", "Studio data directory")
  .option("--no-open", "Do not open the browser automatically")
  .action(async (options: { port: string; root?: string; open: boolean }) => {
    const server = await startStudioServer({
      root: options.root,
      port: Number(options.port),
      open: options.open,
    });
    process.stdout.write(`Agent Demo Studio is running at ${server.url}\n`);
    await new Promise<void>((resolve) => {
      const shutdown = () => void server.close().finally(resolve);
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });
  });

const creator = program
  .command("creator")
  .description("Create, edit, analyze, package, and publish videos for YouTube, Shorts, Reels, TikTok, and more.");

creator
  .command("presets")
  .description("List every built-in video and social export profile.")
  .action(() => output({
    presets: listCreatorPresets(),
    transitions: CREATOR_TRANSITIONS,
    overlayAnimations: CREATOR_OVERLAY_ANIMATIONS,
    loopAnimations: CREATOR_LOOP_ANIMATIONS,
    imageMotions: CREATOR_IMAGE_MOTIONS,
    vfx: CREATOR_VFX_PRESETS,
    promptModes: CREATOR_PROMPT_MODES,
  }));

creator
  .command("assets")
  .description("List bundled fictional presenters, cartoon characters, and scene artwork.")
  .action(() => output({
    assets: listCreatorAssets(),
    overlayAnimations: CREATOR_OVERLAY_ANIMATIONS,
    loopAnimations: CREATOR_LOOP_ANIMATIONS,
    imageMotions: CREATOR_IMAGE_MOTIONS,
    vfx: CREATOR_VFX_PRESETS,
    promptModes: CREATOR_PROMPT_MODES,
  }));

creator
  .command("templates")
  .description("List reusable video project templates.")
  .action(() => output({ templates: listCreatorTemplates() }));

creator
  .command("init")
  .description("Create an editable creator manifest from a template.")
  .argument("<template>", "Template id")
  .option("--source <path>", "Primary video or image source; prompt templates include bundled scenes")
  .option("--secondary-source <path>", "Second source for before/after projects")
  .option("--title <title>", "Project title")
  .option("--output-directory <path>", "Rendered output directory")
  .option("--out <path>", "Manifest path", "creator-project.json")
  .action(async (template: CreatorTemplateId, options: { source?: string; secondarySource?: string; title?: string; outputDirectory?: string; out: string }) => {
    if (!listCreatorTemplates().some((item) => item.id === template)) throw new Error(`Unknown template '${template}'.`);
    const manifest = createTemplateManifest(template, {
      source: options.source ? path.resolve(options.source) : undefined,
      secondarySource: options.secondarySource ? path.resolve(options.secondarySource) : undefined,
      title: options.title,
      outputDirectory: options.outputDirectory,
    });
    const target = path.resolve(options.out);
    await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    output({ manifestPath: target, manifest });
  });

creator
  .command("plan")
  .description("Plan requirements, visual direction, storyboard, resources, workflow, and QA before creating a video.")
  .argument("<prompt>", "Creative brief")
  .option("--mode <mode>", "product-launch, cartoon, story, asmr, or vfx", "product-launch")
  .option("--title <title>", "Project title")
  .option("--source <path>", "Optional source image or video")
  .option("--duration <seconds>", "Target duration in seconds")
  .option("--presenter <id>", "none, aria, leo, nova, or milo")
  .option("--presets <ids>", "Comma-separated export presets", "youtube-1080p")
  .option("--no-voice", "Plan without narration")
  .option("--no-music", "Plan without music or ambience")
  .action((promptText: string, options: { mode: string; title?: string; source?: string; duration?: string; presenter?: string; presets: string; voice: boolean; music: boolean }) => {
    if (!CREATOR_PROMPT_MODES.includes(options.mode as CreatorPromptMode)) throw new Error(`Unknown prompt mode '${options.mode}'. Available: ${CREATOR_PROMPT_MODES.join(", ")}.`);
    if (options.presenter && !["none", "aria", "leo", "nova", "milo"].includes(options.presenter)) throw new Error(`Unknown presenter '${options.presenter}'. Run 'agent-demo creator assets'.`);
    const durationSeconds = options.duration === undefined ? undefined : Number(options.duration);
    if (durationSeconds !== undefined && !Number.isFinite(durationSeconds)) throw new Error("Duration must be a number of seconds.");
    output(createPromptVideoPlan({
      prompt: promptText,
      mode: options.mode as CreatorPromptMode,
      title: options.title,
      source: options.source ? path.resolve(options.source) : undefined,
      durationSeconds,
      presenter: options.presenter as "none" | "aria" | "leo" | "nova" | "milo" | undefined,
      presets: presetList(options.presets),
      generateVoice: options.voice,
      generateMusic: options.music,
    }));
  });

creator
  .command("prompt")
  .description("Create a product launch, cartoon, narrated story, ASMR, or VFX project from one prompt.")
  .argument("<prompt>", "Creative direction or narration")
  .option("--mode <mode>", "product-launch, cartoon, story, asmr, or vfx", "product-launch")
  .option("--title <title>", "Project title")
  .option("--source <path>", "Optional source image or video")
  .option("--output-directory <path>", "Project and render directory")
  .option("--narration <text>", "Narration text; defaults to the prompt")
  .option("--duration <seconds>", "Target duration in seconds")
  .option("--presenter <id>", "none, aria, leo, nova, or milo")
  .option("--voice-name <name>", "System or neural voice name")
  .option("--voice-provider <provider>", "local or neural", "local")
  .option("--voice-rate <number>", "Speech rate adjustment")
  .option("--presets <ids>", "Comma-separated export presets", "youtube-1080p")
  .option("--render", "Render the selected outputs immediately", false)
  .option("--no-voice", "Skip narration synthesis")
  .option("--no-music", "Skip generated score or ASMR soundscape")
  .action(async (promptText: string, options: {
    mode: string;
    title?: string;
    source?: string;
    outputDirectory?: string;
    narration?: string;
    duration?: string;
    presenter?: string;
    voiceName?: string;
    voiceProvider: string;
    voiceRate?: string;
    presets: string;
    render: boolean;
    voice: boolean;
    music: boolean;
  }) => {
    if (!CREATOR_PROMPT_MODES.includes(options.mode as CreatorPromptMode)) throw new Error(`Unknown prompt mode '${options.mode}'. Available: ${CREATOR_PROMPT_MODES.join(", ")}.`);
    if (options.presenter && !["none", "aria", "leo", "nova", "milo"].includes(options.presenter)) throw new Error(`Unknown presenter '${options.presenter}'. Run 'agent-demo creator assets'.`);
    if (!(["local", "neural"] as const).includes(options.voiceProvider as "local" | "neural")) throw new Error("Voice provider must be 'local' or 'neural'.");
    const durationSeconds = options.duration === undefined ? undefined : Number(options.duration);
    const voiceRate = options.voiceRate === undefined ? undefined : Number(options.voiceRate);
    if (durationSeconds !== undefined && !Number.isFinite(durationSeconds)) throw new Error("Duration must be a number of seconds.");
    if (voiceRate !== undefined && !Number.isFinite(voiceRate)) throw new Error("Voice rate must be a number.");
    output(await createPromptVideoProject({
      prompt: promptText,
      mode: options.mode as CreatorPromptMode,
      title: options.title,
      source: options.source ? path.resolve(options.source) : undefined,
      outputDirectory: options.outputDirectory ? path.resolve(options.outputDirectory) : undefined,
      narration: options.narration,
      durationSeconds,
      presenter: options.presenter as "none" | "aria" | "leo" | "nova" | "milo" | undefined,
      voice: options.voiceName,
      voiceProvider: options.voiceProvider as "local" | "neural",
      voiceRate,
      presets: presetList(options.presets),
      generateVoice: options.voice,
      generateMusic: options.music,
      render: options.render,
    }, progress));
  });

creator
  .command("validate")
  .description("Validate a creator manifest and its platform profiles without rendering.")
  .argument("<manifest>", "Creator manifest JSON")
  .action(async (manifestPath: string) => {
    const validation = validateCreatorManifest(JSON.parse(await readFile(path.resolve(manifestPath), "utf8")) as unknown);
    output(validation);
    if (!validation.valid) process.exitCode = 1;
  });

creator
  .command("render")
  .description("Render every export in a creator manifest.")
  .argument("<manifest>", "Creator manifest JSON")
  .option("--keep-work", "Keep intermediate normalized clips for debugging")
  .action(async (manifestPath: string, options: { keepWork?: boolean }) => {
    output(await renderCreatorManifest(manifestPath, progress, { keepWork: options.keepWork }));
  });

creator
  .command("remix")
  .description("Turn one existing video into multiple social formats.")
  .argument("<source>", "Source video")
  .option("--presets <ids>", "Comma-separated presets", "shorts,reels,tiktok")
  .option("--title <title>", "Project title")
  .option("--output-directory <path>", "Output directory", "creator-output")
  .option("--captions <path>", "SRT or VTT captions")
  .option("--music <path>", "Background music")
  .action(async (source: string, options: { presets: string; title?: string; outputDirectory: string; captions?: string; music?: string }) => {
    output(await remixMedia(source, presetList(options.presets), {
      title: options.title,
      outputDirectory: options.outputDirectory,
      captionsPath: options.captions,
      musicPath: options.music,
    }, progress));
  });

creator
  .command("analyze")
  .description("Detect silence, scene changes, and suggested highlight clips.")
  .argument("<source>", "Video or audio file")
  .option("--out <path>", "Also save the analysis JSON")
  .action(async (source: string, options: { out?: string }) => {
    const analysis = await analyzeMedia(source);
    if (options.out) await writeFile(path.resolve(options.out), `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
    output(analysis);
  });

creator
  .command("transcribe")
  .description("Generate local captions with an installed Whisper CLI.")
  .argument("<source>", "Video or audio file")
  .option("--language <code>", "Spoken language code")
  .option("--model <name>", "Whisper model", "turbo")
  .option("--format <format>", "srt or vtt", "srt")
  .option("--output-directory <path>", "Caption output directory")
  .action(async (source: string, options: { language?: string; model: string; format: "srt" | "vtt"; outputDirectory?: string }) => {
    output({ captionsPath: await transcribeMedia(source, options) });
  });

creator
  .command("package")
  .description("Create a self-contained, reviewed social publishing package.")
  .argument("<manifest>", "Creator manifest JSON")
  .argument("<render-result>", "creator-render-result.json")
  .option("--destination <path>", "Package directory")
  .action(async (manifestPath: string, resultPath: string, options: { destination?: string }) => {
    output(await createSocialPackage(await loadCreatorManifest(manifestPath), await readRenderResult(resultPath), options.destination));
  });

creator
  .command("publish-youtube")
  .description("Explicitly publish one reviewed export with YouTube's resumable API.")
  .argument("<render-result>", "creator-render-result.json")
  .argument("<output-id>", "Export id")
  .requiredOption("--confirm", "Confirm the external publish operation")
  .option("--token-env <name>", "Environment variable containing OAuth token", "YOUTUBE_ACCESS_TOKEN")
  .requiredOption("--title <title>", "Video title")
  .option("--description <text>", "Video description")
  .option("--tags <tags>", "Comma-separated tags", "")
  .option("--privacy <status>", "private, unlisted, or public", "private")
  .option("--notify-subscribers", "Notify channel subscribers")
  .option("--made-for-kids", "Declare the video as made for kids")
  .option("--synthetic-media", "Declare realistic altered or synthetic media")
  .option("--caption-language <code>", "Language for an uploaded caption sidecar", "en")
  .option("--no-thumbnail", "Do not set the rendered thumbnail")
  .option("--no-captions", "Do not upload the rendered caption sidecar")
  .action(async (resultPath: string, outputId: string, options: { confirm: true; tokenEnv: string; title: string; description?: string; tags: string; privacy: "private" | "unlisted" | "public"; notifySubscribers?: boolean; madeForKids?: boolean; syntheticMedia?: boolean; captionLanguage: string; thumbnail: boolean; captions: boolean }) => {
    const selected = selectRenderedOutput(await readRenderResult(resultPath), outputId);
    output(await publishToYouTube(selected, publishMetadataFromOutput(selected, options.title, options.description, options.tags.split(",").filter(Boolean)), {
      accessToken: requiredEnvironment(options.tokenEnv), confirmPublish: true, privacyStatus: options.privacy,
      notifySubscribers: options.notifySubscribers, madeForKids: options.madeForKids, containsSyntheticMedia: options.syntheticMedia,
      captionLanguage: options.captionLanguage, uploadThumbnail: options.thumbnail, uploadCaptions: options.captions,
    }));
  });

creator
  .command("publish-tiktok")
  .description("Explicitly publish one reviewed export through TikTok Direct Post.")
  .argument("<render-result>", "creator-render-result.json")
  .argument("<output-id>", "Export id")
  .requiredOption("--confirm", "Confirm the external publish operation")
  .option("--token-env <name>", "Environment variable containing OAuth token", "TIKTOK_ACCESS_TOKEN")
  .requiredOption("--title <title>", "Post title")
  .requiredOption("--privacy <level>", "Creator-supported privacy level")
  .option("--description <text>", "Post description")
  .option("--tags <tags>", "Comma-separated tags", "")
  .option("--disable-comment", "Disable comments on the post")
  .option("--disable-duet", "Disable Duet")
  .option("--disable-stitch", "Disable Stitch")
  .option("--ai-generated", "Label the post as AI-generated content")
  .option("--brand-organic", "Mark content promoting the creator's own business")
  .option("--cover-timestamp-ms <number>", "Video cover timestamp in milliseconds")
  .action(async (resultPath: string, outputId: string, options: { confirm: true; tokenEnv: string; title: string; privacy: string; description?: string; tags: string; disableComment?: boolean; disableDuet?: boolean; disableStitch?: boolean; aiGenerated?: boolean; brandOrganic?: boolean; coverTimestampMs?: string }) => {
    const selected = selectRenderedOutput(await readRenderResult(resultPath), outputId);
    output(await publishToTikTok(selected, publishMetadataFromOutput(selected, options.title, options.description, options.tags.split(",").filter(Boolean)), {
      accessToken: requiredEnvironment(options.tokenEnv), confirmPublish: true, privacyLevel: options.privacy,
      disableComment: options.disableComment, disableDuet: options.disableDuet, disableStitch: options.disableStitch,
      isAigc: options.aiGenerated, brandOrganic: options.brandOrganic, coverTimestampMs: options.coverTimestampMs === undefined ? undefined : Number(options.coverTimestampMs),
    }));
  });

creator
  .command("publish-instagram")
  .description("Explicitly publish one reviewed export as an Instagram Reel.")
  .argument("<render-result>", "creator-render-result.json")
  .argument("<output-id>", "Export id")
  .requiredOption("--confirm", "Confirm the external publish operation")
  .option("--token-env <name>", "Environment variable containing access token", "INSTAGRAM_ACCESS_TOKEN")
  .requiredOption("--account-id <id>", "Instagram professional account id")
  .requiredOption("--public-video-url <url>", "HTTPS URL Meta can fetch")
  .requiredOption("--title <title>", "Reel title")
  .option("--description <text>", "Reel caption")
  .option("--tags <tags>", "Comma-separated tags", "")
  .option("--cover-url <url>", "Public HTTPS cover image URL")
  .option("--api-version <version>", "Meta Graph API version")
  .option("--no-share-to-feed", "Do not also share the Reel to the feed")
  .action(async (resultPath: string, outputId: string, options: { confirm: true; tokenEnv: string; accountId: string; publicVideoUrl: string; title: string; description?: string; tags: string; coverUrl?: string; apiVersion?: string; shareToFeed: boolean }) => {
    const selected = selectRenderedOutput(await readRenderResult(resultPath), outputId);
    output(await publishToInstagram(selected, publishMetadataFromOutput(selected, options.title, options.description, options.tags.split(",").filter(Boolean)), {
      accessToken: requiredEnvironment(options.tokenEnv), instagramAccountId: options.accountId, publicVideoUrl: options.publicVideoUrl,
      confirmPublish: true, coverUrl: options.coverUrl, apiVersion: options.apiVersion, shareToFeed: options.shareToFeed,
    }));
  });

program.parseAsync().catch((error) => {
  console.error(`Agent Demo Studio: ${errorMessage(error)}`);
  process.exitCode = 1;
});
