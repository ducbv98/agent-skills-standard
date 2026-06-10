import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import type { ProcessResult } from "@viet-dubber/shared";

export interface SegmentAudio {
  index: number;
  start: number;
  end: number;
  audioPath: string;
  durationMs: number;
  text: string;
}

export interface ProcessorOptions {
  /** Đường dẫn ffmpeg binary. Mặc định: "ffmpeg" (trong PATH) */
  ffmpegPath?: string;
  /** Thư mục tạm để lưu intermediate files */
  workDir: string;
  /** Mute audio gốc hoàn toàn (mặc định true). Nếu false giữ lại với volume thấp. */
  muteOriginal?: boolean;
  /** Volume của track gốc nếu không mute (0.0 - 1.0). Mặc định 0.1 */
  originalVolume?: number;
}

/** Chạy ffmpeg và đợi kết thúc */
async function runFfmpeg(args: string[], bin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}\n${stderr.slice(-2000)}`));
    });
    proc.on("error", (err) =>
      reject(new Error(`Failed to start ffmpeg: ${err.message}`)),
    );
  });
}

/** Lấy duration video bằng ffprobe (giây) */
async function probeDurationSec(
  videoPath: string,
  ffprobeBin = "ffprobe",
): Promise<number> {
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
        videoPath,
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
        reject(new Error(`ffprobe non-numeric: ${stdout}`));
        return;
      }
      resolve(seconds);
    });
    proc.on("error", (err) =>
      reject(new Error(`Failed to start ffprobe: ${err.message}`)),
    );
  });
}

/**
 * Build một audio track dài bằng video, với các segment được đặt đúng timestamp.
 * Dùng adelay filter để chèn từng segment vào đúng vị trí, rồi amix tất cả.
 */
async function buildTimedAudioTrack(
  segments: SegmentAudio[],
  videoDurationSec: number,
  outputPath: string,
  ffmpegBin: string,
): Promise<void> {
  if (segments.length === 0) {
    throw new Error("Không có segment nào để dựng audio track");
  }

  // Mỗi segment đi qua adelay (đặt vị trí start), apad (đảm bảo đủ dài video)
  // Sau đó amix tất cả lại
  const inputs: string[] = [];
  const filterParts: string[] = [];
  const mixLabels: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    inputs.push("-i", seg.audioPath);

    const delayMs = Math.max(0, Math.round(seg.start * 1000));
    // adelay cần truyền cho mỗi channel: dùng "all" để áp dụng cho tất cả channels
    // apad pad_dur để đảm bảo đủ dài video — tránh amix kết thúc sớm
    filterParts.push(
      `[${i}:a]adelay=${delayMs}|${delayMs},apad=whole_dur=${videoDurationSec}[a${i}]`,
    );
    mixLabels.push(`[a${i}]`);
  }

  const mix = `${mixLabels.join("")}amix=inputs=${segments.length}:duration=longest:normalize=0[aout]`;
  const filter = [...filterParts, mix].join(";");

  await runFfmpeg(
    [
      "-y",
      ...inputs,
      "-filter_complex",
      filter,
      "-map",
      "[aout]",
      "-t",
      videoDurationSec.toFixed(3),
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      outputPath,
    ],
    ffmpegBin,
  );
}

/**
 * Ghép video gốc với audio TTS đã được đồng bộ timing.
 * - Tạo audio track từ các segment (đặt theo timestamp)
 * - Merge với video gốc, mute audio cũ (hoặc giảm volume)
 */
export async function buildDubbedVideo(
  videoPath: string,
  segments: SegmentAudio[],
  outputPath: string,
  options: ProcessorOptions,
): Promise<ProcessResult> {
  const ffmpegBin = options.ffmpegPath ?? "ffmpeg";
  const ffprobeBin = ffmpegBin === "ffmpeg" ? "ffprobe" : ffmpegBin.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
  const muteOriginal = options.muteOriginal ?? true;
  const originalVolume = options.originalVolume ?? 0.1;

  fs.mkdirSync(options.workDir, { recursive: true });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const videoDurationSec = await probeDurationSec(videoPath, ffprobeBin);

  // Step 1: build timed audio track
  const ttsTrackPath = path.join(
    options.workDir,
    `tts_track_${Date.now()}.mp3`,
  );
  await buildTimedAudioTrack(segments, videoDurationSec, ttsTrackPath, ffmpegBin);

  // Step 2: merge video + tts audio (+ optional original audio at low volume)
  if (muteOriginal) {
    // Đơn giản: copy video, dùng tts làm audio chính
    await runFfmpeg(
      [
        "-y",
        "-i",
        videoPath,
        "-i",
        ttsTrackPath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        outputPath,
      ],
      ffmpegBin,
    );
  } else {
    // Mix: original audio nhỏ + TTS lớn
    const filter = `[0:a]volume=${originalVolume.toFixed(2)}[orig];[orig][1:a]amix=inputs=2:duration=longest:normalize=0[aout]`;
    await runFfmpeg(
      [
        "-y",
        "-i",
        videoPath,
        "-i",
        ttsTrackPath,
        "-filter_complex",
        filter,
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        outputPath,
      ],
      ffmpegBin,
    );
  }

  const finalDuration = await probeDurationSec(outputPath, ffprobeBin);
  const title = path.basename(outputPath, path.extname(outputPath));

  return {
    outputPath,
    title,
    durationSeconds: finalDuration,
  };
}

/**
 * Extract audio từ video (cho transcriber).
 * Whisper API giới hạn 25MB — convert sang mono 16kHz mp3 để giảm size mà vẫn đủ chất lượng.
 */
export async function extractAudio(
  videoPath: string,
  options: { ffmpegPath?: string; outputDir?: string } = {},
): Promise<string> {
  const ffmpegBin = options.ffmpegPath ?? "ffmpeg";
  const outDir = options.outputDir ?? os.tmpdir();
  fs.mkdirSync(outDir, { recursive: true });

  const base = path.basename(videoPath, path.extname(videoPath));
  const audioPath = path.join(outDir, `${base}.audio.mp3`);

  await runFfmpeg(
    [
      "-y",
      "-i",
      videoPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      "-c:a",
      "libmp3lame",
      audioPath,
    ],
    ffmpegBin,
  );

  return audioPath;
}
