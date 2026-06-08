import { randomUUID } from "crypto";
import type {
  Document,
  Chunk,
  RetrievalQuery,
  RetrievalResponse,
  RetrievalResult,
  HybridRagConfig,
} from "./types.js";
import { EmbeddingService } from "./embedding/EmbeddingService.js";
import { GraphStore } from "./graph/GraphStore.js";
import { EntityExtractor } from "./graph/EntityExtractor.js";
import { VectorStore } from "./vector/VectorStore.js";
import { CagCache } from "./cag/CagCache.js";
import { chunkText } from "./utils/chunker.js";

/**
 * HybridRagEngine — the main orchestrator.
 *
 * Retrieval strategy selection:
 *
 *   query.mode === "cag"    → use CAG cache only (no graph/vector)
 *   query.mode === "graph"  → use graph traversal only
 *   query.mode === "vector" → use vector similarity only
 *   query.mode === "hybrid" (default) →
 *     1. Check CAG: if context fits in token threshold, serve from cache
 *     2. Else: run graph + vector retrieval in parallel, merge & dedupe
 */
export class HybridRagEngine {
  private readonly embedding: EmbeddingService;
  private readonly graph: GraphStore;
  private readonly extractor: EntityExtractor;
  private readonly vector: VectorStore;
  private readonly cag: CagCache;
  private readonly config: HybridRagConfig;
  private initialized = false;

  constructor(config: HybridRagConfig) {
    this.config = config;
    this.embedding = new EmbeddingService(config.embedding);
    this.graph = new GraphStore(config.neo4j);
    this.extractor = new EntityExtractor(
      config.embedding.apiKey,
      config.embedding.baseUrl,
    );
    this.vector = new VectorStore(config.qdrant);
    this.cag = new CagCache(config.cag);
  }

  /** Must be called once before using the engine. */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await Promise.all([
      this.graph.initialize(),
      this.vector.initialize(this.config.embedding.dimensions),
    ]);
    this.initialized = true;
  }

  // ─── Ingest ────────────────────────────────────────────────────────────────

  /**
   * Ingest a document:
   *   1. Chunk the text
   *   2. Embed chunks in batch
   *   3. Upsert vectors into Qdrant
   *   4. Extract entities per chunk
   *   5. Upsert entities + chunks into Neo4j
   *   6. If small enough, preload into CAG cache
   */
  async ingest(document: Document): Promise<void> {
    await this.initialize();

    const chunks = chunkText(document).map((c) => ({
      ...c,
      id: randomUUID(),
      documentId: document.id,
    }));

    if (chunks.length === 0) return;

    // Batch embed
    const texts = chunks.map((c) => c.content);
    const embeddings = await this.embedding.embedBatch(texts);

    // Parallel: vector upsert + graph upsert
    await Promise.all([
      this.vector.upsertBatch(chunks, embeddings),
      this.ingestToGraph(chunks),
    ]);

    // Preload into CAG if the document is small enough
    if (this.cag.shouldUseCag(document.content)) {
      this.cag.set(document.content);
    }
  }

  // ─── Retrieve ─────────────────────────────────────────────────────────────

  async retrieve(query: RetrievalQuery): Promise<RetrievalResponse> {
    await this.initialize();
    const start = Date.now();
    const topK = query.topK ?? 5;
    const mode = query.mode ?? "hybrid";

    switch (mode) {
      case "cag":
        return this.retrieveCag(query, start);
      case "graph":
        return this.retrieveGraph(query, topK, start);
      case "vector":
        return this.retrieveVector(query, topK, start);
      case "hybrid":
      default:
        return this.retrieveHybrid(query, topK, start);
    }
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  async deleteDocument(documentId: string): Promise<void> {
    await this.initialize();
    await Promise.all([
      this.graph.deleteDocument(documentId),
      this.vector.deleteByDocument(documentId),
    ]);
  }

  async close(): Promise<void> {
    await this.graph.close();
  }

  // ─── Private retrieval strategies ─────────────────────────────────────────

  private async retrieveHybrid(
    query: RetrievalQuery,
    topK: number,
    start: number,
  ): Promise<RetrievalResponse> {
    // Run graph + vector in parallel
    const [graphResults, vectorResults] = await Promise.all([
      this.retrieveGraph(query, topK, start).then((r) => r.results),
      this.retrieveVector(query, topK, start).then((r) => r.results),
    ]);

    // Merge, dedupe by chunkId, prefer higher score
    const merged = new Map<string, RetrievalResult>();
    for (const r of [...graphResults, ...vectorResults]) {
      const existing = merged.get(r.chunk.id);
      if (!existing || r.score > existing.score) {
        merged.set(r.chunk.id, r);
      }
    }

    const results = [...merged.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return {
      results,
      mode: "hybrid",
      latencyMs: Date.now() - start,
      cagHit: false,
    };
  }

  private async retrieveGraph(
    query: RetrievalQuery,
    topK: number,
    start: number,
  ): Promise<RetrievalResponse> {
    const raw = await this.graph.retrieveByEntities(query.text, topK);

    const results: RetrievalResult[] = raw.map((r) => ({
      chunk: r.chunk,
      // Graph results don't have a numeric similarity score; use rank-based
      score: 1.0 / (raw.indexOf(r) + 1),
      source: "graph" as const,
      entities: r.entities,
      graphPath: r.path,
    }));

    return {
      results,
      mode: "graph",
      latencyMs: Date.now() - start,
      cagHit: false,
    };
  }

  private async retrieveVector(
    query: RetrievalQuery,
    topK: number,
    start: number,
  ): Promise<RetrievalResponse> {
    const queryEmbedding = await this.embedding.embed(query.text);
    const raw = await this.vector.search(
      queryEmbedding,
      topK,
      query.minScore ?? 0.0,
      query.documentIds,
    );

    const results: RetrievalResult[] = raw.map((r) => ({
      chunk: r.chunk,
      score: r.score,
      source: "vector" as const,
    }));

    return {
      results,
      mode: "vector",
      latencyMs: Date.now() - start,
      cagHit: false,
    };
  }

  private async retrieveCag(
    query: RetrievalQuery,
    start: number,
  ): Promise<RetrievalResponse> {
    const hotEntries = this.cag.getHottestEntries(query.topK ?? 5);

    // Filter entries whose content is relevant (simple substring match as demo;
    // in production score against embeddings stored in the cache entries)
    const relevant = hotEntries.filter((e) =>
      e.context.toLowerCase().includes(query.text.toLowerCase()),
    );

    const results: RetrievalResult[] = relevant.map((entry, i) => ({
      chunk: {
        id: entry.key,
        documentId: "cag",
        content: entry.context,
        startOffset: 0,
        endOffset: entry.context.length,
        metadata: { hitCount: entry.hitCount, tokenCount: entry.tokenCount },
      },
      score: 1.0 / (i + 1),
      source: "cag" as const,
    }));

    return {
      results,
      mode: "cag",
      latencyMs: Date.now() - start,
      cagHit: results.length > 0,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async ingestToGraph(chunks: Chunk[]): Promise<void> {
    for (const chunk of chunks) {
      await this.graph.upsertChunk(chunk);
      const { entities, relationships } = await this.extractor.extract(
        chunk.content,
      );
      for (const entity of entities) {
        await this.graph.upsertEntity(entity, [chunk.id]);
      }
      for (const rel of relationships) {
        await this.graph.upsertRelationship(rel);
      }
    }
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error("HybridRagEngine.initialize() must be called first");
    }
  }
}
