import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { errorMessage, serializeError } from "../errors.js";
import { listProjects, loadProject, resolveArtifact } from "../project-store.js";
import { renderDemo } from "../render/renderer.js";
import { generateVoiceover } from "../audio/tts.js";
import type { RenderDemoInput } from "../types.js";
import { jobs } from "../jobs.js";
import { listCreatorPresets } from "../creator/presets.js";
import { createTemplateManifest, listCreatorTemplates } from "../creator/templates.js";
import { parseCreatorManifest, validateCreatorManifest } from "../creator/schema.js";
import { remixMedia, renderCreatorManifest } from "../creator/renderer.js";
import { analyzeMedia } from "../creator/media.js";
import { transcribeMedia } from "../creator/captions.js";
import { createSocialPackage } from "../creator/social.js";
import { listCreatorAssets } from "../creator/assets.js";
import { createPromptVideoPlan, createPromptVideoProject } from "../creator/prompt.js";
import {
  CREATOR_IMAGE_MOTIONS,
  CREATOR_LOOP_ANIMATIONS,
  CREATOR_OVERLAY_ANIMATIONS,
  CREATOR_PROMPT_MODES,
  CREATOR_TRANSITIONS,
  CREATOR_VFX_PRESETS,
} from "../creator/types.js";
import type { CreatorManifest, CreatorPresetId, CreatorPromptMode, CreatorRenderResult, CreatorTemplateId } from "../creator/types.js";

export interface StudioServerOptions {
  root?: string;
  port?: number;
  open?: boolean;
}

export interface StudioServerHandle {
  url: string;
  close(): Promise<void>;
}

const publicDirectory = fileURLToPath(new URL("./public/", import.meta.url));

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 5_000_000) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

