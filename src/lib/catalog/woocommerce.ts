import type { CameraSpecs, CatalogProduct, ProductCategory, RecorderSpecs, StorageSpecs, SwitchSpecs, UpsSpecs } from "@/src/domain/catalog/types";
import { pool } from "@/src/lib/db";
import type { PoolClient } from "pg";
import { startCatalogImageWorker } from "@/src/lib/catalog/image-cache";
import { recorderSpecValues } from "@/src/lib/catalog/recorder-spec-values";

type WooProduct = {
  id: number; name: string; sku: string; price: string; regular_price: string;
  sale_price?: string; type?: string; status?: string; catalog_visibility?: string;
  stock_status: "instock" | "outofstock" | "onbackorder"; stock_quantity: number | null;
  permalink: string; description: string; short_description: string;
  categories: { id: number; name: string; slug: string }[];
  tags?: { id: number; name: string; slug: string }[];
  attributes: { id?: number; name: string; slug?: string; position?: number; visible?: boolean; variation?: boolean; options: string[] }[];
  images: { id?: number; src: string; name?: string; alt: string; position?: number }[];
  date_created_gmt?: string; date_modified_gmt?: string;
};

const stripHtml = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&times;/g, "×").replace(/\s+/g, " ").trim();
const asJson = (value: unknown) => JSON.stringify(value);
const numberFrom = (text: string, pattern: RegExp, fallback: number, warning: string, warnings: string[]) => {
  const match = text.match(pattern);
  if (!match) { warnings.push(warning); return fallback; }
  return Number(String(match[1]).replace(",", "."));
};
const includesAny = (text: string, terms: string[]) => terms.some((term) => text.includes(term.toLowerCase()));

function categoryFrom(product: WooProduct): ProductCategory | undefined {
  const text = `${product.name} ${product.categories.map((item) => `${item.name} ${item.slug}`).join(" ")}`.toLowerCase();
  if (includesAny(text, ["nvr", "dvr", "دستگاه ضبط", "recorder"])) return "recorder";
  if (includesAny(text, ["دوربین", "camera", "ipc", "turret", "bullet"])) return "camera";
  if (includesAny(text, ["switch", "سوئیچ", "poe switch"])) return "switch";
  if (includesAny(text, ["هارد", "hard drive", "purple", "skyhawk", "storage"])) return "storage";
  if (includesAny(text, ["ups", "یو پی اس", "برق اضطراری"])) return "ups";
  return undefined;
}

function resolutionSize(mp: number) {
  if (mp >= 8) return [3840, 2160];
  if (mp >= 6) return [3072, 2048];
  if (mp >= 5) return [2880, 1620];
  if (mp >= 4) return [2688, 1520];
  if (mp >= 3) return [2304, 1296];
  return [1920, 1080];
}

function productText(product: WooProduct) {
  return stripHtml(`${product.name} ${product.description} ${product.short_description} ${product.attributes.map((item) => `${item.name}: ${item.options.join(" ")}`).join(" ")}`).toLowerCase();
}

function productImages(product: WooProduct) {
  const images = [...product.images];
  const html = `${product.description || ""} ${product.short_description || ""}`;
  for (const match of html.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi)) {
    const src = match[1].replace(/&amp;/g, "&");
    if (/^https:\/\//i.test(src) && !images.some((image) => image.src === src)) images.push({ src, alt: product.name });
  }
  return images;
}

