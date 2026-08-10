import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { castRay, collectOccluders, collectRightAngleCorners, convexHull, findRightAngleCorner, floorAreaM2, isAxisAlignedSegment, polygonArea, pointInPolygon, projectPointToWall, snapWallToEqualParallel, traceWallLoop } from "@/src/lib/planner/geometry";
import { cameraFovDeg, computeCameraCoverage, ppmAtDistance } from "@/src/lib/planner/coverage";
import { defaultCameraOptics, duplicateFloor, createFloor } from "@/src/domain/planner/types";

const wall = (id, ax, az, bx, bz, heightM = 3) => ({
  id, a: { x: ax, z: az }, b: { x: bx, z: bz }, heightM, thicknessM: 0.2, blocksView: true
});

/** 10 × 6 metre room. */
const room = [wall("w1", 0, 0, 10, 0), wall("w2", 10, 0, 10, 6), wall("w3", 10, 6, 0, 6), wall("w4", 0, 6, 0, 0)];

describe("plan geometry", () => {
  test("polygon area uses the shoelace formula", () => {
    assert.equal(polygonArea([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }]), 12);
  });

  test("a closed wall ring is traced and measured", () => {
    const loop = traceWallLoop(room);
    assert.ok(loop, "walls should close into a loop");
    assert.equal(polygonArea(loop), 60);
    assert.equal(floorAreaM2(room), 60);
  });

  test("open walls have no valid area until the perimeter closes", () => {
    const open = room.slice(0, 3);
    assert.equal(floorAreaM2(open), 0);
  });

  test("convex hull drops interior points", () => {
    const hull = convexHull([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }, { x: 2, z: 2 }]);
    assert.equal(hull.length, 4);
  });

  test("point in polygon respects the boundary", () => {
    const square = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }];
    assert.equal(pointInPolygon({ x: 2, z: 2 }, square), true);
    assert.equal(pointInPolygon({ x: 5, z: 2 }, square), false);
  });

  test("a wall endpoint snaps to an equal parallel reference wall", () => {
    const reference = wall("top", 0, 0, 10, 0);
    const snap = snapWallToEqualParallel(
      { x: 10, z: 6 },
      { x: 0.2, z: 6 },
      [reference],
      0.3
    );

    assert.deepEqual(snap?.point, { x: 0, z: 6 });
    assert.deepEqual(snap?.guideFrom, { x: 0, z: 0 });
    assert.equal(snap?.lengthM, 10);
  });

  test("equal parallel snapping stays inactive outside its tolerance", () => {
    const reference = wall("top", 0, 0, 10, 0);
    assert.equal(
      snapWallToEqualParallel({ x: 10, z: 6 }, { x: 0.5, z: 6 }, [reference], 0.3),
      null
    );
  });

  test("right-angle corners are detected at connected walls", () => {
    const horizontal = wall("horizontal", 0, 0, 10, 0);
    const vertical = wall("vertical", 10, 0, 10, 6);
    const corner = findRightAngleCorner(horizontal, vertical);

    assert.deepEqual(corner?.corner, { x: 10, z: 0 });
    assert.equal(collectRightAngleCorners([horizontal, vertical]).length, 1);
  });

  test("non-right wall junctions do not get a square marker", () => {
    assert.equal(
      findRightAngleCorner(wall("first", 0, 0, 10, 0), wall("second", 10, 0, 14, 4)),
      null
    );
    assert.equal(
      findRightAngleCorner(wall("first", 0, 0, 10, 0), wall("almost", 10, 0, 10.2, 10)),
      null
    );
  });

  test("initial wall alignment recognises both page axes", () => {
    assert.equal(isAxisAlignedSegment({ x: 0, z: 0 }, { x: 10, z: 0.01 }), true);
    assert.equal(isAxisAlignedSegment({ x: 0, z: 0 }, { x: 0.01, z: 10 }), true);
    assert.equal(isAxisAlignedSegment({ x: 0, z: 0 }, { x: 10, z: 0.2 }), false);
    assert.equal(isAxisAlignedSegment({ x: 0, z: 0 }, { x: 10, z: 3 }), false);
  });

  test("door placement projects onto a wall and respects edge clearance", () => {
    const host = wall("host", 0, 0, 10, 0);
    assert.deepEqual(projectPointToWall({ x: 4, z: 3 }, host, 0.5), {
      point: { x: 4, z: 0 },
      offset: 0.4
    });
    assert.equal(projectPointToWall({ x: -2, z: 0 }, host, 0.5).offset, 0.05);
  });
});

