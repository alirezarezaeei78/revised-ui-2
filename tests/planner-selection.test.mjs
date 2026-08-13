import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  obstacleIntersectsRect,
  pointInRect,
  rectFromPoints,
  segmentIntersectsRect,
  obstacleCorners
} from "@/src/lib/planner/geometry";
import {
  deleteSelection,
  describeElement,
  elementsInRect,
  mergeSelection,
  summariseSelection
} from "@/src/lib/planner/selection";
import { defaultCameraOptics, isSelected, soleSelection, toggleSelection } from "@/src/domain/planner/types";
import { obstaclePresets } from "@/src/lib/planner/obstacle-presets";

const wall = (id, ax, az, bx, bz) => ({
  id, a: { x: ax, z: az }, b: { x: bx, z: bz }, heightM: 3, thicknessM: 0.2, blocksView: true
});

const obstacle = (id, x, z, w = 2, d = 2) => ({
  id, label: id, kind: "block", center: { x, z }, widthM: w, depthM: d, heightM: 1, rotationDeg: 0, blocksView: true
});

const camera = (id, x, z) => ({
  id, name: id, position: { x, z }, yawDeg: 0, goal: "monitor", optics: { ...defaultCameraOptics }
});

/** 10 × 6 room with a door, two obstacles and two cameras. */
const floor = () => ({
  id: "f1",
  name: "همکف",
  elevationM: 0,
  heightM: 3.2,
  walls: [wall("w-top", 0, 0, 10, 0), wall("w-right", 10, 0, 10, 6), wall("w-bottom", 10, 6, 0, 6), wall("w-left", 0, 6, 0, 0)],
  doors: [{ id: "d1", wallId: "w-top", offset: 0.2, widthM: 0.9, heightM: 2.1, hinge: "start", openAngleDeg: 45 }],
  obstacles: [obstacle("o-near", 2, 2), obstacle("o-far", 8, 5)],
  cameras: [camera("c-near", 1, 1), camera("c-far", 9, 5)]
});

describe("rectangle hit testing", () => {
  const rect = rectFromPoints({ x: 0, z: 0 }, { x: 4, z: 4 });

  test("rect normalises whichever way it was dragged", () => {
    const backwards = rectFromPoints({ x: 4, z: 4 }, { x: 0, z: 0 });
    assert.deepEqual(backwards, rect);
  });

  test("points inside and outside", () => {
    assert.equal(pointInRect({ x: 2, z: 2 }, rect), true);
    assert.equal(pointInRect({ x: 5, z: 2 }, rect), false);
  });

  test("a segment crossing the box counts, even with both ends outside", () => {
    // Dragging over the middle of a long wall must select it.
    assert.equal(segmentIntersectsRect({ x: -5, z: 2 }, { x: 9, z: 2 }, rect), true);
  });

  test("a segment clear of the box does not count", () => {
    assert.equal(segmentIntersectsRect({ x: -5, z: 9 }, { x: 9, z: 9 }, rect), false);
  });

  test("a rotated obstacle overlapping the box counts", () => {
    const rotated = { ...obstacle("o", 4.6, 4.6, 3, 3), rotationDeg: 45 };
    assert.equal(obstacleIntersectsRect(obstacleCorners(rotated), rect), true);
  });
});

describe("marquee selection", () => {
  test("a box over one corner picks up only what it covers", () => {
    const hits = elementsInRect(floor(), rectFromPoints({ x: -1, z: -1 }, { x: 3.5, z: 3.5 }));
    const ids = hits.map((hit) => hit.id);
    assert.ok(ids.includes("c-near"), "the near camera is inside");
    assert.ok(ids.includes("o-near"), "the near obstacle is inside");
    assert.ok(!ids.includes("c-far"), "the far camera must stay out");
    assert.ok(!ids.includes("o-far"), "the far obstacle must stay out");
  });

  test("a box over everything selects every element", () => {
    const hits = elementsInRect(floor(), rectFromPoints({ x: -2, z: -2 }, { x: 12, z: 8 }));
    // 4 walls + 1 door + 2 obstacles + 2 cameras
    assert.equal(hits.length, 9);
  });

  test("a door is matched at its own position, not its whole wall", () => {
    // The door sits at 20% along the top wall, so a box over the far end misses it.
    const farEnd = elementsInRect(floor(), rectFromPoints({ x: 8, z: -0.5 }, { x: 9.5, z: 0.5 }));
    assert.ok(!farEnd.some((hit) => hit.kind === "door"), "the door is at the other end");

    const nearEnd = elementsInRect(floor(), rectFromPoints({ x: 1.5, z: -0.5 }, { x: 2.5, z: 0.5 }));
    assert.ok(nearEnd.some((hit) => hit.kind === "door"), "the door is inside this box");
  });

  test("an empty box selects nothing", () => {
    assert.equal(elementsInRect(floor(), rectFromPoints({ x: 20, z: 20 }, { x: 25, z: 25 })).length, 0);
  });
});

