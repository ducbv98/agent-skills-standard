import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import type { TranslateResult, TtsResult } from "@viet-dubber/shared";

export interface TtsOptions {
  /** Đường dẫn đến edge-tts binary. Mặc định: "edge-tts" (trong PATH) */
  edgeTtsPath?: string;
  /** Voice — mặc định vi-VN-HoaiMyNeural */
  voice?: string;
  /** Tốc độ đọc, ví dụ "+0%", "-10%", "+15%" */
  rate?: string;
  /** Âm lượng, ví dụ "+0%", "-20%" */
  volume?: string;
  /** Thư mục lưu file audio output */
  outputDir: string;
}

/** Chạy edge-tts CLI và đợi kết thúc */
async function runEdgeTts(args: string[], bin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`edge-tts exited ${code}\n${stderr}`));
    });
    proc.on("error", (err) =>
      reject(new Error(`Failed to start edge-tts: ${err.message}`)),
    );
  });
}

/** Đọc duration của file audio bằng ffprobe */
async function probeDurationMs(audioPath: string, ffprobeBin = "ffprobe"): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      ffprobeBin,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        audioPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited ${code}\n${stderr}`));
        return;
      }
      const seconds = Number.parseFloat(stdout.trim());
      if (Number.isNaN(seconds)) {
        reject(new Error(`ffprobe returned non-numeric duration: ${stdout}`));
        return;
      }
      resolve(Math.round(seconds * 1000));
    });
    proc.on("error", (err) =>
      reject(new Error(`Failed to start ffprobe: ${err.message}`)),
    );
  });
}

/** TTS một đoạn text thành file mp3 — retry khi MS server trả NoAudioReceived */
export async function synthesizeOne(
  text: string,
  outputPath: string,
  options: TtsOptions,
): Promise<void> {
  const bin = options.edgeTtsPath ?? "edge-tts";
  const voice = options.voice ?? "vi-VN-HoaiMyNeural";

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const args = ["--voice", voice, "--text", text, "--write-media", outputPath];
  if (options.rate) args.push("--rate", options.rate);
  if (options.volume) args.push("--volume", options.volume);

  const MAX_RETRIES = 3;
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await runEdgeTts(args, bin);
      // Verify file exists và không rỗng
      const size = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
      if (size > 0) return;
      lastErr = new Error(`edge-tts ghi file rỗng (size=${size})`);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < MAX_RETRIES) {
      // backoff: 500ms, 1500ms
      await new Promise((r) => setTimeout(r, 500 * attempt * attempt));
    }
  }
  throw new Error(
    `edge-tts thất bại sau ${MAX_RETRIES} lần thử cho text="${text.slice(0, 40)}...": ${lastErr?.message ?? "unknown"}`,
  );
}

export interface SegmentAudio {
  index: number;
  start: number;
  end: number;
  audioPath: string;
  durationMs: number;
  /** Text gốc tiếng Việt — giữ lại cho debug */
  text: string;
}

/**
 * TTS từng segment riêng để giữ đúng timing với video gốc.
 * Trả về danh sách file audio cho từng segment — sẽ được processor ghép lại theo timestamp.
 */
/** Heuristic: text trông như tiếng Trung chưa dịch (chứa CJK chars) */
function looksUntranslated(text: string): boolean {
  // CJK Unified Ideographs U+4E00–U+9FFF — ký tự Hán cơ bản
  return /[一-鿿]/.test(text);
}

export interface SegmentsSummary {
  segments: SegmentAudio[];
  skipped: number;
  failed: number;
}

/**
 * TTS từng segment. Robust: skip segment chưa dịch (CJK) hoặc edge-tts fail,
 * không throw cho cả pipeline khi 1 segment hỏng.
 */
export async function synthesizeSegments(
  translation: TranslateResult,
  options: TtsOptions,
): Promise<SegmentAudio[]> {
  const result = await synthesizeSegmentsDetailed(translation, options);
  return result.segments;
}

export async function synthesizeSegmentsDetailed(
  translation: TranslateResult,
  options: TtsOptions,
): Promise<SegmentsSummary> {
  fs.mkdirSync(options.outputDir, { recursive: true });

  const segments: SegmentAudio[] = [];
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < translation.segments.length; i++) {
    const seg = translation.segments[i]!;
    const text = seg.translated.trim();

    if (!text) {
      skipped++;
      continue;
    }

    if (looksUntranslated(text)) {
      process.stderr.write(
        `[TTS] Skip segment ${i} — text có CJK chars (chưa dịch): "${text.slice(0, 40)}"\n`,
      );
      skipped++;
      continue;
    }

    const audioPath = path.join(
      options.outputDir,
      `seg_${String(i).padStart(5, "0")}.mp3`,
    );

    try {
      await synthesizeOne(text, audioPath, options);
      const durationMs = await probeDurationMs(audioPath);
      segments.push({
        index: i,
        start: seg.start,
        end: seg.end,
        audioPath,
        durationMs,
        text,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[TTS] Skip segment ${i} — ${detail.slice(0, 200)}\n`,
      );
      failed++;
    }
  }

  return { segments, skipped, failed };
}

/**
 * TTS toàn bộ transcript thành một file duy nhất (không giữ timing).
 * Dùng khi không cần đồng bộ chính xác với video gốc.
 */
export async function synthesizeFullText(
  translation: TranslateResult,
  outputPath: string,
  options: TtsOptions,
): Promise<TtsResult> {
  await synthesizeOne(translation.fullText, outputPath, options);
  const durationMs = await probeDurationMs(outputPath);
  return { audioPath: outputPath, durationMs };
}
