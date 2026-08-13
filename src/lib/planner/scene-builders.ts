import type * as THREE_NS from "three";
import type { CameraHousing } from "@/src/domain/catalog/types";
import type { FloorPlan, ObstacleVariant, PlanBackdrop, PlanDoor, PlanObstacle, PlanWall, Vec2 } from "@/src/domain/planner/types";
import type { CameraCoverage } from "@/src/lib/planner/coverage";
import { largestClosedWallLoop, type RightAngleCorner } from "@/src/lib/planner/geometry";
import { isCardinalAngle } from "@/src/lib/planner/rotation";

/**
 * Mesh construction for the plan scene.
 *
 * The three.js module is passed in rather than imported: the designer loads it
 * dynamically on the client, and importing it here would pull WebGL into the server
 * bundle. Plan space (x, z) maps straight onto world (x, 0, z), so no axis conversion
 * happens anywhere between the editor and the coverage engine.
 */

type ThreeModule = typeof THREE_NS;
type ObstacleRenderScope = { floorId: string; sceneGeneration: number };

const obstacleAssetUrls: Partial<Record<ObstacleVariant, string>> = {
  sedan: "/models/obstacles/sedan.glb?v=2",
  suv: "/models/obstacles/suv.glb?v=2",
  pickup: "/models/obstacles/pickup.glb?v=2",
  van: "/models/obstacles/van.glb?v=2",
  truck: "/models/obstacles/truck.glb?v=2",
  deciduous: "/models/obstacles/deciduous.glb",
  conifer: "/models/obstacles/conifer.glb",
  palm: "/models/obstacles/palm.glb"
};

const obstacleAssetCache = new Map<string, Promise<THREE_NS.Object3D | null>>();
const loadedObstacleAssets = new Map<string, THREE_NS.Object3D>();

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
    if (!item.userData.sharedAssetTextures) texture?.dispose();
    item.dispose();
  };
  group.traverse((child) => {
    if (child !== group) child.userData.sceneDisposed = true;
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

    // A window leaves masonry below it as well as above; a door only above.
    const sillHeightM = opening.door.type === "window" ? Math.max(0, opening.door.sillHeightM ?? 0.9) : 0;
    if (sillHeightM > 0.01) {
      const apron = wallSectionMesh(THREE, wall, opening.startM, opening.endM, 0, sillHeightM, selected);
      if (apron) group.add(apron);
    }

    const openingTopM = sillHeightM + opening.door.heightM;
    const lintelHeightM = Math.max(0, wall.heightM - openingTopM);
    const lintel = wallSectionMesh(
      THREE,
      wall,
      opening.startM,
      opening.endM,
      openingTopM,
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
  if (door.type === "window") return buildWindowMesh(THREE, door, wall, selected);
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

/**
 * Glazed opening: frame, mullion and a transparent pane sitting on its sill.
 *
 * Rendered separately from a door because there is no leaf to swing, and because glass
 * is the point — the pane stays see-through so the plan reads the way the coverage
 * engine treats it.
 */
function buildWindowMesh(
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
  const center = { x: wall.a.x + dx * door.offset, z: wall.a.z + dz * door.offset };
  const halfWidth = Math.min(door.widthM, span) / 2;
  const sillHeightM = Math.max(0, door.sillHeightM ?? 0.9);
  const rotationY = -Math.atan2(u.z, u.x);
  const thickness = Math.max(0.08, wall.thicknessM * 0.7);

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: selected ? 0xf59e0b : 0xe2e8f0,
    roughness: 0.4,
    metalness: 0.35
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0xbfdcf0,
    roughness: 0.08,
    metalness: 0.1,
    transparent: true,
    opacity: 0.35
  });

  const place = (mesh: THREE_NS.Mesh, offsetAlong: number, height: number) => {
    mesh.position.set(center.x + u.x * offsetAlong, height, center.z + u.z * offsetAlong);
    mesh.rotation.y = rotationY;
    group.add(mesh);
  };

  for (const sign of [-1, 1]) {
    place(new THREE.Mesh(new THREE.BoxGeometry(0.07, door.heightM, thickness), frameMaterial), halfWidth * sign, sillHeightM + door.heightM / 2);
  }
  place(new THREE.Mesh(new THREE.BoxGeometry(door.widthM + 0.14, 0.09, thickness), frameMaterial), 0, sillHeightM + door.heightM + 0.045);
  // Sill board projects slightly, which is what makes it read as a window in the 3D view.
  place(new THREE.Mesh(new THREE.BoxGeometry(door.widthM + 0.18, 0.07, thickness * 1.35), frameMaterial), 0, sillHeightM - 0.035);
  place(new THREE.Mesh(new THREE.BoxGeometry(0.05, door.heightM - 0.1, thickness * 0.8), frameMaterial), 0, sillHeightM + door.heightM / 2);
  place(new THREE.Mesh(new THREE.BoxGeometry(door.widthM - 0.05, door.heightM - 0.1, 0.03), glass), 0, sillHeightM + door.heightM / 2);

  group.userData = { kind: "door", id: door.id };
  group.traverse((child) => { child.userData = { kind: "door", id: door.id }; });
  return group;
}

/** Translucent rubber band drawn while a marquee drag is in progress. */
export function buildMarqueeRect(THREE: ThreeModule, from: Vec2, to: Vec2): THREE_NS.Group {
  const group = new THREE.Group();
  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minZ = Math.min(from.z, to.z);
  const maxZ = Math.max(from.z, to.z);
  const width = Math.max(1e-3, maxX - minX);
  const depth = Math.max(1e-3, maxZ - minZ);

  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({ color: 0x1976b7, transparent: true, opacity: 0.16, depthWrite: false })
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.set(minX + width / 2, 0.09, minZ + depth / 2);
  fill.renderOrder = 20;
  group.add(fill);

  const border = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(minX, 0.1, minZ),
      new THREE.Vector3(maxX, 0.1, minZ),
      new THREE.Vector3(maxX, 0.1, maxZ),
      new THREE.Vector3(minX, 0.1, maxZ)
    ]),
    new THREE.LineBasicMaterial({ color: 0x0f5f99 })
  );
  border.renderOrder = 21;
  group.add(border);
  return group;
}

export function buildObstacleMesh(
  THREE: ThreeModule,
  obstacle: PlanObstacle,
  selected: boolean,
  renderScope?: ObstacleRenderScope
): THREE_NS.Object3D {
  if (obstacle.kind === "surface") {
    const surface = buildSurfaceObstacle(THREE, obstacle, selected);
    if (renderScope) {
      Object.assign(surface.userData, renderScope);
      surface.traverse((child) => Object.assign(child.userData, renderScope));
    }
    return surface;
  }
  if (obstacle.kind === "fence" || obstacle.kind === "gate") {
    const barrier = buildBarrierObstacle(THREE, obstacle, selected);
    if (renderScope) {
      Object.assign(barrier.userData, renderScope);
      barrier.traverse((child) => Object.assign(child.userData, renderScope));
    }
    return barrier;
  }
  if (obstacle.kind === "pole") {
    const pole = buildPoleObstacle(THREE, obstacle, selected);
    if (renderScope) {
      Object.assign(pole.userData, renderScope);
      pole.traverse((child) => Object.assign(child.userData, renderScope));
    }
    return pole;
  }
  if (obstacle.kind === "furniture" || obstacle.kind === "appliance" || obstacle.kind === "seating" || obstacle.kind === "bed") {
    const furniture = buildFurnitureObstacle(THREE, obstacle, selected);
    if (renderScope) {
      Object.assign(furniture.userData, renderScope);
      furniture.traverse((child) => Object.assign(child.userData, renderScope));
    }
    return furniture;
  }
  if (obstacle.variant === "escalator") {
    const escalator = buildEscalatorObstacle(THREE, obstacle, selected);
    if (renderScope) {
      Object.assign(escalator.userData, renderScope);
      escalator.traverse((child) => Object.assign(child.userData, renderScope));
    }
    return escalator;
  }
  if (obstacle.kind === "stairs") {
    const stairs = buildStairObstacle(THREE, obstacle, selected);
    if (renderScope) {
      Object.assign(stairs.userData, renderScope);
      stairs.traverse((child) => Object.assign(child.userData, renderScope));
    }
    return stairs;
  }
  if (obstacle.variant === "elevator") {
    const elevator = buildElevatorObstacle(THREE, obstacle, selected);
    if (renderScope) {
      Object.assign(elevator.userData, renderScope);
      elevator.traverse((child) => Object.assign(child.userData, renderScope));
    }
    return elevator;
  }
  if (obstacle.kind === "vehicle" || obstacle.kind === "tree") {
    const group = obstacle.kind === "vehicle"
      ? buildVehicleObstacle(THREE, obstacle, selected)
      : buildTreeObstacle(THREE, obstacle, selected);
    if (renderScope) Object.assign(group.userData, renderScope);
    attachDetailedObstacleAsset(THREE, group, obstacle, selected, renderScope);
    return group;
  }

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
  mesh.userData = { kind: "obstacle", id: obstacle.id, ...renderScope };
  return mesh;
}