function cameraSpecs(text: string, warnings: string[]): CameraSpecs {
  const resolutionMp = numberFrom(text, /(\d+(?:[.,]\d+)?)\s*(?:mp|مگا ?پیکسل)/i, 2, "رزولوشن از متن استخراج نشد؛ 2MP تخمینی ثبت شد.", warnings);
  const [resolutionWidth, resolutionHeight] = resolutionSize(resolutionMp);
  const focal = numberFrom(text, /(\d+(?:[.,]\d+)?)\s*mm/i, 2.8, "فاصله کانونی استخراج نشد؛ 2.8mm تخمینی است.", warnings);
  const irRangeM = numberFrom(text, /(?:ir|دید در شب)[^\d]{0,20}(\d+(?:[.,]\d+)?)\s*(?:m|متر)/i, 30, "برد IR تخمینی است.", warnings);
  const maxPowerW = numberFrom(text, /(\d+(?:[.,]\d+)?)\s*w(?:att)?/i, 10, "توان دوربین تخمینی است.", warnings);
  
  const hasIpRating = /ip6[5-9]/i.test(text);
  const ipRating = hasIpRating ? (text.match(/ip6[5-9]/i)?.[0].toUpperCase() ?? "IP66") : "IP66";
  if (!hasIpRating) {
    warnings.push("درجه حفاظت بدنه (IP66) تخمینی است.");
  }
  
  const aiFeatures = ["تشخیص چهره", "پلاک‌خوانی", "تشخیص انسان", "تشخیص خودرو", "عبور از خط", "دید رنگی شب"].filter((feature) => text.includes(feature));
  if (resolutionMp >= 2 && !aiFeatures.includes("تشخیص چهره")) {
    aiFeatures.push("تشخیص چهره");
    warnings.push("قابلیت تشخیص چهره بر اساس رزولوشن تخمین زده شد.");
  }
  if (resolutionMp >= 4 && !aiFeatures.includes("پلاک‌خوانی")) {
    aiFeatures.push("پلاک‌خوانی");
    warnings.push("قابلیت پلاک‌خوانی بر اساس رزولوشن تخمین زده شد.");
  }
  if (resolutionMp >= 2 && !aiFeatures.includes("دید رنگی شب") && (text.includes("color") || text.includes("رنگی"))) {
    aiFeatures.push("دید رنگی شب");
    warnings.push("قابلیت دید رنگی شب بر اساس توضیحات تخمین زده شد.");
  }

  const vfMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:-|to|~|تا)\s*(\d+(?:\.\d+)?)\s*mm/i);
  let focalMinMm = focal;
  let focalMaxMm = focal;
  if (vfMatch) {
    focalMinMm = Number(vfMatch[1]);
    focalMaxMm = Number(vfMatch[2]);
  } else if (text.includes("ptz") || text.includes("اسپیددام") || text.includes("چرخشی") || text.includes("varifocal") || text.includes("وریفوکال") || text.includes("vf")) {
    focalMinMm = 2.8;
    focalMaxMm = 12;
    warnings.push("لنز متغیر (وریفوکال 2.8-12mm) تخمینی است.");
  } else if (resolutionMp >= 4 && (text.includes("bullet") || text.includes("بولت") || text.includes("بیرونی") || text.includes("outdoor"))) {
    focalMinMm = 2.8;
    focalMaxMm = 12;
    warnings.push("لنز متغیر (وریفوکال 2.8-12mm) تخمینی است.");
  }

  const codecs = ["H.265+", "H.265", "H.264"].filter((codec) => text.includes(codec.toLowerCase()));
  const sensorWidth = resolutionMp >= 8 ? 7.2 : 5.37;
  const hfovMax = 2 * Math.atan(sensorWidth / (2 * focalMinMm)) * 180 / Math.PI;
  const hfovMin = 2 * Math.atan(sensorWidth / (2 * focalMaxMm)) * 180 / Math.PI;

  const sdCardMatch = text.match(/(?:sd|micro ?sd|card|کارت حافظه)[^\d]{0,20}(\d+)\s*(?:gb|گیگابایت)/i);
  let localStorageGb = sdCardMatch ? Number(sdCardMatch[1]) : undefined;
  if (localStorageGb === undefined) {
    localStorageGb = 128;
    warnings.push("پشتیبانی کارت حافظه تخمینی است (128GB).");
  }

  let poe = /poe/i.test(text);
  if (!poe) {
    poe = true;
    warnings.push("پشتیبانی از PoE تخمینی است (پیش‌فرض فعال).");
  }

  const microphone = /میکروفون|microphone|mic built|صدا/i.test(text);

  return {
    technology: "IP", cameraType: text.includes("ptz") ? "ptz" : text.includes("dome") || text.includes("دام") ? "dome" : text.includes("turret") ? "turret" : "bullet",
    resolutionMp, resolutionWidth, resolutionHeight, sensorFormat: resolutionMp >= 8 ? "1/1.8\"" : "1/2.8\"",
    focalMinMm, focalMaxMm, horizontalFovMin: hfovMin, horizontalFovMax: hfovMax,
    maxFps: numberFrom(text, /(\d+)\s*fps/i, 25, "FPS تخمینی است.", warnings), codecs: codecs.length ? codecs : ["H.265", "H.264"],
    recommendedBitrateKbps: Math.round(resolutionMp * 850), irRangeM,
    doriDetectM: resolutionMp * 18, doriObserveM: resolutionMp * 7, doriRecognizeM: resolutionMp * 3.5, doriIdentifyM: resolutionMp * 1.8,
    microphone, speaker: /بلندگو|speaker/i.test(text), poe, maxPowerW, ipRating, aiFeatures, localStorageGb
  };
}

function recorderSpecs(text: string, warnings: string[]): RecorderSpecs {
  const channels = numberFrom(text, /(\d+)\s*(?:channel|کانال)/i, 8, "تعداد کانال تخمینی است.", warnings);
  const incomingBandwidthMbps = numberFrom(text, /(\d+)\s*mbps/i, channels * 10, "پهنای‌باند تخمینی است.", warnings);
  const driveBays = numberFrom(text, /(\d+)\s*(?:hdd|sata|bay|هارد)/i, channels > 16 ? 4 : channels > 8 ? 2 : 1, "تعداد Bay تخمینی است.", warnings);
  let raidLevels = ["RAID 0", "RAID 1", "RAID 5", "RAID 6", "RAID 10"].filter((level) => text.includes(level.toLowerCase()));
  if (!raidLevels.length && driveBays >= 2) {
    raidLevels = driveBays >= 6 ? ["RAID 0", "RAID 1", "RAID 5", "RAID 6", "RAID 10"] : driveBays >= 4 ? ["RAID 0", "RAID 1", "RAID 5", "RAID 10"] : ["RAID 0", "RAID 1"];
    warnings.push("سطوح RAID پشتیبانی‌شده تخمینی است (بر اساس تعداد Bay).");
  }
  return { technology: text.includes("dvr") ? "DVR" : "NVR", channels, incomingBandwidthMbps, outgoingBandwidthMbps: incomingBandwidthMbps * 0.5, maxDecodeMp: 8, decodeCapacityMp: Math.max(32, channels * 4), maxSimultaneousDecodeChannels: Math.min(channels, 24), driveBays, maxDriveCapacityTb: 18, raidLevels, builtInPoePorts: /poe/i.test(text) ? channels : 0, codecs: ["H.265+", "H.265", "H.264"], maxCameraResolutionMp: 12, basePowerW: 12 + channels * .55, drivePowerPerBayW: 9 };
}

function switchSpecs(text: string, warnings: string[]): SwitchSpecs {
  const poePorts = numberFrom(text, /(\d+)\s*(?:port|پورت)/i, 8, "تعداد پورت تخمینی است.", warnings);
  const poeBudgetW = numberFrom(text, /(\d+(?:[.,]\d+)?)\s*w/i, poePorts * 15, "بودجه PoE تخمینی است.", warnings);
  return { poePorts, totalPorts: poePorts + 2, poeBudgetW, maxPowerPerPortW: /bt|90w/i.test(text) ? 90 : /at|30w/i.test(text) ? 30 : 15.4, uplinkGbps: /10g/i.test(text) ? 10 : 1, extendRangeM: 100, managed: /managed|مدیریتی/i.test(text), surgeProtection: /surge|صاعقه/i.test(text), systemPowerW: 6 + poePorts * .65, poeEfficiency: .9 };
}

