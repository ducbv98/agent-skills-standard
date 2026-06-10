import OpenAI from "openai";
import type {
  TranscribeResult,
  TranslateResult,
  TranslatedSegment,
  TranscriptSegment,
} from "@viet-dubber/shared";

export interface TranslatorOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Batch size (mặc định 10 — nhỏ giúp Llama trả JSON đầy đủ hơn) */
  batchSize?: number;
}

const SYSTEM_PROMPT = `Bạn là chuyên gia dịch lời thuyết minh phim từ tiếng Trung sang tiếng Việt.

YÊU CẦU TUYỆT ĐỐI:
- Output PHẢI là JSON object đúng schema { "items": [...] } — KHÔNG được thiếu ID nào trong input.
- Mỗi item phải có "id" và "translated".
- "translated" PHẢI là tiếng Việt thuần — KHÔNG được chứa bất kỳ ký tự Hán/Trung nào (CJK).
- Nếu không hiểu nghĩa, hãy dịch theo phán đoán hợp lý — vẫn là tiếng Việt thuần.
- Tên riêng người/địa danh: phiên âm Hán Việt (vd: 顾三香 → "Cố Tam Hương", 李瑶 → "Lý Diêu").
- Dịch tự nhiên, ngắn gọn, nghe như thuyết minh phim Việt.
- KHÔNG thêm chú thích, ghi chú, giải thích nằm ngoài JSON.`;

interface SegmentInput {
  id: number;
  text: string;
}

interface SegmentOutput {
  id: number;
  translated: string;
}

/** Detect text còn chứa Hán tự */
function hasCJK(text: string): boolean {
  return /[一-鿿]/.test(text);
}

/** Tìm array of {id, translated} trong bất kỳ shape JSON nào */
function extractItems(parsed: unknown): SegmentOutput[] {
  if (Array.isArray(parsed)) return parsed as SegmentOutput[];
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    // Thử các key thường gặp
    for (const key of ["items", "translations", "results", "data", "segments"]) {
      const val = obj[key];
      if (Array.isArray(val)) return val as SegmentOutput[];
    }
    // Fallback: lấy array đầu tiên trong values
    for (const val of Object.values(obj)) {
      if (Array.isArray(val)) return val as SegmentOutput[];
    }
  }
  return [];
}

async function translateBatch(
  client: OpenAI,
  model: string,
  batch: Array<{ id: number; text: string }>,
): Promise<Map<number, string>> {
  const input: SegmentInput[] = batch.map((b) => ({ id: b.id, text: b.text }));

  const userMessage = `Dịch các đoạn sau sang tiếng Việt thuần (không chứa Hán tự):

${JSON.stringify(input)}

Trả về JSON object đúng format:
{"items":[{"id":<number>,"translated":"<tiếng Việt>"},...]}`;

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Map();
  }

  const outputs = extractItems(parsed);
  const result = new Map<number, string>();
  for (const o of outputs) {
    if (typeof o?.id === "number" && typeof o?.translated === "string") {
      const text = o.translated.trim();
      if (text && !hasCJK(text)) {
        result.set(o.id, text);
      }
    }
  }
  return result;
}

/** Dịch 1 segment đơn (fallback cho batch failed) */
async function translateSingle(
  client: OpenAI,
  model: string,
  text: string,
): Promise<string | undefined> {
  const userMessage = `Dịch câu sau sang tiếng Việt thuần (không chứa Hán tự):
"${text}"

Trả về JSON: {"translated":"<tiếng Việt>"}`;

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });
    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { translated?: unknown };
    if (typeof parsed.translated === "string") {
      const out = parsed.translated.trim();
      if (out && !hasCJK(out)) return out;
    }
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * Dịch toàn bộ transcript từ tiếng Trung sang tiếng Việt.
 * Robust: per-segment retry cho segment Llama bỏ sót hoặc trả về Hán tự.
 */
export async function translateTranscript(
  transcript: TranscribeResult,
  options: TranslatorOptions,
): Promise<TranslateResult> {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseUrl,
  });

  const model = options.model ?? "gpt-4o";
  const BATCH_SIZE = options.batchSize ?? 10;

  // Bước 1: dịch theo batch
  const translatedMap = new Map<number, string>();
  for (let i = 0; i < transcript.segments.length; i += BATCH_SIZE) {
    const batch = transcript.segments
      .slice(i, i + BATCH_SIZE)
      .map((seg: TranscriptSegment, j: number) => ({
        id: i + j,
        text: seg.text,
      }));
    try {
      const batchResults = await translateBatch(client, model, batch);
      for (const [id, val] of batchResults) translatedMap.set(id, val);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[Translator] Batch ${i}-${i + batch.length - 1} failed: ${detail.slice(0, 200)}\n`,
      );
    }
  }

  // Bước 2: retry per-segment cho segment chưa dịch hoặc còn CJK
  const missing: Array<{ id: number; text: string }> = [];
  for (let i = 0; i < transcript.segments.length; i++) {
    const got = translatedMap.get(i);
    if (!got || hasCJK(got)) {
      missing.push({ id: i, text: transcript.segments[i]!.text });
    }
  }

  if (missing.length > 0) {
    process.stderr.write(
      `[Translator] Retry per-segment cho ${missing.length}/${transcript.segments.length} segments\n`,
    );
    for (const m of missing) {
      const out = await translateSingle(client, model, m.text);
      if (out) translatedMap.set(m.id, out);
    }
  }

  // Bước 3: assemble final result
  const segments: TranslatedSegment[] = transcript.segments.map(
    (seg: TranscriptSegment, i: number) => ({
      start: seg.start,
      end: seg.end,
      original: seg.text,
      // Nếu vẫn không dịch được → giữ rỗng (TTS sẽ skip)
      translated: translatedMap.get(i) ?? "",
    }),
  );

  return {
    segments,
    fullText: segments.map((s) => s.translated).filter(Boolean).join(" "),
  };
}