const surfaceColors: Partial<Record<NonNullable<PlanObstacle["variant"]>, number>> = {
  grass: 0x6aab54,
  road: 0x6b7280
};

/** Base colour per furniture variant, chosen so a room reads without labels. */
const furnitureColors: Partial<Record<NonNullable<PlanObstacle["variant"]>, number>> = {
  "sofa-three": 0x5b7c99,
  "sofa-single": 0x5b7c99,
  "coffee-table": 0x8b5e3c,
  "tv-unit": 0x6b4f3a,
  "dining-table": 0x8b5e3c,
  "dining-chair": 0x6b513d,
  "bed-double": 0x7f9bb5,
  "bed-single": 0x7f9bb5,
  wardrobe: 0x9c6b46,
  bookshelf: 0x8b5e3c,
  nightstand: 0x9c6b46,
  dresser: 0x9c6b46,
  fridge: 0xd7dee4,
  "kitchen-counter": 0xc9d2d8,
  stove: 0x8f9aa3,
  "sink-unit": 0xc9d2d8,
  "kitchen-island": 0xc9d2d8,
  dishwasher: 0xd7dee4,
  "office-desk": 0xa9805a,
  "office-chair": 0x475569,
  "meeting-table": 0xa9805a,
  "filing-cabinet": 0x94a3b8,
  "reception-desk": 0xa9805a,
  "partition-screen": 0xaebfcb,
  "shelving-unit": 0x9aa7b1,
  "display-fridge": 0xbcd7e6,
  "checkout-counter": 0xa9805a,
  "clothing-rack": 0x94a3b8,
  "display-stand": 0xa9805a,
  "hospital-bed": 0xd9eef5,
  "stretcher": 0xb9d7e5,
  "exam-table": 0xa8d5cf,
  "nurse-station": 0x7fb8c8,
  "medical-cart": 0x8cb8c7,
  "service-counter": 0x7b93a6,
  "waiting-bench": 0x5d7c91,
  "locker-row": 0x718096,
  "metal-bunk": 0x64748b,
  "student-desk": 0xb68c61,
  "whiteboard": 0xe8eef2,
  "lab-bench": 0x78909c,
  "library-shelf": 0x9b7653,
  "gym-bleacher": 0x527a96
};

/**
 * Interior furniture.
 *
 * A plain box would make every room look the same, so each family gets just enough
 * detail to be identifiable from above: cushions and arms on seating, a mattress and
 * pillows on beds, shelf lines on storage, a door split on appliances.
 */
function buildFurnitureObstacle(THREE: ThreeModule, obstacle: PlanObstacle, selected: boolean) {
  const group = new THREE.Group();
  const variant = obstacle.variant;
  const baseColor = furnitureColors[variant ?? "office-desk"] ?? 0x9aa7b1;
  const body = obstacleMaterial(THREE, baseColor, obstacle, selected, 0.02);
  const accent = obstacleMaterial(THREE, 0xf1f5f9, obstacle, selected, 0.03);
  const dark = obstacleMaterial(THREE, 0x475569, obstacle, selected, 0.02);
  const { widthM, depthM, heightM } = obstacle;

  const box = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE_NS.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.02, w), Math.max(0.02, h), Math.max(0.02, d)), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  if (obstacle.kind === "seating" && variant !== "office-chair" && variant !== "dining-chair") {
    // Seat pad, back and two arms — the silhouette that says "sofa" from above.
    const armW = Math.min(0.22, widthM * 0.14);
    const backD = Math.min(0.22, depthM * 0.25);
    box(widthM, heightM * 0.45, depthM, 0, heightM * 0.225, 0, body);
    box(widthM, heightM * 0.55, backD, 0, heightM * 0.5, -depthM / 2 + backD / 2, body);
    for (const sign of [-1, 1]) {
      box(armW, heightM * 0.72, depthM * 0.9, sign * (widthM / 2 - armW / 2), heightM * 0.36, depthM * 0.05, body);
    }
    // Cushions span the width between the two arms, evenly divided.
    const seatSpan = widthM - armW * 2;
    const cushions = Math.max(1, Math.round(widthM / 0.95));
    const cushionPitch = seatSpan / cushions;
    for (let index = 0; index < cushions; index += 1) {
      const centerX = -seatSpan / 2 + (index + 0.5) * cushionPitch;
      box(cushionPitch - 0.04, 0.1, depthM * 0.62, centerX, heightM * 0.5, depthM * 0.08, accent);
    }
  } else if (variant === "metal-bunk") {
    for (const level of [0.42, 1.3]) {
      box(widthM, 0.12, depthM, 0, level, 0, body);
      box(widthM * 0.92, 0.14, depthM * 0.92, 0, level + 0.12, 0, accent);
    }
    for (const x of [-widthM * 0.45, widthM * 0.45]) {
      for (const z of [-depthM * 0.45, depthM * 0.45]) box(0.055, heightM, 0.055, x, heightM / 2, z, dark);
    }
  } else if (obstacle.kind === "bed") {
    box(widthM, heightM * 0.35, depthM, 0, heightM * 0.175, 0, body);
    box(widthM * 0.98, heightM * 0.3, depthM * 0.94, 0, heightM * 0.5, depthM * 0.02, accent);
    // Headboard sits at the -z end, which is the plan's "top" of the bed.
    box(widthM, heightM * 1.1, 0.08, 0, heightM * 0.55, -depthM / 2, body);
    const pillows = widthM > 1.2 ? 2 : 1;
    for (let index = 0; index < pillows; index += 1) {
      const px = pillows === 1 ? 0 : (index === 0 ? -widthM * 0.24 : widthM * 0.24);
      box(widthM * (pillows === 1 ? 0.6 : 0.42), 0.12, depthM * 0.16, px, heightM * 0.68, -depthM * 0.36, accent);
    }
  } else if (variant === "office-chair" || variant === "dining-chair") {
    box(widthM * 0.8, 0.1, depthM * 0.8, 0, heightM * 0.42, 0, body);
    box(widthM * 0.75, heightM * 0.42, 0.08, 0, heightM * 0.66, -depthM * 0.32, body);
    if (variant === "office-chair") {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, heightM * 0.4, 8), dark);
      post.position.y = heightM * 0.2;
      group.add(post);
      box(widthM * 0.7, 0.05, depthM * 0.7, 0, 0.03, 0, dark);
    } else {
      for (const x of [-widthM * 0.31, widthM * 0.31]) {
        for (const z of [-depthM * 0.3, depthM * 0.3]) {
          box(0.045, heightM * 0.42, 0.045, x, heightM * 0.21, z, dark);
        }
      }
    }
  } else if (variant === "bookshelf" || variant === "shelving-unit" || variant === "wardrobe" || variant === "filing-cabinet" || variant === "locker-row" || variant === "library-shelf") {
    box(widthM, heightM, depthM, 0, heightM / 2, 0, body);
    const shelves = Math.max(2, Math.floor(heightM / 0.4));
    for (let index = 1; index < shelves; index += 1) {
      box(widthM * 0.94, 0.03, depthM * 0.92, 0, (heightM / shelves) * index, depthM * 0.03, accent);
    }
    if (variant === "wardrobe" || variant === "filing-cabinet") {
      box(0.03, heightM * 0.96, depthM * 0.02, 0, heightM / 2, depthM / 2, dark);
    }
  } else if (obstacle.kind === "appliance") {
    box(widthM, heightM, depthM, 0, heightM / 2, 0, body);
    // Door split plus a handle, which is what distinguishes a fridge from a cabinet.
    box(widthM * 0.98, 0.02, 0.02, 0, heightM * 0.62, depthM / 2, dark);
    box(0.04, heightM * 0.3, 0.05, widthM * 0.34, heightM * 0.42, depthM / 2 + 0.02, dark);
    if (variant === "stove") {
      for (const [bx, bz] of [[-0.14, -0.12], [0.14, -0.12], [-0.14, 0.12], [0.14, 0.12]]) {
        const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.015, 12), dark);
        burner.position.set(bx * (widthM / 0.6), heightM + 0.008, bz * (depthM / 0.6));
        group.add(burner);
      }
    }
    if (variant === "display-fridge") {
      box(widthM * 0.88, heightM * 0.78, 0.02, 0, heightM * 0.55, depthM / 2 + 0.01, obstacleMaterial(THREE, 0xdff1fb, obstacle, selected, 0.04));
    }
  } else if (variant === "clothing-rack") {
    for (const sign of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, heightM, 8), dark);
      leg.position.set(sign * (widthM / 2 - 0.05), heightM / 2, 0);
      group.add(leg);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, widthM, 8), dark);
    bar.rotation.z = Math.PI / 2;
    bar.position.y = heightM * 0.94;
    group.add(bar);
    box(widthM * 0.9, heightM * 0.55, depthM * 0.55, 0, heightM * 0.6, 0, body);
  } else if (variant === "rug") {
    box(widthM, Math.max(0.02, heightM), depthM, 0, heightM / 2, 0, body);
    box(widthM * 0.86, heightM + 0.004, depthM * 0.8, 0, heightM / 2 + 0.004, 0, accent);
  } else {
    // Tables, counters and desks: a top on legs rather than a solid block, so a camera
    // reading of "sees over it" matches what is drawn.
    const legInset = 0.08;
    const topThickness = Math.min(0.08, heightM * 0.16);
    box(widthM, topThickness, depthM, 0, heightM - topThickness / 2, 0, body);
    const solidSided = variant === "kitchen-counter" || variant === "kitchen-island"
      || variant === "sink-unit" || variant === "reception-desk" || variant === "checkout-counter"
      || variant === "tv-unit" || variant === "partition-screen" || variant === "display-stand"
      || variant === "dresser" || variant === "nightstand";
    if (solidSided) {
      box(widthM * 0.98, heightM - topThickness, depthM * 0.94, 0, (heightM - topThickness) / 2, 0, body);
      if (variant === "sink-unit") {
        box(widthM * 0.6, 0.04, depthM * 0.6, 0, heightM + 0.01, 0, obstacleMaterial(THREE, 0x94a3b8, obstacle, selected, 0.03));
      }
    } else {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          box(0.07, heightM - topThickness, 0.07,
            sx * (widthM / 2 - legInset), (heightM - topThickness) / 2, sz * (depthM / 2 - legInset), dark);
        }
      }
    }
  }

  addSelectionFootprint(THREE, group, obstacle, selected);
  group.position.set(obstacle.center.x, 0, obstacle.center.z);
  group.rotation.y = -(obstacle.rotationDeg * Math.PI) / 180;
  finishObstacleGroup(group, obstacle);
  return group;
}

