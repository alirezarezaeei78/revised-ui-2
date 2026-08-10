import type { PlanDoor, PlanObstacle, PlanWall, Vec2 } from "@/src/domain/planner/types";

/** 2D plan geometry: areas, segment maths and the ray casting the coverage engine uses. */

export type Segment = { a: Vec2; b: Vec2; heightM: number };

export const add = (p: Vec2, q: Vec2): Vec2 => ({ x: p.x + q.x, z: p.z + q.z });
export const sub = (p: Vec2, q: Vec2): Vec2 => ({ x: p.x - q.x, z: p.z - q.z });
export const scale = (p: Vec2, k: number): Vec2 => ({ x: p.x * k, z: p.z * k });
export const length = (p: Vec2) => Math.hypot(p.x, p.z);
export const distance = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.z - q.z);

export function snapTo(value: number, step: number) {
  return step > 0 ? Math.round(value / step) * step : value;
}

export function snapPoint(point: Vec2, step: number): Vec2 {
  return { x: snapTo(point.x, step), z: snapTo(point.z, step) };
}

export function projectPointToWall(point: Vec2, wall: PlanWall, edgeInsetM = 0): { point: Vec2; offset: number } {
  const dx = wall.b.x - wall.a.x;
  const dz = wall.b.z - wall.a.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 1e-9) return { point: { ...wall.a }, offset: 0 };
  const lengthM = Math.sqrt(lengthSquared);
  const inset = Math.min(0.49, Math.max(0, edgeInsetM / lengthM));
  const rawOffset = ((point.x - wall.a.x) * dx + (point.z - wall.a.z) * dz) / lengthSquared;
  const offset = Math.max(inset, Math.min(1 - inset, rawOffset));
  return {
    point: { x: wall.a.x + dx * offset, z: wall.a.z + dz * offset },
    offset
  };
}

export type EqualParallelWallSnap = {
  point: Vec2;
  guideFrom: Vec2;
  guideTo: Vec2;
  referenceWallId: string;
  lengthM: number;
};

/**
 * Finds the closest endpoint that makes a new wall exactly parallel and equal in length
 * to an existing wall. The matching reference endpoint is returned for a smart guide.
 */
export function snapWallToEqualParallel(
  start: Vec2,
  point: Vec2,
  walls: PlanWall[],
  toleranceM: number
): EqualParallelWallSnap | null {
  let best: (EqualParallelWallSnap & { pointerDistanceM: number }) | null = null;

  for (const wall of walls) {
    const wallLengthM = distance(wall.a, wall.b);
    if (wallLengthM < 0.2) continue;

    for (const [referenceStart, referenceEnd] of [[wall.a, wall.b], [wall.b, wall.a]] as const) {
      const candidate = {
        x: start.x + referenceEnd.x - referenceStart.x,
        z: start.z + referenceEnd.z - referenceStart.z
      };
      const pointerDistanceM = distance(point, candidate);
      if (pointerDistanceM > toleranceM || (best && pointerDistanceM >= best.pointerDistanceM)) continue;

      best = {
        point: candidate,
        guideFrom: referenceEnd,
        guideTo: candidate,
        referenceWallId: wall.id,
        lengthM: wallLengthM,
        pointerDistanceM
      };
    }
  }

  if (!best) return null;
  return {
    point: best.point,
    guideFrom: best.guideFrom,
    guideTo: best.guideTo,
    referenceWallId: best.referenceWallId,
    lengthM: best.lengthM
  };
}

export type RightAngleCorner = {
  corner: Vec2;
  armA: Vec2;
  armB: Vec2;
};

export function isAxisAlignedSegment(a: Vec2, b: Vec2, toleranceDeg = 0.15): boolean {
  const dx = Math.abs(b.x - a.x);
  const dz = Math.abs(b.z - a.z);
  const span = Math.hypot(dx, dz);
  if (span < 0.1) return false;
  return Math.min(dx, dz) / span <= Math.sin((toleranceDeg * Math.PI) / 180);
}

