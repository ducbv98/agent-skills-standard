import path from "path";
import fs from "fs";
import { downloadVideo } from "@viet-dubber/downloader";
import { transcribeAudio } from "@viet-dubber/transcriber";
import { translateTranscript } from "@viet-dubber/translator";
import { synthesizeSegmentsDetailed } from "@viet-dubber/tts";
import { buildDubbedVideo, extractAudio } from "@viet-dubber/processor";
import type { ProcessResult, ProgressEvent } from "@viet-dubber/shared";
import type { ResolvedConfig } from "./config.js";
import { log } from "./logger.js";

export type ProgressCallback = (event: ProgressEvent) => void;

/** Sanitize filename for output */
function safeName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

export async function runPipeline(
  config: ResolvedConfig,
  onProgress: ProgressCallback = log,
): Promise<ProcessResult> {
  const runId = Date.now().toString(36);
  const runWorkDir = path.join(config.workDir, `run_${runId}`);
  fs.mkdirSync(runWorkDir, { recursive: true });

  // === 1. Download ===
  onProgress({
    step: "download",
    status: "start",
    message: `Downloading ${config.url} → ${config.inputDir}`,
  });
  const download = await downloadVideo(config.url, {
    ytdlpPath: config.ytdlpPath,
    outputDir: config.inputDir,
    cookiesFromBrowser: config.cookiesFromBrowser,
    cookiesFile: config.cookiesFile,
  });
  onProgress({
    step: "download",
    status: "done",
    message: `${download.title} (${download.duration}s) [${download.platform}]`,
  });

  // === 2. Extract audio ===
  onProgress({
    step: "extract-audio",
    status: "start",
    message: "Extracting mono 16kHz audio",
  });
  const audioPath = await extractAudio(download.videoPath, {
    ffmpegPath: config.ffmpegPath,
    outputDir: path.join(runWorkDir, "audio"),
  });
  const audioMb = (fs.statSync(audioPath).size / 1024 / 1024).toFixed(2);
  onProgress({
    step: "extract-audio",
    status: "done",
    message: `${audioMb}MB`,
  });

  // === 3. Transcribe ===
  onProgress({
    step: "transcribe",
    status: "start",
    message: `Calling Whisper (${config.whisperModel})`,
  });
  const transcript = await transcribeAudio(audioPath, {
    apiKey: config.openaiApiKey,
    baseUrl: config.openaiBaseUrl || undefined,
    model: config.whisperModel,
    language: "zh",
  });
  onProgress({
    step: "transcribe",
    status: "done",
    message: `${transcript.segments.length} segments, lang=${transcript.language}`,
  });

  fs.writeFileSync(
    path.join(runWorkDir, "transcript.json"),
    JSON.stringify(transcript, null, 2),
    "utf8",
  );

  // === 4. Translate ===
  onProgress({
    step: "translate",
    status: "start",
    message: `Translating with ${config.gptModel}`,
  });
  const translation = await translateTranscript(transcript, {
    apiKey: config.openaiApiKey,
    baseUrl: config.openaiBaseUrl || undefined,
    model: config.gptModel,
  });
  onProgress({
    step: "translate",
    status: "done",
    message: `${translation.segments.length} segments dịch sang VI`,
  });

  fs.writeFileSync(
    path.join(runWorkDir, "translation.json"),
    JSON.stringify(translation, null, 2),
    "utf8",
  );

  // === 5. TTS ===
  onProgress({
    step: "tts",
    status: "start",
    message: `Synthesizing voice=${config.voice} rate=${config.ttsRate}`,
  });
  const ttsResult = await synthesizeSegmentsDetailed(translation, {
    edgeTtsPath: config.edgeTtsPath,
    voice: config.voice,
    rate: config.ttsRate,
    volume: config.ttsVolume,
    outputDir: path.join(runWorkDir, "tts"),
  });
  const segmentAudios = ttsResult.segments;
  const ttsDetail =
    ttsResult.skipped + ttsResult.failed > 0
      ? `${segmentAudios.length}/${translation.segments.length} segments (skip ${ttsResult.skipped}, fail ${ttsResult.failed})`
      : `${segmentAudios.length} segment audio files`;
  onProgress({
    step: "tts",
    status: "done",
    message: ttsDetail,
  });

  if (segmentAudios.length === 0) {
    throw new Error("TTS không tạo ra segment nào — translation có thể rỗng hoặc toàn bộ chưa dịch");
  }

  // === 6. Merge ===
  const outputName = safeName(download.title) || `dubbed_${runId}`;
  const outputPath = path.join(config.outputDir, `${outputName}_vi.mp4`);

  onProgress({
    step: "merge",
    status: "start",
    message: `Building dubbed video → ${outputPath}`,
  });
  const result = await buildDubbedVideo(
    download.videoPath,
    segmentAudios,
    outputPath,
    {
      ffmpegPath: config.ffmpegPath,
      workDir: runWorkDir,
      muteOriginal: true,
      removeSubs: config.removeSubs,
      subsHeightRatio: config.subsHeightRatio,
    },
  );
  onProgress({
    step: "merge",
    status: "done",
    message: `${result.outputPath} (${result.durationSeconds.toFixed(1)}s)`,
  });

  if (!config.keepTmp) {
    try {
      fs.rmSync(runWorkDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  onProgress({
    step: "done",
    status: "done",
    message: result.outputPath,
  });
  return result;
}
