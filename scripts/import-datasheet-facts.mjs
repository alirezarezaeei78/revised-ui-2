import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!inputPath || !process.env.DATABASE_URL) {
  console.error("Usage: DATABASE_URL=... npm run datasheets:import -- path/to/datasheets.json");
  process.exit(1);
}

const records = JSON.parse(await readFile(inputPath, "utf8"));
if (!Array.isArray(records)) throw new Error("The datasheet file must contain a JSON array.");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
let imported = 0;

const partNumberKey = (value) => String(value).toUpperCase().replace(/[^A-Z0-9]+/g, "");
const clean = (value, maximum) => String(value ?? "").replace(/\0/g, "").trim().slice(0, maximum);

try {
  await client.query("BEGIN");
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

  for (const [index, record] of records.entries()) {
    const brand = clean(record?.brand, 80);
    const partNumber = clean(record?.partNumber, 120);
    const sourceUrl = clean(record?.sourceUrl, 1_000);
    const sourceTitle = clean(record?.sourceTitle, 200);
    const facts = record?.facts && typeof record.facts === "object" && !Array.isArray(record.facts) ? record.facts : {};
    const key = partNumberKey(partNumber);
    if (!brand || !key || !/^https:\/\//i.test(sourceUrl) || !sourceTitle || !Object.keys(facts).length) {
      throw new Error(`Invalid datasheet record at array index ${index}.`);
    }
    await client.query(
      `INSERT INTO catalog_datasheet_facts
        (part_number_key,brand,part_number,source_url,source_title,facts)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (part_number_key) DO UPDATE SET
         brand=EXCLUDED.brand,part_number=EXCLUDED.part_number,source_url=EXCLUDED.source_url,
         source_title=EXCLUDED.source_title,facts=EXCLUDED.facts,verified_at=NOW(),updated_at=NOW()`,
      [key, brand, partNumber, sourceUrl, sourceTitle, JSON.stringify(facts)]
    );
    imported += 1;
  }

  await client.query("COMMIT");
  console.log(`Imported ${imported} verified datasheet record(s).`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
