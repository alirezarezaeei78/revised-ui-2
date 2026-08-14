import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const manifestPath = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!manifestPath || !process.env.DATABASE_URL?.trim()) {
  console.error("Usage: DATABASE_URL=... npm run knowledge:ingest -- path/to/official-sources.json");
  process.exit(1);
}

const manifestValue = JSON.parse(await readFile(manifestPath, "utf8"));
const manifest = Array.isArray(manifestValue)
  ? { allowedDomains: [], documents: manifestValue }
  : manifestValue;
const documents = Array.isArray(manifest?.documents) ? manifest.documents : [];
const allowedDomains = new Set(
  (Array.isArray(manifest?.allowedDomains) ? manifest.allowedDomains : [])
    .map((value) => String(value).trim().toLowerCase().replace(/^www\./, ""))
    .filter(Boolean)
);

if (!documents.length) throw new Error("The manifest must contain a non-empty documents array.");
if (!allowedDomains.size) throw new Error("The manifest must declare allowedDomains for official source verification.");

const ollamaBaseUrl = (process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434").replace(/\/+$/, "");
const embeddingModel = process.env.OLLAMA_EMBED_MODEL?.trim() || "qwen3-embedding:0.6b";
const embeddingDimensions = 1_024;
const maximumDocumentBytes = 30 * 1024 * 1024;
const maximumExtractedCharacters = 3_000_000;
const allowedKinds = new Set(["datasheet", "manual", "installation", "network", "standard", "security", "troubleshooting"]);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
let vectorAvailable = false;
let embeddingAvailable = true;
let imported = 0;
let importedChunks = 0;

try {
  await ensureSchema();
  for (const [recordIndex, rawRecord] of documents.entries()) {
    const record = validateRecord(rawRecord, recordIndex);
    const extracted = await extractRecord(record);
    const chunks = buildChunks(record, extracted.pages);
    if (!chunks.length) throw new Error(`No usable text was extracted for ${record.sourceTitle}.`);

    const embeddings = embeddingAvailable ? await embedChunks(chunks) : chunks.map(() => null);
    const documentId = stableId([record.kind, record.brand, record.partNumber, record.sourceUrl].join("|"));
    const sourceHash = sha256(extracted.raw);

    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO assistant_knowledge_documents
          (id,kind,brand,part_number,part_number_key,source_url,source_title,source_hash,language,metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT(id) DO UPDATE SET
           kind=EXCLUDED.kind,brand=EXCLUDED.brand,part_number=EXCLUDED.part_number,
           part_number_key=EXCLUDED.part_number_key,source_url=EXCLUDED.source_url,
           source_title=EXCLUDED.source_title,source_hash=EXCLUDED.source_hash,
           language=EXCLUDED.language,metadata=EXCLUDED.metadata,verified_at=NOW(),updated_at=NOW()`,
        [
          documentId,
          record.kind,
          record.brand || null,
          record.partNumber || null,
          partNumberKey(record.partNumber),
          record.sourceUrl,
          record.sourceTitle,
          sourceHash,
          record.language,
          JSON.stringify(record.metadata)
        ]
      );
      await client.query("DELETE FROM assistant_knowledge_chunks WHERE document_id=$1", [documentId]);

      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        const embedding = embeddings[index];
        const params = [
          `${documentId}:${index}`,
          documentId,
          index,
          chunk.pageNumber,
          chunk.heading,
          chunk.content,
          embedding ? embeddingModel : null,
          embedding ? JSON.stringify(embedding) : null
        ];
        if (vectorAvailable && embedding) {
          await client.query(
            `INSERT INTO assistant_knowledge_chunks
              (id,document_id,chunk_index,page_number,heading,content,embedding_model,embedding_json,embedding)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::vector)`,
            [...params, vectorLiteral(embedding)]
          );
        } else {
          await client.query(
            `INSERT INTO assistant_knowledge_chunks
              (id,document_id,chunk_index,page_number,heading,content,embedding_model,embedding_json)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            params
          );
        }
      }

      if (record.kind === "datasheet" && record.brand && record.partNumber && Object.keys(record.facts).length) {
        await client.query(
          `INSERT INTO catalog_datasheet_facts
            (part_number_key,brand,part_number,source_url,source_title,facts)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT(part_number_key) DO UPDATE SET
             brand=EXCLUDED.brand,part_number=EXCLUDED.part_number,source_url=EXCLUDED.source_url,
             source_title=EXCLUDED.source_title,facts=EXCLUDED.facts,verified_at=NOW(),updated_at=NOW()`,
          [partNumberKey(record.partNumber), record.brand, record.partNumber, record.sourceUrl, record.sourceTitle, JSON.stringify(record.facts)]
        );
      }

      await client.query("COMMIT");
      imported += 1;
      importedChunks += chunks.length;
      console.log(`Imported ${record.sourceTitle}: ${chunks.length} chunk(s), embeddings=${embeddings.some(Boolean) ? "yes" : "no"}.`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  client.release();
  await pool.end();
}