function sharedWallCorner(first: PlanWall, second: PlanWall, toleranceM: number): RightAngleCorner | null {
  const endpointPairs = [
    [first.a, first.b, second.a, second.b],
    [first.a, first.b, second.b, second.a],
    [first.b, first.a, second.a, second.b],
    [first.b, first.a, second.b, second.a]
  ] as const;

  for (const [firstCorner, firstOther, secondCorner, secondOther] of endpointPairs) {
    if (distance(firstCorner, secondCorner) > toleranceM) continue;
    const firstLength = distance(firstCorner, firstOther);
    const secondLength = distance(secondCorner, secondOther);
    if (firstLength < 0.2 || secondLength < 0.2) continue;
    const armA = {
      x: (firstOther.x - firstCorner.x) / firstLength,
      z: (firstOther.z - firstCorner.z) / firstLength
    };
    const armB = {
      x: (secondOther.x - secondCorner.x) / secondLength,
      z: (secondOther.z - secondCorner.z) / secondLength
    };
    return { corner: firstCorner, armA, armB };
  }
  return null;
}

export function findRightAngleCorner(
  first: PlanWall,
  second: PlanWall,
  endpointToleranceM = 0.05,
  angleToleranceDeg = 0.15
): RightAngleCorner | null {
  const corner = sharedWallCorner(first, second, endpointToleranceM);
  if (!corner) return null;
  const dot = corner.armA.x * corner.armB.x + corner.armA.z * corner.armB.z;
  return Math.abs(dot) <= Math.sin((angleToleranceDeg * Math.PI) / 180) ? corner : null;
}

export function collectRightAngleCorners(walls: PlanWall[]): RightAngleCorner[] {
  const corners: RightAngleCorner[] = [];
  for (let firstIndex = 0; firstIndex < walls.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < walls.length; secondIndex += 1) {
      const corner = findRightAngleCorner(walls[firstIndex], walls[secondIndex]);
      if (corner) corners.push(corner);
    }
  }
  return corners;
}

/** Shoelace. Returns absolute area, so winding order does not matter. */
export function polygonArea(points: Vec2[]): number {
  if (points.length < 3) return 0;
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    total += current.x * next.z - next.x * current.z;
  }
  return Math.abs(total) / 2;
}

/** Andrew's monotone chain. Used as the area fallback when walls do not close a loop. */
export function convexHull(points: Vec2[]): Vec2[] {
  if (points.length < 3) return [...points];
  const sorted = [...points].sort((p, q) => p.x - q.x || p.z - q.z);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

  const build = (source: Vec2[]) => {
    const chain: Vec2[] = [];
    for (const point of source) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0) chain.pop();
      chain.push(point);
    }
    chain.pop();
    return chain;
  };

  return [...build(sorted), ...build([...sorted].reverse())];
}

