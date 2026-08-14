import "server-only";

import { query } from "@/src/lib/db";
import { normalizePersian } from "@/src/lib/chatbot/persian";

export type VerifiedKnowledgeSource = {
  id: string;
  kind: string;
  title: string;
  content: string;
  sourceUrl: string;
  sourceTitle: string;
  brand?: string;
  partNumber?: string;
  pageNumber?: number;
  score: number;
};

type SearchOptions = {
  limit: number;
  semantic?: boolean;
};

type KnowledgeRow = Record<string, unknown>;

const ollamaBaseUrl = (process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434").replace(/\/+$/, "");
const embeddingModel = process.env.OLLAMA_EMBED_MODEL?.trim() || "qwen3-embedding:0.6b";
const embeddingDimensions = 1_024;
const globalKnowledge = globalThis as typeof globalThis & {
  __hamyarKnowledgeSchema?: Promise<{ vectorAvailable: boolean }>;
  __hamyarEmbeddingUnavailableUntil?: number;
};

async function ensureKnowledgeSchema() {
  if (!globalKnowledge.__hamyarKnowledgeSchema) {
    globalKnowledge.__hamyarKnowledgeSchema = (async () => {
      await query(`CREATE TABLE IF NOT EXISTS assistant_knowledge_documents (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        brand TEXT,
        part_number TEXT,
        part_number_key TEXT,
        source_url TEXT NOT NULL,
        source_title TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'mixed',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await query(`CREATE TABLE IF NOT EXISTS assistant_knowledge_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES assistant_knowledge_documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        page_number INTEGER,
        heading TEXT,
        content TEXT NOT NULL,
        embedding_model TEXT,
        embedding_json JSONB,
        search_vector TSVECTOR GENERATED ALWAYS AS (
          to_tsvector('simple', COALESCE(heading, '') || ' ' || content)
        ) STORED,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(document_id, chunk_index)
      )`);
      await query("CREATE INDEX IF NOT EXISTS assistant_knowledge_chunks_search_idx ON assistant_knowledge_chunks USING GIN(search_vector)");
      await query("CREATE INDEX IF NOT EXISTS assistant_knowledge_documents_part_idx ON assistant_knowledge_documents(part_number_key)");
      await query("CREATE INDEX IF NOT EXISTS assistant_knowledge_documents_brand_idx ON assistant_knowledge_documents(LOWER(brand))");
      const vector = await query("SELECT EXISTS(SELECT 1 FROM pg_type WHERE typname='vector') AS available");
      return { vectorAvailable: vector.rows[0]?.available === true };
    })().catch((error) => {
      globalKnowledge.__hamyarKnowledgeSchema = undefined;
      throw error;
    });
  }
  return globalKnowledge.__hamyarKnowledgeSchema;
}

export async function searchVerifiedKnowledge(
  input: string,
  options: SearchOptions
): Promise<VerifiedKnowledgeSource[]> {
  if (!process.env.DATABASE_URL?.trim()) return [];
  const text = normalizePersian(input).trim().slice(0, 1_000);
  if (!text) return [];

  try {
    const schema = await ensureKnowledgeSchema();
    const candidateLimit = Math.max(20, Math.min(80, options.limit * 12));
    const partKeys = extractPartNumberKeys(text);
    const searchTerms = text
      .split(/[^\p{L}\p{N}._/-]+/u)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2)
      .slice(0, 16);
    const webQuery = searchTerms.join(" OR ") || text;
    const fuzzyNeedle = searchTerms.sort((left, right) => right.length - left.length)[0] || text.slice(0, 80);
    const lexical = await query(
      `SELECT c.id,c.heading,c.content,c.page_number,c.embedding_json,
              d.kind,d.brand,d.part_number,d.source_url,d.source_title,
              ts_rank_cd(c.search_vector, websearch_to_tsquery('simple', $1)) AS lexical_score,
              CASE WHEN d.part_number_key <> '' AND d.part_number_key=ANY($2::text[]) THEN 1 ELSE 0 END AS exact_part
       FROM assistant_knowledge_chunks c
       JOIN assistant_knowledge_documents d ON d.id=c.document_id
       WHERE c.search_vector @@ websearch_to_tsquery('simple', $1)
          OR c.content ILIKE $3 OR d.source_title ILIKE $3 OR d.brand ILIKE $3 OR d.part_number ILIKE $3
          OR (d.part_number_key <> '' AND d.part_number_key=ANY($2::text[]))
       ORDER BY exact_part DESC, lexical_score DESC, d.verified_at DESC
       LIMIT $4`,
      [webQuery, partKeys, `%${fuzzyNeedle.slice(0, 120)}%`, candidateLimit]
    );

    const rows = new Map<string, { row: KnowledgeRow; lexical: number; semantic: number }>();
    for (const row of lexical.rows as KnowledgeRow[]) {
      rows.set(String(row.id), {
        row,
        lexical: numberValue(row.lexical_score) + (numberValue(row.exact_part) ? 1 : 0),
        semantic: 0
      });
    }

    if (options.semantic && schema.vectorAvailable) {
      const embedding = await embedQuery(text);
      if (embedding) {
        try {
          const semantic = await query(
            `SELECT c.id,c.heading,c.content,c.page_number,c.embedding_json,
                    d.kind,d.brand,d.part_number,d.source_url,d.source_title,
                    1 - (c.embedding::vector(1024) <=> $1::vector(1024)) AS semantic_score
             FROM assistant_knowledge_chunks c
             JOIN assistant_knowledge_documents d ON d.id=c.document_id
             WHERE c.embedding IS NOT NULL AND c.embedding_model=$2
             ORDER BY c.embedding::vector(1024) <=> $1::vector(1024)
             LIMIT $3`,
            [vectorLiteral(embedding), embeddingModel, candidateLimit]
          );
          for (const row of semantic.rows as KnowledgeRow[]) {
            const id = String(row.id);
            const current = rows.get(id);
            rows.set(id, {
              row: current?.row ?? row,
              lexical: current?.lexical ?? 0,
              semantic: Math.max(0, numberValue(row.semantic_score))
            });
          }
        } catch {
          // pgvector is optional. Lexical retrieval remains available on basic PostgreSQL.
        }
      }
    }

    return [...rows.values()]
      .map(({ row, lexical, semantic }) => toSource(row, lexical, semantic))
      .filter((item) => item.content && item.sourceUrl)
      .sort((left, right) => right.score - left.score)
      .slice(0, options.limit);
  } catch {
    return [];
  }
}

async function embedQuery(text: string) {
  if ((globalKnowledge.__hamyarEmbeddingUnavailableUntil ?? 0) > Date.now()) return null;
  try {
    const response = await fetch(`${ollamaBaseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: embeddingModel,
        input: `Represent this Persian CCTV/network support query for retrieval: ${text}`,
        dimensions: embeddingDimensions,
        keep_alive: "30m"
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) throw new Error("embedding-unavailable");
    const payload = await response.json() as { embeddings?: number[][] };
    const embedding = payload.embeddings?.[0];
    if (!embedding || embedding.length !== embeddingDimensions) throw new Error("embedding-dimension");
    return embedding;
  } catch {
    globalKnowledge.__hamyarEmbeddingUnavailableUntil = Date.now() + 5 * 60_000;
    return null;
  }
}

function toSource(row: KnowledgeRow, lexical: number, semantic: number): VerifiedKnowledgeSource {
  const normalizedLexical = Math.min(1, lexical * 4);
  const exactBoost = lexical >= 1 ? 0.5 : 0;
  return {
    id: String(row.id ?? ""),
    kind: String(row.kind ?? "knowledge"),
    title: String(row.heading || row.source_title || "منبع فنی").slice(0, 240),
    content: String(row.content ?? "").replace(/\u0000/g, "").trim().slice(0, 4_000),
    sourceUrl: String(row.source_url ?? "").slice(0, 1_000),
    sourceTitle: String(row.source_title ?? "منبع رسمی").slice(0, 240),
    brand: optionalString(row.brand),
    partNumber: optionalString(row.part_number),
    pageNumber: numberValue(row.page_number) || undefined,
    score: exactBoost + semantic * 0.72 + normalizedLexical * 0.28
  };
}

function optionalString(value: unknown) {
  const output = String(value ?? "").trim();
  return output || undefined;
}

function numberValue(value: unknown) {
  const output = Number(value);
  return Number.isFinite(output) ? output : 0;
}

function vectorLiteral(values: number[]) {
  return `[${values.map((value) => Number(value).toFixed(8)).join(",")}]`;
}

function extractPartNumberKeys(text: string) {
  const matches = text.toLocaleUpperCase("en").match(/[A-Z0-9][A-Z0-9._/-]{3,}/g) ?? [];
  return [...new Set(matches
    .filter((value) => /[A-Z]/.test(value) && /\d/.test(value))
    .map((value) => value.replace(/[^A-Z0-9]+/g, ""))
    .filter(Boolean))];
}
