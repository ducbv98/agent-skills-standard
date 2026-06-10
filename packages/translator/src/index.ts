import OpenAI from "openai";
import type {
  TranscribeResult,
  TranslateResult,
  TranslatedSegment,
} from "@viet-dubber/shared";

export interface TranslatorOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

const SYSTEM_PROMPT = `Bạn là chuyên gia dịch thuật và viết lời thuyết minh phim/video.
Nhiệm vụ: Dịch các đoạn thoại/lời bình từ tiếng Trung sang tiếng Việt tự nhiên, phù hợp để đọc thành tiếng.

Yêu cầu:
- Dịch tự nhiên, nghe như lời thuyết minh phim Việt Nam
- Giữ nguyên cấu trúc JSON được cung cấp
- KHÔNG thêm chú thích, ghi chú hay giải thích
- Giữ độ dài câu tương đương để phù hợp với thời gian
- Tránh dịch sát từng chữ — ưu tiên ý nghĩa tự nhiên
- Các thuật ngữ kỹ thuật, tên riêng giữ nguyên hoặc phiên âm Việt
- Trả về JSON hợp lệ, không có text nào khác`;

interface SegmentInput {
  id: number;
  start: number;
  end: number;
  text: string;
}

interface SegmentOutput {
  id: number;
  translated: string;
}

/**
 * Dịch toàn bộ transcript từ tiếng Trung sang tiếng Việt.
 * Gửi theo batch để tối ưu chi phí API.
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

  // Batch segments theo nhóm 30 để tránh vượt token limit
  const BATCH_SIZE = 30;
  const translated: TranslatedSegment[] = [];

  for (let i = 0; i < transcript.segments.length; i += BATCH_SIZE) {
    const batch = transcript.segments.slice(i, i + BATCH_SIZE);

    const input: SegmentInput[] = batch.map((seg, j) => ({
      id: i + j,
      start: seg.start,
      end: seg.end,
      text: seg.text,
    }));

    const userMessage = `Dịch các đoạn sau sang tiếng Việt:\n${JSON.stringify(input, null, 2)}

Trả về JSON array với format:
[{"id": <số>, "translated": "<tiếng Việt>"}]`;

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "{}";

    let parsed: { translations?: SegmentOutput[] } | SegmentOutput[];
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      throw new Error(`GPT returned invalid JSON: ${raw.slice(0, 200)}`);
    }

    // Handle cả hai format: { translations: [...] } hoặc array trực tiếp
    const outputs: SegmentOutput[] = Array.isArray(parsed)
      ? parsed
      : ((parsed as { translations?: SegmentOutput[] }).translations ?? []);

    // Map về TranslatedSegment
    for (const seg of batch) {
      const idx = i + batch.indexOf(seg);
      const out = outputs.find((o) => o.id === idx);
      translated.push({
        start: seg.start,
        end: seg.end,
        original: seg.text,
        translated: out?.translated ?? seg.text, // fallback giữ nguyên nếu lỗi
      });
    }
  }

  return {
    segments: translated,
    fullText: translated.map((s) => s.translated).join(" "),
  };
}