console.log(`Knowledge ingestion complete: ${imported} document(s), ${importedChunks} chunk(s).`);

async function ensureSchema() {
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
  } catch {
    console.warn("pgvector could not be enabled; full-text retrieval remains active.");
  }

  await client.query(`CREATE TABLE IF NOT EXISTS assistant_knowledge_documents (
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
  await client.query(`CREATE TABLE IF NOT EXISTS assistant_knowledge_chunks (
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
  await client.query(`CREATE TABLE IF NOT EXISTS catalog_datasheet_facts (
    part_number_key TEXT PRIMARY KEY,
    brand TEXT NOT NULL,
    part_number TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_title TEXT NOT NULL,
    facts JSONB NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await client.query("CREATE INDEX IF NOT EXISTS assistant_knowledge_chunks_search_idx ON assistant_knowledge_chunks USING GIN(search_vector)");
  await client.query("CREATE INDEX IF NOT EXISTS assistant_knowledge_documents_part_idx ON assistant_knowledge_documents(part_number_key)");
  await client.query("CREATE INDEX IF NOT EXISTS assistant_knowledge_documents_brand_idx ON assistant_knowledge_documents(LOWER(brand))");

  const vector = await client.query("SELECT EXISTS(SELECT 1 FROM pg_type WHERE typname='vector') AS available");
  vectorAvailable = vector.rows[0]?.available === true;
  if (vectorAvailable) {
    await client.query("ALTER TABLE assistant_knowledge_chunks ADD COLUMN IF NOT EXISTS embedding vector");
    try {
      await client.query(
        "CREATE INDEX IF NOT EXISTS assistant_knowledge_chunks_embedding_idx ON assistant_knowledge_chunks USING hnsw ((embedding::vector(1024)) vector_cosine_ops) WHERE embedding IS NOT NULL"
      );
    } catch {
      console.warn("The vector column is active, but its HNSW index could not be created.");
    }
  }
}

function validateRecord(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid document at index ${index}.`);
  const kind = clean(value.kind, 40).toLowerCase();
  const brand = clean(value.brand, 100);
  const partNumber = clean(value.partNumber, 160);
  const sourceUrl = clean(value.sourceUrl, 1_000);
  const sourceTitle = clean(value.sourceTitle, 300);
  const language = clean(value.language || "mixed", 30);
  const file = clean(value.file, 1_000);
  const text = cleanLarge(value.text);
  const facts = sanitizeFacts(value.facts);
  const metadata = value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata) ? value.metadata : {};

  if (!allowedKinds.has(kind)) throw new Error(`Unsupported knowledge kind at index ${index}.`);
  if (!sourceTitle || !sourceUrl) throw new Error(`sourceTitle and sourceUrl are required at index ${index}.`);
  validateOfficialUrl(sourceUrl);
  if (!file && !text && !/\.pdf(?:$|\?)/i.test(sourceUrl)) {
    // HTML manuals and support pages are accepted; this branch only documents intent.
  }
  if (kind === "datasheet" && (!brand || !partNumber)) {
    throw new Error(`Datasheets require brand and exact partNumber at index ${index}.`);
  }
  return { kind, brand, partNumber, sourceUrl, sourceTitle, language, file, text, facts, metadata };
}

async function extractRecord(record) {
  if (record.text) {
    const content = record.text.slice(0, maximumExtractedCharacters);
    return { raw: Buffer.from(content), pages: [{ pageNumber: 1, text: content }] };
  }

  let bytes;
  let contentType = "";
  if (record.file) {
    const localPath = path.resolve(path.dirname(manifestPath), record.file);
    bytes = await readFile(localPath);
    contentType = localPath.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/plain";
  } else {
    const response = await fetch(record.sourceUrl, {
      redirect: "follow",
      headers: { "User-Agent": "HamyarDoorbinKnowledgeIndexer/1.0" },
      signal: AbortSignal.timeout(45_000)
    });
    if (!response.ok) throw new Error(`Failed to download ${record.sourceUrl}: HTTP ${response.status}`);
    validateOfficialUrl(response.url);
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > maximumDocumentBytes) throw new Error(`Document exceeds ${maximumDocumentBytes} bytes.`);
    contentType = response.headers.get("content-type") || "";
    bytes = Buffer.from(await response.arrayBuffer());
  }

  if (bytes.length > maximumDocumentBytes) throw new Error(`Document exceeds ${maximumDocumentBytes} bytes.`);
  if (/pdf/i.test(contentType) || bytes.subarray(0, 4).toString("ascii") === "%PDF") {
    return { raw: bytes, pages: await extractPdfPages(bytes) };
  }

  const decoded = bytes.toString("utf8");
  const text = /html/i.test(contentType) ? htmlToText(decoded) : decoded;
  return { raw: bytes, pages: [{ pageNumber: 1, text: text.slice(0, maximumExtractedCharacters) }] };
}