/** The four edges of a rotated rectangle, in plan space. */
export function obstacleCorners(obstacle: PlanObstacle): Vec2[] {
  const radians = (obstacle.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfWidth = obstacle.widthM / 2;
  const halfDepth = obstacle.depthM / 2;
  return [
    { x: -halfWidth, z: -halfDepth },
    { x: halfWidth, z: -halfDepth },
    { x: halfWidth, z: halfDepth },
    { x: -halfWidth, z: halfDepth }
  ].map((corner) => ({
    x: obstacle.center.x + corner.x * cos - corner.z * sin,
    z: obstacle.center.z + corner.x * sin + corner.z * cos
  }));
}

export function obstacleSegments(obstacle: PlanObstacle): Segment[] {
  const corners = obstacleCorners(obstacle);
  return corners.map((corner, index) => ({
    a: corner,
    b: corners[(index + 1) % corners.length],
    heightM: obstacle.heightM
  }));
}

export function wallSegment(wall: PlanWall): Segment {
  return { a: wall.a, b: wall.b, heightM: wall.heightM };
}

/** Occluding geometry for one floor, ready for ray casting. */
export function collectOccluders(walls: PlanWall[], obstacles: PlanObstacle[], doors: PlanDoor[] = []): Segment[] {
  const segments: Segment[] = [];
  for (const wall of walls) {
    if (!wall.blocksView) continue;
    const span = distance(wall.a, wall.b);
    const openings = doors
      /*
       * Only doorways are cut out of the wall.
       *
       * A window is a cosmetic element drawn on the wall — the masonry around and behind
       * it still stops a camera, so it must not create a gap in the occluder. Seeing
       * *through* a boundary is a property of the wall itself (`blocksView: false`),
       * which is how a glass partition is modelled.
       */
      .filter((door) => door.wallId === wall.id && door.type !== "window")
      .map((door) => {
        const halfOffset = span > 0 ? Math.min(0.49, door.widthM / span / 2) : 0;
        return {
          start: Math.max(0, door.offset - halfOffset),
          end: Math.min(1, door.offset + halfOffset)
        };
      })
      .sort((first, second) => first.start - second.start);
    if (!openings.length) {
      segments.push(wallSegment(wall));
      continue;
    }

    let cursor = 0;
    const pointAt = (offset: number): Vec2 => ({
      x: wall.a.x + (wall.b.x - wall.a.x) * offset,
      z: wall.a.z + (wall.b.z - wall.a.z) * offset
    });
    for (const opening of openings) {
      if (opening.start > cursor + 1e-4) {
        segments.push({ a: pointAt(cursor), b: pointAt(opening.start), heightM: wall.heightM });
      }
      cursor = Math.max(cursor, opening.end);
    }
    if (cursor < 1 - 1e-4) {
      segments.push({ a: pointAt(cursor), b: pointAt(1), heightM: wall.heightM });
    }
  }
  for (const obstacle of obstacles) if (obstacle.blocksView) segments.push(...obstacleSegments(obstacle));
  return segments;
}

/**
 * Distance from `origin` along `angle` to the first segment hit, or `maxRange`.
 *
 * `sightHeightAt` lets the caller decide whether a given obstacle is actually tall enough
 * to block: a camera three metres up looking down at a person sees straight over a
 * waist-high counter, and treating that counter as a wall would invent blind spots.
 */
export function castRay(
  origin: Vec2,
  angleRad: number,
  maxRange: number,
  segments: Segment[],
  sightHeightAt?: (distanceAlongRay: number) => number
): number {
  const dirX = Math.cos(angleRad);
  const dirZ = Math.sin(angleRad);
  let nearest = maxRange;

  for (const segment of segments) {
    const segX = segment.b.x - segment.a.x;
    const segZ = segment.b.z - segment.a.z;
    const denominator = dirX * segZ - dirZ * segX;
    if (Math.abs(denominator) < 1e-9) continue;

    const deltaX = segment.a.x - origin.x;
    const deltaZ = segment.a.z - origin.z;
    // t = distance along the ray, u = normalised position along the segment.
    const t = (deltaX * segZ - deltaZ * segX) / denominator;
    const u = (deltaX * dirZ - deltaZ * dirX) / denominator;
    if (t <= 1e-6 || t >= nearest || u < 0 || u > 1) continue;

    if (sightHeightAt && segment.heightM < sightHeightAt(t)) continue;
    nearest = t;
  }

  return nearest;
}

/** Ordered fan of visible points across a field of view, used as the coverage polygon. */
export function visibilityFan(
  origin: Vec2,
  headingRad: number,
  fovRad: number,
  maxRange: number,
  segments: Segment[],
  rays: number,
  sightHeightAt?: (distanceAlongRay: number) => number
): Vec2[] {
  const points: Vec2[] = [origin];
  const steps = Math.max(8, rays);
  for (let index = 0; index <= steps; index += 1) {
    const angle = headingRad - fovRad / 2 + (fovRad * index) / steps;
    const reach = castRay(origin, angle, maxRange, segments, sightHeightAt);
    points.push({ x: origin.x + Math.cos(angle) * reach, z: origin.z + Math.sin(angle) * reach });
  }
  return points;
}

/**
 * Visible band between two radii, as a closed ring.
 *
 * Nested fans were stacking four translucent layers on the same ground, so the inner
 * zones showed through as a muddy blend and the widest one covered the rest. A ring is
 * the region a band actually owns, which lets each be drawn once in a solid colour.
 *
 * The outer arc is walked forward and the inner arc back, which closes cleanly because a
 * visibility fan is star-shaped about the origin. `innerRange` of 0 degenerates to the
 * ordinary fan, apex included.
 */
export function visibilityRing(
  origin: Vec2,
  headingRad: number,
  fovRad: number,
  innerRange: number,
  outerRange: number,
  segments: Segment[],
  rays: number,
  sightHeightAt?: (distanceAlongRay: number) => number
): Vec2[] {
  if (!(outerRange > innerRange)) return [];
  const steps = Math.max(8, rays);
  const outer: Vec2[] = [];
  const inner: Vec2[] = [];

  for (let index = 0; index <= steps; index += 1) {
    const angle = fovRad >= Math.PI * 2
      ? (index / steps) * Math.PI * 2
      : headingRad - fovRad / 2 + (fovRad * index) / steps;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // One cast per ray, reused for both radii: an occluder that stops the ray short
    // truncates the outer edge and collapses the ring to nothing past that point.
    const reach = castRay(origin, angle, outerRange, segments, sightHeightAt);
    const outerReach = Math.min(reach, outerRange);
    const innerReach = Math.min(reach, innerRange);
    outer.push({ x: origin.x + cos * outerReach, z: origin.z + sin * outerReach });
    inner.push({ x: origin.x + cos * innerReach, z: origin.z + sin * innerReach });
  }

  if (innerRange <= 1e-6) return [origin, ...outer];
  return [...outer, ...inner.reverse()];
}

export type PlanRect = { minX: number; maxX: number; minZ: number; maxZ: number };

export function rectFromPoints(a: Vec2, b: Vec2): PlanRect {
  return {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minZ: Math.min(a.z, b.z),
    maxZ: Math.max(a.z, b.z)
  };
}

export function pointInRect(point: Vec2, rect: PlanRect): boolean {
  return point.x >= rect.minX && point.x <= rect.maxX && point.z >= rect.minZ && point.z <= rect.maxZ;
}

/**
 * Whether a segment touches a rectangle at all.
 *
 * A marquee must catch a long wall that merely crosses the box, not just one whose
 * endpoint happens to fall inside it — dragging over the middle of a room should select
 * its walls. Endpoints are tested first because that is the common case and is cheap;
 * the edge tests then catch the crossing case.
 */
export function segmentIntersectsRect(a: Vec2, b: Vec2, rect: PlanRect): boolean {
  if (pointInRect(a, rect) || pointInRect(b, rect)) return true;

  const corners: Vec2[] = [
    { x: rect.minX, z: rect.minZ },
    { x: rect.maxX, z: rect.minZ },
    { x: rect.maxX, z: rect.maxZ },
    { x: rect.minX, z: rect.maxZ }
  ];
  for (let index = 0; index < corners.length; index += 1) {
    if (segmentsIntersect(a, b, corners[index], corners[(index + 1) % corners.length])) return true;
  }
  return false;
}

function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const orient = (a: Vec2, b: Vec2, c: Vec2) => Math.sign((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
  const o1 = orient(p1, p2, p3);
  const o2 = orient(p1, p2, p4);
  const o3 = orient(p3, p4, p1);
  const o4 = orient(p3, p4, p2);
  return o1 !== o2 && o3 !== o4;
}

/** Rotated rectangle overlap, tested via its corners and its own edges. */
export function obstacleIntersectsRect(corners: Vec2[], rect: PlanRect): boolean {
  if (corners.some((corner) => pointInRect(corner, rect))) return true;
  for (let index = 0; index < corners.length; index += 1) {
    if (segmentIntersectsRect(corners[index], corners[(index + 1) % corners.length], rect)) return true;
  }
  return false;
}

export function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index];
    const last = polygon[previous];
    const straddles = current.z > point.z !== last.z > point.z;
    if (!straddles) continue;
    const crossingX = ((last.x - current.x) * (point.z - current.z)) / (last.z - current.z) + current.x;
    if (point.x < crossingX) inside = !inside;
  }
  return inside;
}

