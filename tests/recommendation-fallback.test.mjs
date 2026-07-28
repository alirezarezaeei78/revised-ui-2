import assert from "node:assert/strict";
import test from "node:test";
import { mockProducts } from "../src/lib/catalog/mock-products.ts";
import { recommendProducts } from "../src/lib/recommendation/engine.ts";
import { parseProjectBrief } from "../src/lib/recommendation/validation.ts";

test("an impossible camera target returns reviewable closest-fit plans instead of an empty result", () => {
  const brief = parseProjectBrief({
    projectType: "shop",
    cameraCount: 2,
    outdoorCount: 0,
    entrances: 1,
    goal: "mixed",
    archiveDays: 7,
    budget: "balanced",
    zones: [{
      id: "hard-zone",
      name: "ناحیه آزمایشی سخت",
      cameraCount: 2,
      outdoor: false,
      goal: "face-identify",
      targetDistanceM: 30,
      sceneWidthM: 1,
      mountingHeightM: 8,
      targetHeightM: 1.7,
      cameraTiltDeg: 2,
      minimumPpm: 1000
    }]
  });

  const result = recommendProducts(mockProducts, brief);

  assert.ok(result.plans.length > 0);
  assert.ok(result.plans[0].constraints.pending.some((item) => item.includes("PPM")));
  assert.ok(result.rejected.some((item) => item.productName.startsWith("بازبینی دوربین")));
});
