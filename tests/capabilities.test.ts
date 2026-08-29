import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { inspectCapabilities, type CapabilityRuntime } from "../src/capabilities.js";
import { createPromptVideoProject, createSmartPromptVideoPlan } from "../src/creator/prompt.js";

function runtime(commands: string[] = ["ffmpeg", "ffprobe", "powershell.exe"]): CapabilityRuntime {
  const installed = new Set(commands);
  return {
    platform: "win32",
    architecture: "x64",
    env: {},
    browserExecutablePath: "C:\\local\\chromium.exe",
    commandExists: async (command) => installed.has(command),
    pathExists: async (filePath) => filePath === "C:\\local\\chromium.exe",
    now: () => new Date("2026-08-29T00:00:00.000Z"),
    localAiStatus: async () => ({
      available: true,
      localOnly: true,
      baseUrl: "http://127.0.0.1:11434",
      version: "0.32.15",
      profile: "fast",
      selectedModel: "qwen3.5:0.8b",
      models: [{ name: "qwen3.5:0.8b" }],
      message: "Ready with qwen3.5:0.8b; all planning stays on this device.",
    }),
    wanAnimateStatus: async () => ({
      modelId: "Wan-AI/Wan2.2-Animate-2-14B",
      metadataInstalled: false,
      weightsInstalled: false,
      adapterConfigured: false,
      available: false,
      message: "Wan-Animate-2 is not installed in this isolated test runtime.",
      requiredDownloadGb: 82.5,
    }),
  };
}

describe("provider capability registry", () => {
  it("reports a standard zero-token local production path as ready", async () => {
    const report = await inspectCapabilities({
      plannerProvider: "auto",
      plannerProfile: "fast",
      mediaProvider: "builtin",
      generateVoice: true,
      voiceProvider: "local",
      generateMusic: true,
      render: true,
      browserRecording: true,
    }, runtime());

    expect(report).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-08-29T00:00:00.000Z",
      readyForRequest: true,
      fullyLocalForRequest: true,
      paidApiTokensRequired: false,
      blockers: [],
    });
    expect(report.capabilities.filter((item) => item.selected).map((item) => item.id)).toEqual(expect.arrayContaining([
      "planner.ollama-qwen",
      "recording.playwright",
      "visuals.builtin-uploads",
      "voice.system",
      "captions.timeline",
      "music.procedural",
      "rendering.ffmpeg",
      "rendering.ffprobe",
    ]));
  });

  it("identifies missing local adapters and consent before generation", async () => {
    const report = await inspectCapabilities({
      plannerProvider: "deterministic",
      mediaProvider: "local-adapter",
      generateVoice: true,
      voiceProvider: "local-clone",
      generateMusic: false,
      render: false,
    }, runtime([]));

    expect(report.readyForRequest).toBe(false);
    expect(report.blockers.map((item) => item.id)).toEqual([
      "visuals.local-adapter",
      "voice.local-clone",
    ]);
  });

  it("marks a selected network voice clearly without treating it as fully local", async () => {
    const report = await inspectCapabilities({
      plannerProvider: "deterministic",
      mediaProvider: "builtin",
      generateVoice: true,
      voiceProvider: "neural",
      generateMusic: false,
      render: false,
    }, runtime(["edge-tts"]));

    expect(report.readyForRequest).toBe(true);
    expect(report.fullyLocalForRequest).toBe(false);
    expect(report.capabilities.find((item) => item.id === "voice.edge-tts")).toMatchObject({
      selected: true,
      available: true,
      requiresNetwork: true,
      cost: "provider-terms",
    });
  });

  it("attaches the selected inventory to every smart production plan", async () => {
    const plan = await createSmartPromptVideoPlan({
      prompt: "Teach how rainfall returns water to rivers.",
      mode: "cartoon",
      plannerProvider: "deterministic",
      mediaProvider: "builtin",
      generateVoice: false,
      generateMusic: false,
      render: false,
    }, { capabilityRuntime: runtime([]) });

    expect(plan.capabilities).toMatchObject({ readyForRequest: true, paidApiTokensRequired: false });
    expect(plan.capabilities?.capabilities.find((item) => item.id === "planner.deterministic")).toMatchObject({ selected: true, available: true });
  });

  it("persists the plan and blockers before an unavailable generator can run", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agent-demo-capability-gate-"));
    const outputDirectory = path.join(directory, "project");
    try {
      await expect(createPromptVideoProject({
        prompt: "Create a local science animation.",
        mode: "cartoon",
        outputDirectory,
        plannerProvider: "deterministic",
        mediaProvider: "local-adapter",
        generateVoice: false,
        generateMusic: false,
        render: false,
      })).rejects.toThrow(/Production plan saved.*visuals\.local-adapter/i);
      const saved = JSON.parse(await readFile(path.join(outputDirectory, "production-plan.json"), "utf8")) as { capabilities: { blockers: Array<{ id: string }> } };
      expect(saved.capabilities.blockers).toEqual(expect.arrayContaining([{ id: "visuals.local-adapter", detail: expect.any(String), setup: expect.any(String) }]));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
