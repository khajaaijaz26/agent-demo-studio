import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { ffmpegCommand, ffprobeCommand, pathExists } from "../config.js";
import { AgentDemoError } from "../errors.js";
import { commandExists, runCommand, type CommandResult } from "../utils/process.js";

export type AgentTarget = "codex" | "claude";

export interface IntegrationResult {
  agent: AgentTarget;
  installed: boolean;
  message: string;
}

function cliEntryPath(): string {
  return fileURLToPath(new URL("../cli.js", import.meta.url));
}

async function runAgentCommand(command: string, args: string[]): Promise<CommandResult> {
  if (process.platform === "win32") {
    return runCommand("cmd.exe", ["/d", "/s", "/c", command, ...args], {
      timeoutMs: 60_000,
    });
  }
  return runCommand(command, args, { timeoutMs: 60_000 });
}

async function installCodex(): Promise<IntegrationResult> {
  if (!(await commandExists("codex"))) {
    return { agent: "codex", installed: false, message: "Codex CLI was not found." };
  }
  const list = await runAgentCommand("codex", ["mcp", "list"]);
  if (new RegExp("(^|\\n)agent-demo-studio\\s", "i").test(list.stdout)) {
    await runAgentCommand("codex", ["mcp", "remove", "agent-demo-studio"]);
  }
  const add = await runAgentCommand("codex", [
    "mcp",
    "add",
    "agent-demo-studio",
    "--",
    process.execPath,
    cliEntryPath(),
    "mcp",
  ]);
  if (add.code !== 0) {
    throw new AgentDemoError(
      "CODEX_SETUP_FAILED",
      add.stderr.trim() || add.stdout.trim() || "Codex MCP setup failed.",
    );
  }
  return {
    agent: "codex",
    installed: true,
    message: "Installed for Codex CLI, IDE, and desktop clients.",
  };
}

async function installClaude(): Promise<IntegrationResult> {
  if (!(await commandExists("claude"))) {
    return { agent: "claude", installed: false, message: "Claude Code was not found." };
  }
  const existing = await runAgentCommand("claude", ["mcp", "get", "agent-demo-studio"]);
  if (existing.code === 0) {
    await runAgentCommand("claude", [
      "mcp",
      "remove",
      "agent-demo-studio",
      "--scope",
      "user",
    ]);
  }
  const add = await runAgentCommand("claude", [
    "mcp",
    "add",
    "--scope",
    "user",
    "--transport",
    "stdio",
    "agent-demo-studio",
    "--",
    process.execPath,
    cliEntryPath(),
    "mcp",
  ]);
  if (add.code !== 0) {
    throw new AgentDemoError(
      "CLAUDE_SETUP_FAILED",
      add.stderr.trim() || add.stdout.trim() || "Claude Code MCP setup failed.",
    );
  }
  return {
    agent: "claude",
    installed: true,
    message: "Installed for Claude Code at user scope.",
  };
}

export async function installAgentIntegrations(
  targets: AgentTarget[] = ["codex", "claude"],
): Promise<IntegrationResult[]> {
  const results: IntegrationResult[] = [];
  for (const target of targets) {
    results.push(target === "codex" ? await installCodex() : await installClaude());
  }
  return results;
}

export async function removeAgentIntegrations(
  targets: AgentTarget[] = ["codex", "claude"],
): Promise<IntegrationResult[]> {
  const results: IntegrationResult[] = [];
  for (const target of targets) {
    if (!(await commandExists(target))) {
      results.push({ agent: target, installed: false, message: `${target} was not found.` });
      continue;
    }
    const args =
      target === "codex"
        ? ["mcp", "remove", "agent-demo-studio"]
        : ["mcp", "remove", "agent-demo-studio", "--scope", "user"];
    const result = await runAgentCommand(target, args);
    results.push({
      agent: target,
      installed: false,
      message:
        result.code === 0
          ? "Integration removed. Project files were preserved."
          : result.stderr.trim() || "Integration was not configured.",
    });
  }
  return results;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export async function ensureChromiumInstalled(): Promise<boolean> {
  if (await pathExists(chromium.executablePath())) return false;
  const require = createRequire(import.meta.url);
  const cliPath = require.resolve("playwright/cli");
  const result = await runCommand(process.execPath, [cliPath, "install", "chromium"], {
    timeoutMs: 15 * 60_000,
    inherit: true,
  });
  if (result.code !== 0) {
    throw new AgentDemoError(
      "CHROMIUM_INSTALL_FAILED",
      "Playwright could not install Chromium. Run: npx playwright install chromium",
    );
  }
  return true;
}

export async function runDoctor(): Promise<DoctorCheck[]> {
  const browserPath = chromium.executablePath();
  const checks: DoctorCheck[] = [
    {
      name: "Node.js",
      ok: Number(process.versions.node.split(".")[0]) >= 20,
      detail: process.version,
    },
    {
      name: "FFmpeg",
      ok: await commandExists(ffmpegCommand()),
      detail: ffmpegCommand(),
    },
    {
      name: "FFprobe",
      ok: await commandExists(ffprobeCommand()),
      detail: ffprobeCommand(),
    },
    {
      name: "Playwright Chromium",
      ok: await pathExists(browserPath),
      detail: browserPath,
    },
    {
      name: "Codex",
      ok: await commandExists("codex"),
      detail: "codex",
    },
    {
      name: "Claude Code",
      ok: await commandExists("claude"),
      detail: "claude",
    },
  ];
  return checks;
}

export function mcpLaunchConfiguration(): Record<string, unknown> {
  return {
    mcpServers: {
      "agent-demo-studio": {
        command: process.execPath,
        args: [path.resolve(cliEntryPath()), "mcp"],
      },
    },
  };
}
