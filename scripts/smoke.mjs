import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { recordDemoFlow } from "../dist/workflow.js";
import { resolveArtifact } from "../dist/project-store.js";
import { runCommand } from "../dist/utils/process.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const fixture = await readFile(path.join(root, "examples", "sample-site", "index.html"));
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(fixture);
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Smoke server did not start.");
  const outputRoot = path.join(root, "test-output");
  const project = await recordDemoFlow(
    {
      id: `smoke-${Date.now()}`,
      title: "Orbit Analytics in action",
      subtitle: "A real browser-to-video integration test",
      url: `http://127.0.0.1:${address.port}`,
      root: outputRoot,
      narration:
        "Meet Orbit Analytics. Create a focused report, choose the audience, and share product insights in seconds.",
      actions: [
        { type: "chapter", label: "Live analytics", description: "A complete workflow", milliseconds: 900 },
        { type: "click", role: "button", name: "Create report", label: "Open the report builder" },
        { type: "fill", selector: "#report-name", value: "Q3 Growth Brief", label: "Name the report" },
        { type: "fill", selector: "#audience", value: "Leadership team", label: "Choose the audience" },
        { type: "click", role: "button", name: "Generate report", label: "Generate" },
        { type: "wait", milliseconds: 1_200, label: "Show the result" }
      ],
      headless: true,
      slowMotionMs: 30,
      generateVoice: process.env.SMOKE_TTS === "1",
      autoRender: true,
      render: { introSeconds: 0.6, outroSeconds: 0.5 },
    },
    (progress, message) => process.stderr.write(`\r[smoke ${String(progress).padStart(3)}%] ${message.padEnd(50)}`),
  );
  process.stderr.write("\n");
  if (!project.artifacts.finalVideo) throw new Error("Smoke test did not produce a final video.");
  const video = resolveArtifact(project, project.artifacts.finalVideo, outputRoot);
  const probe = await runCommand(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height", "-of", "json", video],
    { timeoutMs: 30_000 },
  );
  if (probe.code !== 0) throw new Error(probe.stderr);
  const details = JSON.parse(probe.stdout);
  const stream = details.streams?.[0];
  if (stream?.width !== 1920 || stream?.height !== 1080 || stream?.codec_name !== "h264") {
    throw new Error(`Unexpected output: ${JSON.stringify(stream)}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, projectId: project.id, video, stream }, null, 2)}\n`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
