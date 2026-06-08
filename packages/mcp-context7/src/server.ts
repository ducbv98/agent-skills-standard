import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { HybridRagEngine } from "hybrid-rag";

/**
 * Context7 MCP Server
 *
 * Tools:
 *   - search_context     : Hybrid semantic + graph search across ingested docs
 *   - ingest_document    : Add a document to the knowledge base
 *   - delete_document    : Remove a document and its vectors/graph nodes
 *   - list_modes         : Explain available retrieval modes
 */
export function buildContext7Server(engine: HybridRagEngine): McpServer {
  const server = new McpServer(
    {
      name: "mcp-context7",
      version: "1.0.0",
    },
    {
      instructions: `
You are connected to the Context7 MCP server.

Context7 provides hybrid retrieval over your document knowledge base using
GraphRAG (Neo4j entity graph + relationships) and CAG (Cache-Augmented Generation).

# TOOLS

## search_context
Search the knowledge base for relevant context given a natural-language query.
- mode: "hybrid" (default) | "graph" | "vector" | "cag"
- hybrid = runs graph + vector retrieval in parallel, merges results
- cag    = serves frequently-used context from cache (fastest)
- graph  = entity + relationship traversal (best for "how does X relate to Y?")
- vector = semantic similarity only (best for dense prose)

## ingest_document
Add or update a document in the knowledge base.
The engine will chunk, embed, extract entities, and build the graph automatically.

## delete_document
Remove a document and all its associated chunks, embeddings, and graph nodes.

## list_modes
Show available retrieval modes with descriptions.

# WORKFLOW
1. Call search_context with the user's question.
2. Use the returned chunks as grounding context for your answer.
3. Cite chunk metadata (documentId, offsets) when relevant.
`.trim(),
    },
  );

  // ── search_context ────────────────────────────────────────────────────────
  server.registerTool(
    "search_context",
    {
      title: "Search context",
      description:
        "Search the knowledge base for relevant context. Use mode='hybrid' for best results.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Natural language search query"),
        topK: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(5)
          .describe("Number of results to return"),
        mode: z
          .enum(["hybrid", "graph", "vector", "cag"])
          .default("hybrid")
          .describe("Retrieval mode"),
        minScore: z
          .number()
          .min(0)
          .max(1)
          .default(0.0)
          .describe("Minimum similarity score (0-1). Only applies to vector mode."),
        documentIds: z
          .array(z.string())
          .optional()
          .describe("Filter results to specific document IDs"),
      }),
    },
    async (args) => {
      const response = await engine.retrieve({
        text: args.query,
        topK: args.topK,
        mode: args.mode,
        minScore: args.minScore,
        documentIds: args.documentIds,
      });

      const lines: string[] = [
        `# Search Results`,
        ``,
        `**Query**: ${args.query}`,
        `**Mode**: ${response.mode} | **Latency**: ${response.latencyMs}ms | **CAG hit**: ${response.cagHit}`,
        `**Found**: ${response.results.length} result(s)`,
        ``,
      ];

      for (const [i, result] of response.results.entries()) {
        lines.push(`## Result ${i + 1} (score: ${result.score.toFixed(4)}, source: ${result.source})`);
        lines.push(`**Document**: ${result.chunk.documentId}`);
        lines.push(`**Offsets**: ${result.chunk.startOffset}–${result.chunk.endOffset}`);
        if (result.entities && result.entities.length > 0) {
          lines.push(
            `**Entities**: ${result.entities.map((e) => `${e.name} (${e.type})`).join(", ")}`,
          );
        }
        if (result.graphPath && result.graphPath.length > 0) {
          lines.push(`**Graph path**: ${result.graphPath.join(" → ")}`);
        }
        lines.push(``);
        lines.push("```");
        lines.push(result.chunk.content);
        lines.push("```");
        lines.push(``);
      }

      if (response.results.length === 0) {
        lines.push("_No results found. Try a different query or ingesting more documents._");
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  // ── ingest_document ───────────────────────────────────────────────────────
  server.registerTool(
    "ingest_document",
    {
      title: "Ingest document",
      description:
        "Add a document to the knowledge base. Automatically chunks, embeds, and builds the entity graph.",
      inputSchema: z.object({
        id: z
          .string()
          .min(1)
          .describe("Unique document ID (use a stable identifier like a file path or URL)"),
        content: z.string().min(1).describe("Full document text content"),
        metadata: z
          .record(z.unknown())
          .default({})
          .describe("Optional metadata (title, source URL, tags, etc.)"),
      }),
    },
    async (args) => {
      const now = new Date().toISOString();
      await engine.ingest({
        id: args.id,
        content: args.content,
        metadata: args.metadata,
        createdAt: now,
        updatedAt: now,
      });

      return {
        content: [
          {
            type: "text",
            text: `✅ Document **${args.id}** ingested successfully.\n\nThe document has been chunked, embedded, and its entities extracted into the knowledge graph.`,
          },
        ],
      };
    },
  );

  // ── delete_document ───────────────────────────────────────────────────────
  server.registerTool(
    "delete_document",
    {
      title: "Delete document",
      description: "Remove a document and all its associated data from the knowledge base.",
      inputSchema: z.object({
        documentId: z.string().min(1).describe("Document ID to delete"),
      }),
    },
    async (args) => {
      await engine.deleteDocument(args.documentId);
      return {
        content: [
          {
            type: "text",
            text: `🗑️ Document **${args.documentId}** and all associated chunks, embeddings, and graph nodes have been removed.`,
          },
        ],
      };
    },
  );

  // ── list_modes ────────────────────────────────────────────────────────────
  server.registerTool(
    "list_modes",
    {
      title: "List retrieval modes",
      description: "Explain the available retrieval modes and when to use each.",
      inputSchema: z.object({}),
    },
    async () => {
      const text = `# Retrieval Modes

| Mode | Description | Best for |
|------|-------------|----------|
| \`hybrid\` | Graph + vector in parallel, merged & deduped | Default — best overall quality |
| \`graph\` | Entity extraction + Neo4j traversal | "How does X relate to Y?", relationship queries |
| \`vector\` | Semantic similarity via Qdrant | Dense prose, factual Q&A |
| \`cag\` | Cache-Augmented Generation — preloaded context | Frequently asked questions, hot documents |

## GraphRAG vs CAG

**GraphRAG** builds a knowledge graph from your documents. Each chunk has entities extracted,
and relationships are stored as edges. Retrieval does a full-text search for matching entity names,
then traverses the graph up to 2 hops to find related chunks.

**CAG** preloads small/frequent documents into the model's KV cache to eliminate retrieval latency.
The engine automatically chooses CAG when a document is under the configured token threshold.

In **hybrid** mode, both strategies run in parallel and their results are merged.`;
      return { content: [{ type: "text", text }] };
    },
  );

  return server;
}
