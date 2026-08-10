import type { FloorPlan, PlanSelection, PlanSelectionRef } from "@/src/domain/planner/types";
import {
  obstacleCorners,
  obstacleIntersectsRect,
  pointInRect,
  segmentIntersectsRect,
  type PlanRect
} from "@/src/lib/planner/geometry";

/**
 * Turns a dragged rectangle into a set of selected elements.
 *
 * Kept out of the canvas component so the rule "what counts as inside the box" is one
 * testable function rather than something buried in a pointer handler.
 */
export function elementsInRect(floor: FloorPlan, rect: PlanRect): PlanSelectionRef[] {
  const hits: PlanSelectionRef[] = [];

  for (const wall of floor.walls) {
    if (segmentIntersectsRect(wall.a, wall.b, rect)) hits.push({ kind: "wall", id: wall.id });
  }

  // Openings follow their host wall, so they are matched at their own position along it
  // rather than by the whole wall — dragging over one end of a wall should not sweep up
  // a door at the far end.
  for (const door of floor.doors ?? []) {
    const wall = floor.walls.find((item) => item.id === door.wallId);
    if (!wall) continue;
    const center = {
      x: wall.a.x + (wall.b.x - wall.a.x) * door.offset,
      z: wall.a.z + (wall.b.z - wall.a.z) * door.offset
    };
    if (pointInRect(center, rect)) hits.push({ kind: "door", id: door.id });
  }

  for (const obstacle of floor.obstacles) {
    if (obstacleIntersectsRect(obstacleCorners(obstacle), rect)) hits.push({ kind: "obstacle", id: obstacle.id });
  }

  for (const camera of floor.cameras) {
    if (pointInRect(camera.position, rect)) hits.push({ kind: "camera", id: camera.id });
  }

  return hits;
}

/** Union of two selections, preserving order and dropping duplicates. */
export function mergeSelection(base: PlanSelection, additions: PlanSelectionRef[]): PlanSelection {
  const seen = new Set(base.map((item) => `${item.kind}:${item.id}`));
  const merged = [...base];
  for (const ref of additions) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(ref);
  }
  return merged;
}

/** Removes every selected element from the floor in one pass. */
export function deleteSelection(floor: FloorPlan, selection: PlanSelection): FloorPlan {
  const wallIds = new Set(selection.filter((item) => item.kind === "wall").map((item) => item.id));
  const doorIds = new Set(selection.filter((item) => item.kind === "door").map((item) => item.id));
  const obstacleIds = new Set(selection.filter((item) => item.kind === "obstacle").map((item) => item.id));
  const cameraIds = new Set(selection.filter((item) => item.kind === "camera").map((item) => item.id));

  return {
    ...floor,
    walls: floor.walls.filter((wall) => !wallIds.has(wall.id)),
    // Openings cannot outlive their wall, so deleting a wall takes its doors and windows
    // with it even when they were not part of the selection.
    doors: (floor.doors ?? []).filter((door) => !doorIds.has(door.id) && !wallIds.has(door.wallId)),
    obstacles: floor.obstacles.filter((obstacle) => !obstacleIds.has(obstacle.id)),
    cameras: floor.cameras.filter((camera) => !cameraIds.has(camera.id))
  };
}

export type SelectionSummary = { kind: PlanSelectionRef["kind"]; label: string; count: number };

const kindLabels: Record<PlanSelectionRef["kind"], string> = {
  wall: "دیوار",
  door: "در و پنجره",
  obstacle: "مانع و عناصر محوطه",
  camera: "دوربین"
};

export function summariseSelection(selection: PlanSelection): SelectionSummary[] {
  const order: PlanSelectionRef["kind"][] = ["camera", "wall", "door", "obstacle"];
  return order
    .map((kind) => ({ kind, label: kindLabels[kind], count: selection.filter((item) => item.kind === kind).length }))
    .filter((entry) => entry.count > 0);
}

/** Human-readable name for one selected element, for the multi-selection list. */
export function describeElement(floor: FloorPlan, ref: PlanSelectionRef): string {
  if (ref.kind === "camera") {
    return floor.cameras.find((item) => item.id === ref.id)?.name ?? "دوربین";
  }
  if (ref.kind === "obstacle") {
    return floor.obstacles.find((item) => item.id === ref.id)?.label ?? "مانع";
  }
  if (ref.kind === "door") {
    const door = (floor.doors ?? []).find((item) => item.id === ref.id);
    return door?.type === "window" ? "پنجره" : "در";
  }
  const wall = floor.walls.find((item) => item.id === ref.id);
  if (!wall) return "دیوار";
  return `دیوار ${Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z).toFixed(1)} متر`;
}
