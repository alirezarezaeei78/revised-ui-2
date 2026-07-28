import type { CameraHousing, SurveillanceTask } from "@/src/domain/catalog/types";

/**
 * Floor plan model for the site designer.
 *
 * Everything is stored in metres in plan space, with +x to the right and +z "down" the
 * page — the same convention the three.js scene uses for its ground plane, so no unit or
 * axis conversion happens between the editor, the coverage engine and the 3D view.
 *
 * Heights are metres above the floor of the storey the element belongs to, not absolute
 * elevation; a floor's own `elevationM` positions it in the stacked 3D view.
 */

export type Vec2 = { x: number; z: number };

export type PlanWall = {
  id: string;
  a: Vec2;
  b: Vec2;
  heightM: number;
  thicknessM: number;
  /** Glass and low partitions bound the space without blocking the camera's line of sight. */
  blocksView: boolean;
};

export type PlanDoor = {
  id: string;
  wallId: string;
  /** Normalised distance of the door centre from wall.a toward wall.b. */
  offset: number;
  widthM: number;
  heightM: number;
  hinge: "start" | "end";
  /** Visual opening angle; 0 is closed and 90 is fully open. */
  openAngleDeg: number;
};

export type ObstacleKind = "block" | "pillar" | "shelf" | "vehicle" | "counter";

export type PlanObstacle = {
  id: string;
  label: string;
  kind: ObstacleKind;
  center: Vec2;
  widthM: number;
  depthM: number;
  heightM: number;
  rotationDeg: number;
  blocksView: boolean;
};

/**
 * Optics for one placed camera.
 *
 * Held per camera rather than per project so a single floor can mix, for example, a
 * long-lens plate reader on the ramp with a wide turret over the till.
 */
export type PlanCameraOptics = {
  megapixel: number;
  sensorWidthMm: number;
  focalMm: number;
  mountHeightM: number;
  tiltDeg: number;
  irRangeM: number;
  /** Hard cap on the drawn wedge; beyond this the image is not useful regardless of maths. */
  maxRangeM: number;
};

export type PlanCamera = {
  id: string;
  name: string;
  /** Fixed wizard inventory slot used to prevent arbitrary camera creation. */
  definitionId?: string;
  /** Links the placement back to a wizard zone so counts and goals stay in sync. */
  zoneId?: string;
  groupName?: string;
  housing?: CameraHousing;
  features?: {
    microphone: boolean;
    colorNightVision: boolean;
    weatherproof: boolean;
  };
  position: Vec2;
  yawDeg: number;
  goal: SurveillanceTask;
  optics: PlanCameraOptics;
  productId?: string;
};

export type PlanCameraDefinition = {
  id: string;
  zoneId: string;
  groupName: string;
  name: string;
  housing: CameraHousing;
  goal: SurveillanceTask;
  optics: PlanCameraOptics;
  features: {
    microphone: boolean;
    colorNightVision: boolean;
    weatherproof: boolean;
  };
};

/**
 * An uploaded plan drawing positioned in plan space.
 *
 * `metresPerPixel` comes from the two-point calibration: the user clicks a known span on
 * the image and types its real length. Until that is done the image is decorative and
 * the designer will not derive dimensions from it.
 */
export type PlanBackdrop = {
  imageUrl: string;
  widthPx: number;
  heightPx: number;
  /** Plan-space position of the image's top-left corner. */
  originM: Vec2;
  metresPerPixel: number;
  opacity: number;
  calibrated: boolean;
};

export type FloorPlan = {
  id: string;
  name: string;
  elevationM: number;
  heightM: number;
  walls: PlanWall[];
  doors: PlanDoor[];
  obstacles: PlanObstacle[];
  cameras: PlanCamera[];
  backdrop?: PlanBackdrop;
};

export type BuildingPlan = {
  floors: FloorPlan[];
  activeFloorId: string;
  gridSizeM: number;
  snapM: number;
  defaults: PlanDefaults;
};

export type PlanDefaults = {
  wallHeightM: number;
  wallThicknessM: number;
  obstacleHeightM: number;
  cameraMountHeightM: number;
};

export type PlanTool = "select" | "wall" | "door" | "obstacle" | "camera" | "measure";
export type PlanViewMode = "top" | "orbit";

export type PlanSelection =
  | { kind: "wall"; id: string }
  | { kind: "door"; id: string }
  | { kind: "obstacle"; id: string }
  | { kind: "camera"; id: string }
  | null;

export const defaultCameraOptics: PlanCameraOptics = {
  megapixel: 4,
  sensorWidthMm: 5.12,
  focalMm: 4,
  mountHeightM: 3,
  tiltDeg: 12,
  irRangeM: 30,
  maxRangeM: 35
};

export const defaultWallHeightM = 3;
export const defaultWallThicknessM = 0.2;
export const defaultPlanDefaults: PlanDefaults = {
  wallHeightM: defaultWallHeightM,
  wallThicknessM: defaultWallThicknessM,
  obstacleHeightM: 1.2,
  cameraMountHeightM: defaultCameraOptics.mountHeightM
};

export function createFloor(name: string, index: number, storeyHeightM = 3.2): FloorPlan {
  return {
    id: `floor-${Date.now().toString(36)}-${index}`,
    name,
    elevationM: index * storeyHeightM,
    heightM: storeyHeightM,
    walls: [],
    doors: [],
    obstacles: [],
    cameras: []
  };
}

/** Fresh ids throughout, so editing the copy never mutates the floor it came from. */
export function duplicateFloor(source: FloorPlan, name: string, index: number): FloorPlan {
  const stamp = Date.now().toString(36);
  return {
    id: `floor-${stamp}-${index}`,
    name,
    elevationM: index * source.heightM,
    heightM: source.heightM,
    walls: source.walls.map((wall, order) => ({ ...wall, id: `wall-${stamp}-${order}`, a: { ...wall.a }, b: { ...wall.b } })),
    doors: (source.doors ?? []).map((door, order) => {
      const sourceWallIndex = source.walls.findIndex((wall) => wall.id === door.wallId);
      return {
        ...door,
        id: `door-${stamp}-${order}`,
        wallId: sourceWallIndex >= 0 ? `wall-${stamp}-${sourceWallIndex}` : door.wallId
      };
    }),
    obstacles: source.obstacles.map((obstacle, order) => ({ ...obstacle, id: `obs-${stamp}-${order}`, center: { ...obstacle.center } })),
    cameras: source.cameras.map((camera, order) => ({
      ...camera,
      id: `cam-${stamp}-${order}`,
      position: { ...camera.position },
      optics: { ...camera.optics }
    })),
    backdrop: source.backdrop ? { ...source.backdrop, originM: { ...source.backdrop.originM } } : undefined
  };
}

export function createEmptyPlan(): BuildingPlan {
  const ground = createFloor("طبقه همکف", 0);
  return {
    floors: [ground],
    activeFloorId: ground.id,
    gridSizeM: 1,
    snapM: 1,
    defaults: { ...defaultPlanDefaults }
  };
}
