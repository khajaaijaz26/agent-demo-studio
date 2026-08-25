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
    if (size > 1_000_000) throw new Error("Request body is too large.");
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
        sendJson(response, 200, { ok: true, product: "Agent Demo Studio" });
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