/**
 * Ground cover such as lawn or roadway.
 *
 * Drawn as a thin slab just above the floor rather than a box: these read as painted
 * areas on the plan, and they carry `blocksView: false` so they never cut a sight line.
 */
function buildSurfaceObstacle(THREE: ThreeModule, obstacle: PlanObstacle, selected: boolean) {
  const group = new THREE.Group();
  const color = surfaceColors[obstacle.variant ?? "grass"] ?? 0x8aa2ad;
  const thickness = Math.max(0.02, obstacle.heightM);

  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(obstacle.widthM, thickness, obstacle.depthM),
    new THREE.MeshStandardMaterial({
      color: selected ? palette.obstacleSelected : color,
      roughness: obstacle.variant === "road" ? 0.95 : 0.85,
      metalness: 0.02
    })
  );
  slab.position.y = thickness / 2;
  slab.receiveShadow = true;
  group.add(slab);

  // Centre line, so a road reads as a carriageway rather than a grey rectangle.
  if (obstacle.variant === "road") {
    const dashCount = Math.max(1, Math.floor(obstacle.widthM / 2));
    for (let index = 0; index < dashCount; index += 1) {
      const dash = new THREE.Mesh(
        new THREE.BoxGeometry(Math.min(0.9, obstacle.widthM / (dashCount * 1.8)), 0.01, 0.12),
        new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 })
      );
      dash.position.set(-obstacle.widthM / 2 + (index + 0.5) * (obstacle.widthM / dashCount), thickness + 0.005, 0);
      group.add(dash);
    }
  }

  group.position.set(obstacle.center.x, 0, obstacle.center.z);
  group.rotation.y = -(obstacle.rotationDeg * Math.PI) / 180;
  group.userData = { kind: "obstacle", id: obstacle.id };
  group.traverse((child) => { child.userData = { kind: "obstacle", id: obstacle.id }; });
  return group;
}

/** Fence, boundary wall or vehicle gate: a thin barrier with regular posts. */
function buildBarrierObstacle(THREE: ThreeModule, obstacle: PlanObstacle, selected: boolean) {
  const group = new THREE.Group();
  const seeThrough = !obstacle.blocksView;
  const bodyColor = selected
    ? palette.obstacleSelected
    : obstacle.kind === "gate" ? 0x64748b : seeThrough ? 0x9ca3af : 0xcbd5e1;

  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(obstacle.widthM, obstacle.heightM, Math.max(0.04, obstacle.depthM)),
    new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.7,
      metalness: obstacle.kind === "gate" ? 0.45 : 0.2,
      // Mesh fencing is modelled as transparent because it is see-through in reality;
      // the preset also marks it non-blocking so coverage agrees with the picture.
      transparent: seeThrough,
      opacity: seeThrough ? 0.42 : 1
    })
  );
  panel.position.y = obstacle.heightM / 2;
  panel.castShadow = !seeThrough;
  group.add(panel);

  const postCount = Math.max(2, Math.round(obstacle.widthM / 2.5) + 1);
  const postMaterial = new THREE.MeshStandardMaterial({ color: selected ? palette.obstacleSelected : 0x6b7280, roughness: 0.6, metalness: 0.35 });
  for (let index = 0; index < postCount; index += 1) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, obstacle.heightM * 1.04, 8),
      postMaterial
    );
    post.position.set(-obstacle.widthM / 2 + (index * obstacle.widthM) / (postCount - 1), obstacle.heightM * 0.52, 0);
    group.add(post);
  }

  group.position.set(obstacle.center.x, 0, obstacle.center.z);
  group.rotation.y = -(obstacle.rotationDeg * Math.PI) / 180;
  group.userData = { kind: "obstacle", id: obstacle.id };
  group.traverse((child) => { child.userData = { kind: "obstacle", id: obstacle.id }; });
  return group;
}

/** Camera mast or lighting column, with a head that shows which one it is. */
function buildPoleObstacle(THREE: ThreeModule, obstacle: PlanObstacle, selected: boolean) {
  const group = new THREE.Group();
  const isLight = obstacle.variant === "light-pole";
  const metal = new THREE.MeshStandardMaterial({
    color: selected ? palette.obstacleSelected : 0x94a3b8,
    roughness: 0.45,
    metalness: 0.55
  });

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(Math.max(0.05, obstacle.widthM / 2.6), Math.max(0.07, obstacle.widthM / 2), obstacle.heightM, 12),
    metal
  );
  shaft.position.y = obstacle.heightM / 2;
  shaft.castShadow = true;
  group.add(shaft);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(obstacle.widthM * 0.9, obstacle.widthM, 0.12, 12), metal);
  base.position.y = 0.06;
  group.add(base);

  if (isLight) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), metal);
    arm.position.set(0.45, obstacle.heightM - 0.1, 0);
    group.add(arm);
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.14, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xfef3c7, emissive: 0xfde68a, emissiveIntensity: 0.55, roughness: 0.4 })
    );
    lamp.position.set(0.85, obstacle.heightM - 0.18, 0);
    group.add(lamp);
  } else {
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.08), metal);
    bracket.position.set(0.25, obstacle.heightM - 0.12, 0);
    group.add(bracket);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.22, 0.22),
      new THREE.MeshStandardMaterial({ color: selected ? palette.obstacleSelected : palette.cameraBody, roughness: 0.4, metalness: 0.3 })
    );
    head.position.set(0.5, obstacle.heightM - 0.16, 0);
    group.add(head);
  }

  group.position.set(obstacle.center.x, 0, obstacle.center.z);
  group.rotation.y = -(obstacle.rotationDeg * Math.PI) / 180;
  group.userData = { kind: "obstacle", id: obstacle.id };
  group.traverse((child) => { child.userData = { kind: "obstacle", id: obstacle.id }; });
  return group;
}