function storageSpecs(text: string, warnings: string[]): StorageSpecs {
  const capacityTb = numberFrom(text, /(\d+(?:[.,]\d+)?)\s*tb/i, 4, "ظرفیت هارد تخمینی است.", warnings);
  return { capacityTb, workloadTbPerYear: /pro/i.test(text) ? 550 : 180, surveillanceOptimized: /purple|skyhawk|surveillance|نظارتی/i.test(text), warrantyMonths: 24, activePowerW: capacityTb >= 12 ? 9.5 : 7.5 };
}

function upsSpecs(text: string, warnings: string[]): UpsSpecs {
  const capacityVa = numberFrom(text, /(\d+(?:[.,]\d+)?)\s*(?:k?va)/i, 1000, "ظرفیت VA تخمینی است.", warnings) * (/kva/i.test(text) ? 1000 : 1);
  const outputPowerW = numberFrom(text, /(\d+(?:[.,]\d+)?)\s*w/i, capacityVa * .7, "توان خروجی UPS تخمینی است.", warnings);
  return { capacityVa, outputPowerW, backupMinutesAtHalfLoad: 15 };
}

export function normalizeWooProduct(product: WooProduct): { product?: CatalogProduct; warnings: string[] } {
  const warnings: string[] = [];
  const category = categoryFrom(product);
  if (!category) return { warnings: ["دسته محصول قابل نگاشت نیست."] };
  const text = productText(product);
  const specs = category === "camera" ? cameraSpecs(text, warnings) : category === "recorder" ? recorderSpecs(text, warnings) : category === "switch" ? switchSpecs(text, warnings) : category === "storage" ? storageSpecs(text, warnings) : upsSpecs(text, warnings);
  const divisor = Math.max(1, Number(process.env.WOOCOMMERCE_PRICE_DIVISOR || 1));
  const price = Math.round(Number(product.price || product.regular_price || 0) / divisor);
  if (!product.sku) warnings.push("SKU خالی است؛ شناسه WooCommerce جایگزین شد.");
  if (!price) warnings.push("قیمت معتبر دریافت نشد.");
  return {
    warnings,
    product: {
      id: `woo-${product.id}`, wooId: product.id, sku: product.sku || `WOO-${product.id}`, name: product.name,
      brand: product.attributes.find((item) => /brand|برند/i.test(item.name))?.options[0] || product.categories.at(-1)?.name || "بدون برند",
      category, price, stockStatus: product.stock_status === "outofstock" ? "out_of_stock" : product.stock_status === "onbackorder" ? "low_stock" : "in_stock",
      stockQuantity: product.stock_quantity ?? (product.stock_status === "instock" ? 1 : 0), warrantyMonths: 0,
      sourceUrl: product.permalink, source: "woocommerce", images: productImages(product).map((image) => ({ url: image.src, alt: image.alt || product.name, source: "ddcpersia" as const })), specs,
      dataQuality: {
        status: "estimated",
        warnings: [...warnings, "مشخصات نرمال‌شده تا زمان تطبیق با دیتاشیت سازنده تأییدشده محسوب نمی‌شوند."]
      }
    }
  };
}

type SyncLogLevel = "info" | "success" | "warning" | "error";
type SyncResult = ReturnType<typeof buildSyncResult>;

function buildSyncResult(dryRun: boolean, sourceProducts: WooProduct[], products: CatalogProduct[], warnings: { wooId: number; name: string; warning: string }[]) {
  const categoryCounts = Object.fromEntries(["camera", "recorder", "switch", "storage", "ups"].map((category) => [category, products.filter((product) => product.category === category).length]));
  return { dryRun, sourceReadOnly: true, received: sourceProducts.length, storedSourceProducts: dryRun ? 0 : sourceProducts.length, normalized: products.length, skipped: sourceProducts.length - products.length, categoryCounts, warnings };
}