describe("preset placement", () => {
  test("a dropped preset keeps the preset's own blocking behaviour", () => {
    // The designer used to hard-code blocksView:true, which made lawns and coffee
    // tables carve blind spots the moment they were added.
    const lawn = obstaclePresets.find((preset) => preset.id === "grass");
    const wardrobe = obstaclePresets.find((preset) => preset.id === "wardrobe");
    assert.equal(lawn.blocksView ?? true, false);
    assert.equal(wardrobe.blocksView ?? true, true);
  });

  test("every category is reachable and non-empty", () => {
    for (const group of ["living", "bedroom", "kitchen", "office", "retail", "landscape", "tree", "site", "vehicle", "structure"]) {
      assert.ok(
        obstaclePresets.some((preset) => preset.group === group),
        `${group} has no presets, so its menu would render nothing`
      );
    }
  });
});

describe("selection bookkeeping", () => {
  test("merging drops duplicates and keeps order", () => {
    const base = [{ kind: "camera", id: "c-near" }];
    const merged = mergeSelection(base, [{ kind: "camera", id: "c-near" }, { kind: "wall", id: "w-top" }]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].id, "c-near");
  });

  test("toggling adds then removes the same element", () => {
    const ref = { kind: "camera", id: "c-near" };
    const added = toggleSelection([], ref);
    assert.equal(isSelected(added, "camera", "c-near"), true);
    assert.equal(toggleSelection(added, ref).length, 0);
  });

  test("sole selection is only defined for exactly one element", () => {
    assert.equal(soleSelection([]), null);
    assert.equal(soleSelection([{ kind: "wall", id: "w-top" }]).id, "w-top");
    assert.equal(soleSelection([{ kind: "wall", id: "w-top" }, { kind: "wall", id: "w-left" }]), null);
  });

  test("summary groups by kind and skips empty kinds", () => {
    const summary = summariseSelection([
      { kind: "camera", id: "a" }, { kind: "camera", id: "b" }, { kind: "wall", id: "w" }
    ]);
    assert.equal(summary.length, 2);
    assert.equal(summary.find((entry) => entry.kind === "camera").count, 2);
  });
});

describe("bulk delete", () => {
  test("removes exactly the selected elements", () => {
    const next = deleteSelection(floor(), [{ kind: "camera", id: "c-near" }, { kind: "obstacle", id: "o-far" }]);
    assert.equal(next.cameras.length, 1);
    assert.equal(next.cameras[0].id, "c-far");
    assert.equal(next.obstacles.length, 1);
    assert.equal(next.obstacles[0].id, "o-near");
    assert.equal(next.walls.length, 4, "walls were not selected");
  });

  test("deleting a wall takes its openings with it", () => {
    const next = deleteSelection(floor(), [{ kind: "wall", id: "w-top" }]);
    assert.equal(next.walls.length, 3);
    assert.equal(next.doors.length, 0, "the door on that wall cannot outlive it");
  });

  test("deleting everything leaves an empty floor", () => {
    const source = floor();
    const everything = elementsInRect(source, rectFromPoints({ x: -5, z: -5 }, { x: 15, z: 15 }));
    const next = deleteSelection(source, everything);
    assert.equal(next.walls.length + next.doors.length + next.obstacles.length + next.cameras.length, 0);
  });

  test("the source floor is never mutated", () => {
    const source = floor();
    deleteSelection(source, [{ kind: "camera", id: "c-near" }]);
    assert.equal(source.cameras.length, 2, "delete must return a new floor");
  });
});

describe("element labels", () => {
  test("each kind gets a readable name", () => {
    const source = floor();
    assert.equal(describeElement(source, { kind: "camera", id: "c-near" }), "c-near");
    assert.equal(describeElement(source, { kind: "obstacle", id: "o-near" }), "o-near");
    assert.equal(describeElement(source, { kind: "door", id: "d1" }), "در");
    assert.match(describeElement(source, { kind: "wall", id: "w-top" }), /دیوار/);
  });

  test("a window is named as one", () => {
    const source = floor();
    source.doors[0].type = "window";
    assert.equal(describeElement(source, { kind: "door", id: "d1" }), "پنجره");
  });
});
