import {
  chromium,
  firefox,
  webkit,
  Browser,
  BrowserContext,
  Page,
} from "playwright";

export type BrowserType = "chromium" | "firefox" | "webkit";

export interface BrowserOptions {
  headless?: boolean;
  browserType?: BrowserType;
  viewport?: { width: number; height: number };
  userAgent?: string;
  /** Timeout in ms for navigation and actions */
  timeout?: number;
}

const DEFAULT_OPTIONS: Required<BrowserOptions> = {
  headless: true,
  browserType: "chromium",
  viewport: { width: 1280, height: 720 },
  userAgent:
    "Mozilla/5.0 (compatible; MCP-Playwright/1.0; +https://github.com/HoangNguyen0403/agent-skills-standard)",
  timeout: 30_000,
};

/**
 * Manages a single persistent browser instance shared across tool calls
 * in the same MCP session. Automatically re-creates on crash.
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly opts: Required<BrowserOptions>;

  constructor(opts: BrowserOptions = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
  }

  async getPage(): Promise<Page> {
    if (!this.browser || !this.browser.isConnected()) {
      await this.launch();
    }
    if (!this.page || this.page.isClosed()) {
      await this.newPage();
    }
    return this.page!;
  }

  async newPage(): Promise<Page> {
    const ctx = await this.getContext();
    this.page = await ctx.newPage();
    this.page.setDefaultTimeout(this.opts.timeout);
    this.page.setDefaultNavigationTimeout(this.opts.timeout);
    return this.page;
  }

  async getContext(): Promise<BrowserContext> {
    if (!this.browser || !this.browser.isConnected()) {
      await this.launch();
    }
    if (!this.context) {
      this.context = await this.browser!.newContext({
        viewport: this.opts.viewport,
        userAgent: this.opts.userAgent,
      });
    }
    return this.context;
  }

  async close(): Promise<void> {
    await this.page?.close().catch(() => null);
    await this.context?.close().catch(() => null);
    await this.browser?.close().catch(() => null);
    this.page = null;
    this.context = null;
    this.browser = null;
  }

  private async launch(): Promise<void> {
    const launcher =
      this.opts.browserType === "firefox"
        ? firefox
        : this.opts.browserType === "webkit"
          ? webkit
          : chromium;

    this.browser = await launcher.launch({ headless: this.opts.headless });
    this.context = null;
    this.page = null;
  }
}