function buildElevatorObstacle(THREE: ThreeModule, obstacle: PlanObstacle, selected: boolean) {
  const group = new THREE.Group();
  const shell = obstacleMaterial(THREE, 0x64748b, obstacle, selected, 0.02);
  const steel = obstacleMaterial(THREE, 0xcbd5e1, obstacle, selected, 0.04);
  const door = obstacleMaterial(THREE, 0x94a3b8, obstacle, selected, 0.03);
  const dark = obstacleMaterial(THREE, 0x1e293b, obstacle, selected, 0.02);
  const { widthM, depthM, heightM } = obstacle;

  const box = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE_NS.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  // Solid shaft at the rear, with a recessed two-panel sliding door on the circulation side (+z).
  box(widthM, heightM, depthM * 0.42, 0, heightM / 2, -depthM * 0.29, shell);
  box(0.16, heightM, depthM * 0.58, -widthM / 2 + 0.08, heightM / 2, depthM * 0.21, shell);
  box(0.16, heightM, depthM * 0.58, widthM / 2 - 0.08, heightM / 2, depthM * 0.21, shell);
  box(widthM, 0.18, depthM * 0.58, 0, heightM - 0.09, depthM * 0.21, shell);
  box(widthM * 0.43, heightM * 0.82, 0.08, -widthM * 0.22, heightM * 0.43, depthM / 2 - 0.05, door);
  box(widthM * 0.43, heightM * 0.82, 0.08, widthM * 0.22, heightM * 0.43, depthM / 2 - 0.05, door);
  box(0.035, heightM * 0.82, 0.1, 0, heightM * 0.43, depthM / 2, dark);
  box(widthM * 0.32, 0.18, 0.08, 0, heightM * 0.92, depthM / 2, steel);
  box(0.12, 0.22, 0.08, widthM * 0.39, heightM * 0.56, depthM / 2, dark);

  group.position.set(obstacle.center.x, 0, obstacle.center.z);
  group.rotation.y = -(obstacle.rotationDeg * Math.PI) / 180;
  group.userData = { kind: "obstacle", id: obstacle.id };
  group.traverse((child) => Object.assign(child.userData, { kind: "obstacle", id: obstacle.id }));
  return group;
}

function buildEscalatorObstacle(THREE: ThreeModule, obstacle: PlanObstacle, selected: boolean) {
  const group = new THREE.Group();
  const stepCount = 18;
  const tread = obstacle.widthM / stepCount;
  const rise = obstacle.heightM / stepCount;
  const stepMaterial = obstacleMaterial(THREE, 0x94a3b8, obstacle, selected, 0.04);
  const edgeMaterial = obstacleMaterial(THREE, 0xfbbf24, obstacle, selected, 0.02);
  const railMaterial = obstacleMaterial(THREE, 0x1e293b, obstacle, selected, 0.7);
  const glassMaterial = obstacleMaterial(THREE, 0x9ed8ea, { ...obstacle, blocksView: false }, selected, 0.05);

  for (let index = 0; index < stepCount; index += 1) {
    const stepHeight = rise * (index + 1);
    const x = -obstacle.widthM / 2 + tread * (index + 0.5);
    const step = new THREE.Mesh(new THREE.BoxGeometry(tread * 1.02, stepHeight, obstacle.depthM * 0.72), stepMaterial);
    step.position.set(x, stepHeight / 2, 0);
    group.add(step);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.035, obstacle.depthM * 0.74), edgeMaterial);
    edge.position.set(x + tread / 2, stepHeight + 0.018, 0);
    group.add(edge);
  }

  for (const z of [-obstacle.depthM * 0.48, obstacle.depthM * 0.48]) {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(obstacle.widthM, 0.65, 0.055), glassMaterial);
    glass.position.set(0, obstacle.heightM / 2 + 0.42, z);
    glass.rotation.z = Math.atan2(obstacle.heightM, obstacle.widthM);
    group.add(glass);
    group.add(branchBetween(
      THREE,
      new THREE.Vector3(-obstacle.widthM / 2, 0.78, z),
      new THREE.Vector3(obstacle.widthM / 2, obstacle.heightM + 0.78, z),
      0.055,
      railMaterial
    ));
  }

  addSelectionFootprint(THREE, group, obstacle, selected);
  return finishObstacleGroup(group, obstacle);
}

function buildStairObstacle(THREE: ThreeModule, obstacle: PlanObstacle, selected: boolean) {
  const group = new THREE.Group();
  const stepCount = Math.max(6, Math.min(24, Math.round(obstacle.widthM / 0.28)));
  const tread = obstacle.widthM / stepCount;
  const rise = obstacle.heightM / stepCount;
  const stone = obstacleMaterial(THREE, 0xd8dee3, obstacle, selected, 0.04);
  const riser = obstacleMaterial(THREE, 0xb7c2ca, obstacle, selected, 0.03);
  const rail = obstacleMaterial(THREE, 0x344b5a, obstacle, selected, 0.72);

  for (let index = 0; index < stepCount; index += 1) {
    const stepHeight = rise * (index + 1);
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(tread * 1.03, stepHeight, obstacle.depthM),
      index % 2 === 0 ? stone : riser
    );
    step.position.set(-obstacle.widthM / 2 + tread * (index + 0.5), stepHeight / 2, 0);
    group.add(step);
  }

  const railHeight = Math.min(1.05, Math.max(0.65, obstacle.heightM * 0.3));
  for (const z of [-obstacle.depthM * 0.48, obstacle.depthM * 0.48]) {
    const lower = new THREE.Vector3(-obstacle.widthM / 2, railHeight, z);
    const upper = new THREE.Vector3(obstacle.widthM / 2, obstacle.heightM + railHeight, z);
    group.add(branchBetween(THREE, lower, upper, Math.max(0.025, obstacle.depthM * 0.025), rail));
    for (let index = 0; index <= stepCount; index += Math.max(2, Math.floor(stepCount / 5))) {
      const progress = index / stepCount;
      const x = -obstacle.widthM / 2 + obstacle.widthM * progress;
      const floorY = obstacle.heightM * progress;
      group.add(branchBetween(
        THREE,
        new THREE.Vector3(x, floorY, z),
        new THREE.Vector3(x, floorY + railHeight, z),
        Math.max(0.02, obstacle.depthM * 0.02),
        rail
      ));
    }
  }
  addSelectionFootprint(THREE, group, obstacle, selected);
  return finishObstacleGroup(group, obstacle);
}

function loadObstacleAsset(url: string) {
  const cached = obstacleAssetCache.get(url);
  if (cached) return cached;
  const request = import("three/examples/jsm/loaders/GLTFLoader.js")
    .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(url))
    .then((gltf) => {
      loadedObstacleAssets.set(url, gltf.scene);
      return gltf.scene as THREE_NS.Object3D;
    })
    .catch(() => null);
  obstacleAssetCache.set(url, request);
  return request;
}

function cloneObstacleAsset(THREE: ThreeModule, source: THREE_NS.Object3D, selected: boolean) {
  const clone = source.clone(true);
  clone.traverse((child) => {
    const mesh = child as THREE_NS.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry = mesh.geometry.clone();
    const cloneMaterial = (material: THREE_NS.Material) => {
      const copy = material.clone();
      copy.userData = { ...copy.userData, sharedAssetTextures: true };
      if (selected && "emissive" in copy) {
        const standard = copy as THREE_NS.MeshStandardMaterial;
        standard.emissive = new THREE.Color(palette.obstacleSelected);
        standard.emissiveIntensity = 0.16;
      }
      return copy;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(cloneMaterial)
      : cloneMaterial(mesh.material);
  });
  return clone;
}

function fitObstacleAsset(
  THREE: ThreeModule,
  source: THREE_NS.Object3D,
  obstacle: PlanObstacle,
  selected: boolean
) {
  const fitted = new THREE.Group();
  const model = cloneObstacleAsset(THREE, source, selected);
  fitted.add(model);
  fitted.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(fitted);
  let size = bounds.getSize(new THREE.Vector3());

  // Kenney assets are not all authored on the same forward axis. The longest horizontal
  // dimension is the vehicle length (or immaterial for a near-round tree), so orient it
  // along plan-space X before fitting the editable obstacle envelope.
  if (size.z > size.x * 1.08) {
    model.rotation.y = Math.PI / 2;
    fitted.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(fitted);
    size = bounds.getSize(new THREE.Vector3());
  }

  fitted.scale.set(
    (obstacle.widthM * 0.96) / Math.max(size.x, 0.001),
    (obstacle.heightM * 0.98) / Math.max(size.y, 0.001),
    (obstacle.depthM * 0.96) / Math.max(size.z, 0.001)
  );
  fitted.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(fitted);
  const center = bounds.getCenter(new THREE.Vector3());
  fitted.position.set(-center.x, -bounds.min.y, -center.z);
  return fitted;
}

function disposeObstacleChildren(group: THREE_NS.Group) {
  group.traverse((child) => {
    if (child === group) return;
    const mesh = child as THREE_NS.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) material.dispose();
  });
  group.clear();
}

