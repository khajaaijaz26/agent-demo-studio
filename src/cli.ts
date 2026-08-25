#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createAgentDemoMcpServer } from "./mcp/server.js";
import { createProject, listProjects, loadProject } from "./project-store.js";
import { recordDemoFlow } from "./workflow.js";
import { generateVoiceover } from "./audio/tts.js";
import { renderDemo } from "./render/renderer.js";
import { startStudioServer } from "./studio/server.js";
import {
  ensureChromiumInstalled,
  installAgentIntegrations,
  mcpLaunchConfiguration,
  removeAgentIntegrations,
  runDoctor,
  type AgentTarget,
} from "./installer/agents.js";
import { errorMessage } from "./errors.js";
import type { RecordFlowInput } from "./types.js";

const program = new Command();

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function progress(value: number, message: string): void {
  const percent = String(Math.round(value)).padStart(3, " ");
  process.stderr.write(`\r[${percent}%] ${message.padEnd(52, " ")}`);
  if (value >= 100) process.stderr.write("\n");
}

function targetsFromOptions(options: { codex?: boolean; claude?: boolean }): AgentTarget[] {
  const selected: AgentTarget[] = [];
  if (options.codex) selected.push("codex");
  if (options.claude) selected.push("claude");
  return selected.length ? selected : ["codex", "claude"];
}

program
  .name("agent-demo")
  .description("Record, edit, narrate, and render polished browser demos from Codex or Claude Code.")
  .version("0.1.0");

program
  .command("setup")
  .description("Install Chromium if needed and register the MCP server with Codex and Claude Code.")
  .option("--codex", "Install only for Codex")
  .option("--claude", "Install only for Claude Code")
  .action(async (options: { codex?: boolean; claude?: boolean }) => {
    process.stderr.write("Checking the browser runtime...\n");
    const browserInstalled = await ensureChromiumInstalled();
    if (browserInstalled) process.stderr.write("Playwright Chromium installed.\n");
    const integrations = await installAgentIntegrations(targetsFromOptions(options));
    output({ integrations, checks: await runDoctor() });
  });

program
  .command("remove-integration")
  .description("Remove MCP registration while preserving all demo projects.")
  .option("--codex", "Remove only from Codex")
  .option("--claude", "Remove only from Claude Code")
  .action(async (options: { codex?: boolean; claude?: boolean }) => {
    output(await removeAgentIntegrations(targetsFromOptions(options)));
  });

