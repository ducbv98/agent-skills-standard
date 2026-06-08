import OpenAI from "openai";
import type { EmbeddingConfig } from "../types.js";

/**
 * Wraps OpenAI embeddings (or any compatible endpoint).
 * Supports batching to stay within rate limits.
 */
export class EmbeddingService {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly dimensions: number;

  constructor(config: EmbeddingConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.model = config.model;
    this.dimensions = config.dimensions;
  }

  /**
   * Embed a single text string.
   */
  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
      dimensions: this.dimensions,
    });

    const data = response.data[0];
    if (!data) throw new Error("Embedding API returned empty response");
    return data.embedding;
  }

  /**
   * Embed multiple texts in parallel batches of `batchSize`.
   */
  async embedBatch(texts: string[], batchSize = 32): Promise<number[][]> {
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response = await this.client.embeddings.create({
        model: this.model,
        input: batch,
        dimensions: this.dimensions,
      });

      // Sort by index to preserve order
      const sorted = [...response.data].sort((a, b) => a.index - b.index);
      results.push(...sorted.map((d) => d.embedding));
    }

    return results;
  }

  /** Cosine similarity between two embedding vectors. */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += (a[i] ?? 0) * (b[i] ?? 0);
      normA += (a[i] ?? 0) ** 2;
      normB += (b[i] ?? 0) ** 2;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