function attachDetailedObstacleAsset(
  THREE: ThreeModule,
  group: THREE_NS.Group,
  obstacle: PlanObstacle,
  selected: boolean,
  renderScope?: ObstacleRenderScope
) {
  if (typeof window === "undefined" || !obstacle.variant) return;
  const url = obstacleAssetUrls[obstacle.variant];
  if (!url) return;
  const replaceWith = (source: THREE_NS.Object3D) => {
    disposeObstacleChildren(group);
    group.add(fitObstacleAsset(THREE, source, obstacle, selected));
    addSelectionFootprint(THREE, group, obstacle, selected);
    finishObstacleGroup(group, obstacle);
    group.userData.assetStatus = "ready";
  };
  const loaded = loadedObstacleAssets.get(url);
  if (loaded) {
    replaceWith(loaded);
    return;
  }
  group.userData.assetStatus = "loading";
  void loadObstacleAsset(url).then((source) => {
    if (!isLiveObstacleRender(group, renderScope)) return;
    if (!source) {
      group.userData.assetStatus = "fallback";
      return;
    }
    replaceWith(source);
  });
}

function isLiveObstacleRender(group: THREE_NS.Group, renderScope?: ObstacleRenderScope) {
  if (group.userData.sceneDisposed) return false;
  if (renderScope && (
    group.userData.floorId !== renderScope.floorId
    || group.userData.sceneGeneration !== renderScope.sceneGeneration
  )) return false;
  let ancestor: THREE_NS.Object3D | null = group;
  while (ancestor) {
    if (ancestor.userData.sceneDisposed) return false;
    if ((ancestor as THREE_NS.Scene).isScene) return true;
    ancestor = ancestor.parent;
  }
  return false;
}

function obstacleMaterial(
  THREE: ThreeModule,
  color: number,
  obstacle: PlanObstacle,
  selected: boolean,
  metalness = 0.05
) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: selected ? palette.obstacleSelected : 0x000000,
    emissiveIntensity: selected ? 0.28 : 0,
    roughness: metalness > 0.2 ? 0.3 : 0.68,
    metalness,
    transparent: !obstacle.blocksView,
    opacity: obstacle.blocksView ? 1 : 0.48
  });
}

function finishObstacleGroup(group: THREE_NS.Group, obstacle: PlanObstacle) {
  group.traverse((child) => {
    const mesh = child as THREE_NS.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  group.position.set(obstacle.center.x, 0, obstacle.center.z);
  group.rotation.y = -(obstacle.rotationDeg * Math.PI) / 180;
  group.userData = { ...group.userData, kind: "obstacle", id: obstacle.id, sceneDisposed: false };
  const floorId = group.userData.floorId;
  const sceneGeneration = group.userData.sceneGeneration;
  group.traverse((child) => {
    child.userData = {
      ...child.userData,
      kind: "obstacle",
      id: obstacle.id,
      ...(floorId ? { floorId } : {}),
      ...(typeof sceneGeneration === "number" ? { sceneGeneration } : {}),
      sceneDisposed: false
    };
  });
  let ancestor = group.parent;
  while (ancestor) {
    if (typeof ancestor.userData.floorOpacity === "number") {
      applyObjectOpacity(group, ancestor.userData.floorOpacity);
      break;
    }
    ancestor = ancestor.parent;
  }
  return group;
}

export function applyObjectOpacity(root: THREE_NS.Object3D, opacity: number) {
  root.traverse((child) => {
    const mesh = child as THREE_NS.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      material.transparent = opacity < 0.999 || material.transparent;
      material.opacity = Math.min(material.opacity, opacity);
      material.depthWrite = opacity >= 0.72;
      material.needsUpdate = true;
    }
  });
}

export function buildFloorFootprintGuide(THREE: ThreeModule, floor: FloorPlan) {
  const group = new THREE.Group();
  const loop = largestClosedWallLoop(floor.walls);
  if (!loop && floor.walls.length === 0) return group;
  const material = new THREE.MeshBasicMaterial({
    color: 0xef4444,
    depthTest: false,
    transparent: true,
    opacity: 0.98
  });
  const segments = loop
    ? loop.map((point, index) => ({ a: point, b: loop[(index + 1) % loop.length] }))
    : floor.walls.map((wall) => ({ a: wall.a, b: wall.b }));
  for (const { a, b } of segments) {
    const segment = branchBetween(
      THREE,
      new THREE.Vector3(a.x, 0.15, a.z),
      new THREE.Vector3(b.x, 0.15, b.z),
      0.075,
      material
    );
    segment.renderOrder = 45;
    group.add(segment);
  }
  group.userData = { kind: "floor-reference", floorId: floor.id };
  return group;
}

/** Architectural overall dimensions: one clean chain for each main axis. */
export function buildOverallDimensionGuide(THREE: ThreeModule, floor: FloorPlan) {
  const group = new THREE.Group();
  const bounds = floorWallBounds(floor);
  if (!bounds) return group;
  const offset = Math.max(1.4, Math.min(2.4, Math.max(bounds.width, bounds.depth) * 0.055));
  const y = 0.12;
  const xDimensionZ = bounds.maxZ + offset;
  const zDimensionX = bounds.minX - offset;
  const material = new THREE.LineBasicMaterial({ color: 0x164e63, depthTest: false, transparent: true, opacity: 0.88 });
  const segment = (a: THREE_NS.Vector3, b: THREE_NS.Vector3) => {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), material);
    line.renderOrder = 48;
    group.add(line);
  };
  const tick = 0.45;

  segment(new THREE.Vector3(bounds.minX, y, xDimensionZ), new THREE.Vector3(bounds.maxX, y, xDimensionZ));
  segment(new THREE.Vector3(bounds.minX, y, bounds.maxZ + 0.15), new THREE.Vector3(bounds.minX, y, xDimensionZ + 0.3));
  segment(new THREE.Vector3(bounds.maxX, y, bounds.maxZ + 0.15), new THREE.Vector3(bounds.maxX, y, xDimensionZ + 0.3));
  segment(new THREE.Vector3(bounds.minX - tick, y, xDimensionZ - tick), new THREE.Vector3(bounds.minX + tick, y, xDimensionZ + tick));
  segment(new THREE.Vector3(bounds.maxX - tick, y, xDimensionZ - tick), new THREE.Vector3(bounds.maxX + tick, y, xDimensionZ + tick));

  segment(new THREE.Vector3(zDimensionX, y, bounds.minZ), new THREE.Vector3(zDimensionX, y, bounds.maxZ));
  segment(new THREE.Vector3(bounds.minX - 0.15, y, bounds.minZ), new THREE.Vector3(zDimensionX - 0.3, y, bounds.minZ));
  segment(new THREE.Vector3(bounds.minX - 0.15, y, bounds.maxZ), new THREE.Vector3(zDimensionX - 0.3, y, bounds.maxZ));
  segment(new THREE.Vector3(zDimensionX - tick, y, bounds.minZ + tick), new THREE.Vector3(zDimensionX + tick, y, bounds.minZ - tick));
  segment(new THREE.Vector3(zDimensionX - tick, y, bounds.maxZ + tick), new THREE.Vector3(zDimensionX + tick, y, bounds.maxZ - tick));
  return group;
}

export function buildFloorSlab(THREE: ThreeModule, floor: FloorPlan, focused: boolean) {
  const group = new THREE.Group();
  const loop = largestClosedWallLoop(floor.walls);
  if (!loop || loop.length < 3) return group;
  const shape = new THREE.Shape();
  shape.moveTo(loop[0].x, loop[0].z);
  for (let index = 1; index < loop.length; index += 1) shape.lineTo(loop[index].x, loop[index].z);
  shape.closePath();
  const slab = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshStandardMaterial({
      color: focused ? 0x5ab6df : 0xb9cbd3,
      transparent: true,
      opacity: focused ? 0.2 : 0.08,
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );
  slab.rotation.x = Math.PI / 2;
  slab.position.y = 0.018;
  slab.receiveShadow = true;
  group.add(slab);
  return group;
}

function addSelectionFootprint(THREE: ThreeModule, group: THREE_NS.Group, obstacle: PlanObstacle, selected: boolean) {
  if (!selected) return;
  const halfLength = obstacle.widthM * 0.54;
  const halfWidth = obstacle.depthM * 0.58;
  const points = [
    new THREE.Vector3(-halfLength, 0.035, -halfWidth),
    new THREE.Vector3(halfLength, 0.035, -halfWidth),
    new THREE.Vector3(halfLength, 0.035, halfWidth),
    new THREE.Vector3(-halfLength, 0.035, halfWidth)
  ];
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: palette.obstacleSelected, depthTest: false, transparent: true, opacity: 0.95 })
  );
  outline.renderOrder = 40;
  group.add(outline);
}