export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

export function boundsOf(points: Vec2[]): Bounds | null {
  if (!points.length) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.z < minZ) minZ = point.z;
    if (point.z > maxZ) maxZ = point.z;
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Traces wall endpoints into a closed loop.
 *
 * Returns null when the walls do not form a single closed ring, which is the normal case
 * mid-drawing; callers fall back to the convex hull so the reported area never jumps to
 * zero while the user is still working.
 */
export function traceWallLoop(walls: PlanWall[], tolerance = 0.05): Vec2[] | null {
  if (walls.length < 3) return null;

  const remaining = walls.map((wall) => ({ a: wall.a, b: wall.b }));
  const start = remaining.shift()!;
  const loop: Vec2[] = [start.a, start.b];

  while (remaining.length) {
    const tail = loop[loop.length - 1];
    const index = remaining.findIndex(
      (wall) => distance(wall.a, tail) <= tolerance || distance(wall.b, tail) <= tolerance
    );
    if (index === -1) return null;
    const [next] = remaining.splice(index, 1);
    loop.push(distance(next.a, tail) <= tolerance ? next.b : next.a);
  }

  const closed = distance(loop[0], loop[loop.length - 1]) <= tolerance;
  if (!closed) return null;
  loop.pop();
  return loop.length >= 3 ? loop : null;
}

