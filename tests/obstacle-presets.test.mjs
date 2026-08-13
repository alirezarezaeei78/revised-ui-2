import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import * as THREE from "three";

import { applyObstaclePreset, obstacleGroupLabels, obstaclePresets } from "@/src/lib/planner/obstacle-presets.ts";
import { createSamplePlan } from "@/src/lib/planner/sample-plans.ts";
import { isCardinalAngle, snapRotationAngle } from "@/src/lib/planner/rotation.ts";
import {
  buildFloorFootprintGuide,
  buildFloorSlab,
  buildOverallDimensionGuide,
  buildObstacleMesh,
  buildObstacleRotateHandle,
  buildYawHandle,
  collectDimensionLabels,
  disposeGroup
} from "@/src/lib/planner/scene-builders.ts";

test("every preset belongs to a labelled group and has real dimensions", () => {
  const known = new Set(Object.keys(obstacleGroupLabels));
  const ids = new Set();
  for (const preset of obstaclePresets) {
    assert.ok(known.has(preset.group), `${preset.id} is in unlabelled group "${preset.group}"`);
    assert.ok(!ids.has(preset.id), `duplicate preset id ${preset.id}`);
    ids.add(preset.id);
    assert.ok(preset.widthM > 0 && preset.depthM > 0 && preset.heightM > 0, `${preset.id} needs real dimensions`);
    assert.ok(preset.label.trim().length > 0 && preset.description.trim().length > 0);
  }
});

test("each room category offers a usable set of furniture", () => {
  for (const group of ["living", "bedroom", "kitchen", "office", "retail"]) {
    const items = obstaclePresets.filter((preset) => preset.group === group);
    assert.ok(items.length >= 5, `${group} should offer at least five items, got ${items.length}`);
  }
});

test("common CCTV environments expose practical object sets", () => {
  for (const group of ["industrial", "warehouse", "parking", "hospitality"]) {
    const items = obstaclePresets.filter((preset) => preset.group === group);
    assert.ok(items.length >= 5, `${group} should offer at least five items, got ${items.length}`);
  }
});

test("sample collection showcases every designer preset without duplicate object ids", () => {
  const plan = createSamplePlan("luxury-villa");
  const objects = plan.floors.flatMap((floor) => floor.obstacles);
  const sampleIds = [
    "luxury-villa", "modern-office", "retail-gallery", "factory-campus", "residential-parking", "kourosh-mall",
    "mega-mall", "general-hospital", "police-station", "barracks-campus", "school-campus"
  ];
  const represented = new Set(sampleIds.flatMap((id) => createSamplePlan(id).floors.flatMap((floor) => floor.obstacles)).map((item) => item.variant).filter(Boolean));
  const missing = obstaclePresets.map((item) => item.id).filter((id) => !represented.has(id));

  assert.deepEqual(missing, [], `villa is missing presets: ${missing.join(", ")}`);
  assert.equal(new Set(objects.map((item) => item.id)).size, objects.length, "villa object ids must be unique");
  assert.equal(plan.floors.length, 5);
  assert.equal(plan.activeFloorId, "villa-ground");
  assert.ok(plan.floors.some((floor) => floor.elevationM < 0), "villa should include a real service basement");
});

test("every sample plan is richly furnished and uses architectural openings", () => {
  const expectations = {
    "luxury-villa": { floors: 5, obstacles: 60 },
    "modern-office": { floors: 3, obstacles: 35 },
    "retail-gallery": { floors: 2, obstacles: 25 },
    "factory-campus": { floors: 2, obstacles: 45 },
    "residential-parking": { floors: 4, obstacles: 75 },
    "kourosh-mall": { floors: 17, obstacles: 750 }
  };

  for (const [sampleId, expected] of Object.entries(expectations)) {
    const plan = createSamplePlan(sampleId);
    const obstacles = plan.floors.flatMap((floor) => floor.obstacles);
    const openings = plan.floors.flatMap((floor) => floor.doors ?? []);
    assert.equal(plan.floors.length, expected.floors, `${sampleId} floor count`);
    assert.ok(obstacles.length >= expected.obstacles, `${sampleId} needs richer furnishing`);
    assert.ok(openings.some((item) => item.type === "window"), `${sampleId} needs windows`);
    assert.ok(openings.some((item) => item.type !== "window"), `${sampleId} needs doors`);
    assert.equal(new Set(obstacles.map((item) => item.id)).size, obstacles.length, `${sampleId} object ids must be unique`);
    for (const floor of plan.floors) {
      const wallIds = new Set(floor.walls.map((wall) => wall.id));
      assert.ok((floor.doors ?? []).some((item) => item.type === "window"), `${sampleId}/${floor.id} needs a window`);
      assert.ok((floor.doors ?? []).some((item) => item.type !== "window"), `${sampleId}/${floor.id} needs a door`);
      assert.ok((floor.doors ?? []).every((item) => wallIds.has(item.wallId)), `${sampleId}/${floor.id} has a detached opening`);
      assert.ok(floor.obstacles.length >= 4, `${sampleId}/${floor.id} is too sparse`);
    }
  }
});

