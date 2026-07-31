import "server-only";

import { query } from "@/src/lib/db";

export type DatasheetFactValue = string | number | boolean | string[];

export type VerifiedDatasheet = {
  brand: string;
  partNumber: string;
  sourceUrl: string;
  sourceTitle: string;
  facts: Record<string, DatasheetFactValue>;
  verifiedAt: string;
};

const globalDatasheets = globalThis as typeof globalThis & { __hamyarDatasheetSchema?: Promise<void> };

export function partNumberKey(value: string) {
  return value.toLocaleUpperCase("en").replace(/[^A-Z0-9]+/g, "");
}

async function ensureDatasheetSchema() {
  if (!globalDatasheets.__hamyarDatasheetSchema) {
    globalDatasheets.__hamyarDatasheetSchema = (async () => {
      await query(`CREATE TABLE IF NOT EXISTS catalog_datasheet_facts (
        part_number_key TEXT PRIMARY KEY,
        brand TEXT NOT NULL,
        part_number TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_title TEXT NOT NULL,
        facts JSONB NOT NULL,
        verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await query("CREATE INDEX IF NOT EXISTS catalog_datasheet_facts_brand_idx ON catalog_datasheet_facts (LOWER(brand))");
    })();
  }
  await globalDatasheets.__hamyarDatasheetSchema;
}

export function sanitizeDatasheetFacts(value: unknown): Record<string, DatasheetFactValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, DatasheetFactValue> = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 80)) {
    const key = rawKey.replace(/\u0000/g, "").trim().slice(0, 80);
    if (!key) continue;
    if (typeof rawValue === "string") output[key] = rawValue.replace(/\u0000/g, "").trim().slice(0, 500);
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) output[key] = rawValue;
    else if (typeof rawValue === "boolean") output[key] = rawValue;
    else if (Array.isArray(rawValue)) {
      output[key] = rawValue.filter((item): item is string => typeof item === "string").slice(0, 20).map((item) => item.trim().slice(0, 120)).filter(Boolean);
    }
  }
  return output;
}

export async function getVerifiedDatasheets(partNumbers: string[]) {
  if (!process.env.DATABASE_URL?.trim() || !partNumbers.length) return new Map<string, VerifiedDatasheet>();
  try {
    await ensureDatasheetSchema();
    const keys = Array.from(new Set(partNumbers.map(partNumberKey).filter(Boolean)));
    const result = await query(
      `SELECT part_number_key,brand,part_number,source_url,source_title,facts,verified_at
       FROM catalog_datasheet_facts WHERE part_number_key=ANY($1::text[])`,
      [keys]
    );
    return new Map<string, VerifiedDatasheet>(result.rows.map((row) => [String(row.part_number_key), {
      brand: String(row.brand),
      partNumber: String(row.part_number),
      sourceUrl: String(row.source_url),
      sourceTitle: String(row.source_title),
      facts: sanitizeDatasheetFacts(row.facts),
      verifiedAt: new Date(row.verified_at).toISOString()
    }]));
  } catch {
    return new Map<string, VerifiedDatasheet>();
  }
}

export async function listVerifiedDatasheets(search = "") {
  await ensureDatasheetSchema();
  const value = search.trim().slice(0, 100);
  const result = value
    ? await query(
        `SELECT brand,part_number,source_url,source_title,facts,verified_at
         FROM catalog_datasheet_facts
         WHERE brand ILIKE $1 OR part_number ILIKE $1
         ORDER BY updated_at DESC LIMIT 100`,
        [`%${value}%`]
      )
    : await query(
        `SELECT brand,part_number,source_url,source_title,facts,verified_at
         FROM catalog_datasheet_facts ORDER BY updated_at DESC LIMIT 100`
      );
  return result.rows.map((row) => ({
    brand: String(row.brand), partNumber: String(row.part_number), sourceUrl: String(row.source_url),
    sourceTitle: String(row.source_title), facts: sanitizeDatasheetFacts(row.facts),
    verifiedAt: new Date(row.verified_at).toISOString()
  } satisfies VerifiedDatasheet));
}

export async function upsertVerifiedDatasheet(input: {
  brand: string;
  partNumber: string;
  sourceUrl: string;
  sourceTitle: string;
  facts: unknown;
}) {
  await ensureDatasheetSchema();
  const brand = input.brand.trim().slice(0, 80);
  const partNumber = input.partNumber.trim().slice(0, 120);
  const sourceUrl = input.sourceUrl.trim().slice(0, 1_000);
  const sourceTitle = input.sourceTitle.trim().slice(0, 200);
  const facts = sanitizeDatasheetFacts(input.facts);
  const key = partNumberKey(partNumber);
  if (!brand || !key || !/^https:\/\//i.test(sourceUrl) || !sourceTitle || !Object.keys(facts).length) {
    throw new Error("برند، Part Number، لینک HTTPS منبع، عنوان منبع و حداقل یک ویژگی معتبر لازم است.");
  }
  const result = await query(
    `INSERT INTO catalog_datasheet_facts
      (part_number_key,brand,part_number,source_url,source_title,facts)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (part_number_key) DO UPDATE SET
       brand=EXCLUDED.brand,part_number=EXCLUDED.part_number,source_url=EXCLUDED.source_url,
       source_title=EXCLUDED.source_title,facts=EXCLUDED.facts,verified_at=NOW(),updated_at=NOW()
     RETURNING brand,part_number,source_url,source_title,facts,verified_at`,
    [key, brand, partNumber, sourceUrl, sourceTitle, JSON.stringify(facts)]
  );
  const row = result.rows[0];
  return {
    brand: String(row.brand), partNumber: String(row.part_number), sourceUrl: String(row.source_url),
    sourceTitle: String(row.source_title), facts: sanitizeDatasheetFacts(row.facts),
    verifiedAt: new Date(row.verified_at).toISOString()
  } satisfies VerifiedDatasheet;
}

export async function deleteVerifiedDatasheet(partNumber: string) {
  await ensureDatasheetSchema();
  const result = await query("DELETE FROM catalog_datasheet_facts WHERE part_number_key=$1", [partNumberKey(partNumber)]);
  return result.rowCount ?? 0;
}
