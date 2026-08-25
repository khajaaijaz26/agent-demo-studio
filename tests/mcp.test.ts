import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";
import { createAgentDemoMcpServer } from "../src/mcp/server.js";

describe("MCP server", () => {
  it("constructs the complete tool server", () => {
    expect(createAgentDemoMcpServer()).toBeInstanceOf(McpServer);
  });
});