let syncRunSchemaInitialized = false;
async function ensureSyncRunSchema() {
  if (syncRunSchemaInitialized) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS catalog_sync_runs (
    id BIGSERIAL PRIMARY KEY, source TEXT NOT NULL, status TEXT NOT NULL,
    products_received INTEGER NOT NULL DEFAULT 0, products_normalized INTEGER NOT NULL DEFAULT 0,
    warnings JSONB NOT NULL DEFAULT '[]'::jsonb, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ
  )`);
  await pool.query("ALTER TABLE catalog_sync_runs ADD COLUMN IF NOT EXISTS dry_run BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE catalog_sync_runs ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'queued'");
  await pool.query("ALTER TABLE catalog_sync_runs ADD COLUMN IF NOT EXISTS progress_percent INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE catalog_sync_runs ADD COLUMN IF NOT EXISTS progress_current INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE catalog_sync_runs ADD COLUMN IF NOT EXISTS progress_total INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE catalog_sync_runs ADD COLUMN IF NOT EXISTS logs JSONB NOT NULL DEFAULT '[]'::jsonb");
  await pool.query("ALTER TABLE catalog_sync_runs ADD COLUMN IF NOT EXISTS result JSONB");
  await pool.query("ALTER TABLE catalog_sync_runs ADD COLUMN IF NOT EXISTS error TEXT");
  await pool.query("ALTER TABLE catalog_sync_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await pool.query("UPDATE catalog_sync_runs SET status='failed',stage='failed',error='فرایند سرور پیش از تکمیل عملیات متوقف شده است.',finished_at=NOW(),updated_at=NOW() WHERE source='woocommerce' AND status IN ('queued','running') AND updated_at < NOW() - INTERVAL '30 minutes'");
  syncRunSchemaInitialized = true;
}

async function appendSyncLog(runId: number, level: SyncLogLevel, message: string, client?: PoolClient) {
  const entry = [{ at: new Date().toISOString(), level, message }];
  const executor = client || pool;
  await executor.query("UPDATE catalog_sync_runs SET logs=logs || $1::jsonb,updated_at=NOW() WHERE id=$2", [asJson(entry), runId]);
}

async function updateSyncProgress(runId: number, stage: string, percent: number, current = 0, total = 0, client?: PoolClient) {
  const executor = client || pool;
  await executor.query("UPDATE catalog_sync_runs SET status='running',stage=$1,progress_percent=$2,progress_current=$3,progress_total=$4,updated_at=NOW() WHERE id=$5",
    [stage, Math.max(0, Math.min(100, Math.round(percent))), current, total, runId]);
}

async function batchInsert<T>(
  client: PoolClient,
  table: string,
  columns: string[],
  records: T[],
  toValues: (record: T, index: number) => unknown[],
  onConflictSql?: string
) {
  if (records.length === 0) return;
  const colNames = columns.join(", ");
  const colCount = columns.length;
  const maxParams = 60000;
  const chunkSize = Math.floor(maxParams / colCount);
  
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const valuePlaceholders: string[] = [];
    const params: unknown[] = [];
    
    chunk.forEach((record, recordIdx) => {
      const placeholders = [];
      const vals = toValues(record, i + recordIdx);
      for (let c = 0; c < colCount; c++) {
        params.push(vals[c]);
        placeholders.push(`$${params.length}`);
      }
      valuePlaceholders.push(`(${placeholders.join(",")})`);
    });
    
    const query = `INSERT INTO ${table} (${colNames}) VALUES ${valuePlaceholders.join(", ")} ${onConflictSql || ""}`;
    await client.query(query, params);
  }
}

async function fetchWooProducts(runId: number) {
  const baseUrl = process.env.WOOCOMMERCE_URL?.replace(/\/$/, "");
  const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!baseUrl || !key || !secret) throw new Error("WOOCOMMERCE_URL و Consumer Key/Secret تنظیم نشده‌اند.");
  const sourceUrl = new URL(baseUrl);
  if (sourceUrl.protocol !== "https:") throw new Error("برای محافظت از کلید خواندنی، WOOCOMMERCE_URL باید HTTPS باشد.");
  const authorization = `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
  const products: WooProduct[] = [];
  let totalPages = 1;
  let totalProducts = 0;
  await updateSyncProgress(runId, "connecting", 2);
  await appendSyncLog(runId, "info", "در حال برقراری اتصال فقط‌خواندنی با WooCommerce...");
  
  // Fetch page 1 first to determine totalPages
  const firstResponse = await fetch(`${baseUrl}/wp-json/wc/v3/products?status=publish&per_page=100&page=1`, { method: "GET", headers: { Authorization: authorization }, cache: "no-store" });
  if (!firstResponse.ok) throw new Error(`WooCommerce API ${firstResponse.status}: ${await firstResponse.text()}`);
  const firstPageProducts = await firstResponse.json() as WooProduct[];
  products.push(...firstPageProducts);
  
  totalPages = Number(firstResponse.headers.get("x-wp-totalpages") || 1);
  totalProducts = Number(firstResponse.headers.get("x-wp-total") || products.length);
  
  await updateSyncProgress(runId, "fetching", 5 + (1 / totalPages) * 27, products.length, totalProducts);
  await appendSyncLog(runId, "info", `صفحه 1 از ${totalPages} دریافت شد؛ ${products.length} محصول خوانده شده است.`);
  
  if (totalPages > 1) {
    for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
      // Respect rate limits by adding a 1-second delay between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
      const response = await fetch(`${baseUrl}/wp-json/wc/v3/products?status=publish&per_page=100&page=${pageNum}`, { method: "GET", headers: { Authorization: authorization }, cache: "no-store" });
      if (!response.ok) throw new Error(`WooCommerce API ${response.status}: ${await response.text()}`);
      const pageProducts = await response.json() as WooProduct[];
      products.push(...pageProducts);
      await updateSyncProgress(runId, "fetching", 5 + (pageNum / totalPages) * 27, products.length, totalProducts);
      await appendSyncLog(runId, "info", `صفحه ${pageNum} از ${totalPages} دریافت شد؛ ${products.length} محصول خوانده شده است.`);
    }
  }
  
  await appendSyncLog(runId, "success", `دریافت ${products.length} محصول منتشرشده از سایت کامل شد.`);
  return products;
}

