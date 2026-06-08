import OpenAI from "openai";
import { randomUUID } from "crypto";
import type { Entity, Relationship } from "../types.js";

interface ExtractionResult {
  entities: Entity[];
  relationships: Relationship[];
}

const SYSTEM_PROMPT = `You are an entity extraction engine. Given a text passage, extract:
1. Named entities (people, organizations, concepts, technologies, locations, etc.)
2. Relationships between those entities

Return ONLY valid JSON in this exact format:
{
  "entities": [
    { "name": "...", "type": "PERSON|ORG|TECH|CONCEPT|LOCATION|OTHER", "properties": {} }
  ],
  "relationships": [
    { "source": "<entity name>", "target": "<entity name>", "type": "USES|PART_OF|RELATED_TO|DEPENDS_ON|...", "properties": {} }
  ]
}`;

/**
 * Uses an LLM to extract entities and relationships from text chunks.
 * These feed directly into the graph store for GraphRAG.
 */
export class EntityExtractor {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, baseUrl?: string, model = "gpt-4o-mini") {
    this.client = new OpenAI({ apiKey, baseURL: baseUrl });
    this.model = model;
  }

  async extract(text: string): Promise<ExtractionResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 2048,
    });

    const content = response.choices[0]?.message?.content ?? "{}";

    let parsed: {
      entities?: Array<{ name: string; type: string; properties: Record<string, unknown> }>;
      relationships?: Array<{
        source: string;
        target: string;
        type: string;
        properties: Record<string, unknown>;
      }>;
    };

    try {
      parsed = JSON.parse(content) as typeof parsed;
    } catch {
      return { entities: [], relationships: [] };
    }

    const entityMap = new Map<string, Entity>();
    for (const raw of parsed.entities ?? []) {
      const id = randomUUID();
      entityMap.set(raw.name, {
        id,
        name: raw.name,
        type: raw.type ?? "OTHER",
        properties: raw.properties ?? {},
      });
    }

    const relationships: Relationship[] = [];
    for (const raw of parsed.relationships ?? []) {
      const src = entityMap.get(raw.source);
      const tgt = entityMap.get(raw.target);
      if (!src || !tgt) continue;
      relationships.push({
        id: randomUUID(),
        sourceId: src.id,
        targetId: tgt.id,
        type: raw.type ?? "RELATED_TO",
        properties: raw.properties ?? {},
      });
    }

    return {
      entities: Array.from(entityMap.values()),
      relationships,
    };
  }
}
