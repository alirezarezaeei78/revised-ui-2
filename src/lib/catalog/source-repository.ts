import type { CatalogProduct, SourceCatalogPage, SourceCatalogProduct, StockStatus } from "@/src/domain/catalog/types";
import { query } from "@/src/lib/db";
import { getCatalogSnapshot } from "@/src/lib/catalog/repository";
import { getVerifiedDatasheets, partNumberKey } from "@/src/lib/catalog/datasheet-repository";

type SourceCatalogFilters = {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  brand?: string;
  inStockOnly?: boolean;
};

const brandSql = `COALESCE(brand.name,
  (SELECT attribute.options->>0 FROM woocommerce_product_attributes attribute
   WHERE attribute.woo_id=source.woo_id AND attribute.name ~* '(brand|برند)' LIMIT 1),
  'بدون برند')`;

function stockStatus(value: string): StockStatus {
  if (value === "outofstock" || value === "out_of_stock") return "out_of_stock";
  if (value === "onbackorder" || value === "low_stock") return "low_stock";
  return "in_stock";
}

function fallbackProduct(product: CatalogProduct): SourceCatalogProduct {
  return {
    id: product.id, wooId: product.wooId, sku: product.sku, name: product.name, brand: product.brand,
    category: product.category, wooCategories: [], price: product.price, stockStatus: product.stockStatus,
    stockQuantity: product.stockQuantity, sourceUrl: product.sourceUrl,
    source: product.source,
    images: (product.images || []).map((image) => ({ url: image.url, originalUrl: image.url, alt: image.alt, cached: false })),
    attributes: [], specs: product.specs,
    normalizationStatus: product.dataQuality?.status === "verified" ? "verified" : "estimated",
    normalizationWarnings: product.dataQuality?.warnings || []
  };
}

