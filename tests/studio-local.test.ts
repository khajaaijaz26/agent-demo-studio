import path from "node:path";
import { access, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyStudioChatIntent,
  resolveStudioPromptPresets,
  startStudioServer,
  studioConversationReply,
  type StudioServerHandle,
} from "../src/studio/server.js";
import type { JobRecord } from "../src/types.js";

describe("Studio chat intent", () => {
  it("keeps operational follow-ups conversational without swallowing creative briefs", () => {
    expect(classifyStudioChatIntent("what happened")).toBe("conversation");
    expect(classifyStudioChatIntent("what happend?")).toBe("conversation");
    expect(classifyStudioChatIntent("Why is it blocked?" )).toBe("conversation");
    expect(classifyStudioChatIntent("Create a cartoon showing what happened when the seed began to glow.")).toBe("create-video");
    expect(classifyStudioChatIntent("Make a YouTube Short for kids")).toBe("create-video");
    expect(resolveStudioPromptPresets("Make a YouTube Short for kids", ["youtube-1080p"])).toEqual(["shorts"]);
  });

  it("explains an unavailable LTX backend and offers the honest local engine", () => {
    const failedJob: JobRecord = {
      id: "failed-ltx-job",
      type: "chat-video-cartoon",
      state: "failed",
      progress: 4,
      message: "visuals.ltx-desktop is unavailable",
      error: "LTX Desktop was not detected and its backend is not reachable.",
      createdAt: "2026-08-29T10:00:00.000Z",
      updatedAt: "2026-08-29T10:00:01.000Z",
    };
    expect(studioConversationReply("what happened", [failedJob])).toMatchObject({
      kind: "message",
      suggestedAction: "use-local-animation",
    });
    expect(studioConversationReply("what happened", [failedJob]).message).toContain("No video frames were generated");
  });
});

describe("local Studio uploads", () => {
  let handle: StudioServerHandle | undefined;
  afterEach(async () => handle?.close());

  it("keeps teacher uploads inside the selected Studio root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-demo-studio-root-"));
    try {
      handle = await startStudioServer({ root, port: 0, open: false });
      const page = await fetch(handle.url).then((response) => response.text());
      expect(page).toContain("prompt-scene-files");
      expect(page).toContain("prompt-narration");
      expect(page).toContain("prompt-planner-profile");
      expect(page).toContain("prompt-generate-music");
      expect(page).toContain("capability-refresh");
      expect(page).toContain('<option value="motion-graphics" selected>Local animation');
      expect(page).not.toContain('<option value="generative" selected>');
      const capabilityResponse = await fetch(`${handle.url}/api/capabilities`);
      expect(capabilityResponse.status).toBe(200);
      const capabilities = await capabilityResponse.json() as { paidApiTokensRequired: boolean; capabilities: Array<{ id: string }>; summary: { selected: number } };
      expect(capabilities.paidApiTokensRequired).toBe(false);
      expect(capabilities.summary.selected).toBeGreaterThan(0);
      expect(capabilities.capabilities.map((item) => item.id)).toEqual(expect.arrayContaining(["planner.deterministic", "music.procedural", "rendering.ffmpeg"]));
      const response = await fetch(`${handle.url}/api/uploads?kind=character&name=teacher-guide.png`, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: Buffer.from("local-test-image"),
      });
      expect(response.status).toBe(201);
      const uploaded = await response.json() as { path: string; sizeBytes: number; kind: string };
      expect(path.resolve(uploaded.path).startsWith(path.resolve(root))).toBe(true);
      expect(uploaded).toMatchObject({ sizeBytes: 16, kind: "character" });
      await expect(access(uploaded.path, constants.R_OK)).resolves.toBeUndefined();

      const narration = "Water warms and becomes vapor. Vapor cools into tiny droplets. Heavy droplets fall and collect again.";
      const planResponse = await fetch(`${handle.url}/api/creator/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Teach the water cycle.", narration, mode: "cartoon", plannerProvider: "deterministic" }),
      });
      expect(planResponse.status).toBe(200);
      const plan = await planResponse.json() as { scenes: Array<{ narration: string }> };
      expect(plan.scenes.map((scene) => scene.narration)).toEqual([
        "Water warms and becomes vapor.",
        "Vapor cools into tiny droplets.",
        "Heavy droplets fall and collect again.",
      ]);

      const jobsBefore = await fetch(`${handle.url}/api/jobs`).then((item) => item.json()) as unknown[];
      const chatResponse = await fetch(`${handle.url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "what happend" }),
      });
      expect(chatResponse.status).toBe(200);
      const chat = await chatResponse.json() as { kind: string; message: string };
      expect(chat.kind).toBe("message");
      expect(chat.message).toContain("No failed video job");
      const jobsAfter = await fetch(`${handle.url}/api/jobs`).then((item) => item.json()) as unknown[];
      expect(jobsAfter).toHaveLength(jobsBefore.length);
    } finally {
      await handle?.close();
      handle = undefined;
      await rm(root, { recursive: true, force: true });
    }
  });
});
