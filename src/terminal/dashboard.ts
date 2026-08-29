import path from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { generateAmbientMusic, generateAsmrSoundscape } from "../audio/music.js";
import { getLocalAiStatus, warmLocalPlanner } from "../creator/local-ai.js";
import { createPromptVideoProject, createSmartPromptVideoPlan } from "../creator/prompt.js";
import { CREATOR_PRESETS } from "../creator/presets.js";
import type { CreatorPlannerProfile, CreatorPromptMode, CreatorPromptVideoInput, CreatorPresetId } from "../creator/types.js";

const MODES: CreatorPromptMode[] = ["product-launch", "cartoon", "story", "asmr", "vfx"];

function color(code: number, value: string): string {
  return output.isTTY ? `\u001b[${code}m${value}\u001b[0m` : value;
}

function line(value = ""): void {
  output.write(`${value}\n`);
}

async function ask(terminal: Interface, label: string, fallback?: string): Promise<string> {
  const suffix = fallback === undefined ? "" : ` ${color(90, `[${fallback}]`)}`;
  const value = (await terminal.question(`${label}${suffix}: `)).trim();
  return value || fallback || "";
}

async function yes(terminal: Interface, label: string, fallback = true): Promise<boolean> {
  const value = (await ask(terminal, `${label} (y/n)`, fallback ? "y" : "n")).toLowerCase();
  return value === "y" || value === "yes";
}

function paths(value: string): string[] | undefined {
  const selected = value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => path.resolve(item));
  return selected.length ? selected : undefined;
}

function presets(value: string): CreatorPresetId[] {
  const selected = value.split(",").map((item) => item.trim()).filter(Boolean);
  for (const preset of selected) if (!(preset in CREATOR_PRESETS)) throw new Error(`Unknown preset '${preset}'.`);
  return (selected.length ? selected : ["youtube-1080p"]) as CreatorPresetId[];
}

async function videoRequest(terminal: Interface, render: boolean): Promise<CreatorPromptVideoInput> {
  line(color(36, "\nCreate a plan-first local video"));
  const prompt = await ask(terminal, "Describe the video");
  if (!prompt) throw new Error("A video description is required.");
  const narration = await ask(terminal, "Exact narration script (optional; sentences are aligned across scenes)", "");
  const mode = await ask(terminal, `Mode (${MODES.join("/")})`, "cartoon") as CreatorPromptMode;
  if (!MODES.includes(mode)) throw new Error(`Unknown mode '${mode}'.`);
  const duration = Number(await ask(terminal, "Target seconds", mode === "cartoon" ? "45" : "30"));
  if (!Number.isFinite(duration) || duration < 6 || duration > 600) throw new Error("Duration must be between 6 and 600 seconds.");
  const profileChoice = (await ask(terminal, "Planner (fast/quality/instant)", "fast")).toLowerCase();
  if (!(["fast", "quality", "instant"].includes(profileChoice))) throw new Error("Planner must be fast, quality, or instant.");
  const sceneSources = paths(await ask(terminal, "Scene image/video paths, comma-separated (optional)", ""));
  const characterSources = paths(await ask(terminal, "Character image paths, comma-separated (optional)", ""));
  const logoValue = await ask(terminal, "Logo image path (optional)", "");
  const musicValue = await ask(terminal, "Authorized music/ambience path (optional)", "");
  const mediaChoice = (await ask(terminal, "Visual generation (uploads/local-adapter)", "uploads")).toLowerCase();
  if (!(["uploads", "local-adapter"].includes(mediaChoice))) throw new Error("Visual generation must be uploads or local-adapter.");
  const mediaTask = mediaChoice === "local-adapter"
    ? await ask(terminal, "Local task (auto/text-to-image/image-to-video/text-to-video)", "auto") as CreatorPromptVideoInput["mediaTask"]
    : "auto";
  const mediaAdapterUrl = mediaChoice === "local-adapter" ? await ask(terminal, "Loopback media adapter URL", process.env.AGENT_DEMO_MEDIA_ADAPTER_URL || "") : undefined;
  const generateVoice = mode !== "asmr" && await yes(terminal, "Generate narration", true);
  const voiceChoice = generateVoice ? (await ask(terminal, "Voice (local/local-clone/neural)", "local")).toLowerCase() : "local";
  if (!(["local", "local-clone", "neural"].includes(voiceChoice))) throw new Error("Voice must be local, local-clone, or neural.");
  let voiceReference: string | undefined;
  let voiceConsent: CreatorPromptVideoInput["voiceConsent"];
  let voiceCloneUrl: string | undefined;
  if (voiceChoice === "local-clone") {
    const voiceReferenceValue = await ask(terminal, "Authorized voice reference path");
    if (!voiceReferenceValue) throw new Error("A voice reference file is required for local cloning.");
    voiceReference = path.resolve(voiceReferenceValue);
    const speakerName = await ask(terminal, "Authorized speaker name");
    if (!speakerName) throw new Error("The authorized speaker name is required for local cloning.");
    const confirmed = await yes(terminal, "Confirm the speaker authorized this cloned voice", false);
    voiceConsent = { speakerName, confirmed, scope: "this terminal-created video project" };
    voiceCloneUrl = await ask(terminal, "Loopback voice adapter URL", process.env.AGENT_DEMO_VOICE_CLONE_URL || "");
  }
  const generateMusic = musicValue ? false : await yes(terminal, "Generate free local music/ambience", true);
  const selectedPresets = presets(await ask(terminal, "Exports, comma-separated", render ? "youtube-1080p" : "youtube-1080p"));
  const outputDirectory = path.resolve(await ask(terminal, "Output directory", path.join("creator-output", "terminal-video")));
  return {
    prompt,
    narration: narration || undefined,
    mode,
    durationSeconds: duration,
    outputDirectory,
    sceneSources,
    logoSource: logoValue ? path.resolve(logoValue) : undefined,
    musicSource: musicValue ? path.resolve(musicValue) : undefined,
    characters: characterSources?.map((source, index) => ({
      id: `terminal-character-${index + 1}`,
      name: path.basename(source, path.extname(source)).replace(/[-_]+/g, " "),
      source,
      role: "character",
      rights: "User-declared authorized character",
    })),
    presenter: "none",
    presets: selectedPresets,
    generateVoice,
    voiceProvider: voiceChoice as "local" | "local-clone" | "neural",
    voiceReference,
    voiceConsent,
    voiceCloneUrl,
    generateMusic,
    plannerProvider: profileChoice === "instant" ? "deterministic" : "auto",
    plannerProfile: (profileChoice === "quality" ? "quality" : "fast") as CreatorPlannerProfile,
    mediaProvider: mediaChoice === "local-adapter" ? "local-adapter" : "builtin",
    mediaTask,
    mediaAdapterUrl,
    render,
  };
}