export async function getSourceCatalogPage(filters: SourceCatalogFilters = {}): Promise<SourceCatalogPage> {
  const page = Math.max(1, Math.floor(filters.page || 1));
  const limit = Math.min(48, Math.max(1, Math.floor(filters.limit || 24)));
  try {
    const values: unknown[] = [];
    const conditions = ["source.is_active=TRUE"];
    if (filters.search?.trim()) {
      values.push(`%${filters.search.trim().slice(0, 100)}%`);
      conditions.push(`(source.name ILIKE $${values.length} OR source.sku ILIKE $${values.length} OR source.woo_id::text ILIKE $${values.length})`);
    }
    if (filters.category && filters.category !== "all") {
      if (filters.category === "other") conditions.push("normalized.id IS NULL");
      else { values.push(filters.category); conditions.push(`normalized.category=$${values.length}`); }
    }
    if (filters.brand && filters.brand !== "all") { values.push(filters.brand); conditions.push(`${brandSql}=$${values.length}`); }
    if (filters.inStockOnly) conditions.push("source.stock_status<>'outofstock'");
    const where = conditions.join(" AND ");
    const countResult = await query(`SELECT COUNT(*)::int AS total FROM woocommerce_product_snapshots source
      LEFT JOIN catalog_products normalized ON normalized.woo_id=source.woo_id AND normalized.source='woocommerce'
      LEFT JOIN catalog_brands brand ON brand.id=normalized.brand_id WHERE ${where}`, values);
    const rowValues = [...values, limit, (page - 1) * limit];
    const rows = await query(`SELECT source.woo_id,source.sku,source.name,source.price,source.stock_status,source.stock_quantity,
        source.permalink,source.source_modified_at,${brandSql} AS brand,
        COALESCE(normalized.category,'other') AS category,normalized.price AS normalized_price,
        normalized.normalization_status,normalized.normalization_warnings,normalized.raw_payload->'specs' AS normalized_specs,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('name',attribute.name,'slug',attribute.slug,'options',attribute.options) ORDER BY attribute.position)
          FROM woocommerce_product_attributes attribute WHERE attribute.woo_id=source.woo_id),'[]'::jsonb) AS attributes,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('url',COALESCE(job.public_path,image.src),'originalUrl',image.src,'alt',image.alt,'cached',(job.status='completed')) ORDER BY image.position)
          FROM woocommerce_product_images image LEFT JOIN catalog_image_jobs job ON job.woo_id=image.woo_id AND job.position=image.position
          WHERE image.woo_id=source.woo_id),'[]'::jsonb) AS images,
        COALESCE((SELECT jsonb_agg(category.name ORDER BY category.name) FROM woocommerce_product_categories category WHERE category.woo_id=source.woo_id),'[]'::jsonb) AS woo_categories
      FROM woocommerce_product_snapshots source
      LEFT JOIN catalog_products normalized ON normalized.woo_id=source.woo_id AND normalized.source='woocommerce'
      LEFT JOIN catalog_brands brand ON brand.id=normalized.brand_id
      WHERE ${where} ORDER BY source.source_modified_at DESC NULLS LAST,source.name
      LIMIT $${rowValues.length - 1} OFFSET $${rowValues.length}`, rowValues);
    const [brandRows, categoryRows, cacheRows] = await Promise.all([
      query(`SELECT DISTINCT ${brandSql} AS brand FROM woocommerce_product_snapshots source
        LEFT JOIN catalog_products normalized ON normalized.woo_id=source.woo_id AND normalized.source='woocommerce'
        LEFT JOIN catalog_brands brand ON brand.id=normalized.brand_id WHERE source.is_active=TRUE ORDER BY brand`),
      query(`SELECT COALESCE(normalized.category,'other') AS category,COUNT(*)::int AS count FROM woocommerce_product_snapshots source
        LEFT JOIN catalog_products normalized ON normalized.woo_id=source.woo_id AND normalized.source='woocommerce'
        WHERE source.is_active=TRUE GROUP BY COALESCE(normalized.category,'other')`),
      query("SELECT status,COUNT(*)::int AS count FROM catalog_image_jobs GROUP BY status")
    ]);
    const divisor = Math.max(1, Number(process.env.WOOCOMMERCE_PRICE_DIVISOR || 1));
    const products: SourceCatalogProduct[] = rows.rows.map((row) => ({
      id: `woo-${row.woo_id}`, wooId: Number(row.woo_id), sku: row.sku || `WOO-${row.woo_id}`, name: row.name,
      brand: row.brand, category: row.category, wooCategories: row.woo_categories || [],
      price: row.normalized_price === null ? Math.round(Number(row.price || 0) / divisor) : Number(row.normalized_price),
      stockStatus: stockStatus(row.stock_status), stockQuantity: Number(row.stock_quantity || 0), sourceUrl: row.permalink,
      source: "woocommerce",
      sourceModifiedAt: row.source_modified_at ? new Date(row.source_modified_at).toISOString() : undefined,
      images: row.images || [], attributes: row.attributes || [], specs: row.normalized_specs || undefined,
      normalizationStatus: row.normalization_status || "unmapped", normalizationWarnings: row.normalization_warnings || []
    }));
    const datasheets = await getVerifiedDatasheets(products.map((product) => product.sku));
    const groundedProducts = products.map((product) => ({
      ...product,
      datasheet: datasheets.get(partNumberKey(product.sku))
    }));
    const total = Number(countResult.rows[0]?.total || 0);
    const imageCache = { queued: 0, downloading: 0, completed: 0, failed: 0 };
    for (const row of cacheRows.rows) if (row.status in imageCache) imageCache[row.status as keyof typeof imageCache] = Number(row.count);
    return {
      products: groundedProducts, page, limit, total, totalPages: Math.ceil(total / limit),
      facets: { brands: brandRows.rows.map((row) => String(row.brand)), categoryCounts: Object.fromEntries(categoryRows.rows.map((row) => [row.category, Number(row.count)])) },
      imageCache
    };
  } catch {
    const snapshot = await getCatalogSnapshot();
    const filtered = snapshot.products.map(fallbackProduct).filter((product) =>
      (!filters.search || `${product.name} ${product.sku} ${product.brand}`.toLocaleLowerCase("fa").includes(filters.search.toLocaleLowerCase("fa"))) &&
      (!filters.category || filters.category === "all" || product.category === filters.category) &&
      (!filters.brand || filters.brand === "all" || product.brand === filters.brand) &&
      (!filters.inStockOnly || product.stockStatus !== "out_of_stock")
    );
    const start = (page - 1) * limit;
    return { products: filtered.slice(start, start + limit), page, limit, total: filtered.length, totalPages: Math.ceil(filtered.length / limit), facets: { brands: Array.from(new Set(filtered.map((item) => item.brand))).sort(), categoryCounts: {} }, imageCache: { queued: 0, downloading: 0, completed: 0, failed: 0 } };
  }
}