function vehicleProfile(
  THREE: ThreeModule,
  length: number,
  width: number,
  height: number,
  variant: PlanObstacle["variant"],
  material: THREE_NS.Material
) {
  const shape = new THREE.Shape();
  const highRoof = variant === "van";
  const suvRoof = variant === "suv";
  const roofY = height * (highRoof ? 0.92 : suvRoof ? 0.86 : 0.78);
  shape.moveTo(-length * 0.49, height * 0.2);
  shape.lineTo(-length * 0.47, height * 0.4);
  shape.quadraticCurveTo(-length * 0.43, height * 0.5, -length * 0.32, height * 0.53);
  shape.lineTo(-length * (highRoof ? 0.3 : 0.18), roofY);
  shape.quadraticCurveTo(0, height * (highRoof ? 0.98 : 0.91), length * (highRoof ? 0.32 : 0.19), roofY);
  shape.lineTo(length * 0.39, height * 0.55);
  shape.quadraticCurveTo(length * 0.48, height * 0.5, length * 0.5, height * 0.34);
  shape.lineTo(length * 0.48, height * 0.2);
  shape.closePath();
  const bevel = Math.max(0.025, Math.min(length, width, height) * 0.035);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width * 0.82,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: bevel,
    bevelThickness: bevel
  });
  geometry.translate(0, 0, -width * 0.41);
  return new THREE.Mesh(geometry, material);
}

function addVehicleDetails(
  THREE: ThreeModule,
  group: THREE_NS.Group,
  obstacle: PlanObstacle,
  selected: boolean,
  wheelX: number[]
) {
  const { widthM: length, depthM: width, heightM: height } = obstacle;
  const glass = obstacleMaterial(THREE, 0x0b2638, obstacle, selected, 0.62);
  const tyre = obstacleMaterial(THREE, 0x101820, obstacle, selected, 0.05);
  const rim = obstacleMaterial(THREE, 0xcbd5e1, obstacle, selected, 0.82);
  const headlight = new THREE.MeshStandardMaterial({ color: 0xfff7cf, emissive: 0xffd56a, emissiveIntensity: 2.4, roughness: 0.16 });
  const tailLight = new THREE.MeshStandardMaterial({ color: 0xe11d48, emissive: 0xbe123c, emissiveIntensity: 1.8, roughness: 0.2 });

  if (obstacle.variant !== "truck") {
    for (const z of [-width * 0.425, width * 0.425]) {
      const sideWindow = new THREE.Mesh(new THREE.BoxGeometry(length * (obstacle.variant === "van" ? 0.53 : 0.42), height * 0.26, 0.025), glass);
      sideWindow.position.set(0, height * 0.68, z);
      group.add(sideWindow);
    }
  }

  const wheelRadius = Math.min(height * 0.2, width * 0.17);
  const wheelDepth = Math.max(0.08, width * 0.105);
  for (const x of wheelX) {
    for (const z of [-width * 0.46, width * 0.46]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelDepth, 24), tyre);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, wheelRadius, z);
      group.add(wheel);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(wheelRadius * 0.48, wheelRadius * 0.48, wheelDepth * 1.06, 16), rim);
      hub.rotation.x = Math.PI / 2;
      hub.position.copy(wheel.position);
      group.add(hub);
    }
  }

  for (const z of [-width * 0.28, width * 0.28]) {
    const front = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.055, width * 0.055), 14, 8), headlight);
    front.scale.set(0.35, 0.65, 1);
    front.position.set(length * 0.49, height * 0.37, z);
    group.add(front);
    const rear = new THREE.Mesh(new THREE.BoxGeometry(0.035, height * 0.12, width * 0.12), tailLight);
    rear.position.set(-length * 0.49, height * 0.38, z);
    group.add(rear);
  }
}

function buildVehicleObstacle(THREE: ThreeModule, obstacle: PlanObstacle, selected: boolean) {
  const group = new THREE.Group();
  const { widthM: length, depthM: width, heightM: height } = obstacle;
  const bodyColor = obstacle.variant === "truck" ? 0xf59e0b
    : obstacle.variant === "pickup" ? 0x64748b
      : obstacle.variant === "van" ? 0xe2e8f0
        : obstacle.variant === "suv" ? 0x2563eb : 0x0f766e;
  const bodyMaterial = obstacleMaterial(THREE, bodyColor, obstacle, selected, 0.35);
  const glassMaterial = obstacleMaterial(THREE, 0x102d40, obstacle, selected, 0.6);

  if (obstacle.variant === "truck") {
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(length * 0.57, height * 0.72, width * 0.88, 3, 3, 2), bodyMaterial);
    cargo.position.set(-length * 0.15, height * 0.61, 0);
    group.add(cargo);
    const cab = vehicleProfile(THREE, length * 0.3, width, height * 0.83, "van", bodyMaterial);
    cab.position.x = length * 0.34;
    group.add(cab);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.035, height * 0.29, width * 0.68), glassMaterial);
    windshield.position.set(length * 0.485, height * 0.59, 0);
    group.add(windshield);
    for (let index = -2; index <= 2; index += 1) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.025, height * 0.65, width * 0.895), obstacleMaterial(THREE, 0xd18a12, obstacle, selected, 0.3));
      rib.position.set(-length * 0.15 + index * length * 0.1, height * 0.61, 0);
      group.add(rib);
    }
  } else if (obstacle.variant === "pickup") {
    const body = vehicleProfile(THREE, length, width, height, "suv", bodyMaterial);
    group.add(body);
    const bedCut = new THREE.Mesh(new THREE.BoxGeometry(length * 0.32, height * 0.28, width * 0.73), obstacleMaterial(THREE, 0x29343d, obstacle, selected, 0.12));
    bedCut.position.set(-length * 0.29, height * 0.69, 0);
    group.add(bedCut);
    const rollBar = new THREE.Mesh(new THREE.TorusGeometry(width * 0.27, Math.max(0.025, width * 0.018), 8, 24, Math.PI), bodyMaterial);
    rollBar.rotation.y = Math.PI / 2;
    rollBar.position.set(-length * 0.1, height * 0.77, 0);
    group.add(rollBar);
  } else {
    group.add(vehicleProfile(THREE, length, width, height, obstacle.variant, bodyMaterial));
  }

  addVehicleDetails(
    THREE,
    group,
    obstacle,
    selected,
    obstacle.variant === "truck" ? [-length * 0.32, -length * 0.08, length * 0.33] : [-length * 0.31, length * 0.31]
  );
  addSelectionFootprint(THREE, group, obstacle, selected);
  return finishObstacleGroup(group, obstacle);
}

function branchBetween(
  THREE: ThreeModule,
  start: THREE_NS.Vector3,
  end: THREE_NS.Vector3,
  radius: number,
  material: THREE_NS.Material
) {
  const direction = end.clone().sub(start);
  const branch = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.7, radius, direction.length(), 10), material);
  branch.position.copy(start).add(end).multiplyScalar(0.5);
  branch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  return branch;
}

function addDeciduousCrown(THREE: ThreeModule, group: THREE_NS.Group, obstacle: PlanObstacle, selected: boolean, trunkHeight: number) {
  const colors = [0x216e39, 0x2f8a46, 0x4d9f50, 0x6aaa55];
  const clusters = [
    [-0.24, 0.02, 0.06, 0.58], [0.2, 0.08, 0.02, 0.62], [0, 0.22, -0.18, 0.66],
    [-0.04, 0.36, 0.16, 0.58], [0.3, 0.27, -0.13, 0.48], [-0.3, 0.28, -0.17, 0.46]
  ];
  for (const [x, y, z, scale] of clusters) {
    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.5, 2),
      obstacleMaterial(THREE, colors[group.children.length % colors.length], obstacle, selected)
    );
    crown.scale.set(obstacle.widthM * scale, obstacle.heightM * 0.25 * scale, obstacle.depthM * scale);
    crown.position.set(obstacle.widthM * x, trunkHeight + obstacle.heightM * y, obstacle.depthM * z);
    crown.rotation.set(x * 0.8, y * 1.2, z * 0.7);
    group.add(crown);
  }
}

