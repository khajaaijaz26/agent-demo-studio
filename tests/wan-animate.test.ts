import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { getWanAnimateStatus } from "../src/creator/wan-animate.js";

describe("Wan-Animate-2 installation discovery", () => {
  it("does not mistake a metadata-only Xet clone for runnable weights", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "agent-demo-wan-"));
    const model = path.join(home, "Models", "Wan2.2-Animate-2-14B");
    try {
      await mkdir(path.join(model, "wan_animate_2"), { recursive: true });
      await writeFile(path.join(model, "README.md"), "Wan-Animate-2");
      await writeFile(path.join(model, "wan_animate_2", "wan_animate_2_bf16.safetensors"), "version https://git-lfs.github.com/spec/v1\noid sha256:test\nsize 40000000000\n");
      const status = await getWanAnimateStatus({ homeDirectory: home, env: {} });
      expect(status).toMatchObject({ metadataInstalled: true, weightsInstalled: false, available: false, requiredDownloadGb: 82.5 });
      expect(status.modelPath).toBe(model);
      expect(status.message).toMatch(/deliberately skipped/i);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("accepts only loopback generation adapters", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "agent-demo-wan-adapter-"));
    try {
      const status = await getWanAnimateStatus({ homeDirectory: home, env: {}, adapterUrl: "https://video.example.com/generate" });
      expect(status.adapterConfigured).toBe(false);
      expect(status.available).toBe(false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