test("sample buildings have a coherent vertical circulation core", () => {
  const elevatorCounts = {
    "luxury-villa": 1, "modern-office": 1, "retail-gallery": 1, "factory-campus": 1, "residential-parking": 1,
    "kourosh-mall": 8, "mega-mall": 6, "general-hospital": 2, "police-station": 2,
    "barracks-campus": 2, "school-campus": 2
  };
  for (const [sampleId, elevatorCount] of Object.entries(elevatorCounts)) {
    const floors = createSamplePlan(sampleId).floors.toSorted((a, b) => a.elevationM - b.elevationM);
    const topFloor = floors.at(-1);

    assert.ok(topFloor, `${sampleId} needs a top floor`);
    assert.equal(
      topFloor.obstacles.some((item) => item.variant === "stairs-straight"),
      false,
      `${sampleId} must not place an upward stair on its top floor`
    );
    assert.ok(
      topFloor.obstacles.some((item) => item.label.includes("پاگرد نهایی")),
      `${sampleId} top floor needs a final landing instead of another stair`
    );
    const elevatorCenters = floors.map((floor) => {
      const elevators = floor.obstacles.filter((item) => item.variant === "elevator");
      assert.equal(elevators.length, elevatorCount, `${sampleId}/${floor.id} elevator bank count`);
      return elevators.map((item) => `${item.center.x}:${item.center.z}`).toSorted().join("|");
    });
    assert.equal(
      new Set(elevatorCenters).size,
      1,
      `${sampleId} elevator shaft must align through every floor`
    );
    for (const floor of floors.slice(0, -1)) {
      const stairs = floor.obstacles.find((item) => item.variant === "stairs-straight");
      const elevators = floor.obstacles.filter((item) => item.variant === "elevator");
      assert.ok(stairs, `${sampleId}/${floor.id} needs a stair to the floor above`);
      assert.ok(
        elevators.some((elevator) => Math.hypot(stairs.center.x - elevator.center.x, stairs.center.z - elevator.center.z) <= 12),
        `${sampleId}/${floor.id} elevator must sit beside its stair`
      );
    }
  }
});

test("upper floors never use an exterior shell door as their main entry", () => {
  for (const sampleId of [
    "luxury-villa", "modern-office", "retail-gallery", "factory-campus", "residential-parking", "kourosh-mall",
    "mega-mall", "general-hospital", "police-station", "barracks-campus", "school-campus"
  ]) {
    for (const floor of createSamplePlan(sampleId).floors.filter((item) => item.elevationM > 0)) {
      const exteriorEntries = (floor.doors ?? []).filter((item) =>
        item.type !== "window" && item.id.includes("entry") && item.wallId.includes("shell")
      );
      assert.deepEqual(exteriorEntries, [], `${sampleId}/${floor.id} has an impossible exterior entry door`);
    }
  }
});

