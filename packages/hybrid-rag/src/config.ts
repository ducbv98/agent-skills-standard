import "dotenv/config";
import { z } from "zod";
import type { HybridRagConfig } from "./types.js";

const EnvSchema = z.object({
  NEO4J_URI: z.string().default("bolt://localhost:7687"),
  NEO4J_USER: z.string().default("neo4j"),
  NEO4J_PASSWORD: z.string(),
  QDRANT_URL: z.string().default("http://localhost:6333"),
  QDRANT_COLLECTION: z.string().default("hybrid_rag"),
  QDRANT_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: z.coerce.number().default(1536),
  CAG_ENABLED: z
    .string()
    .transform((v) => v === "true")
    .default("true"),
  CAG_TOKEN_THRESHOLD: z.coerce.number().default(32000),
  CAG_MAX_ENTRIES: z.coerce.number().default(100),
  CAG_TTL_SECONDS: z.coerce.number().default(3600),
});

function loadConfig(): HybridRagConfig {
  const env = EnvSchema.parse(process.env);

  return {
    neo4j: {
      uri: env.NEO4J_URI,
      user: env.NEO4J_USER,
      password: env.NEO4J_PASSWORD,
    },
    qdrant: {
      url: env.QDRANT_URL,
      collection: env.QDRANT_COLLECTION,
      apiKey: env.QDRANT_API_KEY,
    },
    embedding: {
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL,
      model: env.EMBEDDING_MODEL,
      dimensions: env.EMBEDDING_DIMENSIONS,
    },
    cag: {
      enabled: env.CAG_ENABLED,
      tokenThreshold: env.CAG_TOKEN_THRESHOLD,
      maxEntries: env.CAG_MAX_ENTRIES,
      ttlSeconds: env.CAG_TTL_SECONDS,
    },
  };
}

export const config = loadConfig();
