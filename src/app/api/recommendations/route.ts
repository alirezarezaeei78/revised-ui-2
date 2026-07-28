import { NextRequest, NextResponse } from "next/server";
import { getCatalogSnapshot } from "@/src/lib/catalog/repository";
import { mockProducts } from "@/src/lib/catalog/mock-products";
import { recommendProducts } from "@/src/lib/recommendation/engine";
import { parseProjectBrief } from "@/src/lib/recommendation/validation";
import { getBitrateCalibrationFactors, saveBitrateCalibrationSamples } from "@/src/lib/calibration/bitrate";

export async function POST(request: NextRequest) {
  try {
    const brief = parseProjectBrief(await request.json());
    const snapshot = await getCatalogSnapshot();
    const calibration = await getBitrateCalibrationFactors();
    let result = recommendProducts(snapshot.products, brief, calibration);
    if (!result.plans.length && snapshot.dataMode !== "mock-fallback") {
      const productsById = new Map(snapshot.products.map((product) => [product.id, product]));
      for (const product of mockProducts) {
        if (!productsById.has(product.id)) productsById.set(product.id, product);
      }
      result = recommendProducts([...productsById.values()], brief, calibration);
      result.dataMode = "mock-fallback";
      if (result.plans.length) {
        result.rejected.unshift({
          productName: "کاتالوگ متصل",
          reason: "موجودی متصل برای یک ترکیب کامل کافی نبود؛ اقلام تکمیلیِ نمونه فقط برای ادامه طراحی و برآورد اولیه اضافه شدند."
        });
      }
    } else {
      result.dataMode = snapshot.dataMode;
    }
    await saveBitrateCalibrationSamples(brief, result);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "خطا در ساخت پیشنهاد." }, { status: 400 });
  }
}
