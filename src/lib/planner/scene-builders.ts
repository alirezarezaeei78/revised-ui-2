import type * as THREE_NS from "three";
import type { FloorPlan, PlanBackdrop, PlanDoor, PlanObstacle, PlanWall, Vec2 } from "@/src/domain/planner/types";
import type { CameraCoverage } from "@/src/lib/planner/coverage";
import { obstacleCorners, type RightAngleCorner } from "@/src/lib/planner/geometry";

/**
 * Mesh construction for the plan scene.
 *
 * The three.js module is passed in rather than imported: the designer loads it
 * dynamically on the client, and importing it here would pull WebGL into the server
 * bundle. Plan space (x, z) maps straight onto world (x, 0, z), so no axis conversion
 * happens anywhere between the editor and the coverage engine.
 */

type ThreeModule = typeof THREE_NS;

export const palette = {
  wall: 0x64748b,
  wallSelected: 0x0ea5e9,
  wallGlass: 0x93c5fd,
  obstacle: 0x94a3b8,
  obstacleSelected: 0x0ea5e9,
  cameraBody: 0x0f5f99,
  cameraSelected: 0xf59e0b,
  preview: 0x1976b7
};

export function disposeGroup(group: THREE_NS.Group) {
  const disposeMaterial = (item: THREE_NS.Material) => {
    const texture = (item as THREE_NS.MeshBasicMaterial).map;
    texture?.dispose();
    item.dispose();
  };
  group.traverse((child) => {
    const mesh = child as THREE_NS.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE_NS.Material | THREE_NS.Material[] | undefined;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else if (material) disposeMaterial(material);
  });
  group.clear();
}

export function buildWallMesh(THREE: ThreeModule, wall: PlanWall, selected: boolean): THREE_NS.Object3D {
  const dx = wall.b.x - wall.a.x;
  const dz = wall.b.z - wall.a.z;
  const span = Math.hypot(dx, dz) || 0.01;

  const geometry = new THREE.BoxGeometry(span, wall.heightM, Math.max(0.05, wall.thicknessM));
  const material = new THREE.MeshStandardMaterial({
    color: selected ? palette.wallSelected : wall.blocksView ? palette.wall : palette.wallGlass,
    transparent: !wall.blocksView,
    opacity: wall.blocksView ? 1 : 0.45,
    roughness: 0.85,
    metalness: 0.05
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set((wall.a.x + wall.b.x) / 2, wall.heightM / 2, (wall.a.z + wall.b.z) / 2);
  mesh.rotation.y = -Math.atan2(dz, dx);
  mesh.userData = { kind: "wall", id: wall.id };
  return mesh;
}

function wallSectionMesh(
  THREE: ThreeModule,
  wall: PlanWall,
  startM: number,
  endM: number,
  bottomM: number,
  heightM: number,
  selected: boolean
): THREE_NS.Mesh | null {
  const span = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z);
  const sectionLength = endM - startM;
  if (span < 0.01 || sectionLength < 0.01 || heightM < 0.01) return null;
  const ux = (wall.b.x - wall.a.x) / span;
  const uz = (wall.b.z - wall.a.z) / span;
  const centerM = (startM + endM) / 2;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(sectionLength, heightM, Math.max(0.05, wall.thicknessM)),
    new THREE.MeshStandardMaterial({
      color: selected ? palette.wallSelected : wall.blocksView ? palette.wall : palette.wallGlass,
      transparent: !wall.blocksView,
      opacity: wall.blocksView ? 1 : 0.45,
      roughness: 0.85,
      metalness: 0.05
    })
  );
  mesh.position.set(wall.a.x + ux * centerM, bottomM + heightM / 2, wall.a.z + uz * centerM);
  mesh.rotation.y = -Math.atan2(uz, ux);
  mesh.userData = { kind: "wall", id: wall.id };
  return mesh;
}