function addPalmFronds(THREE: ThreeModule, group: THREE_NS.Group, obstacle: PlanObstacle, selected: boolean, topY: number) {
  const foliage = obstacleMaterial(THREE, 0x2c8b45, obstacle, selected);
  const frondLength = Math.min(obstacle.widthM, obstacle.depthM) * 0.54;
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const curve = new THREE.CubicBezierCurve3(
      new THREE.Vector3(0, topY, 0),
      direction.clone().multiplyScalar(frondLength * 0.28).setY(topY + obstacle.heightM * 0.08),
      direction.clone().multiplyScalar(frondLength * 0.72).setY(topY + obstacle.heightM * 0.03),
      direction.clone().multiplyScalar(frondLength).setY(topY - obstacle.heightM * (0.04 + (index % 3) * 0.015))
    );
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, Math.max(0.025, frondLength * 0.028), 7, false), foliage));
    for (let leafIndex = 3; leafIndex <= 9; leafIndex += 2) {
      const point = curve.getPoint(leafIndex / 12);
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(frondLength * 0.115, 10, 6), foliage);
      leaf.scale.set(1, 0.08, 0.22);
      leaf.rotation.y = angle + Math.PI / 2;
      leaf.position.copy(point);
      group.add(leaf);
    }
  }
}

function buildTreeObstacle(THREE: ThreeModule, obstacle: PlanObstacle, selected: boolean) {
  const group = new THREE.Group();
  const crownWidth = Math.min(obstacle.widthM, obstacle.depthM);
  const palm = obstacle.variant === "palm";
  const trunkRadius = Math.max(0.08, crownWidth * (palm ? 0.045 : 0.065));
  const trunkHeight = obstacle.heightM * (palm ? 0.78 : obstacle.variant === "conifer" ? 0.34 : 0.5);
  const bark = obstacleMaterial(THREE, palm ? 0xa36b35 : 0x704324, obstacle, selected);
  const trunkSegments = palm ? 7 : 1;
  let trunkStart = new THREE.Vector3(0, 0, 0);
  for (let index = 0; index < trunkSegments; index += 1) {
    const progress = (index + 1) / trunkSegments;
    const trunkEnd = new THREE.Vector3(
      palm ? Math.sin(progress * Math.PI) * crownWidth * 0.025 : 0,
      trunkHeight * progress,
      palm ? Math.sin(progress * Math.PI * 1.4) * crownWidth * 0.018 : 0
    );
    group.add(branchBetween(THREE, trunkStart, trunkEnd, trunkRadius * (1 - progress * 0.2), bark));
    trunkStart = trunkEnd;
  }

  if (obstacle.variant === "conifer") {
    const foliageColors = [0x124f34, 0x176b3a, 0x238348];
    for (let layer = 0; layer < 4; layer += 1) {
      const layerWidth = crownWidth * (1 - layer * 0.18);
      const layerHeight = obstacle.heightM * 0.33;
      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(layerWidth / 2, layerHeight, 24, 2),
        obstacleMaterial(THREE, foliageColors[layer % foliageColors.length], obstacle, selected)
      );
      crown.position.y = trunkHeight * 0.62 + layer * obstacle.heightM * 0.16 + layerHeight / 2;
      crown.rotation.y = layer * 0.48;
      group.add(crown);
    }
  } else if (palm) {
    addPalmFronds(THREE, group, obstacle, selected, trunkHeight);
  } else {
    for (const direction of [-1, 1]) {
      const start = new THREE.Vector3(0, trunkHeight * 0.58, 0);
      const end = new THREE.Vector3(direction * obstacle.widthM * 0.18, trunkHeight * 0.92, direction * obstacle.depthM * 0.08);
      group.add(branchBetween(THREE, start, end, trunkRadius * 0.45, bark));
    }
    addDeciduousCrown(THREE, group, obstacle, selected, trunkHeight * 0.72);
  }
  addSelectionFootprint(THREE, group, obstacle, selected);
  return finishObstacleGroup(group, obstacle);
}

/**
 * A recognisable bullet camera with lens, visor, wall bracket and a small direction
 * footprint. The old cone read as a plus sign from above, especially before coverage
 * was enabled; this silhouette remains legible in both plan and orbit views.
 */
export function buildCameraMarker(
  THREE: ThreeModule,
  id: string,
  position: Vec2,
  mountHeightM: number,
  yawDeg: number,
  selected: boolean,
  housing: CameraHousing = "bullet"
): THREE_NS.Group {
  const group = new THREE.Group();
  const color = selected ? palette.cameraSelected : palette.cameraBody;
  const yawRad = (yawDeg * Math.PI) / 180;
  const shellMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.35 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x17364d, roughness: 0.2, metalness: 0.55 });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: selected ? 0x7dd3fc : 0x38bdf8,
    emissive: selected ? 0x0ea5e9 : 0x075985,
    emissiveIntensity: 0.75,
    roughness: 0.08,
    metalness: 0.7
  });
  const heading = new THREE.Group();
  heading.position.y = mountHeightM;
  heading.rotation.y = -yawRad;

  if (housing === "bullet") {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.24, 1.08, 20), shellMaterial);
    body.rotation.z = Math.PI / 2;
    heading.add(body);

    const rear = new THREE.Mesh(new THREE.SphereGeometry(0.235, 18, 12), shellMaterial);
    rear.scale.x = 0.72;
    rear.position.x = -0.52;
    heading.add(rear);

    const lensHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.13, 20), darkMaterial);
    lensHousing.rotation.z = Math.PI / 2;
    lensHousing.position.x = 0.57;
    heading.add(lensHousing);

    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.115, 24), glassMaterial);
    lens.rotation.y = Math.PI / 2;
    lens.position.x = 0.642;
    heading.add(lens);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.07, 0.43), shellMaterial);
    visor.position.set(0.25, 0.245, 0);
    heading.add(visor);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.28, 12), darkMaterial);
    neck.position.set(-0.42, -0.29, 0);
    heading.add(neck);
  } else if (housing === "dome") {
    const ceilingPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 28), shellMaterial);
    ceilingPlate.position.y = 0.08;
    heading.add(ceilingPlate);

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 28, 16),
      new THREE.MeshStandardMaterial({
        color: selected ? 0xfbbf24 : 0xb9d7e8,
        roughness: 0.14,
        metalness: 0.18,
        transparent: true,
        opacity: 0.86
      })
    );
    dome.scale.y = 0.62;
    dome.position.y = -0.16;
    heading.add(dome);

    const domeLens = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 12), glassMaterial);
    domeLens.scale.x = 0.7;
    domeLens.position.set(0.26, -0.18, 0);
    heading.add(domeLens);
  } else if (housing === "turret") {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.16, 24), shellMaterial);
    base.position.y = -0.02;
    heading.add(base);

    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 16), shellMaterial);
    ball.position.set(0.08, 0.05, 0);
    heading.add(ball);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.42, 20), darkMaterial);
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(0.31, 0.03, 0);
    heading.add(barrel);

    const turretLens = new THREE.Mesh(new THREE.CircleGeometry(0.095, 22), glassMaterial);
    turretLens.rotation.y = Math.PI / 2;
    turretLens.position.set(0.525, 0.03, 0);
    heading.add(turretLens);
  } else {
    const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.34, 0.18, 28), shellMaterial);
    canopy.position.y = 0.13;
    heading.add(canopy);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.24, 18), darkMaterial);
    neck.position.y = -0.08;
    heading.add(neck);

    const gimbal = new THREE.Mesh(new THREE.SphereGeometry(0.34, 26, 18), shellMaterial);
    gimbal.position.y = -0.32;
    heading.add(gimbal);

    const ptzLensHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.3, 20), darkMaterial);
    ptzLensHousing.rotation.z = Math.PI / 2;
    ptzLensHousing.position.set(0.28, -0.34, 0);
    heading.add(ptzLensHousing);

    const ptzLens = new THREE.Mesh(new THREE.CircleGeometry(0.095, 22), glassMaterial);
    ptzLens.rotation.y = Math.PI / 2;
    ptzLens.position.set(0.435, -0.34, 0);
    heading.add(ptzLens);

    const patrolHalo = new THREE.Mesh(
      new THREE.RingGeometry(0.48, 0.55, 40),
      new THREE.MeshBasicMaterial({
        color: selected ? 0xf59e0b : 0x22c1dc,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    patrolHalo.rotation.x = -Math.PI / 2;
    patrolHalo.position.y = -0.58;
    heading.add(patrolHalo);
  }
  group.add(heading);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.055, Math.max(0.1, mountHeightM - 0.25), 10),
    new THREE.MeshStandardMaterial({ color: 0x8fa6b6 })
  );
  pole.position.y = Math.max(0.1, (mountHeightM - 0.25) / 2);
  group.add(pole);

  const footprint = new THREE.Mesh(
    new THREE.RingGeometry(
      housing === "ptz" ? 0.46 : 0.34,
      housing === "ptz" ? (selected ? 0.68 : 0.61) : (selected ? 0.58 : 0.49),
      32
    ),
    new THREE.MeshBasicMaterial({
      color: selected ? 0xf59e0b : 0x38bdf8,
      transparent: true,
      opacity: selected ? 0.5 : 0.28,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );
  footprint.rotation.x = -Math.PI / 2;
  footprint.position.y = 0.035;
  group.add(footprint);

  if (housing !== "ptz") {
    const direction = new THREE.Mesh(
      new THREE.ConeGeometry(housing === "dome" ? 0.17 : 0.22, housing === "dome" ? 0.46 : 0.62, 3),
      new THREE.MeshBasicMaterial({
        color: selected ? 0xf59e0b : 0x0ea5e9,
        transparent: true,
        opacity: 0.72,
        depthWrite: false
      })
    );
    direction.rotation.z = -Math.PI / 2;
    direction.rotation.y = -yawRad;
    direction.position.set(Math.cos(yawRad) * 0.72, 0.055, Math.sin(yawRad) * 0.72);
    group.add(direction);
  }

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
  const handleColor = isCardinalAngle(yawDeg) ? 0xef4444 : 0xf59e0b;
  const reach = 2.2;
  const tip = { x: position.x + Math.cos(yawRad) * reach, z: position.z + Math.sin(yawRad) * reach };

  const stem = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(position.x, mountHeightM, position.z),
      new THREE.Vector3(tip.x, mountHeightM, tip.z)
    ]),
    new THREE.LineBasicMaterial({ color: handleColor })
  );
  // The stem is guidance only. It deliberately has no interaction metadata, so a
  // pointer press near the camera body can never be interpreted as a rotate gesture.
  group.add(stem);

  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 16, 12),
    new THREE.MeshStandardMaterial({ color: handleColor, roughness: 0.35 })
  );
  knob.position.set(tip.x, mountHeightM, tip.z);
  knob.userData = { kind: "camera-yaw", id };
  group.add(knob);

  return group;
}

