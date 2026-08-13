import type { CameraHousing, CameraStreamConfig, SurveillanceTask } from "@/src/domain/catalog/types";

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

/**
 * An opening cut into a wall.
 *
 * Doors and windows share this shape because they share everything that matters here:
 * they attach to a wall, move with it, and are deleted with it. `sillHeightM` is what
 * separates them — a window starts above the floor, which is also why it does not break
 * a camera's sight line the way an open doorway does.
 */
export type PlanOpeningType = "door" | "window";

export type PlanDoor = {
  id: string;
  wallId: string;
  type?: PlanOpeningType;
  /** Normalised distance of the opening's centre from wall.a toward wall.b. */
  offset: number;
  widthM: number;
  heightM: number;
  /** Height of the opening's lower edge above the floor; 0 for a door. */
  sillHeightM?: number;
  hinge: "start" | "end";
  /** Visual opening angle; 0 is closed and 90 is fully open. Doors only. */
  openAngleDeg: number;
  /** Glazed openings bound the space without blocking the view through it. */
  blocksView?: boolean;
};

export type ObstacleKind =
  | "block"
  | "pillar"
  | "shelf"
  | "vehicle"
  | "counter"
  | "tree"
  | "stairs"
  | "surface"
  | "fence"
  | "gate"
  | "pole"
  | "equipment"
  | "furniture"
  | "appliance"
  | "seating"
  | "bed";

export type ObstacleVariant =
  | "sedan"
  | "suv"
  | "pickup"
  | "van"
  | "truck"
  | "deciduous"
  | "conifer"
  | "palm"
  | "stairs-straight"
  | "elevator"
  | "escalator"
  | "grass"
  | "road"
  | "bush"
  | "hedge"
  | "fence-mesh"
  | "fence-wall"
  | "gate-sliding"
  | "camera-pole"
  | "light-pole"
  | "equipment-rack"
  // Living room
  | "sofa-three"
  | "sofa-single"
  | "coffee-table"
  | "tv-unit"
  | "rug"
  | "dining-table"
  | "dining-chair"
  // Bedroom
  | "bed-double"
  | "bed-single"
  | "wardrobe"
  | "bookshelf"
  | "nightstand"
  | "dresser"
  // Kitchen
  | "fridge"
  | "kitchen-counter"
  | "stove"
  | "sink-unit"
  | "kitchen-island"
  | "dishwasher"
  // Office
  | "office-desk"
  | "office-chair"
  | "meeting-table"
  | "filing-cabinet"
  | "reception-desk"
  | "partition-screen"
  // Retail
  | "shelving-unit"
  | "display-fridge"
  | "checkout-counter"
  | "clothing-rack"
  | "display-stand"
  // Industrial workshop
  | "workbench"
  | "cnc-machine"
  | "tool-cabinet"
  | "welding-station"
  | "conveyor"
  // Warehouse and logistics
  | "storage-rack"
  | "pallet-stack"
  | "crate-stack"
  | "packing-table"
  | "loading-platform"
  // Parking and traffic
  | "parking-barrier"
  | "guard-booth"
  | "bollard"
  | "speed-bump"
  | "wheel-stop"
  // Hospitality and public spaces
  | "lobby-sofa"
  | "concierge-desk"
  | "luggage-cart"
  | "queue-barrier"
  | "vending-machine"
  | "hospital-bed"
  | "stretcher"
  | "exam-table"
  | "nurse-station"
  | "medical-cart"
  | "privacy-screen"
  | "service-counter"
  | "waiting-bench"
  | "locker-row"
  | "metal-bunk"
  | "student-desk"
  | "whiteboard"
  | "lab-bench"
  | "library-shelf"
  | "gym-bleacher";

export type PlanObstacle = {
  id: string;
  label: string;
  kind: ObstacleKind;
  /** Optional visual model. Geometry calculations continue to use the editable envelope below. */
  variant?: ObstacleVariant;
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
  /**
   * Device type this placement was created from.
   *
   * Unlike the old `definitionId`, a template is reusable: dropping the same type ten
   * times produces ten independent cameras. Editing a placement never writes back to the
   * template, so a one-off lens change stays local to that position.
   */
  templateId?: string;
  /** Legacy single-use inventory slot, retained so saved projects still load. */
  definitionId?: string;
  /** Links the placement back to a wizard zone so counts and goals stay in sync. */
  zoneId?: string;
  groupName?: string;
  housing?: CameraHousing;
  outdoor?: boolean;
  features?: {
    microphone: boolean;
    colorNightVision: boolean;
    weatherproof: boolean;
  };
  /** Encoder settings; filled in on the per-camera detail step. */
  stream?: CameraStreamConfig;
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

export type PlanTool = "select" | "wall" | "door" | "window" | "obstacle" | "camera" | "measure";
export type PlanViewMode = "top" | "orbit" | "building";
/**
 * How the wall tool draws.
 *
 * `glass` is a line partition that does not block the view — the see-through boundary a
 * shopfront or an internal glazed screen makes. It is a separate draw mode rather than a
 * checkbox so a transparent wall is a deliberate choice at the moment of drawing.
 */
export type WallDrawMode = "line" | "rectangle" | "glass";

export type PlanElementKind = "wall" | "door" | "obstacle" | "camera";

export type PlanSelectionRef = { kind: PlanElementKind; id: string };

/**
 * Current selection, as a list.
 *
 * An array rather than a single reference because marquee dragging can pick up many
 * elements at once: one entry drives the property editor, several switch the panel to
 * bulk actions, and zero means nothing is selected.
 */
export type PlanSelection = PlanSelectionRef[];

export const emptySelection: PlanSelection = [];

export function isSelected(selection: PlanSelection, kind: PlanElementKind, id: string): boolean {
  return selection.some((item) => item.kind === kind && item.id === id);
}

/** Single selected element, or null when the selection is empty or plural. */
export function soleSelection(selection: PlanSelection): PlanSelectionRef | null {
  return selection.length === 1 ? selection[0] : null;
}

export function toggleSelection(selection: PlanSelection, ref: PlanSelectionRef): PlanSelection {
  return isSelected(selection, ref.kind, ref.id)
    ? selection.filter((item) => !(item.kind === ref.kind && item.id === ref.id))
    : [...selection, ref];
}

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
      // A duplicated floor keeps the *template* link — the type is still the same device —
      // but drops the single-use definition id so both copies stay independently valid.
      id: `cam-${stamp}-${order}`,
      definitionId: undefined,
      position: { ...camera.position },
      optics: { ...camera.optics },
      features: camera.features ? { ...camera.features } : undefined,
      stream: camera.stream ? { ...camera.stream } : undefined
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
