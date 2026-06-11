import fs from "fs";
import OpenAI from "openai";
import type { TranscribeResult, TranscriptSegment } from "@viet-dubber/shared";

export interface TranscriberOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Gợi ý ngôn ngữ — "zh" cho tiếng Trung */
  language?: string;
}

/**
 * Transcribe audio/video bằng OpenAI Whisper API.
 * Trả về các segment có timestamp (start/end/text).
 *
 * Whisper nhận file ≤ 25MB — nếu lớn hơn cần chunk trước.
 */
export async function transcribeAudio(
  audioPath: string,
  options: TranscriberOptions,
): Promise<TranscribeResult> {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseUrl,
    timeout: 120_000,
    maxRetries: 2,
  });

  const fileSizeMb = fs.statSync(audioPath).size / (1024 * 1024);
  if (fileSizeMb > 24) {
    throw new Error(
      `Audio file too large for Whisper API: ${fileSizeMb.toFixed(1)}MB (max 24MB). ` +
        "Hãy dùng FFmpeg để cắt audio trước, hoặc giảm bitrate.",
    );
  }

  const audioStream = fs.createReadStream(audioPath);

  const response = await client.audio.transcriptions.create({
    file: audioStream,
    model: (options.model ?? "whisper-1") as "whisper-1",
    language: options.language ?? "zh",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  // response.segments có thể undefined tùy SDK version
  const raw = response as unknown as {
    text: string;
    language: string;
    segments?: Array<{
      start: number;
      end: number;
      text: string;
    }>;
  };

  const segments: TranscriptSegment[] = (raw.segments ?? []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
  }));

  // Nếu Whisper không trả segments, tạo 1 segment toàn bộ
  if (segments.length === 0 && raw.text) {
    segments.push({ start: 0, end: 0, text: raw.text.trim() });
  }

  return {
    segments,
    fullText: segments.map((s) => s.text).join(" "),
    language: raw.language ?? "zh",
  };
}