describe("openings and glazing", () => {
  const hostWall = wall("host", 0, -5, 0, 5);
  const opening = (id, type) => ({
    id, wallId: "host", type, offset: 0.5, widthM: 2, heightM: 1.4, sillHeightM: type === "window" ? 0.9 : 0, hinge: "start", openAngleDeg: 45
  });

  test("a doorway is cut out of the wall", () => {
    const segments = collectOccluders([hostWall], [], [opening("d", "door")]);
    // Two stubs either side of the opening rather than one continuous wall.
    assert.equal(segments.length, 2);
    const reach = castRay({ x: -4, z: 0 }, 0, 20, segments);
    assert.equal(reach, 20, "a camera should see straight through an open doorway");
  });

  test("a window is cosmetic and never opens the wall", () => {
    const segments = collectOccluders([hostWall], [], [opening("w", "window")]);
    assert.equal(segments.length, 1, "the wall stays whole");
    assert.ok(castRay({ x: -4, z: 0 }, 0, 20, segments) < 5, "the wall still blocks");
  });

  test("a glass partition lets the view through along its whole length", () => {
    const glass = { ...wall("glass", 0, -5, 0, 5), blocksView: false, thicknessM: 0.06 };
    const segments = collectOccluders([glass], [], []);
    assert.equal(segments.length, 0, "glazing contributes no occluder");
    assert.equal(castRay({ x: -4, z: 0 }, 0, 20, segments), 20);
  });

  test("a window on a glass partition changes nothing", () => {
    const glass = { ...wall("host", 0, -5, 0, 5), blocksView: false };
    const segments = collectOccluders([glass], [], [opening("w", "window")]);
    assert.equal(segments.length, 0);
  });
});

describe("ray casting", () => {
  const segments = [{ a: { x: 5, z: -5 }, b: { x: 5, z: 5 }, heightM: 3 }];

  test("a wall stops the ray at its true distance", () => {
    const reach = castRay({ x: 0, z: 0 }, 0, 20, segments);
    assert.ok(Math.abs(reach - 5) < 1e-6, `expected 5 m, got ${reach}`);
  });

  test("a ray pointing away is unobstructed", () => {
    assert.equal(castRay({ x: 0, z: 0 }, Math.PI, 20, segments), 20);
  });

  test("low obstacles are seen over, not treated as walls", () => {
    const counter = [{ a: { x: 5, z: -5 }, b: { x: 5, z: 5 }, heightM: 0.9 }];
    // Lens at 3 m looking down to 1.7 m at 20 m: the sight line is well above 0.9 m at 5 m.
    const sightHeightAt = (d) => 3 + (1.7 - 3) * Math.min(1, d / 20);
    assert.equal(castRay({ x: 0, z: 0 }, 0, 20, counter, sightHeightAt), 20);
  });

  test("tall obstacles still block", () => {
    const pillar = [{ a: { x: 5, z: -5 }, b: { x: 5, z: 5 }, heightM: 2.9 }];
    const sightHeightAt = (d) => 3 + (1.7 - 3) * Math.min(1, d / 20);
    assert.ok(castRay({ x: 0, z: 0 }, 0, 20, pillar, sightHeightAt) < 6);
  });
});