let wooCatalogSchemaInitialized = false;
async function ensureWooCatalogSchema(client: PoolClient) {
  if (wooCatalogSchemaInitialized) return;
  await client.query(`CREATE TABLE IF NOT EXISTS catalog_sync_runs (
    id BIGSERIAL PRIMARY KEY, source TEXT NOT NULL, status TEXT NOT NULL,
    products_received INTEGER NOT NULL DEFAULT 0, products_normalized INTEGER NOT NULL DEFAULT 0,
    warnings JSONB NOT NULL DEFAULT '[]'::jsonb, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS woocommerce_product_snapshots (
    woo_id BIGINT PRIMARY KEY,
    sku TEXT,
    name TEXT NOT NULL,
    product_type TEXT,
    status TEXT,
    catalog_visibility TEXT,
    price TEXT,
    regular_price TEXT,
    sale_price TEXT,
    stock_status TEXT,
    stock_quantity INTEGER,
    permalink TEXT,
    source_created_at TIMESTAMPTZ,
    source_modified_at TIMESTAMPTZ,
    source_payload JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_run_id BIGINT REFERENCES catalog_sync_runs(id)
  )`);
  await client.query("CREATE INDEX IF NOT EXISTS woo_product_snapshots_active_idx ON woocommerce_product_snapshots (is_active, stock_status)");
  await client.query("CREATE INDEX IF NOT EXISTS woo_product_snapshots_modified_idx ON woocommerce_product_snapshots (source_modified_at DESC)");
  await client.query(`CREATE TABLE IF NOT EXISTS woocommerce_product_attributes (
    woo_id BIGINT NOT NULL REFERENCES woocommerce_product_snapshots(woo_id) ON DELETE CASCADE,
    attribute_key TEXT NOT NULL,
    woo_attribute_id BIGINT,
    name TEXT NOT NULL,
    slug TEXT,
    position INTEGER,
    visible BOOLEAN,
    variation BOOLEAN,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    PRIMARY KEY (woo_id, attribute_key)
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS woocommerce_product_images (
    woo_id BIGINT NOT NULL REFERENCES woocommerce_product_snapshots(woo_id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    woo_image_id BIGINT,
    src TEXT NOT NULL,
    name TEXT,
    alt TEXT,
    PRIMARY KEY (woo_id, position)
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS woocommerce_product_categories (
    woo_id BIGINT NOT NULL REFERENCES woocommerce_product_snapshots(woo_id) ON DELETE CASCADE,
    woo_category_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    PRIMARY KEY (woo_id, woo_category_id)
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS woocommerce_product_tags (
    woo_id BIGINT NOT NULL REFERENCES woocommerce_product_snapshots(woo_id) ON DELETE CASCADE,
    woo_tag_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    PRIMARY KEY (woo_id, woo_tag_id)
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS catalog_image_jobs (
    id BIGSERIAL PRIMARY KEY,
    woo_id BIGINT NOT NULL REFERENCES woocommerce_product_snapshots(woo_id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    source_url TEXT NOT NULL,
    local_filename TEXT,
    public_path TEXT,
    content_type TEXT,
    byte_size BIGINT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','downloading','completed','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (woo_id,position)
  )`);
  await client.query("CREATE INDEX IF NOT EXISTS catalog_image_jobs_status_idx ON catalog_image_jobs (status,next_attempt_at)");
  await client.query("ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS normalization_status TEXT NOT NULL DEFAULT 'estimated'");
  await client.query("ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS normalization_warnings JSONB NOT NULL DEFAULT '[]'::jsonb");
  await client.query("ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS source_modified_at TIMESTAMPTZ");
  await client.query("ALTER TABLE recorder_specs ADD COLUMN IF NOT EXISTS outgoing_bandwidth_mbps NUMERIC(8,2)");
  await client.query("ALTER TABLE recorder_specs ADD COLUMN IF NOT EXISTS decode_capacity_mp NUMERIC(8,2)");
  await client.query("ALTER TABLE recorder_specs ADD COLUMN IF NOT EXISTS max_simultaneous_decode_channels INTEGER");
  await client.query("ALTER TABLE recorder_specs ADD COLUMN IF NOT EXISTS base_power_w NUMERIC(8,2)");
  await client.query("ALTER TABLE recorder_specs ADD COLUMN IF NOT EXISTS drive_power_per_bay_w NUMERIC(8,2)");
  await client.query("ALTER TABLE switch_specs ADD COLUMN IF NOT EXISTS system_power_w NUMERIC(8,2)");
  await client.query("ALTER TABLE switch_specs ADD COLUMN IF NOT EXISTS poe_efficiency NUMERIC(5,3)");
  await client.query("ALTER TABLE storage_specs ADD COLUMN IF NOT EXISTS active_power_w NUMERIC(8,2)");
  wooCatalogSchemaInitialized = true;
}

