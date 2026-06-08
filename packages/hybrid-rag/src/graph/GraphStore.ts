import neo4j, { Driver } from "neo4j-driver";
import type { Neo4jConfig, Entity, Relationship, Chunk } from "../types.js";

/**
 * Neo4j graph store for GraphRAG.
 *
 * Driver is created lazily on first use so that the MCP server can start
 * without a live Neo4j instance.
 *
 * Schema:
 *   (:Chunk {id, content, documentId, startOffset, endOffset})
 *   (:Entity {id, type, name, ...properties})
 *   (:Entity)-[:MENTIONED_IN]->(:Chunk)
 *   (:Entity)-[:RELATES_TO {type, ...}]->(:Entity)
 */
export class GraphStore {
  private _driver: Driver | null = null;
  private readonly config: Neo4jConfig;

  constructor(config: Neo4jConfig) {
    this.config = config;
  }

  /** Lazy driver — created only when first needed. */
  private driver(): Driver {
    if (!this._driver) {
      this._driver = neo4j.driver(
        this.config.uri,
        neo4j.auth.basic(this.config.user, this.config.password),
        { maxConnectionPoolSize: 20 },
      );
    }
    return this._driver;
  }

  /** Verify connectivity and create indexes. */
  async initialize(): Promise<void> {
    const d = this.driver();
    await d.verifyConnectivity();
    const session = d.session();
    try {
      await session.run(
        "CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE",
      );
      await session.run(
        "CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE",
      );
      await session.run(`
        CREATE FULLTEXT INDEX entity_name_idx IF NOT EXISTS
        FOR (e:Entity) ON EACH [e.name]
      `);
    } finally {
      await session.close();
    }
  }

  /** Upsert a document chunk into the graph. */
  async upsertChunk(chunk: Chunk): Promise<void> {
    const session = this.driver().session();
    try {
      await session.run(
        `
        MERGE (c:Chunk {id: $id})
        SET c.content      = $content,
            c.documentId   = $documentId,
            c.startOffset  = $startOffset,
            c.endOffset    = $endOffset,
            c.metadata     = $metadata
        `,
        {
          id: chunk.id,
          content: chunk.content,
          documentId: chunk.documentId,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          metadata: JSON.stringify(chunk.metadata),
        },
      );
    } finally {
      await session.close();
    }
  }

  /** Upsert an entity and link it to the chunks it was extracted from. */
  async upsertEntity(entity: Entity, chunkIds: string[]): Promise<void> {
    const session = this.driver().session();
    try {
      await session.run(
        `
        MERGE (e:Entity {id: $id})
        SET e.type       = $type,
            e.name       = $name,
            e.properties = $properties
        WITH e
        UNWIND $chunkIds AS cid
          MATCH (c:Chunk {id: cid})
          MERGE (e)-[:MENTIONED_IN]->(c)
        `,
        {
          id: entity.id,
          type: entity.type,
          name: entity.name,
          properties: JSON.stringify(entity.properties),
          chunkIds,
        },
      );
    } finally {
      await session.close();
    }
  }

  /** Create a typed relationship between two entities. */
  async upsertRelationship(rel: Relationship): Promise<void> {
    const session = this.driver().session();
    try {
      await session.run(
        `
        MATCH (src:Entity {id: $sourceId})
        MATCH (tgt:Entity {id: $targetId})
        MERGE (src)-[r:RELATES_TO {id: $id}]->(tgt)
        SET r.type       = $type,
            r.properties = $properties
        `,
        {
          id: rel.id,
          sourceId: rel.sourceId,
          targetId: rel.targetId,
          type: rel.type,
          properties: JSON.stringify(rel.properties),
        },
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Graph retrieval: full-text search on entity names → traverse up to
   * `hops` relationship hops → collect connected chunks.
   */
  async retrieveByEntities(
    query: string,
    topK: number,
    hops = 2,
  ): Promise<Array<{ chunk: Chunk; entities: Entity[]; path: string[] }>> {
    const session = this.driver().session();
    try {
      const result = await session.run(
        `
        CALL db.index.fulltext.queryNodes("entity_name_idx", $query)
        YIELD node AS startEntity, score
        WITH startEntity, score
        ORDER BY score DESC
        LIMIT 10
        MATCH path = (startEntity)-[:RELATES_TO*0..$hops]-(relatedEntity:Entity)
        WITH collect(DISTINCT relatedEntity) AS entities, startEntity
        UNWIND entities AS entity
        MATCH (entity)-[:MENTIONED_IN]->(chunk:Chunk)
        RETURN DISTINCT
          chunk.id          AS chunkId,
          chunk.content     AS content,
          chunk.documentId  AS documentId,
          chunk.startOffset AS startOffset,
          chunk.endOffset   AS endOffset,
          chunk.metadata    AS metadata,
          collect(DISTINCT entity) AS entities
        LIMIT $topK
        `,
        { query, hops: neo4j.int(hops), topK: neo4j.int(topK) },
      );

      return result.records.map((rec) => {
        const rawEntities = rec.get("entities") as Array<{
          properties: { id: string; type: string; name: string; properties: string };
        }>;

        const entities: Entity[] = rawEntities.map((e) => ({
          id: e.properties.id,
          type: e.properties.type,
          name: e.properties.name,
          properties: safeParseJson(e.properties.properties),
        }));

        const chunk: Chunk = {
          id: rec.get("chunkId") as string,
          content: rec.get("content") as string,
          documentId: rec.get("documentId") as string,
          startOffset: (rec.get("startOffset") as neo4j.Integer).toNumber(),
          endOffset: (rec.get("endOffset") as neo4j.Integer).toNumber(),
          metadata: safeParseJson(rec.get("metadata") as string),
        };

        return { chunk, entities, path: entities.map((e) => e.name) };
      });
    } finally {
      await session.close();
    }
  }

  /** Delete all chunks and entities for a document. */
  async deleteDocument(documentId: string): Promise<void> {
    const session = this.driver().session();
    try {
      await session.run(
        `
        MATCH (c:Chunk {documentId: $documentId})
        OPTIONAL MATCH (e:Entity)-[:MENTIONED_IN]->(c)
        DETACH DELETE c, e
        `,
        { documentId },
      );
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this._driver?.close();
    this._driver = null;
  }
}

function safeParseJson(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