test("Kourosh Mall keeps an escalator beside the stair and elevator on every level", () => {
  const plan = createSamplePlan("kourosh-mall");
  assert.equal(plan.floors.length, 17);
  assert.equal(plan.floors.filter((floor) => floor.id.startsWith("kourosh-parking-b")).length, 7);
  const commercialUnitDoors = plan.floors.flatMap((floor) => floor.doors ?? []).filter((item) => item.id.includes("-shop-") && item.id.endsWith("-door"));
  assert.equal(commercialUnitDoors.length, 542, "Kourosh commercial levels should match the published unit breakdown");
  const ground = plan.floors.find((floor) => floor.id === "kourosh-commercial-ground");
  assert.ok(ground);
  assert.equal(ground.walls.filter((wall) => wall.id.includes("-envelope-")).length, 8, "the mall envelope should use chamfered corners");
  assert.equal(ground.walls.filter((wall) => wall.id.includes("-atrium-")).length, 8, "the central atrium should be an octagonal void");
  const envelopePoints = ground.walls.filter((wall) => wall.id.includes("-envelope-")).flatMap((wall) => [wall.a, wall.b]);
  assert.equal(Math.max(...envelopePoints.map((point) => point.x)) - Math.min(...envelopePoints.map((point) => point.x)), 116);
  assert.equal(Math.max(...envelopePoints.map((point) => point.z)) - Math.min(...envelopePoints.map((point) => point.z)), 82);
  const b1 = plan.floors.find((floor) => floor.id === "kourosh-commercial-b1");
  const b1Frontages = b1.walls
    .filter((wall) => wall.id.includes("-shop-") && wall.id.endsWith("-front"))
    .map((wall) => Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z));
  assert.equal(b1Frontages.length, 195);
  assert.ok(Math.min(...b1Frontages) >= 2.8, "shops need realistic frontage instead of folder-like slivers");
  for (const floor of plan.floors) {
    const elevators = floor.obstacles.filter((item) => item.variant === "elevator");
    const escalators = floor.obstacles.filter((item) => item.variant === "escalator");
    const stairsOrLandings = floor.obstacles.filter((item) => item.variant === "stairs-straight" || item.label.includes("پاگرد نهایی"));
    assert.equal(elevators.length, 8, `${floor.id} needs the passenger and service elevator banks`);
    assert.equal(stairsOrLandings.length, 4, `${floor.id} needs four emergency circulation cores`);
    assert.equal(escalators.length, 4, `${floor.id} needs four atrium escalators`);
  }
});

test("Mega Mall reproduces its public programme as a dense eight-level complex", () => {
  const plan = createSamplePlan("mega-mall");
  const objects = plan.floors.flatMap((floor) => floor.obstacles);
  const shopDoors = plan.floors.flatMap((floor) => floor.doors ?? []).filter((item) => item.id.includes("-shop-") && item.id.endsWith("-door"));
  assert.equal(plan.floors.length, 8);
  assert.equal(plan.floors.filter((floor) => floor.id.startsWith("mega-parking-b")).length, 3);
  assert.equal(shopDoors.length, 210);
  assert.equal(objects.filter((item) => item.id.startsWith("mega-cinema-hall-")).length, 10);
  assert.ok(objects.length >= 450, "Mega Mall should be fully furnished rather than diagrammatic");
  for (const floor of plan.floors) {
    assert.equal(floor.obstacles.filter((item) => item.variant === "elevator").length, 6, `${floor.id} elevator banks`);
    assert.equal(floor.obstacles.filter((item) => item.variant === "escalator").length, 4, `${floor.id} escalators`);
  }
});

test("the five-floor hospital separates real clinical departments and equipment", () => {
  const plan = createSamplePlan("general-hospital");
  const objects = plan.floors.flatMap((floor) => floor.obstacles);
  const represented = new Set(objects.map((item) => item.variant));
  assert.equal(plan.floors.length, 5);
  assert.ok(plan.floors.some((floor) => floor.name.includes("اورژانس")));
  assert.ok(plan.floors.some((floor) => floor.name.includes("ICU")));
  assert.ok(plan.floors.some((floor) => floor.name.includes("زایمان")));
  for (const variant of ["hospital-bed", "stretcher", "exam-table", "nurse-station", "medical-cart", "privacy-screen"]) {
    assert.ok(represented.has(variant), `hospital needs ${variant}`);
  }
  assert.ok(objects.length >= 170);
});

