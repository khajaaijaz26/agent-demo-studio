import path from "node:path";
import { access, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { startStudioServer, type StudioServerHandle } from "../src/studio/server.js";

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
    } finally {
      await handle?.close();
      handle = undefined;
      await rm(root, { recursive: true, force: true });
    }
  });
});
