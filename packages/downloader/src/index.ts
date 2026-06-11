import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import type { DownloadResult } from "@viet-dubber/shared";

export interface DownloaderOptions {
  /** Đường dẫn đến yt-dlp binary. Mặc định: "yt-dlp" (trong PATH) */
  ytdlpPath?: string;
  /** Thư mục lưu file download */
  outputDir: string;
  /** Cookie file để bypass login (Bilibili/Douyin yêu cầu) */
  cookiesFile?: string;
  /** Giả lập browser để lấy cookies tự động */
  cookiesFromBrowser?: "chrome" | "firefox" | "edge";
  /** Giới hạn chất lượng video, mặc định best mp4 */
  format?: string;
}

/** Validate URL — chỉ cho phép http/https, block path traversal */
function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("URL không hợp lệ");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Chỉ chấp nhận URL http/https");
  }
}

/** Sanitize path component — strip traversal sequences */
function safePath(base: string, filename: string): string {
  const safe = path.basename(filename.replace(/\.\./g, "_"));
  const resolved = path.resolve(base, safe);
  if (!resolved.startsWith(path.resolve(base))) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

/** Detect platform từ URL */
function detectPlatform(url: string): DownloadResult["platform"] {
  if (url.includes("bilibili.com") || url.includes("b23.tv")) return "bilibili";
  if (url.includes("douyin.com") || url.includes("iesdouyin.com")) return "douyin";
  if (url.includes("weibo.com") || url.includes("weibo.cn")) return "weibo";
  return "unknown";
}

/** Chạy yt-dlp và capture output */
async function runYtDlp(
  args: string[],
  ytdlpBin: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlpBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`yt-dlp exited ${code}\n${stderr}`));
    });
    proc.on("error", (err) => reject(new Error(`Failed to start yt-dlp: ${err.message}`)));
  });
}

/** Lấy metadata (title, duration) trước khi download */
async function fetchMetadata(
  url: string,
  ytdlpBin: string,
  extraArgs: string[],
): Promise<{ title: string; duration: number }> {
  const { stdout } = await runYtDlp(
    ["--dump-json", "--no-playlist", ...extraArgs, url],
    ytdlpBin,
  );
  // yt-dlp có thể in nhiều dòng nếu playlist — lấy dòng đầu tiên
  const firstLine = stdout.split("\n").find((l) => l.trim().startsWith("{"));
  if (!firstLine) throw new Error("yt-dlp returned no JSON metadata");

  const meta = JSON.parse(firstLine) as { title?: string; duration?: number };
  return {
    title: meta.title ?? "untitled",
    duration: meta.duration ?? 0,
  };
}

/**
 * Download video từ Bilibili / Douyin / Weibo.
 * Trả về đường dẫn file video đã download.
 */
export async function downloadVideo(
  url: string,
  options: DownloaderOptions,
): Promise<DownloadResult> {
  const ytdlpBin = options.ytdlpPath ?? "yt-dlp";
  const platform = detectPlatform(url);

  validateUrl(url);
  fs.mkdirSync(options.outputDir, { recursive: true });
  const resolvedOutputDir = path.resolve(options.outputDir);

  // Base args
  const baseArgs: string[] = ["--no-playlist"];

  // Cookie handling — cần thiết cho Bilibili/Douyin login content
  if (options.cookiesFile) {
    baseArgs.push("--cookies", options.cookiesFile);
  } else if (options.cookiesFromBrowser) {
    baseArgs.push("--cookies-from-browser", options.cookiesFromBrowser);
  }

  // Platform-specific args
  if (platform === "bilibili") {
    // Ưu tiên format có audio, tránh DASH tách audio riêng
    baseArgs.push("--format", options.format ?? "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best");
    baseArgs.push("--merge-output-format", "mp4");
  } else if (platform === "douyin") {
    // Douyin watermark — dùng --add-headers để bypass
    baseArgs.push("--add-headers", "Referer:https://www.douyin.com");
    baseArgs.push("--format", options.format ?? "bestvideo+bestaudio/best");
    baseArgs.push("--merge-output-format", "mp4");
  } else {
    baseArgs.push("--format", options.format ?? "bestvideo+bestaudio/best");
    baseArgs.push("--merge-output-format", "mp4");
  }

  // Lấy metadata trước
  const { title, duration } = await fetchMetadata(url, ytdlpBin, baseArgs);

  // Sanitize title cho filename
  const safeTitle = title
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);

  const outputTemplate = path.join(resolvedOutputDir, `${safeTitle}.%(ext)s`);

  await runYtDlp(
    [...baseArgs, "--output", outputTemplate, url],
    ytdlpBin,
  );

  const files = fs.readdirSync(resolvedOutputDir).filter((f) =>
    f.startsWith(safeTitle) && (f.endsWith(".mp4") || f.endsWith(".mkv") || f.endsWith(".webm")),
  );

  if (files.length === 0) {
    throw new Error(`yt-dlp finished but no video file found in ${resolvedOutputDir}`);
  }

  const videoFile = files
    .map((f) => ({ f, mtime: fs.statSync(safePath(resolvedOutputDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]!.f;

  return {
    videoPath: safePath(resolvedOutputDir, videoFile),
    title,
    duration,
    platform,
    originalUrl: url,
  };
}