test("public-safety and education samples stay detailed without copying a sensitive real site", () => {
  const expectations = {
    "police-station": { floors: 4, objects: 120 },
    "barracks-campus": { floors: 4, objects: 170 },
    "school-campus": { floors: 4, objects: 300 }
  };
  for (const [id, expected] of Object.entries(expectations)) {
    const plan = createSamplePlan(id);
    const objects = plan.floors.flatMap((floor) => floor.obstacles);
    assert.equal(plan.floors.length, expected.floors);
    assert.ok(objects.length >= expected.objects, `${id} is too sparse`);
    assert.equal(new Set(objects.map((item) => item.id)).size, objects.length, `${id} object ids must be unique`);
  }
});

test("the compact ribbon keeps essential assets visible and gates advanced categories", () => {
  const source = fs.readFileSync(path.resolve("src", "components", "planner", "FloorPlanDesigner.tsx"), "utf8");
  const essentials = source.slice(source.indexOf('className="plan-ribbon-section plan-ribbon-essentials"'), source.indexOf('className="plan-ribbon-section plan-ribbon-view"'));
  const advanced = source.slice(source.indexOf('className="plan-element-strip is-advanced"'), source.indexOf('className="plan-defaults-section"'));
  const ribbon = source.slice(source.indexOf('className="plan-toolbar plan-ribbon"'), source.indexOf('className="plan-element-strip is-advanced"'));

  for (const group of ["vehicle", "structure", "tree"]) assert.ok(essentials.includes(`group="${group}"`), `${group} must stay in the main ribbon`);
  for (const group of ["vehicle", "structure", "tree"]) assert.equal(advanced.includes(`group="${group}"`), false, `${group} must not be duplicated in advanced assets`);
  assert.ok(source.includes('useState(false);'));
  assert.ok(source.includes('mode === "environment" && showAdvancedElements'));
  assert.ok(source.includes('className="plan-history-actions"'));
  assert.ok(source.includes('"plan-advanced-switch is-active"'));
  assert.ok(source.includes('className="plan-advanced-switch-track"'));
  assert.equal(source.includes("plan-advanced-toggle"), false);
  assert.ok(source.includes('<span>ساختمان</span>'));
  assert.equal(ribbon.includes("پوشش DORI"), false, "DORI must not consume main-ribbon space");
  assert.ok(source.includes('className={showCoverage ? "plan-coverage-toggle active" : "plan-coverage-toggle"}'));
});

test("work and dining chairs face their nearest table", () => {
  const tableVariants = new Set(["office-desk", "meeting-table", "dining-table"]);
  for (const sampleId of ["luxury-villa", "modern-office", "retail-gallery", "factory-campus", "residential-parking", "kourosh-mall"]) {
    for (const floor of createSamplePlan(sampleId).floors) {
      const tables = floor.obstacles.filter((item) => tableVariants.has(item.variant));
      for (const chair of floor.obstacles.filter((item) => item.variant === "office-chair" || item.variant === "dining-chair")) {
        const nearest = tables
          .map((table) => ({ table, distance: Math.hypot(table.center.x - chair.center.x, table.center.z - chair.center.z) }))
          .toSorted((a, b) => a.distance - b.distance)[0];
        assert.ok(nearest && nearest.distance < 2.5, `${sampleId}/${chair.id} is detached from a table`);

        const angle = (chair.rotationDeg ?? 0) * Math.PI / 180;
        const forward = { x: -Math.sin(angle), z: Math.cos(angle) };
        const toTable = {
          x: (nearest.table.center.x - chair.center.x) / nearest.distance,
          z: (nearest.table.center.z - chair.center.z) / nearest.distance
        };
        const alignment = forward.x * toTable.x + forward.z * toTable.z;
        assert.ok(alignment > 0.5, `${sampleId}/${chair.id} faces away from ${nearest.table.id}`);
      }
    }
  }
});

