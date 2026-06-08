import { randomUUID } from "crypto";
import type { CagConfig, CagEntry } from "../types.js";

/**
 * Cache-Augmented Generation (CAG) cache.
 *
 * CAG preloads entire knowledge bases into the LLM's KV cache, avoiding
 * per-query retrieval latency. This implementation provides the caching
 * layer — the actual KV cache is in the model server.
 *
 * Strategy:
 * - Small / frequently-used contexts → CAG (serve from cache)
 * - Large / dynamic corpora          → GraphRAG (on-demand retrieval)
 *
 * This is an in-process LRU cache tracking which contexts have been
 * preloaded. In production, back it with Redis for distributed scenarios.
 */
export class CagCache {
  private readonly entries = new Map<string, CagEntry>();
  private readonly config: CagConfig;

  constructor(config: CagConfig) {
    this.config = config;
  }

  /** Store or refresh a context in the cache. Returns the entry key. */
  set(context: string, tokenCount?: number): string {
    // Deterministic key based on content hash
    const key = this.hash(context);

    const existing = this.entries.get(key);
    if (existing) {
      existing.lastAccessedAt = new Date().toISOString();
      existing.hitCount += 1;
      return key;
    }

    this.evictIfNeeded();

    this.entries.set(key, {
      key,
      context,
      tokenCount: tokenCount ?? this.estimateTokens(context),
      lastAccessedAt: new Date().toISOString(),
      hitCount: 0,
    });

    return key;
  }

  /** Retrieve a cached context by key. Returns null on miss or expiry. */
  get(key: string): CagEntry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;

    // TTL check
    const age =
      (Date.now() - new Date(entry.lastAccessedAt).getTime()) / 1000;
    if (age > this.config.ttlSeconds) {
      this.entries.delete(key);
      return null;
    }

    entry.lastAccessedAt = new Date().toISOString();
    entry.hitCount += 1;
    return entry;
  }

  /**
   * Decide whether to use CAG or GraphRAG for a given context.
   *
   * Returns true (use CAG) when:
   *   1. CAG is enabled
   *   2. The context fits within the token threshold
   *   3. The context is already cached OR is small enough to preload
   */
  shouldUseCag(context: string): boolean {
    if (!this.config.enabled) return false;
    const tokens = this.estimateTokens(context);
    return tokens <= this.config.tokenThreshold;
  }

  /** Get all entries sorted by hitCount descending (hottest first). */
  getHottestEntries(limit = 10): CagEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, limit);
  }

  /** Stats for monitoring. */
  stats(): { size: number; totalTokens: number; hitRate: number } {
    const values = [...this.entries.values()];
    const totalHits = values.reduce((s, e) => s + e.hitCount, 0);
    const totalCalls = values.reduce((s, e) => s + e.hitCount + 1, 0);
    return {
      size: this.entries.size,
      totalTokens: values.reduce((s, e) => s + e.tokenCount, 0),
      hitRate: totalCalls > 0 ? totalHits / totalCalls : 0,
    };
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private evictIfNeeded(): void {
    if (this.entries.size < this.config.maxEntries) return;
    // Evict least recently accessed entry
    let oldest: [string, CagEntry] | null = null;
    for (const pair of this.entries.entries()) {
      if (
        !oldest ||
        new Date(pair[1].lastAccessedAt) < new Date(oldest[1].lastAccessedAt)
      ) {
        oldest = pair;
      }
    }
    if (oldest) this.entries.delete(oldest[0]);
  }

  /** Cheap token estimate: ~4 chars per token (GPT rule of thumb). */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** Simple djb2-like hash for deterministic cache keys. */
  private hash(text: string): string {
    let h = 5381;
    for (let i = 0; i < text.length; i++) {
      h = ((h << 5) + h + text.charCodeAt(i)) & 0xffffffff;
    }
    return (h >>> 0).toString(16);
  }
}