async function serveFile(
  request: IncomingMessage,
  response: ServerResponse,
  filePath: string,
  contentType: string,
): Promise<void> {
  const info = await stat(filePath);
  const range = request.headers.range;
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Content-Type", contentType);
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      response.writeHead(416);
      response.end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) {
      response.writeHead(416, { "Content-Range": `bytes */${info.size}` });
      response.end();
      return;
    }
    const { createReadStream } = await import("node:fs");
    response.writeHead(206, {
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${info.size}`,
    });
    createReadStream(filePath, { start, end }).pipe(response);
    return;
  }

  response.writeHead(200, { "Content-Length": info.size });
  const { createReadStream } = await import("node:fs");
  createReadStream(filePath).pipe(response);
}

function openBrowser(url: string): void {
  const command =
    process.platform === "win32" ? "cmd.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args =
    process.platform === "win32" ? ["/d", "/s", "/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
}

export async function startStudioServer(
  options: StudioServerOptions = {},
): Promise<StudioServerHandle> {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, { ok: true, product: "Agent Demo Studio", version: "0.3.0", creatorEngine: true, promptVideo: true, vfx: true });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/jobs") {
        sendJson(response, 200, jobs.list());
        return;
      }
      const jobMatch = /^\/api\/jobs\/([a-f0-9-]+)$/.exec(url.pathname);
      if (request.method === "GET" && jobMatch) {
        const job = jobs.get(jobMatch[1]!);
        sendJson(response, job ? 200 : 404, job ?? { error: "Job not found" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/creator/presets") {
        sendJson(response, 200, listCreatorPresets());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/creator/templates") {
        sendJson(response, 200, listCreatorTemplates());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/creator/assets") {
        sendJson(response, 200, {
          assets: listCreatorAssets(),
          transitions: CREATOR_TRANSITIONS,
          overlayAnimations: CREATOR_OVERLAY_ANIMATIONS,
          loopAnimations: CREATOR_LOOP_ANIMATIONS,
          imageMotions: CREATOR_IMAGE_MOTIONS,
          vfx: CREATOR_VFX_PRESETS,
          promptModes: CREATOR_PROMPT_MODES,
        });
        return;
      }
      const creatorArtifactMatch = /^\/api\/creator\/jobs\/([a-f0-9-]+)\/outputs\/([^/]+)\/(video|thumbnail)$/.exec(url.pathname);
      if (request.method === "GET" && creatorArtifactMatch) {
        const job = jobs.get<CreatorRenderResult | { renderResult?: CreatorRenderResult }>(creatorArtifactMatch[1]!);
        const outputId = decodeURIComponent(creatorArtifactMatch[2]!);
        const jobResult = job?.result;
        const renderResult: CreatorRenderResult | undefined = jobResult && "outputs" in jobResult
          ? jobResult as CreatorRenderResult
          : jobResult && "renderResult" in jobResult
            ? jobResult.renderResult
            : undefined;
        const artifact = renderResult?.outputs?.find((item) => item.id === outputId);
        if (!artifact) throw new Error("Creator artifact was not found or is not ready.");
        const kind = creatorArtifactMatch[3];
        await serveFile(request, response, kind === "video" ? artifact.videoPath : artifact.thumbnailPath, kind === "video" ? "video/mp4" : "image/jpeg");
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/creator/template") {
        const body = await readJson(request);
        const templateId = String(body.templateId || "product-demo") as CreatorTemplateId;
        if (!listCreatorTemplates().some((template) => template.id === templateId)) throw new Error(`Unknown creator template '${templateId}'.`);
        sendJson(response, 200, createTemplateManifest(templateId, {
          title: typeof body.title === "string" ? body.title : undefined,
          source: typeof body.source === "string" ? body.source : undefined,
          secondarySource: typeof body.secondarySource === "string" ? body.secondarySource : undefined,
          outputDirectory: typeof body.outputDirectory === "string" ? body.outputDirectory : undefined,
        }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/creator/prompt") {
        const body = await readJson(request);
        const mode = String(body.mode || "product-launch") as CreatorPromptMode;
        if (!CREATOR_PROMPT_MODES.includes(mode)) throw new Error(`Unknown prompt mode '${mode}'.`);
        const presets = (Array.isArray(body.presets) ? body.presets : ["youtube-1080p"]) as CreatorPresetId[];
        const job = jobs.start(`creator-prompt-${mode}`, (report) => createPromptVideoProject({
          prompt: String(body.prompt || ""),
          mode,
          title: typeof body.title === "string" ? body.title : undefined,
          source: typeof body.source === "string" && body.source.trim() ? body.source : undefined,
          outputDirectory: typeof body.outputDirectory === "string" && body.outputDirectory.trim() ? body.outputDirectory : undefined,
          narration: typeof body.narration === "string" ? body.narration : undefined,
          durationSeconds: typeof body.durationSeconds === "number" ? body.durationSeconds : undefined,
          presenter: ["none", "aria", "leo", "nova", "milo"].includes(String(body.presenter)) ? body.presenter as "none" | "aria" | "leo" | "nova" | "milo" : undefined,
          voice: typeof body.voice === "string" ? body.voice : undefined,
          voiceProvider: body.voiceProvider === "neural" ? "neural" : "local",
          voiceRate: typeof body.voiceRate === "number" ? body.voiceRate : undefined,
          presets,
          generateVoice: body.generateVoice !== false,
          generateMusic: body.generateMusic !== false,
          render: body.render === true,
        }, report));
        sendJson(response, 202, job);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/creator/plan") {
        const body = await readJson(request);
        const mode = String(body.mode || "product-launch") as CreatorPromptMode;
        if (!CREATOR_PROMPT_MODES.includes(mode)) throw new Error(`Unknown prompt mode '${mode}'.`);
        sendJson(response, 200, createPromptVideoPlan({
          prompt: String(body.prompt || ""),
          mode,
          title: typeof body.title === "string" ? body.title : undefined,
          source: typeof body.source === "string" && body.source.trim() ? body.source : undefined,
          durationSeconds: typeof body.durationSeconds === "number" ? body.durationSeconds : undefined,
          presenter: ["none", "aria", "leo", "nova", "milo"].includes(String(body.presenter)) ? body.presenter as "none" | "aria" | "leo" | "nova" | "milo" : undefined,
          presets: (Array.isArray(body.presets) ? body.presets : ["youtube-1080p"]) as CreatorPresetId[],
          generateVoice: body.generateVoice !== false,
          generateMusic: body.generateMusic !== false,
        }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/creator/validate") {
        const body = await readJson(request);
        sendJson(response, 200, validateCreatorManifest(body.manifest));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/creator/render") {
        const body = await readJson(request);
        const manifest = typeof body.manifestPath === "string" ? body.manifestPath : parseCreatorManifest(body.manifest);
        const job = jobs.start("creator-render", (report) => renderCreatorManifest(manifest, report, {
          baseDirectory: typeof body.baseDirectory === "string" ? body.baseDirectory : undefined,
          keepWork: body.keepWork === true,
        }));
        sendJson(response, 202, job);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/creator/remix") {
        const body = await readJson(request);
        const source = String(body.source || "");
        const presets = (Array.isArray(body.presets) ? body.presets : ["shorts", "reels", "tiktok"]) as CreatorPresetId[];
        const job = jobs.start("creator-remix", (report) => remixMedia(source, presets, {
          title: typeof body.title === "string" ? body.title : undefined,
          outputDirectory: typeof body.outputDirectory === "string" ? body.outputDirectory : undefined,
          captionsPath: typeof body.captionsPath === "string" ? body.captionsPath : undefined,
          musicPath: typeof body.musicPath === "string" ? body.musicPath : undefined,
          baseDirectory: typeof body.baseDirectory === "string" ? body.baseDirectory : undefined,
        }, report));
        sendJson(response, 202, job);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/creator/analyze") {
        const body = await readJson(request);
        const job = jobs.start("creator-analysis", () => analyzeMedia(String(body.source || "")));
        sendJson(response, 202, job);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/creator/transcribe") {
        const body = await readJson(request);
        const job = jobs.start("creator-transcription", async () => ({ captionsPath: await transcribeMedia(String(body.source || ""), {
          outputDirectory: typeof body.outputDirectory === "string" ? body.outputDirectory : undefined,
          language: typeof body.language === "string" ? body.language : undefined,
          model: typeof body.model === "string" ? body.model : undefined,
          format: body.format === "vtt" ? "vtt" : "srt",
        }) }));
        sendJson(response, 202, job);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/creator/package") {
        const body = await readJson(request);
        const manifest = parseCreatorManifest(body.manifest) as CreatorManifest;
        const renderResult = body.renderResult as unknown as CreatorRenderResult;
        sendJson(response, 200, await createSocialPackage(manifest, renderResult, typeof body.destination === "string" ? body.destination : undefined));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/projects") {
        sendJson(response, 200, await listProjects(options.root));
        return;
      }

      const projectMatch = /^\/api\/projects\/([a-z0-9-]+)(?:\/(video|thumbnail|render|voice))?$/.exec(
        url.pathname,
      );
      if (projectMatch) {
        const projectId = projectMatch[1]!;
        const action = projectMatch[2];
        const project = await loadProject(projectId, options.root);

        if (request.method === "GET" && !action) {
          sendJson(response, 200, project);
          return;
        }
        if (request.method === "GET" && action === "video") {
          if (!project.artifacts.finalVideo) throw new Error("This project has no rendered video yet.");
          await serveFile(
            request,
            response,
            resolveArtifact(project, project.artifacts.finalVideo, options.root),
            "video/mp4",
          );
          return;
        }
        if (request.method === "GET" && action === "thumbnail") {
          if (!project.artifacts.thumbnail) throw new Error("This project has no thumbnail yet.");
          await serveFile(
            request,
            response,
            resolveArtifact(project, project.artifacts.thumbnail, options.root),
            "image/jpeg",
          );
          return;
        }
        if (request.method === "POST" && action === "voice") {
          const body = await readJson(request);
          const narration = String(body.narration || "");
          const output = await generateVoiceover(projectId, narration, {
            root: options.root,
            voice: typeof body.voice === "string" ? body.voice : undefined,
            rate: typeof body.rate === "number" ? body.rate : undefined,
          });
          sendJson(response, 200, { ok: true, output });
          return;
        }
        if (request.method === "POST" && action === "render") {
          const body = await readJson(request);
          const renderInput: RenderDemoInput = {
            projectId,
            root: options.root,
            title: typeof body.title === "string" ? body.title : undefined,
            subtitle: typeof body.subtitle === "string" ? body.subtitle : undefined,
            narration: typeof body.narration === "string" ? body.narration : undefined,
            voicePath: typeof body.voicePath === "string" ? body.voicePath : undefined,
            musicPath: typeof body.musicPath === "string" ? body.musicPath : undefined,
            useGeneratedMusic:
              typeof body.useGeneratedMusic === "boolean" ? body.useGeneratedMusic : undefined,
            theme:
              body.theme && typeof body.theme === "object"
                ? (body.theme as RenderDemoInput["theme"])
                : undefined,
            render:
              body.render && typeof body.render === "object"
                ? (body.render as RenderDemoInput["render"])
                : undefined,
          };
          sendJson(response, 200, await renderDemo(renderInput));
          return;
        }
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { error: "Method not allowed" });
        return;
      }
      const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const safeName = path.basename(requested);
      const filePath = path.join(publicDirectory, safeName);
      const extension = path.extname(safeName);
      const contentType =
        extension === ".css"
          ? "text/css; charset=utf-8"
          : extension === ".js"
            ? "text/javascript; charset=utf-8"
            : "text/html; charset=utf-8";
      response.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
        "Content-Security-Policy":
          "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'",
      });
      response.end(await readFile(filePath));
    } catch (error) {
      if (!response.headersSent) sendJson(response, 500, { error: serializeError(error) });
      else response.destroy(new Error(errorMessage(error)));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4545, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port ?? 4545;
  const url = `http://127.0.0.1:${port}`;
  if (options.open !== false) openBrowser(url);

  return {
    url,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