program
  .command("doctor")
  .description("Check all local recording and agent integration requirements.")
  .action(async () => {
    const checks = await runDoctor();
    checks.forEach((check) =>
      process.stdout.write(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}\n`),
    );
    if (checks.some((check) => !check.ok && !["Codex", "Claude Code"].includes(check.name))) {
      process.exitCode = 1;
    }
  });

program
  .command("mcp")
  .description("Run the Agent Demo Studio MCP server over stdio.")
  .action(() => {
    serveStdio(() => createAgentDemoMcpServer(), {
      onerror: (error) => console.error(`[agent-demo-studio] ${error.message}`),
    });
  });

program
  .command("mcp-config")
  .description("Print a portable MCP configuration block for other compatible clients.")
  .action(() => output(mcpLaunchConfiguration()));

program
  .command("new")
  .description("Create an empty demo project.")
  .argument("<url>", "Website URL")
  .requiredOption("--title <title>", "Project title")
  .option("--subtitle <subtitle>", "Project subtitle")
  .option("--id <id>", "Stable project ID")
  .option("--root <directory>", "Studio data directory")
  .action(async (url: string, options: { title: string; subtitle?: string; id?: string; root?: string }) => {
    output(await createProject({ ...options, url }));
  });

program
  .command("quick")
  .description("Record and render a simple visible website demo in one command.")
  .argument("<url>", "Website URL")
  .option("--title <title>", "Demo title")
  .option("--subtitle <subtitle>", "Demo subtitle")
  .option("--narration <text>", "Voice-over narration")
  .option("--duration <seconds>", "Time to show the website", "4")
  .option("--headless", "Run without showing the browser", false)
  .option("--root <directory>", "Studio data directory")
  .option("--no-render", "Only save the raw recording")
  .option("--no-voice", "Do not synthesize narration")
  .action(
    async (
      url: string,
      options: {
        title?: string;
        subtitle?: string;
        narration?: string;
        duration: string;
        headless: boolean;
        root?: string;
        render: boolean;
        voice: boolean;
      },
    ) => {
      const hostname = new URL(url).hostname.replace(/^www\./, "");
      const project = await recordDemoFlow(
        {
          title: options.title || `${hostname} product tour`,
          subtitle: options.subtitle,
          url,
          root: options.root,
          narration: options.narration,
          actions: [
            { type: "chapter", label: "Product overview", milliseconds: 1_000 },
            { type: "wait", milliseconds: Math.max(1, Number(options.duration)) * 1_000 },
          ],
          headless: options.headless,
          generateVoice: options.voice,
          autoRender: options.render,
        },
        progress,
      );
      output(project);
    },
  );

program
  .command("record")
  .description("Run an end-to-end demo script from JSON.")
  .argument("<script>", "Path to a JSON recording script")
  .option("--root <directory>", "Override the Studio data directory")
  .option("--headless", "Run without showing the browser")
  .action(async (scriptPath: string, options: { root?: string; headless?: boolean }) => {
    const script = JSON.parse(await readFile(scriptPath, "utf8")) as RecordFlowInput;
    if (options.root) script.root = options.root;
    if (options.headless !== undefined) script.headless = options.headless;
    output(await recordDemoFlow(script, progress));
  });

program
  .command("voice")
  .description("Generate and attach a local voice-over.")
  .argument("<project-id>", "Project ID")
  .option("--text <narration>", "Narration text")
  .option("--file <path>", "Read narration from a text file")
  .option("--voice <name>", "System voice name")
  .option("--rate <number>", "Speaking rate from -10 to 10", "0")
  .option("--root <directory>", "Studio data directory")
  .action(
    async (
      projectId: string,
      options: { text?: string; file?: string; voice?: string; rate: string; root?: string },
    ) => {
      const narration = options.file ? await readFile(options.file, "utf8") : options.text;
      if (!narration) throw new Error("Use --text or --file to provide narration.");
      output({
        output: await generateVoiceover(projectId, narration, {
          root: options.root,
          voice: options.voice,
          rate: Number(options.rate),
        }),
      });
    },
  );

program
  .command("render")
  .description("Render a recorded project as a polished 1080p MP4.")
  .argument("<project-id>", "Project ID")
  .option("--voice <path>", "Voice-over audio path")
  .option("--music <path>", "Music audio path")
  .option("--no-generated-music", "Disable generated ambient music")
  .option("--no-captions", "Disable burned-in narration captions")
  .option("--root <directory>", "Studio data directory")
  .action(
    async (
      projectId: string,
      options: {
        voice?: string;
        music?: string;
        generatedMusic: boolean;
        captions: boolean;
        root?: string;
      },
    ) => {
      output(
        await renderDemo(
          {
            projectId,
            root: options.root,
            voicePath: options.voice,
            musicPath: options.music,
            useGeneratedMusic: options.generatedMusic,
            render: { captions: options.captions },
          },
          progress,
        ),
      );
    },
  );

program
  .command("list")
  .description("List all local demo projects.")
  .option("--root <directory>", "Studio data directory")
  .action(async (options: { root?: string }) => output(await listProjects(options.root)));

program
  .command("show")
  .description("Print one project's manifest.")
  .argument("<project-id>", "Project ID")
  .option("--root <directory>", "Studio data directory")
  .action(async (projectId: string, options: { root?: string }) =>
    output(await loadProject(projectId, options.root)),
  );

program
  .command("studio")
  .description("Open the local all-in-one visual editor.")
  .option("--port <number>", "Local port", "4545")
  .option("--root <directory>", "Studio data directory")
  .option("--no-open", "Do not open the browser automatically")
  .action(async (options: { port: string; root?: string; open: boolean }) => {
    const server = await startStudioServer({
      root: options.root,
      port: Number(options.port),
      open: options.open,
    });
    process.stdout.write(`Agent Demo Studio is running at ${server.url}\n`);
    await new Promise<void>((resolve) => {
      const shutdown = () => void server.close().finally(resolve);
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });
  });

program.parseAsync().catch((error) => {
  console.error(`Agent Demo Studio: ${errorMessage(error)}`);
  process.exitCode = 1;
});