/**
 * Rotation handle for a placed obstacle.
 *
 * Mirrors the camera's yaw handle so one gesture works everywhere: grab the amber knob
 * and drag to spin the element. Reach scales with the footprint, so the handle clears a
 * conference table as well as a nightstand.
 */
export function buildObstacleRotateHandle(
  THREE: ThreeModule,
  obstacle: PlanObstacle
): THREE_NS.Group {
  const group = new THREE.Group();
  const rotationRad = -(obstacle.rotationDeg * Math.PI) / 180;
  const handleColor = isCardinalAngle(obstacle.rotationDeg) ? 0xef4444 : 0xf59e0b;
  const reach = Math.max(1.1, Math.max(obstacle.widthM, obstacle.depthM) * 0.75 + 0.7);
  const handleHeight = Math.max(0.25, obstacle.heightM + 0.25);
  const tip = {
    x: obstacle.center.x + Math.cos(rotationRad) * reach,
    z: obstacle.center.z + Math.sin(rotationRad) * reach
  };

  group.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(obstacle.center.x, handleHeight, obstacle.center.z),
      new THREE.Vector3(tip.x, handleHeight, tip.z)
    ]),
    new THREE.LineBasicMaterial({ color: handleColor })
  ));

  const handleMaterial = new THREE.MeshStandardMaterial({ color: handleColor, roughness: 0.35 });

  // An arrow head rather than a plain ball, so the element's facing is readable.
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.6, 12), handleMaterial);
  arrow.position.set(tip.x, handleHeight, tip.z);
  arrow.rotation.z = -Math.PI / 2;
  arrow.rotation.y = -rotationRad;
  // Only the arrow head starts rotation. Previously the line and the small centre
  // marker were tagged too, which made dragging the selected object itself rotate it.
  arrow.userData = { kind: "obstacle-rotate", id: obstacle.id };
  group.add(arrow);

  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), handleMaterial);
  knob.position.set(obstacle.center.x, handleHeight, obstacle.center.z);
  group.add(knob);

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

  /*
   * Bands are disjoint rings, so opacity no longer compounds and each can be drawn at
   * full strength. They sit at one height with a shared render order — nothing overlaps,
   * so there is no z-fighting to stagger around, and every zone keeps its own colour.
   */
  coverage.bands.forEach((band) => {
    if (band.polygon.length < 3) return;
    const shape = polygonShape(THREE, band.polygon);
    const fill = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(band.color),
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    fill.rotation.x = Math.PI / 2;
    fill.position.y = 0.02;
    fill.renderOrder = 3;
    group.add(fill);

    // A crisp edge in the same hue keeps the boundary between zones readable where two
    // saturated fills meet.
    const edge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        band.polygon.map((point) => new THREE.Vector3(point.x, 0.045, point.z))
      ),
      new THREE.LineBasicMaterial({ color: new THREE.Color(band.color), transparent: true, opacity: 0.95 })
    );
    edge.renderOrder = 4;
    group.add(edge);
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

export function buildPreviewRect(THREE: ThreeModule, from: Vec2, to: Vec2, color = palette.preview): THREE_NS.Object3D {
  const group = new THREE.Group();
  const corners = [
    new THREE.Vector3(from.x, 0.13, from.z),
    new THREE.Vector3(to.x, 0.13, from.z),
    new THREE.Vector3(to.x, 0.13, to.z),
    new THREE.Vector3(from.x, 0.13, to.z)
  ];
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(corners),
    new THREE.LineBasicMaterial({ color, depthTest: false })
  );
  outline.renderOrder = 31;
  group.add(outline);
  const widthM = Math.abs(to.x - from.x);
  const depthM = Math.abs(to.z - from.z);
  if (widthM > 0.001 && depthM > 0.001) {
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(widthM, depthM),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false
      })
    );
    fill.rotation.x = -Math.PI / 2;
    fill.position.set((from.x + to.x) / 2, 0.11, (from.z + to.z) / 2);
    fill.renderOrder = 30;
    group.add(fill);
  }
  return group;
}

export type DimensionLabel = {
  id: string;
  kind: "overall-length" | "overall-width" | "selected-wall";
  text: string;
  world: { x: number; y: number; z: number };
};

function floorWallBounds(floor: FloorPlan) {
  const points = floor.walls.flatMap((wall) => [wall.a, wall.b]);
  if (!points.length) return null;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minZ = Math.min(...points.map((point) => point.z));
  const maxZ = Math.max(...points.map((point) => point.z));
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ };
}

/**
 * Overall dimensions stay visible. An internal wall reveals its length only when
 * selected, and furniture never receives a dimension badge.
 */
export function collectDimensionLabels(floor: FloorPlan, selectedWallId?: string): DimensionLabel[] {
  const bounds = floorWallBounds(floor);
  if (!bounds) return [];
  const offset = Math.max(1.4, Math.min(2.4, Math.max(bounds.width, bounds.depth) * 0.055));
  const labels: DimensionLabel[] = [
    {
      id: "overall-length",
      kind: "overall-length",
      text: `طول کل · ${bounds.width.toFixed(1)} متر`,
      world: { x: (bounds.minX + bounds.maxX) / 2, y: 0.2, z: bounds.maxZ + offset }
    },
    {
      id: "overall-width",
      kind: "overall-width",
      text: `عرض کل · ${bounds.depth.toFixed(1)} متر`,
      world: { x: bounds.minX - offset, y: 0.2, z: (bounds.minZ + bounds.maxZ) / 2 }
    }
  ];
  const selectedWall = selectedWallId ? floor.walls.find((wall) => wall.id === selectedWallId) : undefined;
  if (selectedWall) {
    const span = Math.hypot(selectedWall.b.x - selectedWall.a.x, selectedWall.b.z - selectedWall.a.z);
    labels.push({
      id: `selected-wall-${selectedWall.id}`,
      kind: "selected-wall",
      text: `دیوار انتخابی · ${span.toFixed(2)} متر`,
      world: {
        x: (selectedWall.a.x + selectedWall.b.x) / 2,
        y: selectedWall.heightM + 0.2,
        z: (selectedWall.a.z + selectedWall.b.z) / 2
      }
    });
  }
  return labels;
}