/** Splits a wall around its attached doors, including the lintel above each opening. */
export function buildWallWithDoors(
  THREE: ThreeModule,
  wall: PlanWall,
  doors: PlanDoor[],
  selected: boolean
): THREE_NS.Object3D {
  if (!doors.length) return buildWallMesh(THREE, wall, selected);
  const group = new THREE.Group();
  const span = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z);
  const openings = doors
    .map((door) => {
      const centerM = Math.max(0, Math.min(span, door.offset * span));
      return {
        door,
        startM: Math.max(0, centerM - door.widthM / 2),
        endM: Math.min(span, centerM + door.widthM / 2)
      };
    })
    .sort((first, second) => first.startM - second.startM);

  let cursorM = 0;
  for (const opening of openings) {
    const solid = wallSectionMesh(THREE, wall, cursorM, opening.startM, 0, wall.heightM, selected);
    if (solid) group.add(solid);
    const lintelHeightM = Math.max(0, wall.heightM - opening.door.heightM);
    const lintel = wallSectionMesh(
      THREE,
      wall,
      opening.startM,
      opening.endM,
      opening.door.heightM,
      lintelHeightM,
      selected
    );
    if (lintel) group.add(lintel);
    cursorM = Math.max(cursorM, opening.endM);
  }
  const tail = wallSectionMesh(THREE, wall, cursorM, span, 0, wall.heightM, selected);
  if (tail) group.add(tail);
  group.userData = { kind: "wall", id: wall.id };
  return group;
}

/** Architectural top-view swing symbol plus a framed, half-open 3D door leaf. */
export function buildDoorMesh(
  THREE: ThreeModule,
  door: PlanDoor,
  wall: PlanWall,
  selected: boolean
): THREE_NS.Object3D {
  const group = new THREE.Group();
  const dx = wall.b.x - wall.a.x;
  const dz = wall.b.z - wall.a.z;
  const span = Math.hypot(dx, dz) || 0.01;
  const u = { x: dx / span, z: dz / span };
  const normal = { x: -u.z, z: u.x };
  const center = { x: wall.a.x + dx * door.offset, z: wall.a.z + dz * door.offset };
  const halfWidth = Math.min(door.widthM, span) / 2;
  const hingeSign = door.hinge === "start" ? -1 : 1;
  const hinge = { x: center.x + u.x * halfWidth * hingeSign, z: center.z + u.z * halfWidth * hingeSign };
  const closedDirection = { x: -u.x * hingeSign, z: -u.z * hingeSign };
  const angleRad = (Math.max(0, Math.min(90, door.openAngleDeg)) * Math.PI) / 180;
  const openDirection = {
    x: closedDirection.x * Math.cos(angleRad) + normal.x * Math.sin(angleRad),
    z: closedDirection.z * Math.cos(angleRad) + normal.z * Math.sin(angleRad)
  };
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x7c4a2d, roughness: 0.55, metalness: 0.05 });
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: selected ? 0xf59e0b : 0xb86f3c,
    roughness: 0.48,
    metalness: 0.03
  });

  for (const sign of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, door.heightM, 0.14), frameMaterial);
    post.position.set(center.x + u.x * halfWidth * sign, door.heightM / 2, center.z + u.z * halfWidth * sign);
    post.rotation.y = -Math.atan2(u.z, u.x);
    group.add(post);
  }
  const header = new THREE.Mesh(new THREE.BoxGeometry(door.widthM + 0.18, 0.12, 0.14), frameMaterial);
  header.position.set(center.x, door.heightM + 0.06, center.z);
  header.rotation.y = -Math.atan2(u.z, u.x);
  group.add(header);

  const leaf = new THREE.Mesh(new THREE.BoxGeometry(door.widthM, door.heightM - 0.08, 0.07), leafMaterial);
  leaf.position.set(
    hinge.x + openDirection.x * door.widthM / 2,
    (door.heightM - 0.08) / 2,
    hinge.z + openDirection.z * door.widthM / 2
  );
  leaf.rotation.y = -Math.atan2(openDirection.z, openDirection.x);
  group.add(leaf);

  const handle = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xd6a83d, roughness: 0.22, metalness: 0.8 })
  );
  handle.position.set(
    hinge.x + openDirection.x * door.widthM * 0.85 + normal.x * 0.055,
    Math.min(1.05, door.heightM * 0.52),
    hinge.z + openDirection.z * door.widthM * 0.85 + normal.z * 0.055
  );
  group.add(handle);

  const arcPoints: THREE_NS.Vector3[] = [];
  for (let index = 0; index <= 24; index += 1) {
    const radians = angleRad * (index / 24);
    const direction = {
      x: closedDirection.x * Math.cos(radians) + normal.x * Math.sin(radians),
      z: closedDirection.z * Math.cos(radians) + normal.z * Math.sin(radians)
    };
    arcPoints.push(new THREE.Vector3(hinge.x + direction.x * door.widthM, 0.18, hinge.z + direction.z * door.widthM));
  }
  const arc = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(arcPoints),
    new THREE.LineBasicMaterial({ color: selected ? 0xf59e0b : 0x9a5b2c, depthTest: false })
  );
  arc.renderOrder = 25;
  group.add(arc);

  group.userData = { kind: "door", id: door.id };
  group.traverse((child) => { child.userData = { kind: "door", id: door.id }; });
  return group;
}

