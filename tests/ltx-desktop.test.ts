import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { getLtxDesktopStatus } from "../src/creator/ltx-desktop.js";

describe("LTX Desktop readiness", () => {
  it("distinguishes a healthy local backend from paid API-only mode", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agent-demo-ltx-"));
    const executable = path.join(directory, "LTX Desktop.exe");
    try {
      await writeFile(executable, "test");
      const localFetch = vi.fn(async (request) => {
        const url = String(request);
        if (url.endsWith("/health")) return new Response(JSON.stringify({ status: "ok", active_model: "fast-2.5", gpu_info: { name: "Test GPU" } }));
        return new Response(JSON.stringify({ force_api_generations: false }));
      }) as typeof fetch;
      const local = await getLtxDesktopStatus({ installedPaths: [executable], fetchImpl: localFetch });
      expect(local).toMatchObject({ installed: true, available: true, localGenerationAvailable: true, apiOnly: false, gpuName: "Test GPU" });

      const apiFetch = vi.fn(async (request) => {
        const url = String(request);
        if (url.endsWith("/health")) return new Response(JSON.stringify({ status: "ok" }));
        return new Response(JSON.stringify({ force_api_generations: true }));
      }) as typeof fetch;
      const apiOnly = await getLtxDesktopStatus({ installedPaths: [executable], fetchImpl: apiFetch });
      expect(apiOnly).toMatchObject({ available: true, localGenerationAvailable: false, apiOnly: true });
      expect(apiOnly.message).toMatch(/paid/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports an installed app whose backend cannot start", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agent-demo-ltx-down-"));
    const executable = path.join(directory, "LTX Desktop.exe");
    try {
      await writeFile(executable, "test");
      const fetchImpl = vi.fn(async () => { throw new Error("connection refused"); }) as typeof fetch;
      const status = await getLtxDesktopStatus({ installedPaths: [executable], fetchImpl });
      expect(status).toMatchObject({ installed: true, available: false, localGenerationAvailable: false });
      expect(status.message).toMatch(/backend is not reachable/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
