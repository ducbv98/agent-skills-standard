/**
 * Core types for the GraphRAG + CAG hybrid engine.
 */

// ─── Document & Chunk ────────────────────────────────────────────────────────

export interface Document {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  /** ISO timestamp */
  createdAt: string;
  updatedAt: string;
}

export interface Chunk {
  id: string;
  documentId: string;
  content: string;
  /** Float32 embedding vector */
  embedding?: number[];
  metadata: Record<string, unknown>;
  /** Character offset in source document */
  startOffset: number;
  endOffset: number;
}

// ─── Graph entities ───────────────────────────────────────────────────────────

export interface Entity {
  id: string;
  type: string;
  name: string;
  properties: Record<string, unknown>;
}

export interface Relationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface GraphNode extends Entity {
  chunkIds: string[];
}

// ─── Retrieval ────────────────────────────────────────────────────────────────

export type RetrievalMode = "graph" | "vector" | "hybrid" | "cag";

export interface RetrievalQuery {
  text: string;
  topK?: number;
  mode?: RetrievalMode;
  /** Filter by document IDs */
  documentIds?: string[];
  /** Minimum similarity threshold [0-1] */
  minScore?: number;
}

export interface RetrievalResult {
  chunk: Chunk;
  score: number;
  /** How this result was retrieved */
  source: "graph" | "vector" | "cag";
  /** Related entities from graph traversal */
  entities?: Entity[];
  /** Graph path that led to this chunk */
  graphPath?: string[];
}

export interface RetrievalResponse {
  results: RetrievalResult[];
  mode: RetrievalMode;
  /** Total retrieval time in ms */
  latencyMs: number;
  /** Was CAG cache used? */
  cagHit: boolean;
}

// ─── CAG (Cache-Augmented Generation) ────────────────────────────────────────

export interface CagEntry {
  key: string;
  /** Serialised context that was preloaded into KV cache */
  context: string;
  /** Estimated token count */
  tokenCount: number;
  /** Last access timestamp */
  lastAccessedAt: string;
  /** How many times this entry was used */
  hitCount: number;
}

export interface CagConfig {
  enabled: boolean;
  /** Max tokens before falling back to GraphRAG */
  tokenThreshold: number;
  /** Max entries in the LRU cache */
  maxEntries: number;
  /** TTL in seconds */
  ttlSeconds: number;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface Neo4jConfig {
  uri: string;
  user: string;
  password: string;
  database?: string;
}

export interface QdrantConfig {
  url: string;
  collection: string;
  apiKey?: string;
}

export interface EmbeddingConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  dimensions: number;
}

export interface HybridRagConfig {
  neo4j: Neo4jConfig;
  qdrant: QdrantConfig;
  embedding: EmbeddingConfig;
  cag: CagConfig;
}
