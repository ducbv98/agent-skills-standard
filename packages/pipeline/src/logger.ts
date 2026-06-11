import type { PipelineStep, ProgressEvent } from "@viet-dubber/shared";

const stepLabels: Record<PipelineStep, string> = {
  download: "1/6 Download",
  "extract-audio": "2/6 Extract audio",
  transcribe: "3/6 Transcribe (Whisper)",
  translate: "4/6 Translate (GPT)",
  tts: "5/6 TTS (edge-tts)",
  merge: "6/6 Merge video",
  done: "Done",
};

export function log(event: ProgressEvent): void {
  const label = stepLabels[event.step];
  const pct = event.percent !== undefined ? ` (${event.percent}%)` : "";
  const marker = event.status === "done" ? "OK — " : "";
  const safeMsg = event.message.replace(/[\r\n]/g, " ");
  process.stdout.write(`[${label}]${pct} ${marker}${safeMsg}\n`);
}

export function logError(message: string, err: unknown): void {
  const detail = (err instanceof Error ? err.message : String(err)).replace(/[\r\n]/g, " ");
  process.stderr.write(`\n[ERROR] ${message}: ${detail}\n`);
}
