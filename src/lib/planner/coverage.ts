import type { SurveillanceTask } from "@/src/domain/catalog/types";
import type { FloorPlan, PlanCamera, Vec2 } from "@/src/domain/planner/types";
import {
  boundsOf,
  castRay,
  collectOccluders,
  distance,
  floorAreaM2,
  pointInPolygon,
  visibilityFan,
  visibilityRing,
  type Segment
} from "@/src/lib/planner/geometry";
import {
  distanceForPixelDensity,
  horizontalFovDeg,
  horizontalPixelsForMegapixel,
  sceneWidthAtDistanceM
} from "@/src/lib/calculators/optics";

/**
 * Turns placed cameras into what they can actually see on the drawn floor.
 *
 * Coverage is a ray-cast visibility fan rather than a plain wedge, so walls and
 * obstacles cut the shape the way they cut the real view. Each fan is then clipped at
 * the EN 62676-4 pixel-density distances to give the nested DORI bands.
 */

/** Height of the thing being looked at, per surveillance task. */
const targetHeightM: Record<SurveillanceTask, number> = {
  monitor: 1.6,
  "face-capture": 1.7,
  "face-identify": 1.7,
  "plate-capture": 0.8,
  anpr: 0.8
};

/**
 * Saturated, well-separated hues.
 *
 * The bands no longer overlap, so each can be drawn at full strength instead of relying
 * on blended translucency — these are chosen to stay distinct against both the light
 * floor and an uploaded plan image underneath.
 */
export const doriLevels = [
  { key: "detect", label: "کشف", ppm: 25, color: "#dc2626" },
  { key: "observe", label: "مشاهده", ppm: 62, color: "#f97316" },
  { key: "recognize", label: "بازشناسی", ppm: 125, color: "#facc15" },
  { key: "identify", label: "شناسایی", ppm: 250, color: "#22c55e" }
] as const;

export type DoriKey = (typeof doriLevels)[number]["key"];

export type CoverageBand = {
  key: DoriKey;
  label: string;
  ppm: number;
  color: string;
  /** Distance at which this level's pixel density is reached. */
  distanceM: number;
  /** Ring bounds actually drawn, after clamping to the camera's effective range. */
  innerDistanceM: number;
  outerDistanceM: number;
  polygon: Vec2[];
};

export type CameraCoverage = {
  cameraId: string;
  coverageMode: "fixed" | "ptz-patrol";
  fovDeg: number;
  headingRad: number;
  horizontalPixels: number;
  effectiveRangeM: number;
  /** True when the effective range stops short of the detect distance, cutting bands. */
  truncatedByRange: boolean;
  visibleBandCount: number;
  polygon: Vec2[];
  bands: CoverageBand[];
  doriDistances: Record<DoriKey, number>;
};

function radialVisibilityPolygon(
  origin: Vec2,
  maxRangeM: number,
  occluders: Segment[],
  rays: number,
  sightHeightAt: (distanceAlongRay: number) => number
): Vec2[] {
  const steps = Math.max(36, rays);
  return Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2;
    const reach = castRay(origin, angle, maxRangeM, occluders, sightHeightAt);
    return {
      x: origin.x + Math.cos(angle) * reach,
      z: origin.z + Math.sin(angle) * reach
    };
  });
}

export function cameraFovDeg(camera: PlanCamera): number {
  return horizontalFovDeg(camera.optics.focalMm, camera.optics.sensorWidthMm);
}

export function ppmAtDistance(horizontalPixels: number, fovDeg: number, distanceM: number): number {
  const width = sceneWidthAtDistanceM(distanceM, fovDeg);
  return width > 0 ? horizontalPixels / width : 0;
}

/**
 * Line-of-sight height at a distance along the ray.
 *
 * The sight line runs from the lens down to the target's head at the camera's useful
 * range; anything shorter than that line at a given distance is seen over rather than
 * blocked. Without this, a shop counter would carve a blind wedge behind itself.
 */
function sightHeightFactory(camera: PlanCamera, rangeM: number) {
  const lensHeight = camera.optics.mountHeightM;
  const target = targetHeightM[camera.goal] ?? 1.6;
  return (distanceAlongRay: number) => {
    const ratio = rangeM > 0 ? Math.min(1, distanceAlongRay / rangeM) : 1;
    return lensHeight + (target - lensHeight) * ratio;
  };
}

