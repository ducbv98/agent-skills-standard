#!/usr/bin/env node
import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BrowserManager } from "./BrowserManager.js";
import { buildPlaywrightServer } from "./server.js";

async function main(): Promise<void> {
  const headless = process.env["PLAYWRIGHT_HEADLESS"] !== "false";
  const browserType =
    (process.env["PLAYWRIGHT_BROWSER"] as "chromium" | "firefox" | "webkit") ??
    "chromium";

  const manager = new BrowserManager({ headless, browserType });
  const server = buildPlaywrightServer(manager);
  const transport = new StdioServerTransport();

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await manager.close();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await manager.close();
    process.exit(0);
  });

  await server.connect(transport);
  console.error("[mcp-playwright] Server running on stdio");
}

main().catch((err: unknown) => {
  console.error("[mcp-playwright] Fatal error:", err);
  process.exit(1);
});
