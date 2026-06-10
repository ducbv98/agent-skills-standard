/** Kết quả download từ yt-dlp */
export interface DownloadResult {
  videoPath: string;       // đường dẫn file video đã download
  title: string;           // tiêu đề gốc
  duration: number;        // giây
  platform: "bilibili" | "douyin" | "weibo" | "unknown";
  originalUrl: string;
}

/** Một đoạn transcript với timestamp */
export interface TranscriptSegment {
  start: number;           // giây
  end: number;             // giây
  text: string;            // tiếng Trung
}

/** Kết quả transcribe từ Whisper */
export interface TranscribeResult {
  segments: TranscriptSegment[];
  fullText: string;        // toàn bộ text gộp lại
  language: string;        // detected language
}

/** Một đoạn đã dịch */
export interface TranslatedSegment {
  start: number;
  end: number;
  original: string;        // tiếng Trung
  translated: string;      // tiếng Việt
}

/** Kết quả dịch */
export interface TranslateResult {
  segments: TranslatedSegment[];
  fullText: string;        // toàn bộ tiếng Việt
}

/** Kết quả TTS */
export interface TtsResult {
  audioPath: string;       // file audio .mp3/.wav
  durationMs: number;
}

/** Kết quả xử lý video cuối cùng */
export interface ProcessResult {
  outputPath: string;      // video đã ghép âm tiếng Việt
  title: string;
  durationSeconds: number;
}

/** Config chạy pipeline */
export interface PipelineConfig {
  url: string;
  voice: string;
  ttsRate: string;
  ttsVolume: string;
  inputDir: string;
  outputDir: string;
  workDir: string;
  whisperModel: string;
  gptModel: string;
  openaiApiKey: string;
  openaiBaseUrl: string;
  ffmpegPath: string;
  ytdlpPath: string;
  edgeTtsPath: string;
  keepTmp: boolean;
  /** Blur dải đáy video để che phụ đề hardcoded (mặc định false) */
  removeSubs: boolean;
  /** Tỷ lệ chiều cao dải subs (0-1, mặc định 0.18) */
  subsHeightRatio: number;
}

/** Progress event để log */
export type PipelineStep =
  | "download"
  | "extract-audio"
  | "transcribe"
  | "translate"
  | "tts"
  | "merge"
  | "done";

export interface ProgressEvent {
  step: PipelineStep;
  message: string;
  percent?: number;
  /** start = bắt đầu step, done = step xong, error = lỗi (chỉ ở step "done" tổng) */
  status?: "start" | "done" | "error";
}
