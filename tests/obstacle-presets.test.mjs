import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import * as THREE from "three";

import { applyObstaclePreset, obstaclePresets } from "@/src/lib/planner/obstacle-presets.ts";
import { buildFloorFootprintGuide, buildFloorSlab, buildObstacleMesh, disposeGroup } from "@/src/lib/planner/scene-builders.ts";

test("obstacle library exposes five differently sized vehicle models", () => {
  const vehicles = obstaclePresets.filter((item) => item.group === "vehicle");
  assert.equal(vehicles.length, 5);
  assert.equal(new Set(vehicles.map((item) => `${item.widthM}:${item.depthM}:${item.heightM}`)).size, 5);
  assert.ok(vehicles.every((item) => item.kind === "vehicle"));
});

test("tree presets are configurable blocking obstacles", () => {
  const trees = obstaclePresets.filter((item) => item.group === "tree");
  assert.deepEqual(trees.map((item) => item.id), ["deciduous", "conifer", "palm"]);

  const source = {
    id: "obstacle-1",
    label: "custom",
    kind: "block",
    center: { x: 2, z: 3 },
    widthM: 1,
    depthM: 1,
    heightM: 1,
    rotationDeg: 25,
    blocksView: false
  };
  const result = applyObstaclePreset(source, trees[0]);
  assert.equal(result.kind, "tree");
  assert.equal(result.variant, "deciduous");
  assert.equal(result.blocksView, true);
  assert.deepEqual(result.center, source.center);
  assert.equal(result.rotationDeg, 25);
});

test("vehicle and tree visuals are detailed multi-mesh models", () => {
  const build = (variant) => {
    const preset = obstaclePresets.find((item) => item.id === variant);
    return buildObstacleMesh(THREE, {
      id: variant,
      label: preset.label,
      kind: preset.kind,
      variant: preset.id,
      center: { x: 0, z: 0 },
      widthM: preset.widthM,
      depthM: preset.depthM,
      heightM: preset.heightM,
      rotationDeg: 0,
      blocksView: true
    }, false);
  };

  const sedan = build("sedan");
  const deciduous = build("deciduous");
  const palm = build("palm");
  assert.ok(sedan.children.length >= 15, "car should include body, glazing, lights, wheels and hubs");
  assert.ok(deciduous.children.length >= 9, "tree should include trunk, branches and foliage clusters");
  assert.ok(palm.children.length >= 40, "palm should include a segmented trunk and curved fronds");
});

test("every vehicle and tree variant ships a valid binary glTF asset", () => {
  for (const preset of obstaclePresets.filter((item) => item.group !== "structure")) {
    const assetPath = path.resolve("public", "models", "obstacles", `${preset.id}.glb`);
    const bytes = fs.readFileSync(assetPath);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "glTF", `${preset.id} must be a GLB file`);
    assert.ok(bytes.length > 10_000, `${preset.id} model should not be an empty placeholder`);
    if (preset.group === "vehicle") {
      assert.equal(bytes.includes(Buffer.from('"uri":"Textures/colormap.png"')), false, `${preset.id} texture must be embedded`);
      assert.equal(bytes.includes(Buffer.from('"mimeType":"image/png"')), true, `${preset.id} must declare its embedded texture`);
    }
  }
  assert.ok(fs.statSync(path.resolve("public", "models", "obstacles", "Textures", "colormap.png")).size > 10_000);
});

test("stairs preset builds individual steps and handrails", () => {
  const preset = obstaclePresets.find((item) => item.id === "stairs-straight");
  assert.ok(preset);
  const stairs = buildObstacleMesh(THREE, {
    id: "stairs", label: preset.label, kind: preset.kind, variant: preset.id,
    center: { x: 0, z: 0 }, widthM: preset.widthM, depthM: preset.depthM,
    heightM: preset.heightM, rotationDeg: 0, blocksView: true
  }, false);
  assert.ok(stairs.children.length >= 20);
});

test("closed lower floors produce a red footprint guide and preview slab", () => {
  const floor = {
    id: "ground", name: "همکف", elevationM: 0, heightM: 3.2,
    walls: [
      { id: "a", a: { x: 0, z: 0 }, b: { x: 8, z: 0 }, heightM: 3, thicknessM: 0.2, blocksView: true },
      { id: "b", a: { x: 8, z: 0 }, b: { x: 8, z: 6 }, heightM: 3, thicknessM: 0.2, blocksView: true },
      { id: "c", a: { x: 8, z: 6 }, b: { x: 0, z: 6 }, heightM: 3, thicknessM: 0.2, blocksView: true },
      { id: "d", a: { x: 0, z: 6 }, b: { x: 0, z: 0 }, heightM: 3, thicknessM: 0.2, blocksView: true }
    ],
    doors: [], obstacles: [], cameras: []
  };
  assert.equal(buildFloorFootprintGuide(THREE, floor).children.length, 4);
  assert.equal(buildFloorSlab(THREE, floor, true).children.length, 1);
});

test("disposed floor scenes invalidate every obstacle render scope", () => {
  const sceneGroup = new THREE.Group();
  const obstacle = buildObstacleMesh(THREE, {
    id: "floor-a-obstacle",
    label: "مانع طبقه اول",
    kind: "stairs",
    variant: "stairs-straight",
    center: { x: 0, z: 0 },
    widthM: 4.2,
    depthM: 1.4,
    heightM: 3.2,
    rotationDeg: 0,
    blocksView: true
  }, false, { floorId: "floor-a", sceneGeneration: 7 });
  sceneGroup.add(obstacle);

  assert.equal(obstacle.userData.floorId, "floor-a");
  assert.ok(obstacle.children.every((child) => child.userData.floorId === "floor-a"));
  disposeGroup(sceneGroup);
  assert.equal(obstacle.userData.sceneDisposed, true);
  assert.equal(obstacle.parent, null);
});
