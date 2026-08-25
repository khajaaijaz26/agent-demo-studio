#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createAgentDemoMcpServer } from "./server.js";

serveStdio(() => createAgentDemoMcpServer(), {
  onerror: (error) => console.error(`[agent-demo-studio] ${error.message}`),
});
