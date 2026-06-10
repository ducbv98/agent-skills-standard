import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import type { PipelineConfig } from "@viet-dubber/shared";

// .env ở repo root — không phụ thuộc CWD (pnpm filter set CWD vào package dir)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(__dirname, "../../../.env");
if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
} else {
  dotenv.config();
}

export interface CliArgs {
  url?: string;
  voice?: string;
  input?: string;
  output?: string;
  workDir?: string;
  rate?: string;
  volume?: string;
  keepTmp?: boolean;
  cookiesFromBrowser?: "chrome" | "firefox" | "edge";
  cookiesFile?: string;
  help?: boolean;
}

/** Parse argv kiểu --key value / --key=value / --flag */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;

    const eqIdx = a.indexOf("=");
    let key: string;
    let value: string | undefined;
    if (eqIdx > -1) {
      key = a.slice(2, eqIdx);
      value = a.slice(eqIdx + 1);
    } else {
      key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        i++;
      }
    }

    switch (key) {
      case "url":
        args.url = value;
        break;
      case "voice":
        args.voice = value;
        break;
      case "input":
      case "input-dir":
      case "in":
        args.input = value;
        break;
      case "output":
      case "output-dir":
      case "out":
        args.output = value;
        break;
      case "work-dir":
      case "workdir":
        args.workDir = value;
        break;
      case "rate":
        args.rate = value;
        break;
      case "volume":
        args.volume = value;
        break;
      case "keep-tmp":
        args.keepTmp = true;
        break;
      case "cookies-from-browser":
        if (value === "chrome" || value === "firefox" || value === "edge") {
          args.cookiesFromBrowser = value;
        }
        break;
      case "cookies":
        args.cookiesFile = value;
        break;
      case "help":
      case "h":
        args.help = true;
        break;
    }
  }
  return args;
}

export function printHelp(): void {
  process.stdout.write(`viet-dubber — dub Chinese video sang tiếng Việt bằng AI

Usage:
  pnpm dub -- --url <bilibili/douyin/weibo URL> [options]

Options:
  --url <url>                 URL video (required)
  --voice <voice>             edge-tts voice (default: vi-VN-HoaiMyNeural)
  --rate <rate>               Tốc độ đọc, ví dụ +0%, -10%, +15% (default: +0%)
  --volume <vol>              Âm lượng, ví dụ +0%, -20% (default: +0%)
  --input <dir>               Thư mục lưu video download (default: D:\\Video\\Input)
  --output <dir>              Thư mục output dub (default: D:\\Video\\Output)
  --work-dir <dir>            Thư mục tạm intermediate (default: ./tmp)
  --cookies-from-browser <b>  chrome|firefox|edge — auto load cookies
  --cookies <file>            File cookies.txt thủ công
  --keep-tmp                  Giữ thư mục tạm sau khi xong
  --help, -h                  In help này

Environment:
  OPENAI_API_KEY  required
  OPENAI_BASE_URL optional
  TTS_VOICE, TTS_RATE, WHISPER_MODEL, GPT_MODEL — xem README
`);
}

export interface ResolvedConfig extends PipelineConfig {
  cookiesFromBrowser?: "chrome" | "firefox" | "edge";
  cookiesFile?: string;
}

export function buildConfig(args: CliArgs): ResolvedConfig {
  const url = args.url ?? process.env.URL;
  if (!url) {
    throw new Error("Missing --url (hoặc env URL)");
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error("Missing OPENAI_API_KEY trong env (.env)");
  }

  const inputDir = path.resolve(
    args.input ?? process.env.INPUT_DIR ?? "D:\\Video\\Input",
  );
  const outputDir = path.resolve(
    args.output ?? process.env.OUTPUT_DIR ?? "D:\\Video\\Output",
  );
  const workDir = path.resolve(
    args.workDir ?? process.env.WORK_DIR ?? "./tmp",
  );

  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });

  const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
  const ytdlpPath = process.env.YTDLP_PATH || "yt-dlp";
  const edgeTtsPath = process.env.EDGE_TTS_PATH || "edge-tts";

  // Augment PATH với directories của explicit binary paths
  // Cần thiết để ffprobe (cùng dir ffmpeg) findable bởi spawned processes
  const sep = process.platform === "win32" ? ";" : ":";
  const augmentDirs = [ffmpegPath, ytdlpPath, edgeTtsPath]
    .filter((p) => p.includes(path.sep) || p.includes("/"))
    .map((p) => path.dirname(p));
  if (augmentDirs.length > 0) {
    const existing = process.env.PATH ?? "";
    process.env.PATH = [...new Set(augmentDirs), existing].join(sep);
  }

  return {
    url,
    voice: args.voice ?? process.env.TTS_VOICE ?? "vi-VN-HoaiMyNeural",
    ttsRate: args.rate ?? process.env.TTS_RATE ?? "+0%",
    ttsVolume: args.volume ?? process.env.TTS_VOLUME ?? "+0%",
    inputDir,
    outputDir,
    workDir,
    whisperModel: process.env.WHISPER_MODEL ?? "whisper-1",
    gptModel: process.env.GPT_MODEL ?? "gpt-4o",
    openaiApiKey,
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "",
    ffmpegPath,
    ytdlpPath,
    edgeTtsPath,
    keepTmp: args.keepTmp ?? false,
    cookiesFromBrowser: args.cookiesFromBrowser,
    cookiesFile: args.cookiesFile,
  };
}