const wallPointKey = (point: Vec2, toleranceM = 0.05) =>
  `${Math.round(point.x / toleranceM)}:${Math.round(point.z / toleranceM)}`;

/**
 * Finds the largest actual closed wall cycle while ignoring internal partitions and
 * smaller inner rooms. This keeps area and optimisation valid on architectural plans
 * that contain more than a bare exterior rectangle.
 */
export function largestClosedWallLoop(walls: PlanWall[]): Vec2[] | null {
  if (walls.length < 3) return null;
  const edges = walls.map((wall, index) => ({
    index,
    a: wall.a,
    b: wall.b,
    aKey: wallPointKey(wall.a),
    bKey: wallPointKey(wall.b)
  }));
  const adjacency = new Map<string, number[]>();
  for (const edge of edges) {
    adjacency.set(edge.aKey, [...(adjacency.get(edge.aKey) ?? []), edge.index]);
    adjacency.set(edge.bKey, [...(adjacency.get(edge.bKey) ?? []), edge.index]);
  }

  let best: Vec2[] | null = null;
  let bestArea = 0;
  let explored = 0;
  const maxExplorations = Math.max(2_000, walls.length * walls.length * 4);
  const walk = (startKey: string, currentKey: string, path: Vec2[], used: Set<number>) => {
    if (explored++ > maxExplorations) return;
    if (currentKey === startKey && used.size >= 3) {
      const loop = path.slice(0, -1);
      const area = polygonArea(loop);
      if (area > bestArea) {
        bestArea = area;
        best = loop;
      }
      return;
    }
    if (used.size >= walls.length) return;
    for (const edgeIndex of adjacency.get(currentKey) ?? []) {
      if (used.has(edgeIndex)) continue;
      const edge = edges[edgeIndex];
      const nextKey = edge.aKey === currentKey ? edge.bKey : edge.aKey;
      const nextPoint = edge.aKey === currentKey ? edge.b : edge.a;
      used.add(edgeIndex);
      walk(startKey, nextKey, [...path, nextPoint], used);
      used.delete(edgeIndex);
    }
  };

  for (const edge of edges) {
    walk(edge.aKey, edge.bKey, [edge.a, edge.b], new Set([edge.index]));
    walk(edge.bKey, edge.aKey, [edge.b, edge.a], new Set([edge.index]));
  }
  return bestArea > 0.5 ? best : null;
}

/** Enclosed floor area in square metres. Open wall chains never produce a guessed area. */
export function floorAreaM2(walls: PlanWall[]): number {
  const loop = traceWallLoop(walls) ?? largestClosedWallLoop(walls);
  return loop ? polygonArea(loop) : 0;
}
