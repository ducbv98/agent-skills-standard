import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BrowserManager } from "./BrowserManager.js";

/**
 * Playwright MCP Server
 *
 * Tools:
 *   navigate          Navigate to a URL
 *   screenshot        Capture a screenshot (returns base64 PNG)
 *   get_text          Get visible text content of the page
 *   click             Click an element by CSS selector
 *   fill              Fill an input field
 *   evaluate          Run JavaScript in the page context
 *   get_html          Get full page HTML
 *   scroll            Scroll the page
 *   wait_for          Wait for a selector to appear
 *   close_browser     Close the browser and free resources
 */
export function buildPlaywrightServer(manager: BrowserManager): McpServer {
  const server = new McpServer(
    {
      name: "mcp-playwright",
      version: "1.0.0",
    },
    {
      instructions: `
You are connected to the Playwright MCP server.
It gives you full control of a Chromium browser via Playwright.

# TOOLS

- navigate        : Go to any URL
- screenshot      : Capture the current page as a PNG image (base64)
- get_text        : Get the visible text content of the page or a selector
- click           : Click an element by CSS selector
- fill            : Type into an input / textarea by CSS selector
- evaluate        : Run arbitrary JavaScript and get the return value
- get_html        : Get the full page HTML (or innerHTML of a selector)
- scroll          : Scroll by pixels or to a selector
- wait_for        : Wait for a selector to appear in the DOM
- close_browser   : Close the browser (frees resources; auto-reopens on next tool call)

# SAFETY NOTES
- This server runs a REAL browser on the host machine.
- Do not navigate to untrusted URLs received from untrusted sources.
- JavaScript executed via 'evaluate' runs in the page context, not the host OS.
`.trim(),
    },
  );

  // ── navigate ──────────────────────────────────────────────────────────────
  server.registerTool(
    "navigate",
    {
      title: "Navigate to URL",
      description: "Navigate the browser to a URL and wait for the page to load.",
      inputSchema: z.object({
        url: z.string().url().describe("Full URL to navigate to (must include http/https)"),
        waitUntil: z
          .enum(["load", "domcontentloaded", "networkidle", "commit"])
          .default("load")
          .describe("When to consider navigation finished"),
      }),
    },
    async (args) => {
      const page = await manager.getPage();
      await page.goto(args.url, { waitUntil: args.waitUntil });
      const title = await page.title();
      return {
        content: [
          {
            type: "text",
            text: `✅ Navigated to: ${args.url}\n**Page title**: ${title}`,
          },
        ],
      };
    },
  );

  // ── screenshot ────────────────────────────────────────────────────────────
  server.registerTool(
    "screenshot",
    {
      title: "Take screenshot",
      description: "Capture the current page as a PNG screenshot.",
      inputSchema: z.object({
        fullPage: z
          .boolean()
          .default(false)
          .describe("Capture the full scrollable page (true) or just the viewport (false)"),
        selector: z
          .string()
          .optional()
          .describe("CSS selector — screenshot only that element"),
      }),
    },
    async (args) => {
      const page = await manager.getPage();

      let buffer: Buffer;
      if (args.selector) {
        const el = await page.$(args.selector);
        if (!el) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Element not found: ${args.selector}`,
              },
            ],
            isError: true,
          };
        }
        buffer = (await el.screenshot()) as Buffer;
      } else {
        buffer = (await page.screenshot({ fullPage: args.fullPage })) as Buffer;
      }

      return {
        content: [
          {
            type: "image",
            data: buffer.toString("base64"),
            mimeType: "image/png",
          },
        ],
      };
    },
  );

  // ── get_text ──────────────────────────────────────────────────────────────
  server.registerTool(
    "get_text",
    {
      title: "Get page text",
      description: "Get the visible text content of the page or a specific element.",
      inputSchema: z.object({
        selector: z
          .string()
          .optional()
          .describe("CSS selector for a specific element (omit for whole page)"),
      }),
    },
    async (args) => {
      const page = await manager.getPage();
      let text: string;
      if (args.selector) {
        const el = await page.$(args.selector);
        text = el ? (await el.innerText()) : `Element not found: ${args.selector}`;
      } else {
        text = await page.innerText("body");
      }
      return { content: [{ type: "text", text }] };
    },
  );

  // ── click ─────────────────────────────────────────────────────────────────
  server.registerTool(
    "click",
    {
      title: "Click element",
      description: "Click an element identified by a CSS selector.",
      inputSchema: z.object({
        selector: z.string().min(1).describe("CSS selector for the element to click"),
        button: z
          .enum(["left", "right", "middle"])
          .default("left")
          .describe("Mouse button to use"),
        clickCount: z
          .number()
          .int()
          .min(1)
          .max(3)
          .default(1)
          .describe("Number of clicks (e.g. 2 for double-click)"),
      }),
    },
    async (args) => {
      const page = await manager.getPage();
      await page.click(args.selector, {
        button: args.button,
        clickCount: args.clickCount,
      });
      return {
        content: [{ type: "text", text: `✅ Clicked: ${args.selector}` }],
      };
    },
  );

  // ── fill ──────────────────────────────────────────────────────────────────
  server.registerTool(
    "fill",
    {
      title: "Fill input",
      description: "Fill an input or textarea with text.",
      inputSchema: z.object({
        selector: z.string().min(1).describe("CSS selector for the input element"),
        value: z.string().describe("Text to type into the field"),
        clearFirst: z
          .boolean()
          .default(true)
          .describe("Clear existing content before typing"),
      }),
    },
    async (args) => {
      const page = await manager.getPage();
      if (args.clearFirst) {
        await page.fill(args.selector, args.value);
      } else {
        await page.type(args.selector, args.value);
      }
      return {
        content: [
          {
            type: "text",
            text: `✅ Filled "${args.selector}" with "${args.value}"`,
          },
        ],
      };
    },
  );

  // ── evaluate ──────────────────────────────────────────────────────────────
  server.registerTool(
    "evaluate",
    {
      title: "Evaluate JavaScript",
      description: "Run JavaScript in the page context and return the result.",
      inputSchema: z.object({
        expression: z
          .string()
          .min(1)
          .describe(
            "JavaScript expression or function body to evaluate. Must return a JSON-serialisable value.",
          ),
      }),
    },
    async (args) => {
      const page = await manager.getPage();
      const result: unknown = await page.evaluate(args.expression);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // ── get_html ──────────────────────────────────────────────────────────────
  server.registerTool(
    "get_html",
    {
      title: "Get HTML",
      description: "Get the HTML of the page or a specific element.",
      inputSchema: z.object({
        selector: z
          .string()
          .optional()
          .describe("CSS selector (omit for full page HTML)"),
        outerHtml: z
          .boolean()
          .default(false)
          .describe("Return outerHTML instead of innerHTML"),
      }),
    },
    async (args) => {
      const page = await manager.getPage();
      let html: string;
      if (args.selector) {
        const el = await page.$(args.selector);
        if (!el) {
          return {
            content: [
              {
                type: "text",
                text: `Element not found: ${args.selector}`,
              },
            ],
            isError: true,
          };
        }
        html = args.outerHtml
          ? await el.evaluate((n) => n.outerHTML)
          : await el.innerHTML();
      } else {
        html = await page.content();
      }
      return { content: [{ type: "text", text: html }] };
    },
  );

  // ── scroll ────────────────────────────────────────────────────────────────
  server.registerTool(
    "scroll",
    {
      title: "Scroll page",
      description: "Scroll the page by pixel amount or to a specific element.",
      inputSchema: z.object({
        x: z.number().default(0).describe("Horizontal scroll amount in pixels"),
        y: z.number().default(0).describe("Vertical scroll amount in pixels"),
        selector: z
          .string()
          .optional()
          .describe("Scroll to bring this element into view (overrides x/y)"),
      }),
    },
    async (args) => {
      const page = await manager.getPage();
      if (args.selector) {
        const el = await page.$(args.selector);
        if (el) await el.scrollIntoViewIfNeeded();
      } else {
        await page.evaluate(
          ({ x, y }: { x: number; y: number }) => window.scrollBy(x, y),
          { x: args.x, y: args.y },
        );
      }
      return { content: [{ type: "text", text: `✅ Scrolled` }] };
    },
  );

  // ── wait_for ──────────────────────────────────────────────────────────────
  server.registerTool(
    "wait_for",
    {
      title: "Wait for selector",
      description: "Wait until a CSS selector appears in the DOM.",
      inputSchema: z.object({
        selector: z.string().min(1).describe("CSS selector to wait for"),
        state: z
          .enum(["attached", "detached", "visible", "hidden"])
          .default("visible")
          .describe("Desired state of the element"),
        timeoutMs: z
          .number()
          .int()
          .min(100)
          .max(60_000)
          .default(10_000)
          .describe("Maximum wait time in milliseconds"),
      }),
    },
    async (args) => {
      const page = await manager.getPage();
      await page.waitForSelector(args.selector, {
        state: args.state,
        timeout: args.timeoutMs,
      });
      return {
        content: [
          {
            type: "text",
            text: `✅ Element "${args.selector}" is now ${args.state}`,
          },
        ],
      };
    },
  );

  // ── close_browser ─────────────────────────────────────────────────────────
  server.registerTool(
    "close_browser",
    {
      title: "Close browser",
      description: "Close the browser and free all resources. It will re-open automatically on the next tool call.",
      inputSchema: z.object({}),
    },
    async () => {
      await manager.close();
      return { content: [{ type: "text", text: "✅ Browser closed." }] };
    },
  );

  return server;
}