export function computeCameraCoverage(camera: PlanCamera, occluders: Segment[], rays = 72): CameraCoverage {
  const fovDeg = cameraFovDeg(camera);
  const fovRad = (fovDeg * Math.PI) / 180;
  const headingRad = (camera.yawDeg * Math.PI) / 180;
  const horizontalPixels = horizontalPixelsForMegapixel(camera.optics.megapixel);
  const effectiveRangeM = Math.max(1, camera.optics.maxRangeM);
  const sightHeightAt = sightHeightFactory(camera, effectiveRangeM);
  const isPtzPatrol = camera.housing === "ptz";

  const polygon = isPtzPatrol
    ? radialVisibilityPolygon(camera.position, effectiveRangeM, occluders, rays, sightHeightAt)
    : visibilityFan(camera.position, headingRad, fovRad, effectiveRangeM, occluders, rays, sightHeightAt);

  const distances = {
    detect: distanceForPixelDensity(horizontalPixels, fovDeg, 25),
    observe: distanceForPixelDensity(horizontalPixels, fovDeg, 62),
    recognize: distanceForPixelDensity(horizontalPixels, fovDeg, 125),
    identify: distanceForPixelDensity(horizontalPixels, fovDeg, 250)
  } satisfies Record<DoriKey, number>;

  /*
   * Each level owns a ring, not a fan reaching back to the lens.
   *
   * Nested fans meant identify sat inside recognize inside observe inside detect: four
   * translucent layers over the same ground, which blended into one wash and let the
   * widest band paint over the tighter ones. Disjoint rings give four regions that can
   * each be drawn once, in full colour.
   */
  const ordered = [...doriLevels].sort((a, b) => b.ppm - a.ppm);
  const bands: CoverageBand[] = [];
  let innerRange = 0;

  for (const level of ordered) {
    const outerRange = Math.min(distances[level.key], effectiveRangeM);
    const ringPolygon = outerRange - innerRange > 0.2
      ? visibilityRing(
          camera.position,
          headingRad,
          isPtzPatrol ? Math.PI * 2 : fovRad,
          innerRange,
          outerRange,
          occluders,
          rays,
          sightHeightAt
        )
      : [];
    bands.push({
      key: level.key,
      label: level.label,
      ppm: level.ppm,
      color: level.color,
      distanceM: distances[level.key],
      innerDistanceM: innerRange,
      outerDistanceM: outerRange,
      polygon: ringPolygon
    });
    innerRange = Math.max(innerRange, outerRange);
  }

  // Flagged on what the user can actually see missing, not on the raw comparison —
  // a range a rounding step short of the detect distance still draws all four rings.
  const visibleBandCount = bands.filter((band) => band.polygon.length >= 3).length;

  return {
    cameraId: camera.id,
    coverageMode: isPtzPatrol ? "ptz-patrol" : "fixed",
    fovDeg,
    headingRad,
    horizontalPixels,
    effectiveRangeM,
    truncatedByRange: visibleBandCount < doriLevels.length,
    visibleBandCount,
    polygon,
    bands,
    doriDistances: distances
  };
}

/** Range at which the image still meets the lowest DORI level; the natural outer edge. */
export function doriDetectRangeM(megapixel: number, focalMm: number, sensorWidthMm: number): number {
  const fovDeg = horizontalFovDeg(focalMm, sensorWidthMm);
  return distanceForPixelDensity(horizontalPixelsForMegapixel(megapixel), fovDeg, 25);
}

export type FloorCoverage = {
  cameras: CameraCoverage[];
  hasPtzPatrol: boolean;
  areaM2: number;
  coveredPercent: number;
  identifyPercent: number;
  blindPercent: number;
  grid: { cell: Vec2; ppm: number; covered: boolean }[];
};

/**
 * Whole-floor summary.
 *
 * The grid is sampled over the drawn extent; each cell takes the best pixel density any
 * camera achieves there, because a point is only as well covered as its best view of it.
 */
export function computeFloorCoverage(floor: FloorPlan, gridStepM = 1): FloorCoverage {
  const occluders = collectOccluders(floor.walls, floor.obstacles, floor.doors);
  const cameras = floor.cameras.map((camera) => computeCameraCoverage(camera, occluders));
  const hasPtzPatrol = cameras.some((camera) => camera.coverageMode === "ptz-patrol");
  const areaM2 = floorAreaM2(floor.walls);

  const points = floor.walls.flatMap((wall) => [wall.a, wall.b]);
  const bounds = boundsOf(points.length ? points : floor.cameras.map((camera) => camera.position));
  if (!bounds) {
    return { cameras, hasPtzPatrol, areaM2, coveredPercent: 0, identifyPercent: 0, blindPercent: 100, grid: [] };
  }

  const grid: FloorCoverage["grid"] = [];
  const step = Math.max(0.5, gridStepM);
  let covered = 0;
  let identify = 0;
  let total = 0;

  for (let x = bounds.minX; x <= bounds.maxX; x += step) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z += step) {
      const cell: Vec2 = { x, z };
      total += 1;
      let best = 0;
      for (const coverage of cameras) {
        if (coverage.polygon.length < 3 || !pointInPolygon(cell, coverage.polygon)) continue;
        const camera = floor.cameras.find((item) => item.id === coverage.cameraId)!;
        const ppm = ppmAtDistance(coverage.horizontalPixels, coverage.fovDeg, distance(camera.position, cell));
        if (ppm > best) best = ppm;
      }
      if (best >= 25) covered += 1;
      if (best >= 250) identify += 1;
      grid.push({ cell, ppm: best, covered: best >= 25 });
    }
  }

  const ratio = (value: number) => (total > 0 ? (value / total) * 100 : 0);
  return {
    cameras,
    hasPtzPatrol,
    areaM2,
    coveredPercent: ratio(covered),
    identifyPercent: ratio(identify),
    blindPercent: 100 - ratio(covered),
    grid
  };
}

/** Suggested lens for a task at a distance, used by the "fit to target" action. */
export function focalForTask(task: SurveillanceTask, distanceM: number, megapixel: number, sensorWidthMm: number): number {
  const required = task === "anpr" || task === "plate-capture" ? 200 : task === "face-identify" ? 250 : task === "face-capture" ? 125 : 62;
  const horizontalPixels = horizontalPixelsForMegapixel(megapixel);
  const sceneWidth = horizontalPixels / required;
  return sceneWidth > 0 ? (distanceM * sensorWidthMm) / sceneWidth : 0;
}
