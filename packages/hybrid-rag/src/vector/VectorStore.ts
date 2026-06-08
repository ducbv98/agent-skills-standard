import { QdrantClient } from "@qdrant/js-client-rest";
import type { QdrantConfig, Chunk } from "../types.js";

/**
 * Qdrant-backed vector store.
 *
 * Each point in the collection:
 *   id      = chunk.id (UUID)
 *   vector  = embedding float array
 *   payload = { documentId, content, startOffset, endOffset, metadata }
 */
export class VectorStore {
  private readonly client: QdrantClient;
  private readonly collection: string;

  constructor(config: QdrantConfig) {
    this.client = new QdrantClient({
      url: config.url,
      apiKey: config.apiKey,
    });
    this.collection = config.collection;
  }

  /** Create collection if it doesn't exist. */
  async initialize(dimensions: number): Promise<void> {
    const existing = await this.client.getCollections();
    const found = existing.collections.some((c) => c.name === this.collection);

    if (!found) {
      await this.client.createCollection(this.collection, {
        vectors: {
          size: dimensions,
          distance: "Cosine",
        },
      });
    }
  }

  /** Upsert chunk + embedding into the collection. */
  async upsert(chunk: Chunk, embedding: number[]): Promise<void> {
    await this.client.upsert(this.collection, {
      wait: true,
      points: [
        {
          id: chunk.id,
          vector: embedding,
          payload: {
            documentId: chunk.documentId,
            content: chunk.content,
            startOffset: chunk.startOffset,
            endOffset: chunk.endOffset,
            metadata: chunk.metadata,
          },
        },
      ],
    });
  }

  /** Batch upsert. */
  async upsertBatch(
    chunks: Chunk[],
    embeddings: number[][],
  ): Promise<void> {
    if (chunks.length !== embeddings.length) {
      throw new Error("chunks and embeddings arrays must be the same length");
    }

    const points = chunks.map((chunk, i) => ({
      id: chunk.id,
      vector: embeddings[i] as number[],
      payload: {
        documentId: chunk.documentId,
        content: chunk.content,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        metadata: chunk.metadata,
      },
    }));

    await this.client.upsert(this.collection, { wait: true, points });
  }

  /**
   * Semantic search: find top-K chunks closest to the query embedding.
   */
  async search(
    queryEmbedding: number[],
    topK: number,
    minScore = 0.0,
    documentIds?: string[],
  ): Promise<Array<{ chunk: Chunk; score: number }>> {
    const filter =
      documentIds && documentIds.length > 0
        ? {
            must: [
              {
                key: "documentId",
                match: { any: documentIds },
              },
            ],
          }
        : undefined;

    const results = await this.client.search(this.collection, {
      vector: queryEmbedding,
      limit: topK,
      score_threshold: minScore,
      filter,
      with_payload: true,
    });

    return results
      .filter((r) => r.payload !== null && r.payload !== undefined)
      .map((r) => {
        const p = r.payload as {
          documentId: string;
          content: string;
          startOffset: number;
          endOffset: number;
          metadata: Record<string, unknown>;
        };
        return {
          chunk: {
            id: String(r.id),
            documentId: p.documentId,
            content: p.content,
            startOffset: p.startOffset,
            endOffset: p.endOffset,
            metadata: p.metadata ?? {},
          },
          score: r.score,
        };
      });
  }

  /** Delete all vectors for a document. */
  async deleteByDocument(documentId: string): Promise<void> {
    await this.client.delete(this.collection, {
      wait: true,
      filter: {
        must: [{ key: "documentId", match: { value: documentId } }],
      },
    });
  }
}