function printPlan(plan: Awaited<ReturnType<typeof createSmartPromptVideoPlan>>): void {
  line();
  line(color(35, plan.title));
  line(`${plan.requirements.targetDurationSeconds}s · ${plan.mode} · ${plan.requirements.outputPresets.join(", ")}`);
  line(`Planner: ${plan.intelligence?.provider === "ollama" ? `${plan.intelligence.model} local` : "instant local rules"}`);
  plan.scenes.forEach((scene, index) => {
    line(color(36, `\n${index + 1}. ${scene.title} (${scene.durationSeconds}s)`));
    line(`   Visual: ${scene.visual}`);
    line(`   Voice:  ${scene.narration}`);
    if (scene.onScreenText) line(`   Text:   ${scene.onScreenText}`);
  });
  line(color(90, `\n${plan.resources.length} resources · ${plan.productionRules.length} fixed production rules · ${plan.qualityChecklist.length} QA checks`));
}

async function createMusic(terminal: Interface): Promise<void> {
  line(color(36, "\nGenerate free local music"));
  const style = (await ask(terminal, "Style (ambient/asmr)", "ambient")).toLowerCase();
  if (style !== "ambient" && style !== "asmr") throw new Error("Music style must be ambient or asmr.");
  const durationSeconds = Number(await ask(terminal, "Duration seconds", "45"));
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 600) throw new Error("Duration must be between 1 and 600 seconds.");
  const outputPath = path.resolve(await ask(terminal, "Output WAV", path.join("creator-output", `${style}-music.wav`)));
  await (style === "asmr" ? generateAsmrSoundscape(outputPath, durationSeconds) : generateAmbientMusic(outputPath, durationSeconds));
  line(color(32, `Music ready: ${outputPath}`));
}

async function header(): Promise<void> {
  const status = await getLocalAiStatus();
  line(color(35, "\n╭──────────────────────────────────────────────╮"));
  line(color(35, "│          AGENT DEMO STUDIO · LOCAL           │"));
  line(color(35, "╰──────────────────────────────────────────────╯"));
  line(status.available
    ? `${color(32, "●")} ${status.selectedModel} · ${status.profile} · 0 paid API tokens`
    : `${color(33, "●")} Instant fallback · Qwen optional · 0 paid API tokens`);
  line("Plan · text/image/video · characters · voice · music · VFX · render");
}

export async function runTerminalDashboard(): Promise<void> {
  if (!input.isTTY || !output.isTTY) throw new Error("The terminal dashboard needs an interactive TTY. Use the ordinary agent-demo commands for scripts.");
  const terminal = createInterface({ input, output });
  try {
    let running = true;
    while (running) {
      await header();
      line("\n  1  Create and render a video");
      line("  2  Review a production plan");
      line("  3  Generate local music / ASMR");
      line("  4  Warm the fastest local Qwen");
      line("  5  Show visual Studio command");
      line("  0  Exit\n");
      const choice = await ask(terminal, "Choose", "1");
      try {
        if (choice === "1") {
          const request = await videoRequest(terminal, true);
          const result = await createPromptVideoProject(request, (progress, message) => line(`${String(Math.round(progress)).padStart(3, " ")}%  ${message}`));
          printPlan(result.plan);
          line(color(32, `\nProject: ${result.manifestPath}`));
          for (const rendered of result.renderResult?.outputs ?? []) line(color(32, `Video:   ${rendered.videoPath}`));
        } else if (choice === "2") {
          printPlan(await createSmartPromptVideoPlan(await videoRequest(terminal, false)));
        } else if (choice === "3") {
          await createMusic(terminal);
        } else if (choice === "4") {
          const profile = await ask(terminal, "Profile (fast/quality)", "fast") as CreatorPlannerProfile;
          const warmed = await warmLocalPlanner({ profile });
          line(color(32, `${warmed.model} is warm for ${warmed.keepAlive}.`));
        } else if (choice === "5") {
          line(color(36, "Run: agent-demo studio"));
          line("It opens the all-in-one local browser dashboard on this laptop.");
        } else if (choice === "0") running = false;
        else line(color(33, "Unknown menu choice."));
      } catch (error) {
        line(color(31, `\nError: ${error instanceof Error ? error.message : String(error)}`));
      }
      if (running) await terminal.question(color(90, "\nPress Enter to continue…"));
    }
  } finally {
    terminal.close();
  }
}
