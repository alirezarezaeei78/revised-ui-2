import { NextRequest, NextResponse } from "next/server";
import type { SourceCatalogProduct } from "@/src/domain/catalog/types";
import { getSourceCatalogPage } from "@/src/lib/catalog/source-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only, narrowly scoped catalog access for the public assistant.
 * The normal catalog page keeps its account requirement; this endpoint only returns
 * a small set of in-stock matches so the assistant can ground product answers.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const requestedLimit = Number(params.get("limit") || 24);
  const resolutionMp = Number(params.get("resolutionMp"));
  const page = await getSourceCatalogPage({
    page: 1,
    limit: Math.min(48, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 24)),
    search: params.get("q")?.slice(0, 100) || "",
    category: params.get("category") || "all",
    brand: params.get("brand")?.slice(0, 60) || "all",
    inStockOnly: true
  });

  if (!Number.isFinite(resolutionMp) || resolutionMp <= 0) {
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  }

  const products = page.products.filter((product) => matchesResolution(product, resolutionMp));
  return NextResponse.json({
    ...page,
    products,
    total: products.length,
    totalPages: products.length ? 1 : 0
  }, { headers: { "Cache-Control": "no-store" } });
}

function matchesResolution(product: SourceCatalogProduct, resolutionMp: number) {
  if (product.category !== "camera") return false;
  const datasheetResolution = product.datasheet?.facts.resolutionMp;
  if (typeof datasheetResolution === "number") {
    return Math.abs(datasheetResolution - resolutionMp) < 0.01;
  }
  // The normalized value may classify search results, but the assistant will not
  // present it as a verified feature unless a manufacturer datasheet is attached.
  if (product.specs && "resolutionMp" in product.specs) {
    return Math.abs(product.specs.resolutionMp - resolutionMp) < 0.01;
  }

  const escaped = String(resolutionMp).replace(".", "[.,]");
  return new RegExp(`(?:^|\\D)${escaped}\\s*(?:mp|مگا\\s*پیکسل|مگاپیکسل)(?:\\D|$)`, "i").test(`${product.name} ${product.sku}`);
}