describe("camera coverage", () => {
  const camera = {
    id: "c1",
    name: "test",
    position: { x: 1, z: 3 },
    yawDeg: 0,
    goal: "monitor",
    optics: { ...defaultCameraOptics, focalMm: 4, sensorWidthMm: 5.12, megapixel: 4, maxRangeM: 30 }
  };

  test("field of view matches the lens formula", () => {
    // 2 * atan(5.12 / (2*4)) = 65.5 degrees
    assert.ok(Math.abs(cameraFovDeg(camera) - 65.5) < 0.6, `got ${cameraFovDeg(camera)}`);
  });

  test("DORI distances are correctly ordered", () => {
    const coverage = computeCameraCoverage(camera, [], 32);
    const { detect, observe, recognize, identify } = coverage.doriDistances;
    assert.ok(detect > observe && observe > recognize && recognize > identify,
      `expected descending DORI distances, got ${JSON.stringify(coverage.doriDistances)}`);
  });

  test("pixel density falls with distance", () => {
    const near = ppmAtDistance(2560, 65.5, 5);
    const far = ppmAtDistance(2560, 65.5, 20);
    assert.ok(near > far);
    assert.ok(Math.abs(near / far - 4) < 0.05, "density should be inversely proportional to distance");
  });

  test("all four DORI zones are drawn for a normally-ranged camera", () => {
    // 4MP / 4mm gives a detect distance near 80 m, so a 90 m range clears every band.
    const wide = { ...camera, optics: { ...camera.optics, maxRangeM: 90 } };
    const coverage = computeCameraCoverage(wide, [], 64);
    const visible = coverage.bands.filter((band) => band.polygon.length >= 3);
    assert.equal(visible.length, 4, `expected 4 zones, got ${visible.length}`);
    assert.equal(coverage.truncatedByRange, false);
  });

  test("zones are disjoint rings, not stacked fans", () => {
    const ringSumFor = (maxRangeM) => {
      const coverage = computeCameraCoverage({ ...camera, optics: { ...camera.optics, maxRangeM } }, [], 64);
      const rings = coverage.bands.reduce(
        (sum, band) => sum + (band.polygon.length >= 3 ? polygonArea(band.polygon) : 0),
        0
      );
      return { rings, fan: polygonArea(coverage.polygon), coverage };
    };

    // Cut the fan at the detect distance: every part of it then belongs to exactly one
    // zone, so the rings must add up to the fan and no more. Nested fans would roughly
    // double this, since each inner zone would be counted again inside the outer ones.
    const detect = ringSumFor(90).coverage.doriDistances.detect;
    const exact = ringSumFor(detect);
    assert.ok(Math.abs(exact.rings / exact.fan - 1) < 0.02,
      `rings should tile the fan once, got ratio ${(exact.rings / exact.fan).toFixed(3)}`);

    // Past the detect distance the view is below every DORI grade, so the extra area is
    // deliberately unowned — the rings must not stretch to fill it.
    const longer = ringSumFor(90);
    assert.ok(longer.rings < longer.fan, "no zone may claim ground below detect grade");
    assert.ok(Math.abs(longer.rings - exact.rings) < exact.rings * 0.02,
      "a longer range must not change the graded zones themselves");
  });

  test("each ring starts where the previous one ends", () => {
    const wide = { ...camera, optics: { ...camera.optics, maxRangeM: 90 } };
    const { bands } = computeCameraCoverage(wide, [], 32);
    for (let index = 1; index < bands.length; index += 1) {
      assert.ok(Math.abs(bands[index].innerDistanceM - bands[index - 1].outerDistanceM) < 1e-6,
        `gap between ${bands[index - 1].key} and ${bands[index].key}`);
    }
    assert.equal(bands[0].innerDistanceM, 0, "the tightest zone must start at the lens");
  });

  test("a short effective range drops outer zones and says so", () => {
    const short = { ...camera, optics: { ...camera.optics, maxRangeM: 6 } };
    const coverage = computeCameraCoverage(short, [], 32);
    const visible = coverage.bands.filter((band) => band.polygon.length >= 3);
    assert.ok(visible.length < 4, "a 6 m range cannot reach the detect distance");
    assert.equal(coverage.truncatedByRange, true, "the missing zones must be reported");
  });

  test("a PTZ sweep still produces all four zones", () => {
    const ptz = { ...camera, housing: "ptz", optics: { ...camera.optics, maxRangeM: 90 } };
    const coverage = computeCameraCoverage(ptz, [], 64);
    assert.equal(coverage.coverageMode, "ptz-patrol");
    assert.equal(coverage.bands.filter((band) => band.polygon.length >= 3).length, 4);
  });

  test("walls clip the coverage polygon", () => {
    const occluders = room.map((item) => ({ a: item.a, b: item.b, heightM: item.heightM }));
    const clipped = computeCameraCoverage(camera, occluders, 48);
    const open = computeCameraCoverage(camera, [], 48);
    const reach = (coverage) => Math.max(...coverage.polygon.map((p) => Math.hypot(p.x - camera.position.x, p.z - camera.position.z)));
    assert.ok(reach(clipped) < reach(open), "the room should cut the fan short");
  });
});

describe("floor duplication", () => {
  test("a duplicated floor shares no ids or object references", () => {
    const source = createFloor("همکف", 0);
    source.walls.push(wall("w1", 0, 0, 5, 0));
    source.doors.push({ id: "door-1", wallId: "w1", offset: 0.5, widthM: 0.9, heightM: 2.1, hinge: "start", openAngleDeg: 45 });
    source.cameras.push({ id: "cam-1", name: "دوربین ۱", position: { x: 2, z: 2 }, yawDeg: 0, goal: "monitor", optics: { ...defaultCameraOptics } });

    const copy = duplicateFloor(source, "طبقه اول", 1);

    assert.notEqual(copy.id, source.id);
    assert.notEqual(copy.walls[0].id, source.walls[0].id);
    assert.notEqual(copy.doors[0].id, source.doors[0].id);
    assert.equal(copy.doors[0].wallId, copy.walls[0].id);
    assert.notEqual(copy.cameras[0].id, source.cameras[0].id);

    // Moving the copy's camera must not disturb the original.
    copy.cameras[0].position.x = 9;
    assert.equal(source.cameras[0].position.x, 2);

    copy.optics = undefined;
    assert.equal(source.cameras[0].optics.focalMm, defaultCameraOptics.focalMm);
  });
});
