import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
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
import { renderDemo } from "../render/renderer.js";
import { recordDemoFlow } from "../workflow.js";
import { runDoctor } from "../installer/agents.js";
import { startStudioServer, type StudioServerHandle } from "../studio/server.js";
import type { BrowserAction, DemoProject, RecordFlowInput, RenderDemoInput } from "../types.js";

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

let studio: StudioServerHandle | undefined;

export function createAgentDemoMcpServer(): McpServer {
  const server = new McpServer(
    { name: "agent-demo-studio", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Agent Demo Studio records websites in a visible browser and renders polished 1080p demos. Preferred live flow: demo_create_project, demo_browser_start, then demo_browser_snapshot and demo_browser_act as needed, demo_browser_finish, demo_generate_voice, and demo_render. For a known script, use demo_record_flow. Recording/rendering jobs return job_id; poll demo_job_status until completed. Use role/name or stable selectors. Never put passwords or secrets in demo actions.",
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
    "demo_job_status",
    {
      title: "Get background job status",
      description: "Poll a recording, voice-over, or rendering job until it completes or fails.",
      inputSchema: z.object({ jobId: z.string() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ jobId }) => result(jobs.get(jobId) ?? { error: "JOB_NOT_FOUND", jobId }),
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