async function executeWooCatalogSync(runId: number, dryRun: boolean) {
  try {
    const sourceProducts = await fetchWooProducts(runId);
    await updateSyncProgress(runId, "normalizing", 35, 0, sourceProducts.length);
    await appendSyncLog(runId, "info", "تحلیل دسته‌بندی‌ها، ویژگی‌های فنی، قیمت و موجودی آغاز شد.");
    const normalized = sourceProducts.map(normalizeWooProduct);
    const products = normalized.flatMap((item) => item.product ? [item.product] : []);
    const warnings = normalized.flatMap((item, index) => item.warnings.map((warning) => ({ wooId: sourceProducts[index].id, name: sourceProducts[index].name, warning })));
    const result = buildSyncResult(dryRun, sourceProducts, products, warnings);
    await pool.query("UPDATE catalog_sync_runs SET products_received=$1,products_normalized=$2,warnings=$3,updated_at=NOW() WHERE id=$4", [sourceProducts.length, products.length, asJson(warnings), runId]);
    await updateSyncProgress(runId, "normalizing", dryRun ? 92 : 40, sourceProducts.length, sourceProducts.length);
    await appendSyncLog(runId, warnings.length ? "warning" : "success", `${products.length} محصول قابل استانداردسازی و ${sourceProducts.length - products.length} محصول نیازمند نگاشت شناسایی شد؛ ${warnings.length} هشدار کیفیت ثبت شد.`);
    if (dryRun) {
      await appendSyncLog(runId, "success", "بررسی آزمایشی پایان یافت؛ هیچ داده‌ای در کاتالوگ محلی یا سایت تغییر نکرد.");
      await pool.query("UPDATE catalog_sync_runs SET status='success',stage='completed',progress_percent=100,result=$1,finished_at=NOW(),updated_at=NOW() WHERE id=$2", [asJson(result), runId]);
      return;
    }

    const client = await pool.connect();
    try {
      await updateSyncProgress(runId, "preparing", 42);
      await appendSyncLog(runId, "info", "در حال آماده‌سازی جداول و تراکنش دیتابیس داخلی اپ...");
      await client.query("BEGIN");
      await ensureWooCatalogSchema(client);
      await client.query("UPDATE woocommerce_product_snapshots SET is_active=FALSE");
      await client.query("UPDATE catalog_products SET stock_status='out_of_stock',stock_quantity=0 WHERE source='woocommerce'");

      const wooIds = sourceProducts.map(p => p.id);
      if (wooIds.length > 0) {
        await client.query("DELETE FROM woocommerce_product_attributes WHERE woo_id = ANY($1::bigint[])", [wooIds]);
        await client.query("DELETE FROM woocommerce_product_images WHERE woo_id = ANY($1::bigint[])", [wooIds]);
        await client.query("DELETE FROM woocommerce_product_categories WHERE woo_id = ANY($1::bigint[])", [wooIds]);
        await client.query("DELETE FROM woocommerce_product_tags WHERE woo_id = ANY($1::bigint[])", [wooIds]);
        await client.query("DELETE FROM catalog_products WHERE woo_id = ANY($1::bigint[])", [wooIds]);
      }

      await appendSyncLog(runId, "success", "ساختار دیتابیس آماده شد؛ ثبت Snapshotهای خام آغاز شد.", client);
      const batchSize = 100;
      for (let i = 0; i < sourceProducts.length; i += batchSize) {
        const chunk = sourceProducts.slice(i, i + batchSize);
        
        const snapshotsData = [];
        const attributesData = [];
        const imagesData = [];
        const imageJobsData = [];
        const categoriesData = [];
        const tagsData = [];
        
        for (const product of chunk) {
          snapshotsData.push({
            woo_id: product.id, sku: product.sku || null, name: product.name, product_type: product.type || null, 
            status: product.status || "publish", catalog_visibility: product.catalog_visibility || null,
            price: product.price, regular_price: product.regular_price, sale_price: product.sale_price || null, 
            stock_status: product.stock_status, stock_quantity: product.stock_quantity, permalink: product.permalink,
            source_created_at: product.date_created_gmt || null, source_modified_at: product.date_modified_gmt || null, 
            source_payload: asJson(product), sync_run_id: runId
          });
          
          for (const [index, attribute] of product.attributes.entries()) {
            const key = attribute.slug || `${attribute.id || 0}-${attribute.name}-${index}`;
            attributesData.push({
              woo_id: product.id, attribute_key: key, woo_attribute_id: attribute.id || null, 
              name: attribute.name, slug: attribute.slug || null, position: attribute.position ?? index, 
              visible: attribute.visible ?? null, variation: attribute.variation ?? null, options: asJson(attribute.options)
            });
          }
          
          for (const [index, image] of productImages(product).entries()) {
            imagesData.push({
              woo_id: product.id, position: index, woo_image_id: image.id || null, 
              src: image.src, name: image.name || null, alt: image.alt || null
            });
            imageJobsData.push({
              woo_id: product.id, position: index, source_url: image.src
            });
          }
          
          for (const category of product.categories) {
            categoriesData.push({
              woo_id: product.id, woo_category_id: category.id, name: category.name, slug: category.slug
            });
          }
          
          for (const tag of product.tags || []) {
            tagsData.push({
              woo_id: product.id, woo_tag_id: tag.id, name: tag.name, slug: tag.slug
            });
          }
        }
        
        await batchInsert(
          client,
          "woocommerce_product_snapshots",
          ["woo_id", "sku", "name", "product_type", "status", "catalog_visibility", "price", "regular_price", "sale_price", "stock_status", "stock_quantity", "permalink", "source_created_at", "source_modified_at", "source_payload", "is_active", "sync_run_id"],
          snapshotsData,
          (r) => [r.woo_id, r.sku, r.name, r.product_type, r.status, r.catalog_visibility, r.price, r.regular_price, r.sale_price, r.stock_status, r.stock_quantity, r.permalink, r.source_created_at, r.source_modified_at, r.source_payload, true, r.sync_run_id],
          `ON CONFLICT (woo_id) DO UPDATE SET sku=EXCLUDED.sku,name=EXCLUDED.name,product_type=EXCLUDED.product_type,status=EXCLUDED.status,
            catalog_visibility=EXCLUDED.catalog_visibility,price=EXCLUDED.price,regular_price=EXCLUDED.regular_price,sale_price=EXCLUDED.sale_price,
            stock_status=EXCLUDED.stock_status,stock_quantity=EXCLUDED.stock_quantity,permalink=EXCLUDED.permalink,
            source_created_at=EXCLUDED.source_created_at,source_modified_at=EXCLUDED.source_modified_at,source_payload=EXCLUDED.source_payload,
            is_active=TRUE,last_seen_at=NOW(),sync_run_id=EXCLUDED.sync_run_id`
        );

        await batchInsert(
          client,
          "woocommerce_product_attributes",
          ["woo_id", "attribute_key", "woo_attribute_id", "name", "slug", "position", "visible", "variation", "options"],
          attributesData,
          (r) => [r.woo_id, r.attribute_key, r.woo_attribute_id, r.name, r.slug, r.position, r.visible, r.variation, r.options]
        );

        await batchInsert(
          client,
          "woocommerce_product_images",
          ["woo_id", "position", "woo_image_id", "src", "name", "alt"],
          imagesData,
          (r) => [r.woo_id, r.position, r.woo_image_id, r.src, r.name, r.alt]
        );

        await batchInsert(
          client,
          "catalog_image_jobs",
          ["woo_id", "position", "source_url"],
          imageJobsData,
          (r) => [r.woo_id, r.position, r.source_url],
          `ON CONFLICT (woo_id,position) DO UPDATE SET source_url=EXCLUDED.source_url,
            status=CASE WHEN catalog_image_jobs.source_url<>EXCLUDED.source_url THEN 'queued' ELSE catalog_image_jobs.status END,
            attempts=CASE WHEN catalog_image_jobs.source_url<>EXCLUDED.source_url THEN 0 ELSE catalog_image_jobs.attempts END,
            next_attempt_at=CASE WHEN catalog_image_jobs.source_url<>EXCLUDED.source_url THEN NOW() ELSE catalog_image_jobs.next_attempt_at END,
            updated_at=NOW()`
        );

        await batchInsert(
          client,
          "woocommerce_product_categories",
          ["woo_id", "woo_category_id", "name", "slug"],
          categoriesData,
          (r) => [r.woo_id, r.woo_category_id, r.name, r.slug]
        );

        await batchInsert(
          client,
          "woocommerce_product_tags",
          ["woo_id", "woo_tag_id", "name", "slug"],
          tagsData,
          (r) => [r.woo_id, r.woo_tag_id, r.name, r.slug]
        );

        const processedCount = Math.min(i + batchSize, sourceProducts.length);
        await updateSyncProgress(runId, "saving-snapshots", 44 + (processedCount / sourceProducts.length) * 34, processedCount, sourceProducts.length, client);
        await appendSyncLog(runId, "info", `${processedCount} از ${sourceProducts.length} Snapshot همراه ویژگی‌ها و تصاویر ثبت شد.`, client);
      }

      await appendSyncLog(runId, "success", "تمام Snapshotها ثبت شدند؛ استانداردسازی محصولات مهندسی آغاز شد.", client);

      const productIds = products.map(p => p.id);
      if (productIds.length > 0) {
        await Promise.all([
          client.query("DELETE FROM camera_specs WHERE product_id = ANY($1::text[])", [productIds]),
          client.query("DELETE FROM recorder_specs WHERE product_id = ANY($1::text[])", [productIds]),
          client.query("DELETE FROM switch_specs WHERE product_id = ANY($1::text[])", [productIds]),
          client.query("DELETE FROM storage_specs WHERE product_id = ANY($1::text[])", [productIds]),
          client.query("DELETE FROM ups_specs WHERE product_id = ANY($1::text[])", [productIds])
        ]);
      }

      const brandsResult = await client.query("SELECT id, name, slug FROM catalog_brands");
      const brandMapByName = new Map<string, number>();
      const brandMapBySlug = new Map<string, number>();
      for (const row of brandsResult.rows) {
        brandMapByName.set(row.name.toLowerCase(), Number(row.id));
        brandMapBySlug.set(row.slug, Number(row.id));
      }

      const brandMap = new Map<string, number>();
      const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const uniqueBrands = Array.from(new Set(products.map(p => p.brand)));

      for (const brandName of uniqueBrands) {
        const nameLower = brandName.toLowerCase();
        const slug = slugify(brandName) || `brand-${Math.random().toString(36).substring(2, 7)}`;
        
        if (brandMapByName.has(nameLower)) {
          brandMap.set(brandName, brandMapByName.get(nameLower)!);
          continue;
        }
        if (brandMapBySlug.has(slug)) {
          brandMap.set(brandName, brandMapBySlug.get(slug)!);
          brandMapByName.set(nameLower, brandMapBySlug.get(slug)!);
          continue;
        }

        const insertResult = await client.query(
          "INSERT INTO catalog_brands (name, slug) VALUES ($1, $2) RETURNING id",
          [brandName, slug]
        );
        const newId = Number(insertResult.rows[0].id);
        brandMap.set(brandName, newId);
        brandMapByName.set(nameLower, newId);
        brandMapBySlug.set(slug, newId);
      }

      for (let i = 0; i < products.length; i += batchSize) {
        const chunk = products.slice(i, i + batchSize);
        
        const catalogProductsData = [];
        const cameraSpecsData = [];
        const recorderSpecsData = [];
        const switchSpecsData = [];
        const storageSpecsData = [];
        const upsSpecsData = [];
        
        for (const product of chunk) {
          const brandId = brandMap.get(product.brand) || null;
          const sourceProduct = sourceProducts.find((item) => item.id === product.wooId);
          
          catalogProductsData.push({
            id: product.id, woo_id: product.wooId, sku: product.sku, name: product.name, 
            brand_id: brandId, category: product.category, price: product.price, 
            stock_status: product.stockStatus, stock_quantity: product.stockQuantity, 
            warranty_months: product.warrantyMonths, source_url: product.sourceUrl, 
            raw_payload: asJson(product), normalization_status: product.dataQuality?.status || "estimated", 
            normalization_warnings: asJson(product.dataQuality?.warnings || []), 
            source_modified_at: sourceProduct?.date_modified_gmt || null
          });

          const s = product.specs;
          if (product.category === "camera") {
            cameraSpecsData.push({ product_id: product.id, ...s as CameraSpecs });
          } else if (product.category === "recorder") {
            recorderSpecsData.push({ product_id: product.id, ...s as RecorderSpecs });
          } else if (product.category === "switch") {
            switchSpecsData.push({ product_id: product.id, ...s as SwitchSpecs });
          } else if (product.category === "storage") {
            storageSpecsData.push({ product_id: product.id, ...s as StorageSpecs });
          } else {
            upsSpecsData.push({ product_id: product.id, ...s as UpsSpecs });
          }
        }
        
        await batchInsert(
          client,
          "catalog_products",
          ["id", "woo_id", "sku", "name", "brand_id", "category", "price", "stock_status", "stock_quantity", "warranty_months", "source_url", "source", "raw_payload", "normalization_status", "normalization_warnings", "source_modified_at", "synced_at", "updated_at"],
          catalogProductsData,
          (r) => [r.id, r.woo_id, r.sku, r.name, r.brand_id, r.category, r.price, r.stock_status, r.stock_quantity, r.warranty_months, r.source_url, "woocommerce", r.raw_payload, r.normalization_status, r.normalization_warnings, r.source_modified_at, new Date(), new Date()],
          `ON CONFLICT (id) DO UPDATE SET sku=EXCLUDED.sku,name=EXCLUDED.name,brand_id=EXCLUDED.brand_id,category=EXCLUDED.category,
            price=EXCLUDED.price,stock_status=EXCLUDED.stock_status,stock_quantity=EXCLUDED.stock_quantity,source_url=EXCLUDED.source_url,
            source='woocommerce',raw_payload=EXCLUDED.raw_payload,normalization_status=EXCLUDED.normalization_status,
            normalization_warnings=EXCLUDED.normalization_warnings,source_modified_at=EXCLUDED.source_modified_at,synced_at=NOW(),updated_at=NOW()`
        );

        if (cameraSpecsData.length > 0) {
          await batchInsert(
            client,
            "camera_specs",
            ["product_id", "technology", "camera_type", "resolution_mp", "resolution_width", "resolution_height", "sensor_format", "focal_min_mm", "focal_max_mm", "horizontal_fov_min", "horizontal_fov_max", "max_fps", "codecs", "recommended_bitrate_kbps", "ir_range_m", "dori_detect_m", "dori_observe_m", "dori_recognize_m", "dori_identify_m", "microphone", "speaker", "poe", "max_power_w", "ip_rating", "ai_features", "local_storage_gb"],
            cameraSpecsData,
            (r) => [r.product_id, r.technology, r.cameraType, r.resolutionMp, r.resolutionWidth, r.resolutionHeight, r.sensorFormat, r.focalMinMm, r.focalMaxMm, r.horizontalFovMin, r.horizontalFovMax, r.maxFps, r.codecs, r.recommendedBitrateKbps, r.irRangeM, r.doriDetectM, r.doriObserveM, r.doriRecognizeM, r.doriIdentifyM, r.microphone, r.speaker, r.poe, r.maxPowerW, r.ipRating, r.aiFeatures, r.localStorageGb ?? null]
          );
        }
        
        if (recorderSpecsData.length > 0) {
          await batchInsert(
            client,
            "recorder_specs",
            ["product_id", "technology", "channels", "incoming_bandwidth_mbps", "max_decode_mp", "drive_bays", "max_drive_capacity_tb", "raid_levels", "built_in_poe_ports", "codecs", "max_camera_resolution_mp", "outgoing_bandwidth_mbps", "decode_capacity_mp", "max_simultaneous_decode_channels", "base_power_w", "drive_power_per_bay_w"],
            recorderSpecsData,
            recorderSpecValues
          );
        }

        if (switchSpecsData.length > 0) {
          await batchInsert(
            client,
            "switch_specs",
            ["product_id", "poe_ports", "total_ports", "poe_budget_w", "max_power_per_port_w", "uplink_gbps", "extend_range_m", "managed", "surge_protection", "system_power_w", "poe_efficiency"],
            switchSpecsData,
            (r) => [r.product_id, r.poePorts, r.totalPorts, r.poeBudgetW, r.maxPowerPerPortW, r.uplinkGbps, r.extendRangeM, r.managed, r.surgeProtection, r.systemPowerW ?? null, r.poeEfficiency ?? null]
          );
        }

        if (storageSpecsData.length > 0) {
          await batchInsert(
            client,
            "storage_specs",
            ["product_id", "capacity_tb", "workload_tb_per_year", "surveillance_optimized", "warranty_months", "active_power_w"],
            storageSpecsData,
            (r) => [r.product_id, r.capacityTb, r.workloadTbPerYear, r.surveillanceOptimized, r.warrantyMonths, r.activePowerW ?? null]
          );
        }

        if (upsSpecsData.length > 0) {
          await batchInsert(
            client,
            "ups_specs",
            ["product_id", "capacity_va", "output_power_w", "backup_minutes_at_half_load"],
            upsSpecsData,
            (r) => [r.product_id, r.capacityVa, r.outputPowerW, r.backupMinutesAtHalfLoad]
          );
        }

        const processedCount = Math.min(i + batchSize, products.length);
        await updateSyncProgress(runId, "saving-normalized", 78 + (processedCount / Math.max(1, products.length)) * 18, processedCount, products.length, client);
        await appendSyncLog(runId, "info", `${processedCount} از ${products.length} محصول استانداردشده ذخیره شد.`, client);
      }

      await updateSyncProgress(runId, "committing", 98, products.length, products.length, client);
      await appendSyncLog(runId, "info", "در حال نهایی‌سازی تراکنش و ثبت صف دریافت تصاویر...", client);
      await client.query("COMMIT");
      startCatalogImageWorker();
      await appendSyncLog(runId, "success", "دریافت محصولات کامل شد؛ Worker تصاویر در پس‌زمینه فعال است.");
      await pool.query("UPDATE catalog_sync_runs SET status='success',stage='completed',progress_percent=100,result=$1,error=NULL,finished_at=NOW(),updated_at=NOW() WHERE id=$2", [asJson(result), runId]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } catch (error) {
    const message = error instanceof Error ? error.message : "خطای نامشخص دریافت کاتالوگ";
    await pool.query("UPDATE catalog_sync_runs SET status='failed',stage='failed',error=$1,finished_at=NOW(),updated_at=NOW() WHERE id=$2", [message.slice(0, 1000), runId]).catch(() => undefined);
    await appendSyncLog(runId, "error", `عملیات متوقف شد: ${message}`).catch(() => undefined);
  }
}

export async function startWooCatalogSync(dryRun: boolean) {
  await ensureSyncRunSchema();
  const active = await pool.query("SELECT id FROM catalog_sync_runs WHERE source='woocommerce' AND status IN ('queued','running') ORDER BY id DESC LIMIT 1");
  if (active.rows[0]) return { accepted: true, alreadyRunning: true, runId: Number(active.rows[0].id) };
  const created = await pool.query("INSERT INTO catalog_sync_runs (source,status,dry_run,stage,logs) VALUES ('woocommerce','queued',$1,'queued',$2) RETURNING id", [dryRun, asJson([{ at: new Date().toISOString(), level: "info", message: dryRun ? "بررسی آزمایشی در صف اجرا قرار گرفت." : "دریافت محصولات در صف اجرا قرار گرفت." }])]);
  const runId = Number(created.rows[0].id);
  void executeWooCatalogSync(runId, dryRun);
  return { accepted: true, alreadyRunning: false, runId };
}

export async function getWooCatalogSyncRun(runId?: number) {
  await ensureSyncRunSchema();
  const result = runId
    ? await pool.query("SELECT * FROM catalog_sync_runs WHERE id=$1 AND source='woocommerce'", [runId])
    : await pool.query("SELECT * FROM catalog_sync_runs WHERE source='woocommerce' ORDER BY id DESC LIMIT 1");
  const row = result.rows[0];
  if (!row) return null;
  const imageCache = { queued: 0, downloading: 0, completed: 0, failed: 0 };
  if (!row.dry_run) {
    try {
      const cacheRows = await pool.query("SELECT status,COUNT(*)::int AS count FROM catalog_image_jobs GROUP BY status");
      for (const cacheRow of cacheRows.rows) if (cacheRow.status in imageCache) imageCache[cacheRow.status as keyof typeof imageCache] = Number(cacheRow.count);
    } catch { /* Image jobs are created during the first full import. */ }
  }
  return {
    id: Number(row.id), dryRun: Boolean(row.dry_run), status: row.status, stage: row.stage,
    progressPercent: Number(row.progress_percent || 0), progressCurrent: Number(row.progress_current || 0), progressTotal: Number(row.progress_total || 0),
    logs: row.logs || [], result: row.result as SyncResult | null, error: row.error || null, imageCache,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null
  };
}
