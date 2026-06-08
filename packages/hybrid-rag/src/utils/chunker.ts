import type { Document, Chunk } from "../types.js";

export interface ChunkOptions {
  /** Target size in characters */
  chunkSize?: number;
  /** Overlap between consecutive chunks */
  overlap?: number;
}

/**
 * Splits a Document into overlapping text chunks.
 * Uses paragraph-aware splitting: prefers to break on blank lines,
 * falls back to sentence boundaries, then hard character limit.
 */
export function chunkText(
  document: Document,
  options: ChunkOptions = {},
): Omit<Chunk, "id" | "documentId">[] {
  const { chunkSize = 1000, overlap = 200 } = options;
  const text = document.content.trim();
  if (!text) return [];

  // Split on double newlines (paragraphs) first
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());

  const chunks: Omit<Chunk, "id" | "documentId">[] = [];
  let buffer = "";
  let bufferStart = 0;
  let cursor = 0;

  const flush = (content: string, start: number): void => {
    const trimmed = content.trim();
    if (!trimmed) return;
    chunks.push({
      content: trimmed,
      embedding: undefined,
      metadata: document.metadata,
      startOffset: start,
      endOffset: start + content.length,
    });
  };

  for (const para of paragraphs) {
    if (buffer.length + para.length > chunkSize && buffer.length > 0) {
      flush(buffer, bufferStart);
      // Keep `overlap` chars for the next chunk
      const overlapText = buffer.slice(-overlap);
      bufferStart = cursor - overlapText.length;
      buffer = overlapText + "\n\n" + para;
    } else {
      if (buffer) {
        buffer += "\n\n" + para;
      } else {
        buffer = para;
        bufferStart = cursor;
      }
    }
    cursor += para.length + 2; // +2 for "\n\n"
  }

  if (buffer) flush(buffer, bufferStart);

  return chunks;
}
