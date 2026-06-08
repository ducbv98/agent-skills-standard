#!/usr/bin/env node
import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HybridRagEngine } from "hybrid-rag";
import { buildContext7Server } from "./server.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const engine = new HybridRagEngine(config);
  await engine.initialize();

  const server = buildContext7Server(engine);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error("[mcp-context7] Server running on stdio");
}

main().catch((err: unknown) => {
  console.error("[mcp-context7] Fatal error:", err);
  process.exit(1);
});