test("tall furniture blocks the view and low furniture does not", () => {
  const byId = (id) => obstaclePresets.find((preset) => preset.id === id);
  // A camera on the ceiling sees over a sofa but not over a wardrobe; the flags have to
  // agree with the heights or the coverage map lies.
  assert.equal(byId("sofa-three").blocksView, false);
  assert.equal(byId("coffee-table").blocksView, false);
  assert.equal(byId("wardrobe").blocksView, true);
  assert.equal(byId("bookshelf").blocksView, true);
  assert.equal(byId("fridge").blocksView, true);
  for (const preset of obstaclePresets.filter((item) => item.blocksView === true && item.group !== "site")) {
    assert.ok(preset.heightM >= 1.5, `${preset.id} blocks view at only ${preset.heightM} m`);
  }
});

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
  // Only these two groups are asset-backed. Landscape, site and structure elements are
  // built procedurally, so an exclusion list would silently demand models for them.
  for (const preset of obstaclePresets.filter((item) => item.group === "vehicle" || item.group === "tree")) {
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

test("elevator preset builds a recognizable shaft and sliding doors", () => {
  const preset = obstaclePresets.find((item) => item.id === "elevator");
  assert.ok(preset);
  const elevator = buildObstacleMesh(THREE, {
    id: "elevator", label: preset.label, kind: preset.kind, variant: preset.id,
    center: { x: 0, z: 0 }, widthM: preset.widthM, depthM: preset.depthM,
    heightM: preset.heightM, rotationDeg: 0, blocksView: true
  }, false);
  assert.ok(elevator.children.length >= 9);
});

test("escalator preset builds moving-step geometry, glass sides and handrails", () => {
  const preset = obstaclePresets.find((item) => item.id === "escalator");
  assert.ok(preset);
  const escalator = buildObstacleMesh(THREE, {
    id: "escalator", label: preset.label, kind: preset.kind, variant: preset.id,
    center: { x: 0, z: 0 }, widthM: preset.widthM, depthM: preset.depthM,
    heightM: preset.heightM, rotationDeg: 0, blocksView: false
  }, false);
  assert.ok(escalator.children.length >= 40);
});

test("rotation begins only from the endpoint handle, never the item body or guide line", () => {
  const cameraHandle = buildYawHandle(THREE, "camera-1", { x: 0, z: 0 }, 3, 0);
  const cameraTargets = cameraHandle.children.filter((child) => child.userData.kind === "camera-yaw");
  assert.equal(cameraTargets.length, 1);
  assert.ok(cameraTargets[0].position.x > 1, "camera rotate target should sit away from its body");

  const obstacleHandle = buildObstacleRotateHandle(THREE, {
    id: "chair-1", label: "chair", kind: "seating", variant: "office-chair",
    center: { x: 0, z: 0 }, widthM: 0.6, depthM: 0.6, heightM: 1.1,
    rotationDeg: 0, blocksView: false
  });
  const obstacleTargets = obstacleHandle.children.filter((child) => child.userData.kind === "obstacle-rotate");
  assert.equal(obstacleTargets.length, 1);
  assert.ok(obstacleTargets[0].position.x > 1, "obstacle rotate target should be the arrow tip");
});

test("rotation magnetically locks to cardinal axes and leaves other angles free", () => {
  assert.equal(snapRotationAngle(2.8), 0);
  assert.equal(snapRotationAngle(87.2), 90);
  assert.equal(snapRotationAngle(181.5), 180);
  assert.equal(snapRotationAngle(357.4), 0);
  assert.equal(snapRotationAngle(44), 44);
  assert.equal(snapRotationAngle(44, true), 45);
  assert.equal(isCardinalAngle(270), true);
  assert.equal(isCardinalAngle(45), false);

  const cardinalHandle = buildYawHandle(THREE, "camera-cardinal", { x: 0, z: 0 }, 3, 90);
  const freeHandle = buildYawHandle(THREE, "camera-free", { x: 0, z: 0 }, 3, 45);
  assert.equal(cardinalHandle.children[1].material.color.getHex(), 0xef4444);
  assert.equal(freeHandle.children[1].material.color.getHex(), 0xf59e0b);
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
  assert.equal(buildOverallDimensionGuide(THREE, floor).children.length, 10);

  const overallLabels = collectDimensionLabels(floor);
  assert.deepEqual(overallLabels.map((item) => item.kind), ["overall-length", "overall-width"]);
  assert.ok(overallLabels[0].text.includes("8.0"));
  assert.ok(overallLabels[1].text.includes("6.0"));
  const selectedWallLabels = collectDimensionLabels(floor, "a");
  assert.equal(selectedWallLabels.length, 3);
  assert.equal(selectedWallLabels[2].kind, "selected-wall");
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
