import assert from "node:assert/strict";
import test from "node:test";
import { defaultCameraOptics, defaultPlanDefaults } from "../src/domain/planner/types.ts";
import { computeCameraCoverage } from "../src/lib/planner/coverage.ts";
import {
  castRay,
  collectOccluders,
  largestClosedWallLoop,
  pointInPolygon,
  polygonArea
} from "../src/lib/planner/geometry.ts";
import {
  optimiseCameraPlacement
} from "../src/lib/planner/smart-placement.ts";

const walls = [
  { id: "north", a: { x: -10, z: -6 }, b: { x: 10, z: -6 }, heightM: 3, thicknessM: 0.2, blocksView: true },
  { id: "east", a: { x: 10, z: -6 }, b: { x: 10, z: 6 }, heightM: 3, thicknessM: 0.2, blocksView: true },
  { id: "south", a: { x: 10, z: 6 }, b: { x: -10, z: 6 }, heightM: 3, thicknessM: 0.2, blocksView: true },
  { id: "west", a: { x: -10, z: 6 }, b: { x: -10, z: -6 }, heightM: 3, thicknessM: 0.2, blocksView: true },
  { id: "partition", a: { x: 0, z: -6 }, b: { x: 0, z: 2 }, heightM: 3, thicknessM: 0.15, blocksView: true }
];

const floor = {
  id: "ground",
  name: "همکف",
  elevationM: 0,
  heightM: 3.2,
  walls,
  doors: [
    { id: "entry", wallId: "south", offset: 0.5, widthM: 2.4, heightM: 2.2, hinge: "start", openAngleDeg: 55 }
  ],
  obstacles: [
    { id: "block", label: "مانع مرکزی", kind: "block", center: { x: 4, z: 0 }, widthM: 2, depthM: 3, heightM: 2.6, rotationDeg: 0, blocksView: true }
  ],
  cameras: [{
    id: "existing",
    definitionId: "monitor-1",
    zoneId: "general",
    groupName: "سالن",
    name: "دوربین موجود",
    housing: "bullet",
    features: { microphone: false, colorNightVision: false, weatherproof: false },
    position: { x: -9.5, z: -5.5 },
    yawDeg: 35,
    goal: "monitor",
    optics: { ...defaultCameraOptics, maxRangeM: 20 }
  }]
};

const definitions = [
  {
    id: "monitor-1",
    zoneId: "general",
    groupName: "سالن",
    name: "دوربین موجود",
    housing: "bullet",
    goal: "monitor",
    optics: { ...defaultCameraOptics, maxRangeM: 20 },
    features: { microphone: false, colorNightVision: false, weatherproof: false }
  },
  {
    id: "face-1",
    zoneId: "entry",
    groupName: "ورودی",
    name: "تشخیص چهره",
    housing: "bullet",
    goal: "face-identify",
    optics: { ...defaultCameraOptics, focalMm: 8, maxRangeM: 18 },
    features: { microphone: false, colorNightVision: true, weatherproof: false }
  },
  {
    id: "monitor-2",
    zoneId: "general",
    groupName: "سالن",
    name: "پوشش سالن",
    housing: "turret",
    goal: "monitor",
    optics: { ...defaultCameraOptics, focalMm: 2.8, maxRangeM: 22 },
    features: { microphone: true, colorNightVision: false, weatherproof: false }
  },
  {
    id: "dome-1",
    zoneId: "general",
    groupName: "سالن",
    name: "دام سقفی",
    housing: "dome",
    goal: "monitor",
    optics: { ...defaultCameraOptics, focalMm: 2.8, maxRangeM: 18 },
    features: { microphone: true, colorNightVision: false, weatherproof: false }
  },
  {
    id: "ptz-1",
    zoneId: "general",
    groupName: "سالن",
    name: "دوربین گردان",
    housing: "ptz",
    goal: "monitor",
    optics: { ...defaultCameraOptics, focalMm: 4, maxRangeM: 20 },
    features: { microphone: false, colorNightVision: true, weatherproof: true }
  }
];

test("largest wall loop keeps the exterior boundary when partitions exist", () => {
  const loop = largestClosedWallLoop(walls);
  assert.ok(loop);
  assert.equal(polygonArea(loop), 240);
});

test("an architectural door is treated as an opening in visibility rays", () => {
  const blocked = collectOccluders(walls, floor.obstacles);
  const withDoor = collectOccluders(walls, floor.obstacles, floor.doors);
  assert.equal(castRay({ x: 0, z: 0 }, Math.PI / 2, 20, blocked), 6);
  assert.equal(castRay({ x: 0, z: 0 }, Math.PI / 2, 20, withDoor), 20);
});

test("PTZ patrol covers around the mount while a fixed bullet keeps its heading", () => {
  const fixed = { ...floor.cameras[0], position: { x: 0, z: 0 }, yawDeg: 0, housing: "bullet" };
  const ptz = { ...fixed, id: "ptz", housing: "ptz" };
  const fixedCoverage = computeCameraCoverage(fixed, [], 72);
  const ptzCoverage = computeCameraCoverage(ptz, [], 72);

  assert.equal(fixedCoverage.coverageMode, "fixed");
  assert.equal(ptzCoverage.coverageMode, "ptz-patrol");
  assert.equal(pointInPolygon({ x: -5, z: 0 }, fixedCoverage.polygon), false);
  assert.equal(pointInPolygon({ x: -5, z: 0 }, ptzCoverage.polygon), true);
});

test("smart placement preserves existing cameras and fills blind areas", () => {
  const plan = {
    floors: [floor],
    activeFloorId: floor.id,
    gridSizeM: 1,
    snapM: 1,
    defaults: { ...defaultPlanDefaults }
  };
  const result = optimiseCameraPlacement(plan, definitions);
  const nextFloor = result.plan.floors[0];
  const boundary = largestClosedWallLoop(walls);

  assert.equal(result.report.requested, 4);
  assert.equal(result.report.placed, 4, JSON.stringify(result.report));
  assert.equal(nextFloor.cameras[0], floor.cameras[0]);
  assert.equal(nextFloor.cameras.length, 5);
  assert.ok(result.report.coverageAfterPercent >= result.report.coverageBeforePercent);
  assert.deepEqual(
    new Set(nextFloor.cameras.slice(1).map((camera) => camera.housing)),
    new Set(["bullet", "turret", "dome", "ptz"])
  );
  for (const camera of nextFloor.cameras.slice(1)) {
    assert.ok(pointInPolygon(camera.position, boundary));
    assert.ok(Number.isFinite(camera.yawDeg));
  }
});