export function buildObstacleMesh(THREE: ThreeModule, obstacle: PlanObstacle, selected: boolean): THREE_NS.Object3D {
  const geometry = new THREE.BoxGeometry(obstacle.widthM, obstacle.heightM, obstacle.depthM);
  const material = new THREE.MeshStandardMaterial({
    color: selected ? palette.obstacleSelected : palette.obstacle,
    roughness: 0.7,
    metalness: 0.1,
    transparent: !obstacle.blocksView,
    opacity: obstacle.blocksView ? 1 : 0.5
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(obstacle.center.x, obstacle.heightM / 2, obstacle.center.z);
  mesh.rotation.y = -(obstacle.rotationDeg * Math.PI) / 180;
  mesh.userData = { kind: "obstacle", id: obstacle.id };
  return mesh;
}

/** Small body plus a heading spike, so yaw is readable in the top view. */
export function buildCameraMarker(
  THREE: ThreeModule,
  id: string,
  position: Vec2,
  mountHeightM: number,
  yawDeg: number,
  selected: boolean
): THREE_NS.Group {
  const group = new THREE.Group();
  const color = selected ? palette.cameraSelected : palette.cameraBody;

  const body = new THREE.Mesh(
    new THREE.ConeGeometry(0.32, 0.8, 4),
    new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 })
  );
  body.rotation.z = Math.PI / 2;
  body.rotation.y = -(yawDeg * Math.PI) / 180;
  body.position.y = mountHeightM;
  group.add(body);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, mountHeightM, 6),
    new THREE.MeshStandardMaterial({ color: 0x8fa6b6 })
  );
  pole.position.y = mountHeightM / 2;
  group.add(pole);

  group.position.set(position.x, 0, position.z);
  group.userData = { kind: "camera", id };
  // Children must carry the id too: the raycaster reports the mesh, not the group.
  group.traverse((child) => { child.userData = { kind: "camera", id }; });
  return group;
}

/**
 * Grab handle for aiming a selected camera.
 *
 * Rotation used to be reachable only through a number field. A dedicated handle set out
 * along the heading — distinct from the body, which drags to move — makes aiming a
 * direct manipulation instead of a form entry.
 */
export function buildYawHandle(
  THREE: ThreeModule,
  id: string,
  position: Vec2,
  mountHeightM: number,
  yawDeg: number
): THREE_NS.Group {
  const group = new THREE.Group();
  const yawRad = (yawDeg * Math.PI) / 180;
  const reach = 2.2;
  const tip = { x: position.x + Math.cos(yawRad) * reach, z: position.z + Math.sin(yawRad) * reach };

  const stem = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(position.x, mountHeightM, position.z),
      new THREE.Vector3(tip.x, mountHeightM, tip.z)
    ]),
    new THREE.LineBasicMaterial({ color: 0xf59e0b })
  );
  group.add(stem);

  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.35 })
  );
  knob.position.set(tip.x, mountHeightM, tip.z);
  group.add(knob);

  group.traverse((child) => { child.userData = { kind: "camera-yaw", id }; });
  return group;
}

function polygonShape(THREE: ThreeModule, polygon: Vec2[]): THREE_NS.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(polygon[0].x, polygon[0].z);
  for (let index = 1; index < polygon.length; index += 1) shape.lineTo(polygon[index].x, polygon[index].z);
  shape.closePath();
  return shape;
}

/**
 * Nested DORI bands as flat translucent shapes just above the floor.
 * Each band is lifted a hair further so the tighter zones never z-fight the wider ones.
 */
export function buildCoverageMesh(THREE: ThreeModule, coverage: CameraCoverage): THREE_NS.Group {
  const group = new THREE.Group();

  coverage.bands.forEach((band, index) => {
    if (band.polygon.length < 3) return;
    const geometry = new THREE.ShapeGeometry(polygonShape(THREE, band.polygon));
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(band.color),
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = 0.02 + index * 0.006;
    mesh.renderOrder = 2 + index;
    group.add(mesh);
  });

  if (coverage.polygon.length >= 3) {
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        coverage.polygon.map((point) => new THREE.Vector3(point.x, 0.06, point.z))
      ),
      new THREE.LineBasicMaterial({ color: 0x0e7490, transparent: true, opacity: 0.75 })
    );
    group.add(outline);
  }

  return group;
}

