# MCP Hybrid RAG

TypeScript monorepo gồm 3 packages:

| Package | Mô tả |
|---|---|
| `packages/mcp-context7` | MCP server — tìm kiếm tài liệu & context từ codebase |
| `packages/mcp-playwright` | MCP server — browser automation qua Playwright |
| `packages/hybrid-rag` | GraphRAG + CAG hybrid engine |

## Kiến trúc

```
AI Agent (Claude / Kiro / Cursor…)
        │
        ├── MCP: mcp-context7    ──►  Context search (semantic + graph)
        ├── MCP: mcp-playwright  ──►  Browser automation
        │
        └── packages/hybrid-rag
              ├── GraphRAG   ──► Neo4j (entity relationships)
              ├── VectorRAG  ──► pgvector / Qdrant (semantic embeddings)
              └── CAG        ──► Cache-Augmented Generation (KV cache reuse)
```

### GraphRAG + CAG Hybrid

- **GraphRAG**: Kết hợp graph traversal (Neo4j) + vector similarity để tìm context phong phú hơn RAG thuần tuý. Entity extraction → graph upsert → hybrid retrieval (Cypher + cosine similarity).
- **CAG (Cache-Augmented Generation)**: Preloads toàn bộ knowledge base vào KV cache của model, tránh retrieval latency. Hybrid mode: CAG cho document nhỏ/thường dùng, GraphRAG cho corpus lớn/dynamic.

## Quick Start

```bash
pnpm install
cp packages/hybrid-rag/.env.example packages/hybrid-rag/.env
# Điền NEO4J_URI, NEO4J_PASSWORD, OPENAI_API_KEY, QDRANT_URL
pnpm build
```

### Chạy MCP servers

```bash
# Context7
pnpm --filter mcp-context7 start

# Playwright
pnpm --filter mcp-playwright start
```

### Đăng ký vào AI agent (ví dụ Kiro / Claude)

```jsonc
{
  "mcpServers": {
    "context7": {
      "command": "node",
      "args": ["packages/mcp-context7/dist/index.js"]
    },
    "playwright": {
      "command": "node",
      "args": ["packages/mcp-playwright/dist/index.js"]
    }
  }
}
```

## Yêu cầu

- Node.js >= 20
- pnpm >= 10
- Neo4j >= 5 (cho GraphRAG)
- Qdrant hoặc pgvector (cho vector store)
- OpenAI API key (hoặc bất kỳ embedding provider nào)