async function extractPdfPages(bytes) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), disableWorker: true });
  const document = await task.promise;
  const pages = [];
  let totalCharacters = 0;
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "")
        .join("")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
      totalCharacters += text.length;
      if (totalCharacters > maximumExtractedCharacters) throw new Error("Extracted document text is too large.");
      if (text) pages.push({ pageNumber, text });
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }
  return pages;
}

function buildChunks(record, pages) {
  const chunks = [];
  if (Object.keys(record.facts).length) {
    chunks.push({
      pageNumber: 1,
      heading: `${record.brand} ${record.partNumber} — ویژگی‌های ساختاریافته تأییدشده`,
      content: Object.entries(record.facts).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`).join("\n")
    });
  }
  for (const page of pages) {
    for (const [index, content] of splitText(page.text, 1_400).entries()) {
      chunks.push({
        pageNumber: page.pageNumber,
        heading: `${record.sourceTitle} — صفحه ${page.pageNumber}${index ? `، بخش ${index + 1}` : ""}`,
        content
      });
    }
  }
  return chunks.slice(0, 2_500);
}

function splitText(text, maximum) {
  const paragraphs = text.split(/\n{2,}|(?<=[.!?؟])\s+(?=[A-Zآ-ی0-9])/).map((item) => item.trim()).filter(Boolean);
  const output = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (paragraph.length > maximum) {
      if (current) output.push(current);
      for (let start = 0; start < paragraph.length; start += maximum - 160) {
        output.push(paragraph.slice(start, start + maximum).trim());
      }
      current = "";
      continue;
    }
    if (current && current.length + paragraph.length + 2 > maximum) {
      output.push(current);
      current = `${current.slice(-160)}\n${paragraph}`;
    } else {
      current = current ? `${current}\n${paragraph}` : paragraph;
    }
  }
  if (current) output.push(current);
  return output.filter((item) => item.length >= 40);
}

async function embedChunks(chunks) {
  const results = [];
  try {
    for (let start = 0; start < chunks.length; start += 12) {
      const batch = chunks.slice(start, start + 12).map((chunk) =>
        `Represent this verified CCTV/network document passage for retrieval.\n${chunk.heading}\n${chunk.content}`
      );
      const response = await fetch(`${ollamaBaseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: embeddingModel, input: batch, dimensions: embeddingDimensions, keep_alive: "30m" }),
        signal: AbortSignal.timeout(120_000)
      });
      if (!response.ok) throw new Error(`Ollama embedding failed with HTTP ${response.status}.`);
      const payload = await response.json();
      if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== batch.length) throw new Error("Invalid embedding response.");
      for (const embedding of payload.embeddings) {
        if (!Array.isArray(embedding) || embedding.length !== embeddingDimensions) throw new Error("Unexpected embedding dimension.");
        results.push(embedding);
      }
    }
    return results;
  } catch (error) {
    embeddingAvailable = false;
    console.warn(`${error instanceof Error ? error.message : "Embedding unavailable"} Continuing with PostgreSQL full-text retrieval.`);
    return chunks.map(() => null);
  }
}

function validateOfficialUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`Only HTTPS official sources are accepted: ${value}`);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (isPrivateHost(host)) throw new Error(`Private or local source hosts are not accepted: ${host}`);
  const allowed = [...allowedDomains].some((domain) => host === domain || host.endsWith(`.${domain}`));
  if (!allowed) throw new Error(`Source host is not in allowedDomains: ${host}`);
}

function isPrivateHost(host) {
  if (host === "localhost" || host.endsWith(".local")) return true;
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!match) return false;
  const first = Number(match[1]);
  const second = Number(match[2]);
  return first === 10 || first === 127 || first === 0 || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function sanitizeFacts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 120)) {
    const key = clean(rawKey, 100);
    if (!key) continue;
    if (typeof rawValue === "string") output[key] = clean(rawValue, 800);
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) output[key] = rawValue;
    else if (typeof rawValue === "boolean") output[key] = rawValue;
    else if (Array.isArray(rawValue)) output[key] = rawValue.map((item) => clean(item, 160)).filter(Boolean).slice(0, 30);
  }
  return output;
}

function htmlToText(value) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function clean(value, maximum) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maximum);
}

function cleanLarge(value) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, maximumExtractedCharacters) : "";
}

function partNumberKey(value) {
  return String(value || "").toLocaleUpperCase("en").replace(/[^A-Z0-9]+/g, "");
}

function stableId(value) {
  return sha256(Buffer.from(value)).slice(0, 40);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function vectorLiteral(values) {
  return `[${values.map((value) => Number(value).toFixed(8)).join(",")}]`;
}