export function buildBackdropMesh(THREE: ThreeModule, backdrop: PlanBackdrop): THREE_NS.Object3D | null {
  const widthM = backdrop.widthPx * backdrop.metresPerPixel;
  const depthM = backdrop.heightPx * backdrop.metresPerPixel;
  if (!(widthM > 0) || !(depthM > 0)) return null;

  const texture = new THREE.TextureLoader().load(backdrop.imageUrl);
  texture.colorSpace = THREE.SRGBColorSpace;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(widthM, depthM),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: backdrop.opacity, depthWrite: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  // PlaneGeometry is centred; the stored origin is the image's top-left corner.
  mesh.position.set(backdrop.originM.x + widthM / 2, 0.005, backdrop.originM.z + depthM / 2);
  mesh.renderOrder = 1;
  mesh.userData = { kind: "backdrop", id: "backdrop" };
  return mesh;
}

export function buildBackdrop(THREE: ThreeModule, floor: FloorPlan): THREE_NS.Object3D | null {
  return floor.backdrop ? buildBackdropMesh(THREE, floor.backdrop) : null;
}

export function buildPreviewLine(
  THREE: ThreeModule,
  from: Vec2,
  to: Vec2,
  color = palette.preview
): THREE_NS.Object3D {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, 0.1, from.z),
      new THREE.Vector3(to.x, 0.1, to.z)
    ]),
    new THREE.LineDashedMaterial({ color, dashSize: 0.4, gapSize: 0.25 })
  );
}

export function buildRightAngleMarker(
  THREE: ThreeModule,
  { corner, armA, armB }: RightAngleCorner
): THREE_NS.Object3D {
  const size = 0.48;
  const first = { x: corner.x + armA.x * size, z: corner.z + armA.z * size };
  const inner = { x: first.x + armB.x * size, z: first.z + armB.z * size };
  const second = { x: corner.x + armB.x * size, z: corner.z + armB.z * size };
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(first.x, 0.16, first.z),
      new THREE.Vector3(inner.x, 0.16, inner.z),
      new THREE.Vector3(second.x, 0.16, second.z)
    ]),
    new THREE.LineBasicMaterial({ color: 0xb7791f, depthTest: false })
  );
  line.renderOrder = 24;
  return line;
}

export function buildSmartGuideLine(THREE: ThreeModule, from: Vec2, to: Vec2): THREE_NS.Object3D {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, 0.13, from.z),
      new THREE.Vector3(to.x, 0.13, to.z)
    ]),
    new THREE.LineDashedMaterial({
      color: 0x0ea5a8,
      dashSize: 0.22,
      gapSize: 0.14,
      transparent: true,
      opacity: 0.95
    })
  );
  line.computeLineDistances();
  line.renderOrder = 20;
  return line;
}

export function buildPreviewRect(THREE: ThreeModule, from: Vec2, to: Vec2): THREE_NS.Object3D {
  const corners = [
    new THREE.Vector3(from.x, 0.1, from.z),
    new THREE.Vector3(to.x, 0.1, from.z),
    new THREE.Vector3(to.x, 0.1, to.z),
    new THREE.Vector3(from.x, 0.1, to.z)
  ];
  return new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(corners),
    new THREE.LineBasicMaterial({ color: palette.preview })
  );
}

/** Midpoints of every wall and obstacle edge, for the dimension overlay. */
export type DimensionLabel = { id: string; text: string; world: { x: number; y: number; z: number } };

export function collectDimensionLabels(floor: FloorPlan): DimensionLabel[] {
  const labels: DimensionLabel[] = [];

  for (const wall of floor.walls) {
    const span = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z);
    if (span < 0.2) continue;
    labels.push({
      id: `wall-${wall.id}`,
      text: `${span.toFixed(2)} m`,
      world: { x: (wall.a.x + wall.b.x) / 2, y: wall.heightM + 0.15, z: (wall.a.z + wall.b.z) / 2 }
    });
  }

  for (const obstacle of floor.obstacles) {
    const corners = obstacleCorners(obstacle);
    labels.push({
      id: `obs-${obstacle.id}`,
      text: `${obstacle.widthM.toFixed(2)} × ${obstacle.depthM.toFixed(2)} m`,
      world: { x: (corners[0].x + corners[2].x) / 2, y: obstacle.heightM + 0.15, z: (corners[0].z + corners[2].z) / 2 }
    });
  }

  return labels;
}
