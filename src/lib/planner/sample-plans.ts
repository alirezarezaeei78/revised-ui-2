import {
  defaultPlanDefaults,
  type BuildingPlan,
  type FloorPlan,
  type ObstacleKind,
  type ObstacleVariant,
  type PlanDoor,
  type PlanObstacle,
  type PlanWall,
  type Vec2
} from "@/src/domain/planner/types";
import { obstaclePreset } from "@/src/lib/planner/obstacle-presets";

type SamplePlanId =
  | "luxury-villa"
  | "modern-office"
  | "retail-gallery"
  | "factory-campus"
  | "residential-parking"
  | "kourosh-mall"
  | "mega-mall"
  | "general-hospital"
  | "police-station"
  | "barracks-campus"
  | "school-campus";

const wallHeightM = 3.2;
const wallThicknessM = 0.2;

function wall(id: string, a: Vec2, b: Vec2, heightM = wallHeightM, thicknessM = wallThicknessM): PlanWall {
  return { id, a, b, heightM, thicknessM, blocksView: true };
}

function rectangle(prefix: string, left: number, top: number, right: number, bottom: number, heightM = wallHeightM): PlanWall[] {
  return [
    wall(`${prefix}-north`, { x: left, z: top }, { x: right, z: top }, heightM),
    wall(`${prefix}-east`, { x: right, z: top }, { x: right, z: bottom }, heightM),
    wall(`${prefix}-south`, { x: right, z: bottom }, { x: left, z: bottom }, heightM),
    wall(`${prefix}-west`, { x: left, z: bottom }, { x: left, z: top }, heightM)
  ];
}

function partition(id: string, x1: number, z1: number, x2: number, z2: number, heightM = wallHeightM): PlanWall {
  return wall(id, { x: x1, z: z1 }, { x: x2, z: z2 }, heightM, 0.15);
}

function glassPartition(id: string, x1: number, z1: number, x2: number, z2: number, heightM = wallHeightM): PlanWall {
  return { ...partition(id, x1, z1, x2, z2, heightM), blocksView: false };
}

function door(id: string, wallId: string, offset = 0.5, widthM = 1.2): PlanDoor {
  return { id, wallId, offset, widthM, heightM: 2.2, hinge: "start", openAngleDeg: 55 };
}

function windowOpening(id: string, wallId: string, offset: number, widthM = 2): PlanDoor {
  return {
    id,
    wallId,
    type: "window",
    offset,
    widthM,
    heightM: 1.5,
    sillHeightM: 0.85,
    hinge: "start",
    openAngleDeg: 0,
    blocksView: false
  };
}

function obstacle(
  id: string,
  label: string,
  kind: ObstacleKind,
  x: number,
  z: number,
  widthM: number,
  depthM: number,
  heightM: number,
  blocksView = true,
  rotationDeg = 0
): PlanObstacle {
  return { id, label, kind, center: { x, z }, widthM, depthM, heightM, rotationDeg, blocksView };
}

function presetObstacle(id: string, variant: ObstacleVariant, x: number, z: number, rotationDeg = 0): PlanObstacle {
  const preset = obstaclePreset(variant);
  if (!preset) throw new Error(`Unknown obstacle preset: ${variant}`);
  return {
    id,
    label: preset.label,
    kind: preset.kind,
    variant,
    center: { x, z },
    widthM: preset.widthM,
    depthM: preset.depthM,
    heightM: preset.heightM,
    rotationDeg,
    blocksView: preset.blocksView ?? true
  };
}

function presetObstacles(
  prefix: string,
  placements: Array<[variant: ObstacleVariant, x: number, z: number, rotationDeg?: number]>
): PlanObstacle[] {
  return placements.map(([variant, x, z, rotationDeg], index) =>
    presetObstacle(`${prefix}-${variant}-${index + 1}`, variant, x, z, rotationDeg)
  );
}

function tableChairs(
  prefix: string,
  x: number,
  z: number,
  rotationDeg = 0,
  variant: Extract<ObstacleVariant, "office-chair" | "dining-chair"> = "office-chair"
): PlanObstacle[] {
  const vertical = Math.abs(rotationDeg % 180) === 90;
  const placements: Array<[ObstacleVariant, number, number, number]> = vertical
    ? [
        [variant, x - 1.15, z - 0.38, 270], [variant, x - 1.15, z + 0.38, 270],
        [variant, x + 1.15, z - 0.38, 90], [variant, x + 1.15, z + 0.38, 90]
      ]
    : [
        [variant, x - 0.55, z - 1.05, 0], [variant, x + 0.55, z - 1.05, 0],
        [variant, x - 0.55, z + 1.05, 180], [variant, x + 0.55, z + 1.05, 180]
      ];
  return presetObstacles(prefix, placements);
}

function topLanding(id: string, x: number, z: number, rotationDeg = 0): PlanObstacle {
  return obstacle(id, "پاگرد نهایی", "block", x, z, 4.2, 1.4, 0.18, false, rotationDeg);
}

function mallCore(prefix: string, top = false): PlanObstacle[] {
  return [
    top
      ? topLanding(`${prefix}-landing`, -2, 0, 90)
      : presetObstacle(`${prefix}-stairs`, "stairs-straight", -2, 0, 90),
    presetObstacle(`${prefix}-elevator`, "elevator", 0, 0, 90),
    presetObstacle(`${prefix}-escalator`, "escalator", 2, 0, 90)
  ];
}

function floor(id: string, name: string, index: number, walls: PlanWall[], doors: PlanDoor[] = [], obstacles: PlanObstacle[] = [], heightM = 3.4): FloorPlan {
  return { id, name, elevationM: index * heightM, heightM, walls, doors, obstacles, cameras: [] };
}

function building(floors: FloorPlan[]): BuildingPlan {
  return {
    floors,
    activeFloorId: floors[0].id,
    gridSizeM: 1,
    snapM: 1,
    defaults: { ...defaultPlanDefaults, wallHeightM, wallThicknessM }
  };
}

/**
 * A fully furnished multi-level estate. Service-heavy objects live in a dedicated
 * basement, leaving the garden and residential floors calm and readable.
 */
function luxuryVillaPlan(): BuildingPlan {
  const basementWalls = [
    ...rectangle("villa-basement-shell", -22, -15, 22, 15),
    partition("villa-basement-spine", 0, -15, 0, 15),
    partition("villa-basement-west-bay", -22, 5, 0, 5),
    partition("villa-basement-east-bay", 0, 0, 22, 0)
  ];
  const basement = floor("villa-basement", "زیرزمین، پارکینگ و خدمات", -1, basementWalls, [
    door("villa-basement-ramp", "villa-basement-shell-south", 0.2, 5),
    door("villa-basement-workshop", "villa-basement-spine", 0.28, 1.4),
    door("villa-basement-warehouse", "villa-basement-spine", 0.76, 1.4),
    door("villa-basement-service", "villa-basement-east-bay", 0.5, 1.4),
    windowOpening("villa-basement-vent-a", "villa-basement-shell-east", 0.28, 1.4),
    windowOpening("villa-basement-vent-b", "villa-basement-shell-east", 0.72, 1.4)
  ], [
    ...presetObstacles("villa-basement-vehicles", [
      ["sedan", -16, -10], ["suv", -16, -5], ["pickup", -16, 0],
      ["van", -16, 9], ["truck", -8, 11, 90]
    ]),
    ...presetObstacles("villa-basement-parking", [
      ["parking-barrier", -10, -13], ["guard-booth", -4, -11], ["bollard", -7, -13],
      ["speed-bump", -15, -12], ["wheel-stop", -16, 3]
    ]),
    ...presetObstacles("villa-basement-workshop", [
      ["workbench", 6, -10], ["cnc-machine", 13, -9], ["tool-cabinet", 20.5, -10, 90],
      ["welding-station", 18, -4], ["conveyor", 8, -3]
    ]),
    ...presetObstacles("villa-basement-warehouse", [
      ["storage-rack", 20.5, 5, 90], ["pallet-stack", 6, 5], ["crate-stack", 9, 5],
      ["packing-table", 6, 11], ["loading-platform", 15, 11]
    ]),
    presetObstacle("villa-basement-rack", "equipment-rack", 1.5, 13),
    presetObstacle("villa-basement-stairs", "stairs-straight", 2, 3, 90),
    presetObstacle("villa-basement-elevator", "elevator", 3.8, 3, 90)
  ]);

  const estateWalls = rectangle("villa-estate", -32, -24, 32, 24, 2.2);
  const groundWalls = [
    ...estateWalls,
    ...rectangle("villa-house", -16, -11, 16, 11),
    partition("villa-ground-public-h", -16, 2, 16, 2),
    partition("villa-ground-lounge-v", -4, -11, -4, 2),
    partition("villa-ground-kitchen-v", 7, 2, 7, 11),
    partition("villa-ground-office-v", -8, 2, -8, 11)
  ];
  const ground = floor("villa-ground", "همکف، باغ و پذیرایی", 0, groundWalls, [
    door("villa-gate", "villa-estate-south", 0.5, 5),
    door("villa-main-entry", "villa-house-south", 0.5, 2.4),
    door("villa-garden-entry", "villa-house-north", 0.3, 1.8),
    door("villa-kitchen-entry", "villa-ground-public-h", 0.78, 1.2),
    door("villa-office-entry", "villa-ground-public-h", 0.15, 1.1),
    windowOpening("villa-ground-window-south-a", "villa-house-south", 0.2, 2.4),
    windowOpening("villa-ground-window-south-b", "villa-house-south", 0.8, 2.4),
    windowOpening("villa-ground-window-north", "villa-house-north", 0.7, 3),
    windowOpening("villa-ground-window-east", "villa-house-east", 0.5, 2.2),
    windowOpening("villa-ground-window-west", "villa-house-west", 0.5, 2.2)
  ], [
    ...presetObstacles("villa-arrival", [
      ["road", 0, 19], ["gate-sliding", 0, 23.2],
      ["fence-mesh", -24, 23.2], ["fence-wall", 24, 23.2],
      ["camera-pole", -29, 19], ["light-pole", 29, 19]
    ]),
    ...presetObstacles("villa-landscape", [
      ["grass", -25, -14], ["hedge", 25, -10, 90], ["bush", -19, -20],
      ["deciduous", -27, -4], ["conifer", 28, 0], ["palm", 24, -18]
    ]),
    ...presetObstacles("villa-lounge", [
      ["rug", -10, -4], ["sofa-three", -10, -5], ["sofa-single", -7, -3.5, 90],
      ["coffee-table", -10, -3.3], ["tv-unit", -14.5, -4, 90], ["dining-table", 1.5, -4, 90]
    ]),
    ...tableChairs("villa-dining-chairs", 1.5, -4, 90, "dining-chair"),
    ...presetObstacles("villa-hospitality", [
      ["lobby-sofa", 1, -7], ["concierge-desk", 4.5, -9], ["luggage-cart", 6, -7],
      ["queue-barrier", 0, -9], ["vending-machine", 14.5, -7, 90]
    ]),
    ...presetObstacles("villa-kitchen", [
      ["fridge", 14.5, 8.5, 90], ["kitchen-counter", 10.5, 10.2],
      ["stove", 13.5, 10.2], ["sink-unit", 8.5, 10.2],
      ["kitchen-island", 11.5, 6], ["dishwasher", 9.5, 10.2]
    ]),
    presetObstacle("villa-reception", "reception-desk", -4.5, 6, 90),
    presetObstacle("villa-stairs", "stairs-straight", 2, 3, 90),
    presetObstacle("villa-ground-elevator", "elevator", 3.8, 3, 90),
    obstacle("villa-pool", "استخر روباز", "block", -23, 5, 10, 4.5, 0.18, false)
  ]);

  const firstWalls = [
    ...rectangle("villa-first-shell", -16, -11, 16, 11),
    partition("villa-first-hall", -16, 0, 16, 0),
    partition("villa-first-west", -6, -11, -6, 11),
    partition("villa-first-east", 6, -11, 6, 11),
    partition("villa-first-suite", 0, 0, 0, 11)
  ];
  const first = floor("villa-first", "طبقه اول، سوئیت و کتابخانه", 1, firstWalls, [
    door("villa-first-suite-a", "villa-first-hall", 0.18),
    door("villa-first-suite-b", "villa-first-hall", 0.82),
    door("villa-first-study", "villa-first-west", 0.72),
    windowOpening("villa-first-window-south-a", "villa-first-shell-south", 0.2, 2.2),
    windowOpening("villa-first-window-south-b", "villa-first-shell-south", 0.8, 2.2),
    windowOpening("villa-first-window-north-a", "villa-first-shell-north", 0.25, 2.4),
    windowOpening("villa-first-window-north-b", "villa-first-shell-north", 0.75, 2.4),
    windowOpening("villa-first-window-east", "villa-first-shell-east", 0.5, 2)
  ], [
    ...presetObstacles("villa-private", [
    ["bed-double", -11, -5], ["nightstand", -8.8, -5], ["wardrobe", -14.8, -1.8, 90],
    ["dresser", -10.5, -9.8], ["bed-single", 11, -5], ["bookshelf", 14.8, -4, 90],
    ["office-desk", -3, 6], ["office-chair", -3, 7.2, 180], ["meeting-table", 3, 6, 90],
    ["filing-cabinet", -5.5, 9.5, 90], ["partition-screen", 0, 4.5]
    ]),
    ...tableChairs("villa-first-meeting-chairs", 3, 6, 90),
    presetObstacle("villa-first-stairs", "stairs-straight", 2, 3, 90),
    presetObstacle("villa-first-elevator", "elevator", 3.8, 3, 90)
  ]);

  const secondWalls = [
    ...rectangle("villa-second-shell", -16, -11, 16, 11),
    partition("villa-second-gallery", -16, 1, 16, 1),
    partition("villa-second-west", -5, -11, -5, 1),
    partition("villa-second-east", 7, -11, 7, 1),
    partition("villa-second-service", 5, 1, 5, 11)
  ];
  const second = floor("villa-second", "طبقه دوم، گالری و سرگرمی", 2, secondWalls, [
    door("villa-second-gallery-a", "villa-second-gallery", 0.2),
    door("villa-second-gallery-b", "villa-second-gallery", 0.78),
    windowOpening("villa-second-window-south-a", "villa-second-shell-south", 0.2, 2.4),
    windowOpening("villa-second-window-south-b", "villa-second-shell-south", 0.8, 2.4),
    windowOpening("villa-second-window-north", "villa-second-shell-north", 0.5, 3.2),
    windowOpening("villa-second-window-west", "villa-second-shell-west", 0.5, 2.2)
  ], [
    ...presetObstacles("villa-gallery", [
      ["shelving-unit", -11, -4, 90], ["display-fridge", -14.8, -8, 90],
      ["checkout-counter", -10, -9.2], ["clothing-rack", 1, -5, 90], ["display-stand", 4, -5]
    ]),
    obstacle("villa-cinema", "سینمای خانگی", "block", 11, -5, 7, 5, 1.1, false),
    obstacle("villa-games", "میز بازی", "counter", -7, 6, 3, 1.6, 0.85, false),
    obstacle("villa-bar", "کافی‌بار", "counter", 10, 7.5, 5, 1, 1.05, false),
    presetObstacle("villa-second-stairs", "stairs-straight", 2, 3, 90),
    presetObstacle("villa-second-elevator", "elevator", 3.8, 3, 90)
  ]);

  const roofWalls = [
    ...rectangle("villa-roof-shell", -16, -11, 16, 11, 1.25),
    ...rectangle("villa-roof-room", -5, -3.5, 5, 3.5)
  ];
  const roof = floor("villa-roof", "بام، روف‌گاردن و تاسیسات", 3, roofWalls, [
    door("villa-roof-door", "villa-roof-room-south", 0.5, 1.4),
    windowOpening("villa-roof-window-east", "villa-roof-room-east", 0.5, 1.6),
    windowOpening("villa-roof-window-west", "villa-roof-room-west", 0.5, 1.6)
  ], [
    obstacle("villa-roof-pergola", "پرگولا و نشیمن سایه‌بان", "counter", -10, 6, 6, 5, 2.5, false),
    obstacle("villa-roof-garden-a", "باغچه خطی بام", "shelf", 11, -7.5, 7, 1.4, 0.7, false),
    obstacle("villa-roof-garden-b", "باغچه خطی بام", "shelf", 11, 7.5, 7, 1.4, 0.7, false),
    obstacle("villa-roof-firepit", "آتشدان مرکزی", "pillar", 0, -7, 1.4, 1.4, 0.55, false),
    topLanding("villa-roof-landing", 2, 3, 90),
    presetObstacle("villa-roof-elevator", "elevator", 3.8, 3, 90)
  ]);
  const plan = building([basement, ground, first, second, roof]);
  return { ...plan, activeFloorId: ground.id };
}

function modernOfficePlan(): BuildingPlan {
  const make = (index: number, name: string) => {
    const prefix = `office-${index}`;
    const walls = [
      ...rectangle(`${prefix}-shell`, -18, -11, 18, 11),
      partition(`${prefix}-core-v`, -6, -11, -6, 11),
      glassPartition(`${prefix}-meeting-h`, -18, 2, 18, 2),
      glassPartition(`${prefix}-rooms-v`, 7, -11, 7, 2)
    ];
    const openings = [
      ...(index === 0 ? [door(`${prefix}-entry`, `${prefix}-shell-south`, 0.5, 1.8)] : []),
      door(`${prefix}-core-door`, `${prefix}-core-v`, 0.24, 1.2),
      door(`${prefix}-meeting-door`, `${prefix}-meeting-h`, 0.68, 1.2),
      door(`${prefix}-room-door`, `${prefix}-rooms-v`, 0.5, 1.1),
      windowOpening(`${prefix}-window-north-a`, `${prefix}-shell-north`, 0.22, 3),
      windowOpening(`${prefix}-window-north-b`, `${prefix}-shell-north`, 0.78, 3),
      windowOpening(`${prefix}-window-east`, `${prefix}-shell-east`, 0.5, 2.4),
      windowOpening(`${prefix}-window-west`, `${prefix}-shell-west`, 0.5, 2.4)
    ];
    const shared = [
      index < 2
        ? presetObstacle(`${prefix}-stairs`, "stairs-straight", -12, 7, 90)
        : topLanding(`${prefix}-landing`, -12, 7, 90),
      presetObstacle(`${prefix}-elevator`, "elevator", -10.2, 7, 90),
      presetObstacle(`${prefix}-rack`, "equipment-rack", -16.5, 8.5, 90)
    ];
    const obstacles = index === 0 ? [
      ...shared,
      ...presetObstacles(`${prefix}-lobby`, [
        ["reception-desk", -1.5, -7], ["lobby-sofa", 3, -7], ["lobby-sofa", 3, -4.5],
        ["queue-barrier", -1.5, -9], ["vending-machine", 16.5, -7, 90], ["luggage-cart", 5.5, -7]
      ]),
      ...presetObstacles(`${prefix}-service`, [
        ["office-desk", 11, -5], ["office-chair", 11, -3.8, 180], ["filing-cabinet", 16.5, -2, 90],
        ["coffee-table", 2.5, 5], ["sofa-three", 2.5, 6.5], ["rug", 2.5, 5.5]
      ])
    ] : index === 1 ? [
      ...shared,
      ...presetObstacles(`${prefix}-operations`, [
        ["office-desk", -2, -7], ["office-desk", 2, -7], ["office-desk", -2, -3.5], ["office-desk", 2, -3.5],
        ["office-chair", -2, -5.8, 180], ["office-chair", 2, -5.8, 180], ["office-chair", -2, -2.3, 180], ["office-chair", 2, -2.3, 180],
        ["partition-screen", 0, -5.2, 90], ["partition-screen", 0, -1.8, 90],
        ["filing-cabinet", 5.5, -8.5, 90], ["filing-cabinet", 5.5, -5.8, 90],
        ["meeting-table", 1, 6], ["kitchen-counter", 11, 8.5], ["fridge", 16.5, 8.5, 90]
      ]),
      ...tableChairs(`${prefix}-meeting-chairs`, 1, 6)
    ] : [
      ...shared,
      ...presetObstacles(`${prefix}-management`, [
        ["office-desk", -1, -6], ["office-chair", -1, -4.8, 180], ["bookshelf", 5.5, -7, 90],
        ["meeting-table", 1, 6], ["meeting-table", 11.5, -5, 90], ["filing-cabinet", 16.5, -8, 90],
        ["sofa-three", -1, 8], ["sofa-single", 2, 6.5, 90], ["coffee-table", -1, 6.5], ["rug", -1, 6.5],
        ["vending-machine", 16.5, 8.5, 90], ["reception-desk", 11.5, -9]
      ]),
      ...tableChairs(`${prefix}-boardroom-chairs`, 1, 6),
      ...tableChairs(`${prefix}-meeting-room-chairs`, 11.5, -5, 90)
    ];
    return floor(prefix, name, index, walls, openings, obstacles);
  };
  return building([make(0, "لابی و خدمات"), make(1, "دفترهای عملیاتی"), make(2, "مدیریت و جلسات")]);
}

function retailGalleryPlan(): BuildingPlan {
  const groundWalls = [
    ...rectangle("gallery-shell", -20, -13, 20, 13),
    partition("gallery-back", -20, 6, 20, 6),
    glassPartition("gallery-east", 8, -13, 8, 6),
    glassPartition("gallery-west", -8, -13, -8, 6),
    partition("gallery-stock-v", 5, 6, 5, 13)
  ];
  const ground = floor("gallery-ground", "گالری، صندوق و انبار", 0, groundWalls, [
    door("gallery-entry", "gallery-shell-south", 0.5, 3),
    door("gallery-stock-door", "gallery-back", 0.72, 1.5),
    door("gallery-office-door", "gallery-back", 0.18, 1.2),
    windowOpening("gallery-window-south-a", "gallery-shell-south", 0.18, 3),
    windowOpening("gallery-window-south-b", "gallery-shell-south", 0.82, 3),
    windowOpening("gallery-window-east", "gallery-shell-east", 0.5, 2.6),
    windowOpening("gallery-window-west", "gallery-shell-west", 0.5, 2.6)
  ], [
    ...presetObstacles("gallery-sales", [
      ["shelving-unit", -15, -7, 90], ["shelving-unit", -15, -2, 90],
      ["shelving-unit", 15, -7, 90], ["shelving-unit", 15, -2, 90],
      ["display-stand", -4, -6], ["display-stand", 0, -6], ["display-stand", 4, -6],
      ["clothing-rack", -4, -1, 90], ["clothing-rack", 0, -1, 90], ["clothing-rack", 4, -1, 90],
      ["display-fridge", 18.5, 3.5, 90], ["checkout-counter", 12, 4], ["checkout-counter", 16, 4]
    ]),
    ...presetObstacles("gallery-stock", [
      ["storage-rack", 17.5, 9, 90], ["storage-rack", 12.5, 9, 90],
      ["pallet-stack", 8, 10], ["crate-stack", 8, 7.5], ["packing-table", 1, 9.5]
    ]),
    presetObstacle("gallery-stairs", "stairs-straight", -8, 6, 90),
    presetObstacle("gallery-ground-elevator", "elevator", -6.2, 6, 90),
    presetObstacle("gallery-rack", "equipment-rack", -18.5, 10.5, 90)
  ]);
  const mezzanine = floor("gallery-mezzanine", "نیم‌طبقه اداری", 1, [
    ...rectangle("gallery-mezz-shell", -11, -8, 11, 8),
    glassPartition("gallery-mezz-h", -11, 1, 11, 1),
    glassPartition("gallery-mezz-v", 2, -8, 2, 8)
  ], [
    door("gallery-mezz-meeting", "gallery-mezz-h", 0.72),
    windowOpening("gallery-mezz-window-north", "gallery-mezz-shell-north", 0.5, 3),
    windowOpening("gallery-mezz-window-east", "gallery-mezz-shell-east", 0.5, 2)
  ], [
    ...presetObstacles("gallery-mezz-office", [
      ["office-desk", -6, -4], ["office-desk", -2, -4], ["office-chair", -6, -2.8, 180], ["office-chair", -2, -2.8, 180],
      ["meeting-table", -4, 4.5], ["filing-cabinet", -9.5, 5.5, 90], ["reception-desk", 6, -5, 90],
      ["lobby-sofa", 6, 4.5], ["coffee-table", 6, 3], ["vending-machine", 9.5, 6, 90]
    ]),
    ...tableChairs("gallery-mezz-meeting-chairs", -4, 4.5),
    topLanding("gallery-mezz-landing", -8, 6, 90),
    presetObstacle("gallery-mezz-elevator", "elevator", -6.2, 6, 90)
  ]);
  return building([ground, mezzanine]);
}

function factoryCampusPlan(): BuildingPlan {
  const groundWalls = [
    ...rectangle("factory-yard", -30, -20, 30, 20, 2.4),
    ...rectangle("factory-hall", -25, -14, 12, 14, 6),
    ...rectangle("factory-office", 15, -14, 26, 2, 3.4),
    partition("factory-storage", -8, -14, -8, 14, 6),
    partition("factory-quality", -25, 8, 12, 8, 6)
  ];
  const ground = floor("factory-ground", "محوطه، تولید و انبار", 0, groundWalls, [
    door("factory-gate", "factory-yard-south", 0.78, 6),
    door("factory-hall-door", "factory-hall-south", 0.5, 5),
    door("factory-storage-door", "factory-storage", 0.75, 2),
    door("factory-quality-door", "factory-quality", 0.72, 1.5),
    door("factory-office-door", "factory-office-south", 0.5, 1.5),
    windowOpening("factory-office-window-east", "factory-office-east", 0.5, 2),
    windowOpening("factory-office-window-north", "factory-office-north", 0.5, 2.4)
  ], [
    ...presetObstacles("factory-production", [
      ["conveyor", -17, -9], ["conveyor", -17, -4], ["conveyor", -17, 1], ["conveyor", -17, 6],
      ["cnc-machine", -3, -9], ["cnc-machine", 4, -9], ["cnc-machine", -3, -3], ["cnc-machine", 4, -3],
      ["workbench", -3, 3], ["workbench", 4, 3], ["welding-station", -3, 6], ["welding-station", 4, 6],
      ["tool-cabinet", 10.5, -10, 90], ["tool-cabinet", 10.5, 4, 90]
    ]),
    ...presetObstacles("factory-storage-zone", [
      ["storage-rack", -22.5, -9, 90], ["storage-rack", -22.5, -3, 90], ["storage-rack", -22.5, 3, 90],
      ["pallet-stack", -12, 10], ["pallet-stack", -17, 10], ["crate-stack", -22, 10],
      ["packing-table", -4, 11], ["loading-platform", 5, 11]
    ]),
    ...presetObstacles("factory-yard-assets", [
      ["truck", 22, 13, 90], ["van", 22, 7, 90], ["pickup", 24, -5, 90],
      ["parking-barrier", 17, 18], ["guard-booth", 11, 17], ["speed-bump", 20, 17],
      ["camera-pole", -27, 17], ["camera-pole", 27, 17], ["light-pole", -27, -16], ["light-pole", 27, -16]
    ]),
    ...presetObstacles("factory-ground-office", [
      ["office-desk", 19, -8], ["office-chair", 19, -6.8, 180], ["filing-cabinet", 25, -10, 90],
      ["reception-desk", 19, -12], ["equipment-rack", 25, -2, 90]
    ]),
    presetObstacle("factory-ground-stairs", "stairs-straight", 10, -1, 90),
    presetObstacle("factory-ground-elevator", "elevator", 8.2, -1, 90)
  ], 6.2);

  const admin = floor("factory-admin", "مدیریت، کنترل کیفیت و رفاه", 1, [
    ...rectangle("factory-admin-shell", -14, -9, 14, 9),
    glassPartition("factory-admin-h", -14, 1, 14, 1),
    glassPartition("factory-admin-v", 4, -9, 4, 9)
  ], [
    door("factory-admin-meeting", "factory-admin-h", 0.72, 1.2),
    door("factory-admin-office", "factory-admin-v", 0.3, 1.2),
    windowOpening("factory-admin-window-north-a", "factory-admin-shell-north", 0.25, 2.5),
    windowOpening("factory-admin-window-north-b", "factory-admin-shell-north", 0.75, 2.5),
    windowOpening("factory-admin-window-east", "factory-admin-shell-east", 0.5, 2)
  ], [
    ...presetObstacles("factory-admin-assets", [
      ["office-desk", -8, -5], ["office-desk", -3, -5], ["office-chair", -8, -3.8, 180], ["office-chair", -3, -3.8, 180],
      ["meeting-table", -4, 5], ["filing-cabinet", -12.5, 6, 90], ["partition-screen", 0, -4, 90],
      ["reception-desk", 9, -6, 90], ["lobby-sofa", 9, 5], ["coffee-table", 9, 3.5],
      ["fridge", 12.5, 7, 90], ["kitchen-counter", 7, 8], ["vending-machine", 12.5, 0, 90]
    ]),
    ...tableChairs("factory-admin-meeting-chairs", -4, 5),
    topLanding("factory-admin-landing", 10, -1, 90),
    presetObstacle("factory-admin-elevator", "elevator", 8.2, -1, 90)
  ], 3.8);
  admin.elevationM = ground.heightM;
  return building([ground, admin]);
}

function residentialParkingPlan(): BuildingPlan {
  const parking = floor("residential-parking", "پارکینگ و لابی", 0, [
    ...rectangle("residential-parking-shell", -16, -12, 16, 12),
    partition("residential-lobby", -4, -12, -4, 2),
    partition("residential-storage", 6, -12, 6, 2)
  ], [
    door("residential-gate", "residential-parking-shell-south", 0.5, 4),
    door("residential-lobby-door", "residential-lobby", 0.35, 1.4),
    door("residential-storage-door", "residential-storage", 0.35, 1.2),
    windowOpening("residential-lobby-window", "residential-parking-shell-east", 0.25, 2)
  ], [
    ...presetObstacles("residential-cars", [
      ["sedan", -12, 7, 90], ["sedan", -7, 7, 90], ["suv", -2, 7, 90],
      ["suv", 3, 7, 90], ["pickup", 8, 7, 90], ["van", 13, 7, 90]
    ]),
    ...presetObstacles("residential-parking-tools", [
      ["parking-barrier", 0, -10], ["guard-booth", -12, -8], ["speed-bump", 0, -7.5],
      ["wheel-stop", -12, 10], ["wheel-stop", -7, 10], ["wheel-stop", -2, 10],
      ["bollard", -3, -10], ["bollard", 3, -10]
    ]),
    ...presetObstacles("residential-lobby-assets", [
      ["reception-desk", 1, -7], ["lobby-sofa", 3, -3], ["coffee-table", 3, -1.5],
      ["vending-machine", 14.5, -8, 90], ["equipment-rack", 14.5, -2, 90]
    ]),
    presetObstacle("residential-parking-stairs", "stairs-straight", 12, 2, 90),
    presetObstacle("residential-parking-elevator", "elevator", 10.2, 2, 90)
  ]);
  const apartment = (index: number) => floor(`residential-${index}`, `طبقه مسکونی ${index}`, index, [
    ...rectangle(`residential-${index}-shell`, -16, -12, 16, 12),
    partition(`residential-${index}-hall`, 0, -12, 0, 12),
    partition(`residential-${index}-north`, -16, -2, 16, -2),
    partition(`residential-${index}-south`, -16, 5, 16, 5),
    partition(`residential-${index}-west`, -8, -12, -8, 12),
    partition(`residential-${index}-east`, 8, -12, 8, 12)
  ], [
    door(`residential-${index}-lobby-entry`, `residential-${index}-south`, 0.88, 1.5),
    door(`residential-${index}-bed-a`, `residential-${index}-north`, 0.2),
    door(`residential-${index}-bed-b`, `residential-${index}-north`, 0.8),
    door(`residential-${index}-living`, `residential-${index}-south`, 0.3),
    door(`residential-${index}-kitchen`, `residential-${index}-south`, 0.75),
    windowOpening(`residential-${index}-window-north-a`, `residential-${index}-shell-north`, 0.22, 2.4),
    windowOpening(`residential-${index}-window-north-b`, `residential-${index}-shell-north`, 0.78, 2.4),
    windowOpening(`residential-${index}-window-east`, `residential-${index}-shell-east`, 0.5, 2.2),
    windowOpening(`residential-${index}-window-west`, `residential-${index}-shell-west`, 0.5, 2.2)
  ], [
    ...presetObstacles(`residential-${index}-living-assets`, [
      ["rug", -4, 8], ["sofa-three", -4, 9.5], ["sofa-single", -1.5, 7.5, 90],
      ["coffee-table", -4, 7.5], ["tv-unit", -7.5, 8, 90], ["dining-table", 4, 8, 90]
    ]),
    ...tableChairs(`residential-${index}-dining-chairs`, 4, 8, 90, "dining-chair"),
    ...presetObstacles(`residential-${index}-bedrooms`, [
      ["bed-double", -12, -7], ["nightstand", -9.5, -7], ["wardrobe", -15.5, -4, 90],
      ["bed-single", 12, -7], ["dresser", 9, -10.5], ["bookshelf", 15.5, -4, 90]
    ]),
    ...presetObstacles(`residential-${index}-kitchen-assets`, [
      ["fridge", 7.5, 2.8, 90], ["kitchen-counter", 3, 4.2], ["stove", 6, 4.2],
      ["sink-unit", 0.8, 4.2], ["kitchen-island", 4, 1], ["dishwasher", 1.8, 4.2]
    ]),
    presetObstacle(`residential-${index}-desk`, "office-desk", -4, 1),
    presetObstacle(`residential-${index}-chair`, "office-chair", -4, 2.2, 180),
    index < 3
      ? presetObstacle(`residential-${index}-stairs`, "stairs-straight", 12, 2, 90)
      : topLanding(`residential-${index}-landing`, 12, 2, 90),
    presetObstacle(`residential-${index}-elevator`, "elevator", 10.2, 2, 90)
  ]);
  return building([parking, apartment(1), apartment(2), apartment(3)]);
}

/**
 * A compact surveillance-ready abstraction of Kourosh Mall rather than a literal
 * architectural survey: parking and loading below, Hyperstar-style grocery at B1,
 * a retail atrium at grade, and the leisure/food/cinema mix on the upper level.
 */
function kouroshMallPrototypePlan(): BuildingPlan {
  const parking = floor("kourosh-parking", "پارکینگ و بارانداز کوروش مال", -2, [
    ...rectangle("kourosh-parking-shell", -30, -18, 30, 18),
    partition("kourosh-parking-ramp", -30, -9, -17, -9),
    partition("kourosh-parking-service", 16, -18, 16, 18)
  ], [
    door("kourosh-parking-gate", "kourosh-parking-shell-south", 0.2, 5),
    door("kourosh-loading-gate", "kourosh-parking-shell-south", 0.82, 5),
    door("kourosh-parking-service-door", "kourosh-parking-service", 0.72, 1.5),
    windowOpening("kourosh-parking-window-east", "kourosh-parking-shell-east", 0.5, 2.4)
  ], [
    ...mallCore("kourosh-parking"),
    ...presetObstacles("kourosh-parking-cars", [
      ["sedan", -25, -13, 90], ["suv", -19, -13, 90], ["sedan", -13, -13, 90],
      ["pickup", -7, -13, 90], ["sedan", 7, -13, 90], ["van", 13, -13, 90],
      ["suv", -25, 12, 90], ["sedan", -19, 12, 90], ["sedan", -13, 12, 90],
      ["suv", -7, 12, 90], ["pickup", 7, 12, 90], ["van", 13, 12, 90],
      ["truck", 23, 10, 90], ["truck", 23, -8, 90]
    ]),
    ...presetObstacles("kourosh-parking-safety", [
      ["parking-barrier", -20, 16], ["parking-barrier", 20, 16], ["guard-booth", -25, 15],
      ["speed-bump", -10, 15], ["speed-bump", 10, 15], ["bollard", -5, -3], ["bollard", 5, -3],
      ["wheel-stop", -25, 15], ["wheel-stop", -19, 15], ["equipment-rack", 28, -15, 90]
    ])
  ], 3.8);

  const hypermarket = floor("kourosh-hypermarket", "هایپرمارکت کوروش مال", -1, [
    ...rectangle("kourosh-hyper-shell", -30, -18, 30, 18),
    glassPartition("kourosh-hyper-front", -30, -12, 30, -12),
    partition("kourosh-hyper-back", -30, 11, 30, 11),
    partition("kourosh-hyper-cold", 19, -12, 19, 11),
    partition("kourosh-hyper-stock", -18, 11, -18, 18)
  ], [
    door("kourosh-hyper-entry-a", "kourosh-hyper-front", 0.38, 2.2),
    door("kourosh-hyper-entry-b", "kourosh-hyper-front", 0.62, 2.2),
    door("kourosh-hyper-stock-door", "kourosh-hyper-back", 0.18, 1.8),
    door("kourosh-hyper-cold-door", "kourosh-hyper-cold", 0.7, 1.5),
    windowOpening("kourosh-hyper-window-east", "kourosh-hyper-shell-east", 0.5, 2.8)
  ], [
    ...mallCore("kourosh-hyper"),
    ...presetObstacles("kourosh-hyper-aisles-a", [
      ["shelving-unit", -25, -8], ["shelving-unit", -21, -8], ["shelving-unit", -17, -8], ["shelving-unit", -13, -8],
      ["shelving-unit", -25, -4], ["shelving-unit", -21, -4], ["shelving-unit", -17, -4], ["shelving-unit", -13, -4],
      ["shelving-unit", -25, 4], ["shelving-unit", -21, 4], ["shelving-unit", -17, 4], ["shelving-unit", -13, 4],
      ["shelving-unit", -25, 8], ["shelving-unit", -21, 8], ["shelving-unit", -17, 8], ["shelving-unit", -13, 8]
    ]),
    ...presetObstacles("kourosh-hyper-aisles-b", [
      ["shelving-unit", 8, -8], ["shelving-unit", 12, -8], ["shelving-unit", 16, -8],
      ["shelving-unit", 8, -4], ["shelving-unit", 12, -4], ["shelving-unit", 16, -4],
      ["shelving-unit", 8, 4], ["shelving-unit", 12, 4], ["shelving-unit", 16, 4],
      ["shelving-unit", 8, 8], ["shelving-unit", 12, 8], ["shelving-unit", 16, 8]
    ]),
    ...presetObstacles("kourosh-hyper-cold-assets", [
      ["display-fridge", 22, -9, 90], ["display-fridge", 22, -5, 90], ["display-fridge", 22, -1, 90],
      ["display-fridge", 22, 3, 90], ["display-fridge", 22, 7, 90], ["display-fridge", 27, 7, 90],
      ["fridge", 27, -8, 90], ["fridge", 27, -4, 90], ["fridge", 27, 0, 90]
    ]),
    ...presetObstacles("kourosh-hyper-checkouts", [
      ["checkout-counter", -18, -14], ["checkout-counter", -13, -14], ["checkout-counter", -8, -14],
      ["checkout-counter", -3, -14], ["checkout-counter", 3, -14], ["checkout-counter", 8, -14],
      ["queue-barrier", -18, -16], ["queue-barrier", -8, -16], ["queue-barrier", 3, -16],
      ["storage-rack", -27, 14, 90], ["storage-rack", -22, 14, 90], ["pallet-stack", -14, 14],
      ["crate-stack", -10, 14], ["packing-table", -5, 14], ["equipment-rack", 28, 14, 90]
    ])
  ]);

  const retail = floor("kourosh-retail", "همکف تجاری و آتریوم کوروش مال", 0, [
    ...rectangle("kourosh-retail-shell", -30, -18, 30, 18),
    glassPartition("kourosh-retail-north", -30, 8, 30, 8),
    glassPartition("kourosh-retail-west", -10, -18, -10, 8),
    glassPartition("kourosh-retail-east", 10, -18, 10, 8)
  ], [
    door("kourosh-main-entry-a", "kourosh-retail-shell-south", 0.38, 3),
    door("kourosh-main-entry-b", "kourosh-retail-shell-south", 0.62, 3),
    door("kourosh-retail-west-door", "kourosh-retail-west", 0.35, 1.8),
    door("kourosh-retail-east-door", "kourosh-retail-east", 0.35, 1.8),
    windowOpening("kourosh-retail-window-north-a", "kourosh-retail-shell-north", 0.25, 4),
    windowOpening("kourosh-retail-window-north-b", "kourosh-retail-shell-north", 0.75, 4)
  ], [
    ...mallCore("kourosh-retail"),
    ...presetObstacles("kourosh-retail-shops", [
      ["clothing-rack", -25, -10, 90], ["clothing-rack", -21, -10, 90], ["display-stand", -16, -10],
      ["clothing-rack", 25, -10, 90], ["clothing-rack", 21, -10, 90], ["display-stand", 16, -10],
      ["shelving-unit", -25, -3, 90], ["shelving-unit", -20, -3, 90], ["display-stand", -15, -3],
      ["shelving-unit", 25, -3, 90], ["shelving-unit", 20, -3, 90], ["display-stand", 15, -3],
      ["checkout-counter", -24, 5], ["checkout-counter", 24, 5], ["display-fridge", -28, 5, 90], ["display-fridge", 28, 5, 90]
    ]),
    ...presetObstacles("kourosh-retail-atrium", [
      ["concierge-desk", 0, -9], ["queue-barrier", -4, -12], ["queue-barrier", 4, -12],
      ["lobby-sofa", -7, 12], ["lobby-sofa", 7, 12], ["coffee-table", -7, 10.5], ["coffee-table", 7, 10.5],
      ["vending-machine", -27, 14, 90], ["vending-machine", 27, 14, 90], ["luggage-cart", -12, 14],
      ["equipment-rack", 12, 14, 90], ["display-stand", -20, 13], ["display-stand", 20, 13]
    ])
  ]);

  const leisure = floor("kourosh-leisure", "طبقه دوم، فودکورت و شهربازی ژوپیتر", 1, [
    ...rectangle("kourosh-leisure-shell", -30, -18, 30, 18),
    partition("kourosh-leisure-cinema", -30, 7, 30, 7),
    glassPartition("kourosh-leisure-food", 10, -18, 10, 7),
    partition("kourosh-leisure-play", -12, -18, -12, 7)
  ], [
    door("kourosh-cinema-entry-a", "kourosh-leisure-cinema", 0.28, 1.8),
    door("kourosh-cinema-entry-b", "kourosh-leisure-cinema", 0.72, 1.8),
    door("kourosh-food-door", "kourosh-leisure-food", 0.55, 1.8),
    door("kourosh-play-door", "kourosh-leisure-play", 0.55, 1.8),
    windowOpening("kourosh-leisure-window-north-a", "kourosh-leisure-shell-north", 0.25, 4),
    windowOpening("kourosh-leisure-window-north-b", "kourosh-leisure-shell-north", 0.75, 4)
  ], [
    ...mallCore("kourosh-leisure"),
    obstacle("kourosh-bowling", "بولینگ و بازی گروهی", "block", -20, 12, 17, 7, 1.1, false),
    obstacle("kourosh-family-zone", "سرگرمی خانوادگی", "block", 0, 12, 17, 7, 1.1, false),
    obstacle("kourosh-events-zone", "رویداد و اجرای کودک", "block", 20, 12, 17, 7, 1.1, false),
    obstacle("kourosh-jupiter", "شهربازی ژوپیتر", "block", -21, -5, 14, 9, 1.1, false),
    ...presetObstacles("kourosh-food-counters", [
      ["kitchen-counter", 14, -14], ["kitchen-counter", 19, -14], ["kitchen-counter", 24, -14],
      ["display-fridge", 28, -13, 90], ["checkout-counter", 14, -10], ["checkout-counter", 20, -10], ["checkout-counter", 26, -10]
    ]),
    ...presetObstacles("kourosh-food-tables", [
      ["dining-table", 15, -4], ["dining-table", 21, -4], ["dining-table", 27, -4],
      ["dining-table", 15, 2], ["dining-table", 21, 2], ["dining-table", 27, 2],
      ["lobby-sofa", -7, -10], ["coffee-table", -7, -8.5], ["vending-machine", 7, -14, 90],
      ["queue-barrier", -5, 5], ["queue-barrier", 5, 5], ["equipment-rack", 28, 5, 90]
    ]),
    ...tableChairs("kourosh-food-a", 15, -4, 0, "dining-chair"),
    ...tableChairs("kourosh-food-b", 21, -4, 0, "dining-chair"),
    ...tableChairs("kourosh-food-c", 27, -4, 0, "dining-chair"),
    ...tableChairs("kourosh-food-d", 15, 2, 0, "dining-chair"),
    ...tableChairs("kourosh-food-e", 21, 2, 0, "dining-chair"),
    ...tableChairs("kourosh-food-f", 27, 2, 0, "dining-chair")
  ]);

  const cinema = floor("kourosh-cinema", "طبقه ششم، پردیس سینمایی کوروش", 2, [
    ...rectangle("kourosh-cinema-shell", -30, -18, 30, 18),
    partition("kourosh-cinema-lobby", -30, 3, 30, 3),
    partition("kourosh-cinema-west", -10, 3, -10, 18),
    partition("kourosh-cinema-east", 10, 3, 10, 18)
  ], [
    door("kourosh-cinema-hall-a", "kourosh-cinema-lobby", 0.18, 1.8),
    door("kourosh-cinema-hall-b", "kourosh-cinema-lobby", 0.5, 1.8),
    door("kourosh-cinema-hall-c", "kourosh-cinema-lobby", 0.82, 1.8),
    door("kourosh-cinema-west-exit", "kourosh-cinema-west", 0.55, 1.4),
    door("kourosh-cinema-east-exit", "kourosh-cinema-east", 0.55, 1.4),
    windowOpening("kourosh-cinema-window-east", "kourosh-cinema-shell-east", 0.35, 2.5)
  ], [
    ...mallCore("kourosh-cinema"),
    obstacle("kourosh-cinema-a", "سالن سینمای کوروش ۱", "block", -20, 11, 17, 12, 3, true),
    obstacle("kourosh-cinema-b", "سالن سینمای کوروش ۲", "block", 0, 11, 17, 12, 3, true),
    obstacle("kourosh-cinema-c", "سالن سینمای کوروش ۳", "block", 20, 11, 17, 12, 3, true),
    ...presetObstacles("kourosh-cinema-lobby-assets", [
      ["checkout-counter", -24, -12], ["checkout-counter", -18, -12], ["queue-barrier", -21, -9],
      ["display-fridge", 25, -13, 90], ["display-fridge", 28, -13, 90], ["vending-machine", 28, -8, 90],
      ["lobby-sofa", -15, -3], ["lobby-sofa", -8, -3], ["lobby-sofa", 8, -3], ["lobby-sofa", 15, -3],
      ["coffee-table", -15, -1.5], ["coffee-table", -8, -1.5], ["coffee-table", 8, -1.5], ["coffee-table", 15, -1.5],
      ["equipment-rack", 27, 0, 90], ["concierge-desk", 20, -12]
    ])
  ]);

  const roof = floor("kourosh-roof", "طبقه هفتم، فودکورت و روف‌گاردن کوروش", 3, [
    ...rectangle("kourosh-roof-shell", -30, -18, 30, 18, 2.2),
    ...rectangle("kourosh-roof-core", -7, -5, 7, 5),
    glassPartition("kourosh-roof-food", 10, -18, 10, 18, 2.8)
  ], [
    door("kourosh-roof-core-door", "kourosh-roof-core-south", 0.5, 1.8),
    door("kourosh-roof-food-door", "kourosh-roof-food", 0.5, 1.8),
    windowOpening("kourosh-roof-window-east", "kourosh-roof-shell-east", 0.5, 3),
    windowOpening("kourosh-roof-window-west", "kourosh-roof-shell-west", 0.5, 3)
  ], [
    ...mallCore("kourosh-roof", true),
    ...presetObstacles("kourosh-roof-food", [
      ["kitchen-counter", 15, -14], ["kitchen-counter", 20, -14], ["kitchen-counter", 25, -14],
      ["checkout-counter", 15, -10], ["checkout-counter", 21, -10], ["checkout-counter", 27, -10],
      ["display-fridge", 28, -15, 90], ["vending-machine", 28, 15, 90],
      ["dining-table", 15, -3], ["dining-table", 22, -3], ["dining-table", 15, 4], ["dining-table", 22, 4],
      ["dining-table", 15, 11], ["dining-table", 22, 11]
    ]),
    ...tableChairs("kourosh-roof-table-a", 15, -3, 0, "dining-chair"),
    ...tableChairs("kourosh-roof-table-b", 22, -3, 0, "dining-chair"),
    ...tableChairs("kourosh-roof-table-c", 15, 4, 0, "dining-chair"),
    ...tableChairs("kourosh-roof-table-d", 22, 4, 0, "dining-chair"),
    ...tableChairs("kourosh-roof-table-e", 15, 11, 0, "dining-chair"),
    ...tableChairs("kourosh-roof-table-f", 22, 11, 0, "dining-chair"),
    ...presetObstacles("kourosh-roof-garden", [
      ["grass", -20, -10], ["grass", -20, 10], ["grass", -10, -12], ["grass", -10, 12],
      ["palm", -25, -13], ["palm", -25, 13], ["deciduous", -15, -12], ["deciduous", -15, 12],
      ["bush", -10, -8], ["bush", -10, 8], ["hedge", -22, 0, 90], ["light-pole", -28, 0]
    ])
  ]);

  return building([parking, hypermarket, retail, leisure, cinema, roof]);
}

function kouroshEnvelope(prefix: string, heightM = 3.4): PlanWall[] {
  const points: Vec2[] = [
    { x: -49, z: -41 }, { x: 47, z: -41 }, { x: 58, z: -30 }, { x: 58, z: 30 },
    { x: 47, z: 41 }, { x: -49, z: 41 }, { x: -58, z: 30 }, { x: -58, z: -30 }
  ];
  const names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  return points.map((point, index) => wall(
    `${prefix}-envelope-${names[index]}`,
    point,
    points[(index + 1) % points.length],
    heightM
  ));
}

function kouroshAtrium(prefix: string): PlanWall[] {
  const points: Vec2[] = [
    { x: -14, z: -13 }, { x: 14, z: -13 }, { x: 20, z: -7 }, { x: 20, z: 8 },
    { x: 14, z: 14 }, { x: -14, z: 14 }, { x: -20, z: 8 }, { x: -20, z: -7 }
  ];
  const names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  return points.map((point, index) => glassPartition(
    `${prefix}-atrium-${names[index]}`,
    point.x,
    point.z,
    points[(index + 1) % points.length].x,
    points[(index + 1) % points.length].z,
    1.35
  ));
}

function kouroshAccessCore(prefix: string, top = false): PlanObstacle[] {
  const stairPositions: Array<[number, number]> = [[-31, -19], [31, -19], [-31, 19], [31, 19]];
  const elevatorPositions: Array<[number, number]> = [
    [-27, -9], [-27, -3], [-27, 3], [-27, 9], [27, -9], [27, -3], [27, 3], [27, 9]
  ];
  const escalatorPositions: Array<[number, number]> = [[-10, -17], [10, -17], [-10, 17], [10, 17]];
  return [
    ...stairPositions.map(([x, z], index) => top
      ? topLanding(`${prefix}-landing-${index + 1}`, x, z, 90)
      : presetObstacle(`${prefix}-stairs-${index + 1}`, "stairs-straight", x, z, 90)),
    ...elevatorPositions.map(([x, z], index) => presetObstacle(`${prefix}-elevator-${index + 1}`, "elevator", x, z, 90)),
    ...escalatorPositions.map(([x, z], index) => presetObstacle(`${prefix}-escalator-${index + 1}`, "escalator", x, z, 90))
  ];
}

function shopBand(
  prefix: string,
  count: number,
  start: number,
  end: number,
  front: number,
  back: number,
  horizontal: boolean
): { walls: PlanWall[]; doors: PlanDoor[] } {
  const walls: PlanWall[] = [];
  const doors: PlanDoor[] = [];
  const step = (end - start) / count;
  for (let index = 0; index < count; index += 1) {
    const from = start + step * index;
    const to = from + step;
    const frontageId = `${prefix}-shop-${index + 1}-front`;
    walls.push(horizontal
      ? glassPartition(frontageId, from, front, to, front)
      : glassPartition(frontageId, front, from, front, to));
    walls.push(horizontal
      ? partition(`${prefix}-shop-${index + 1}-side`, from, front, from, back)
      : partition(`${prefix}-shop-${index + 1}-side`, front, from, back, from));
    doors.push(door(`${prefix}-shop-${index + 1}-door`, frontageId, 0.5, Math.min(0.9, Math.abs(step) * 0.62)));
  }
  walls.push(horizontal
    ? partition(`${prefix}-shop-end`, end, front, end, back)
    : partition(`${prefix}-shop-end`, front, end, back, end));
  return { walls, doors };
}

function kouroshShopRing(prefix: string, total: number) {
  const definitions = [
    { name: "north-inner", weight: 96, start: -48, end: 48, front: -22, back: -15, horizontal: true },
    { name: "north-outer", weight: 96, start: -48, end: 48, front: -30, back: -40, horizontal: true },
    { name: "south-inner", weight: 96, start: -48, end: 48, front: 22, back: 15, horizontal: true },
    { name: "south-outer", weight: 96, start: -48, end: 48, front: 30, back: 40, horizontal: true },
    { name: "west-inner", weight: 46, start: -23, end: 23, front: -34, back: -22, horizontal: false },
    { name: "west-outer", weight: 46, start: -23, end: 23, front: -44, back: -57, horizontal: false },
    { name: "east-inner", weight: 46, start: -23, end: 23, front: 34, back: 22, horizontal: false },
    { name: "east-outer", weight: 46, start: -23, end: 23, front: 44, back: 57, horizontal: false }
  ];
  const weightTotal = definitions.reduce((sum, item) => sum + item.weight, 0);
  const counts = definitions.map((item) => Math.floor(total * item.weight / weightTotal));
  for (let index = 0; counts.reduce((sum, count) => sum + count, 0) < total; index = (index + 1) % counts.length) counts[index] += 1;
  const bands = definitions.map((item, index) => shopBand(
    `${prefix}-${item.name}`,
    counts[index],
    item.start,
    item.end,
    item.front,
    item.back,
    item.horizontal
  ));
  return {
    walls: bands.flatMap((band) => band.walls),
    doors: bands.flatMap((band) => band.doors)
  };
}

function kouroshRetailAssets(prefix: string): PlanObstacle[] {
  const shopFixtures: Array<[ObstacleVariant, number, number, number?]> = [];
  for (const z of [-27, -18, 18, 27]) {
    for (const x of [-44, -35, -26, -17, 17, 26, 35, 44]) {
      const variant: ObstacleVariant = shopFixtures.length % 3 === 0 ? "clothing-rack" : shopFixtures.length % 3 === 1 ? "shelving-unit" : "display-stand";
      shopFixtures.push([variant, x, z, 0]);
    }
  }
  for (const x of [-40, 40]) {
    for (const z of [-17, -8, 8, 17]) shopFixtures.push(["display-stand", x, z, 90]);
  }
  return [
    ...presetObstacles(`${prefix}-shop-fixtures`, shopFixtures),
    ...presetObstacles(`${prefix}-atrium-kiosks`, [
      ["display-stand", -16, -10], ["display-stand", 16, -10], ["display-stand", -16, 11], ["display-stand", 16, 11],
      ["concierge-desk", 0, -16], ["lobby-sofa", -7, 0, 90], ["lobby-sofa", 7, 0, 90],
      ["coffee-table", -7, 0, 90], ["coffee-table", 7, 0, 90], ["equipment-rack", 42, 27, 90]
    ]),
    ...kouroshAccessCore(`${prefix}-core`)
  ];
}

function kouroshCommercialFloor(id: string, name: string, index: number, shopCount: number): FloorPlan {
  const ring = kouroshShopRing(id, shopCount);
  return floor(id, name, index, [
    ...kouroshEnvelope(id),
    ...kouroshAtrium(id),
    ...ring.walls
  ], [
    ...ring.doors,
    windowOpening(`${id}-window-east`, `${id}-envelope-east`, 0.5, 3.2)
  ], kouroshRetailAssets(id));
}

function kouroshParkingFloor(index: number): FloorPlan {
  const id = `kourosh-parking-b${Math.abs(index)}`;
  const vehiclePlacements: Array<[ObstacleVariant, number, number, number]> = [];
  const variants: ObstacleVariant[] = ["sedan", "suv", "sedan", "pickup", "sedan", "van"];
  for (const z of [-27, -9, 9, 27]) {
    for (const x of [-39, -31, -17, -9, 9, 17, 31, 39]) {
      vehiclePlacements.push([variants[vehiclePlacements.length % variants.length], x, z, 90]);
    }
  }
  return floor(id, `پارکینگ کوروش مال B${Math.abs(index)}`, index, [
    ...kouroshEnvelope(id, 3.6),
    partition(`${id}-lane-west`, -6, -34, -6, 34, 1.2),
    partition(`${id}-lane-east`, 6, -34, 6, 34, 1.2)
  ], [
    door(`${id}-vehicle-gate`, `${id}-envelope-south`, 0.5, 6),
    windowOpening(`${id}-vent-east`, `${id}-envelope-east`, 0.5, 3)
  ], [
    ...presetObstacles(`${id}-cars`, vehiclePlacements),
    ...presetObstacles(`${id}-traffic`, [
      ["parking-barrier", -12, 31], ["parking-barrier", 12, 31], ["speed-bump", 0, 27],
      ["guard-booth", -42, 28], ["bollard", -5, -26], ["bollard", 5, -26], ["equipment-rack", 43, -28, 90]
    ]),
    ...kouroshAccessCore(`${id}-core`)
  ], 3.6);
}

function kouroshCinemaFloor(index: number, firstHall: number): FloorPlan {
  const id = `kourosh-cinema-${index}`;
  const hallCenters: Array<[number, number]> = [[-32, -19], [0, -19], [32, -19], [-32, 19], [0, 19], [32, 19]];
  const hallWalls = hallCenters.flatMap(([x, z], hallIndex) => rectangle(
    `${id}-hall-${hallIndex + 1}`,
    x - 12,
    z - 6,
    x + 12,
    z + 6,
    4.2
  ));
  return floor(id, `طبقه ${index}، سالن‌های ${firstHall} تا ${firstHall + 5} پردیس سینمایی کوروش`, index, [
    ...kouroshEnvelope(id, 4.2),
    ...hallWalls
  ], [
    ...hallCenters.map((_, hallIndex) => door(
      `${id}-hall-${hallIndex + 1}-door`,
      `${id}-hall-${hallIndex + 1}-south`,
      0.5,
      1.8
    )),
    windowOpening(`${id}-window-east`, `${id}-envelope-east`, 0.5, 3)
  ], [
    ...hallCenters.map(([x, z], hallIndex) => obstacle(
      `${id}-auditorium-${hallIndex + 1}`,
      `سالن سینما ${firstHall + hallIndex}`,
      "block",
      x,
      z,
      22,
      10,
      3.4,
      true
    )),
    ...presetObstacles(`${id}-lobby`, [
      ["checkout-counter", -10, 0], ["checkout-counter", -5, 0], ["queue-barrier", -7.5, 3],
      ["display-fridge", 38, 0, 90], ["vending-machine", 42, 0, 90], ["lobby-sofa", 12, 0]
    ]),
    ...kouroshAccessCore(`${id}-core`)
  ], 4.2);
}

function kouroshMallPlan(): BuildingPlan {
  const prototype = kouroshMallPrototypePlan();
  const prototypeHyper = prototype.floors.find((item) => item.id === "kourosh-hypermarket");
  const prototypeLeisure = prototype.floors.find((item) => item.id === "kourosh-leisure");
  const prototypeRoof = prototype.floors.find((item) => item.id === "kourosh-roof");
  const stripPrototypeCore = (items: PlanObstacle[] = []) => items.filter((item) =>
    item.variant !== "stairs-straight" && item.variant !== "elevator" && item.variant !== "escalator" && !item.label.includes("پاگرد نهایی")
  );

  const parkingFloors = [-9, -8, -7, -6, -5, -4, -3].map(kouroshParkingFloor);
  const hyperRing = kouroshShopRing("kourosh-hyper-b2", 68);
  const hypermarket = floor("kourosh-hyper-b2", "زیرزمین دوم، هایپراستار، ۳۱ واحد تجاری و ۳۷ واحد بازار طلا", -2, [
    ...kouroshEnvelope("kourosh-hyper-b2"),
    ...kouroshAtrium("kourosh-hyper-b2"),
    ...hyperRing.walls,
    partition("kourosh-hyper-b2-stock", -42, 16, 42, 16)
  ], [
    ...hyperRing.doors,
    door("kourosh-hyper-b2-stock-door", "kourosh-hyper-b2-stock", 0.82, 2),
    windowOpening("kourosh-hyper-b2-window-east", "kourosh-hyper-b2-envelope-east", 0.5, 3)
  ], [
    ...stripPrototypeCore(prototypeHyper?.obstacles),
    ...kouroshAccessCore("kourosh-hyper-b2-core")
  ]);

  const commercialB1 = kouroshCommercialFloor("kourosh-commercial-b1", "منفی یک، ۱۴۹ واحد تجاری و ۴۶ واحد بازار طلا", -1, 195);
  const ground = kouroshCommercialFloor("kourosh-commercial-ground", "همکف، ۱۱۱ واحد تجاری و ۲۵ واحد شمالی", 0, 136);
  ground.doors = [
    ...(ground.doors ?? []),
    door("kourosh-main-entry", "kourosh-commercial-ground-envelope-south", 0.5, 4.5)
  ];
  const first = kouroshCommercialFloor("kourosh-commercial-first", "طبقه اول، ۱۴۳ واحد تجاری، بورس موبایل و تراریوم", 1, 143);
  first.obstacles.push(
    obstacle("kourosh-terrarium", "تراریوم کوروش", "block", 35, -14, 15, 11, 2.2, false),
    presetObstacle("kourosh-terrarium-palm-a", "palm", 32, -14),
    presetObstacle("kourosh-terrarium-palm-b", "palm", 38, -14)
  );

  const leisure = floor("kourosh-leisure-2", "طبقه دوم، ژوپیتر ۴۴۲۸ مترمربع و فودکورت", 2, [
    ...kouroshEnvelope("kourosh-leisure-2", 4.2),
    ...kouroshAtrium("kourosh-leisure-2"),
    partition("kourosh-leisure-2-food", 8, -34, 8, 34, 4.2)
  ], [
    door("kourosh-leisure-2-food-door", "kourosh-leisure-2-food", 0.58, 2),
    windowOpening("kourosh-leisure-2-window-east", "kourosh-leisure-2-envelope-east", 0.5, 4)
  ], [
    ...stripPrototypeCore(prototypeLeisure?.obstacles),
    obstacle("kourosh-jupiter-main", "سرزمین بازی ژوپیتر", "block", -26, 0, 32, 43, 2.2, false),
    ...kouroshAccessCore("kourosh-leisure-2-core")
  ], 4.2);

  const cinemaLobby = floor("kourosh-cinema-lobby-3", "طبقه سوم، گیشه سینما و خانه کودک", 3, [
    ...kouroshEnvelope("kourosh-cinema-lobby-3"),
    ...kouroshAtrium("kourosh-cinema-lobby-3"),
    glassPartition("kourosh-cinema-lobby-3-kids", -42, 12, -12, 12)
  ], [
    door("kourosh-cinema-lobby-3-kids-door", "kourosh-cinema-lobby-3-kids", 0.5, 1.8),
    windowOpening("kourosh-cinema-lobby-3-window-east", "kourosh-cinema-lobby-3-envelope-east", 0.5, 3)
  ], [
    ...presetObstacles("kourosh-cinema-lobby-3-assets", [
      ["checkout-counter", -8, -20], ["checkout-counter", 0, -20], ["checkout-counter", 8, -20],
      ["queue-barrier", -8, -16], ["queue-barrier", 8, -16], ["lobby-sofa", -30, 20],
      ["lobby-sofa", 30, 20], ["display-fridge", 42, -18, 90], ["vending-machine", 42, 18, 90]
    ]),
    obstacle("kourosh-kids-club", "خانه بازی کودک", "block", -28, 22, 25, 18, 1.2, false),
    ...kouroshAccessCore("kourosh-cinema-lobby-3-core")
  ]);

  const cinema4 = kouroshCinemaFloor(4, 1);
  const admin5 = floor("kourosh-admin-5", "طبقه پنجم، اداری، فرهنگی و سالن VIP", 5, [
    ...kouroshEnvelope("kourosh-admin-5"),
    ...kouroshAtrium("kourosh-admin-5"),
    glassPartition("kourosh-admin-5-office", -42, 12, 42, 12),
    glassPartition("kourosh-admin-5-vip", 12, -34, 12, 34)
  ], [
    door("kourosh-admin-5-office-door", "kourosh-admin-5-office", 0.35, 1.5),
    door("kourosh-admin-5-vip-door", "kourosh-admin-5-vip", 0.65, 1.5),
    windowOpening("kourosh-admin-5-window-east", "kourosh-admin-5-envelope-east", 0.5, 3)
  ], [
    ...presetObstacles("kourosh-admin-5-desks", [
      ["office-desk", -34, 20], ["office-chair", -34, 21.2, 180], ["office-desk", -26, 20], ["office-chair", -26, 21.2, 180],
      ["office-desk", -18, 20], ["office-chair", -18, 21.2, 180], ["meeting-table", 28, 20],
      ["filing-cabinet", -42, 28, 90], ["reception-desk", 25, -20], ["lobby-sofa", 34, -12]
    ]),
    ...tableChairs("kourosh-admin-5-meeting", 28, 20),
    obstacle("kourosh-vip-hall", "سالن VIP کوروش", "block", 30, 22, 26, 18, 1.1, false),
    ...kouroshAccessCore("kourosh-admin-5-core")
  ]);
  const cinema6 = kouroshCinemaFloor(6, 7);
  const roof = floor("kourosh-roof-7", "طبقه هفتم، فودکورت و روف‌گاردن", 7, [
    ...kouroshEnvelope("kourosh-roof-7", 2.4),
    ...kouroshAtrium("kourosh-roof-7")
  ], [
    door("kourosh-roof-7-atrium-door", "kourosh-roof-7-atrium-south", 0.5, 1.8),
    windowOpening("kourosh-roof-7-window-east", "kourosh-roof-7-envelope-east", 0.5, 4)
  ], [
    ...stripPrototypeCore(prototypeRoof?.obstacles),
    ...presetObstacles("kourosh-roof-7-landscape", [
      ["grass", -34, -22], ["grass", -34, 22], ["grass", 34, -22], ["grass", 34, 22],
      ["palm", -42, -26], ["palm", -42, 26], ["palm", 42, -26], ["palm", 42, 26],
      ["hedge", -30, 0, 90], ["hedge", 30, 0, 90], ["light-pole", 0, -29], ["light-pole", 0, 29]
    ]),
    ...kouroshAccessCore("kourosh-roof-7-core", true)
  ]);

  const floors = [
    ...parkingFloors,
    hypermarket,
    commercialB1,
    ground,
    first,
    leisure,
    cinemaLobby,
    cinema4,
    admin5,
    cinema6,
    roof
  ];
  ground.elevationM = 0;
  const belowGround = [commercialB1, hypermarket, ...[...parkingFloors].reverse()];
  let lowerElevation = 0;
  for (const lowerFloor of belowGround) {
    lowerElevation -= lowerFloor.heightM;
    lowerFloor.elevationM = lowerElevation;
  }
  const aboveGround = [first, leisure, cinemaLobby, cinema4, admin5, cinema6, roof];
  let upperElevation = ground.heightM;
  for (const upperFloor of aboveGround) {
    upperFloor.elevationM = upperElevation;
    upperElevation += upperFloor.heightM;
  }
  const plan = building(floors);
  return { ...plan, activeFloorId: ground.id };
}

function polygonEnvelope(prefix: string, points: Vec2[], heightM = 3.6): PlanWall[] {
  return points.map((point, index) => wall(
    `${prefix}-envelope-${index + 1}`,
    point,
    points[(index + 1) % points.length],
    heightM
  ));
}

function stackBuilding(floors: FloorPlan[], groundId: string): BuildingPlan {
  const groundIndex = floors.findIndex((item) => item.id === groundId);
  if (groundIndex < 0) return building(floors);
  floors[groundIndex].elevationM = 0;
  for (let index = groundIndex - 1; index >= 0; index -= 1) {
    floors[index].elevationM = floors[index + 1].elevationM - floors[index].heightM;
  }
  for (let index = groundIndex + 1; index < floors.length; index += 1) {
    floors[index].elevationM = floors[index - 1].elevationM + floors[index - 1].heightM;
  }
  const plan = building(floors);
  return { ...plan, activeFloorId: groundId };
}

function standardFacilityCore(prefix: string, top = false, halfSpan = 28): PlanObstacle[] {
  return [
    top ? topLanding(`${prefix}-landing-west`, -halfSpan, 0, 90) : presetObstacle(`${prefix}-stairs-west`, "stairs-straight", -halfSpan, 0, 90),
    top ? topLanding(`${prefix}-landing-east`, halfSpan, 0, 90) : presetObstacle(`${prefix}-stairs-east`, "stairs-straight", halfSpan, 0, 90),
    presetObstacle(`${prefix}-elevator-public`, "elevator", -halfSpan + 4, 0, 90),
    presetObstacle(`${prefix}-elevator-service`, "elevator", halfSpan - 4, 0, 90)
  ];
}

function centralCorridorRooms(prefix: string, left: number, right: number, top: number, bottom: number, columns = 6, heightM = 3.6) {
  const walls: PlanWall[] = [
    partition(`${prefix}-corridor-north`, left, -3, right, -3, heightM),
    partition(`${prefix}-corridor-south`, left, 3, right, 3, heightM)
  ];
  const doors: PlanDoor[] = [];
  const step = (right - left) / columns;
  for (let index = 1; index < columns; index += 1) {
    const x = left + step * index;
    walls.push(partition(`${prefix}-north-divider-${index}`, x, top, x, -3, heightM));
    walls.push(partition(`${prefix}-south-divider-${index}`, x, 3, x, bottom, heightM));
  }
  for (let index = 0; index < columns; index += 1) {
    const offset = (index + 0.5) / columns;
    doors.push(door(`${prefix}-north-room-door-${index + 1}`, `${prefix}-corridor-north`, offset, 1.35));
    doors.push(door(`${prefix}-south-room-door-${index + 1}`, `${prefix}-corridor-south`, offset, 1.35));
  }
  return { walls, doors };
}

function gridPresets(
  prefix: string,
  variants: ObstacleVariant[],
  xs: number[],
  zs: number[],
  rotationDeg = 0
): PlanObstacle[] {
  const placements: Array<[ObstacleVariant, number, number, number]> = [];
  for (const z of zs) for (const x of xs) placements.push([variants[placements.length % variants.length], x, z, rotationDeg]);
  return presetObstacles(prefix, placements);
}

/* Mega Mall Ekbatan: three parking levels, a full hypermarket plate, two retail
   galleries with 210 shopfronts, a 6,000 m² leisure floor and ten cinema halls. */
function megaEnvelope(prefix: string, heightM = 4.2): PlanWall[] {
  return polygonEnvelope(prefix, [
    { x: -62, z: -44 }, { x: 54, z: -44 }, { x: 70, z: -30 }, { x: 70, z: 32 },
    { x: 58, z: 45 }, { x: -58, z: 45 }, { x: -72, z: 30 }, { x: -72, z: -30 }
  ], heightM);
}

function megaAtrium(prefix: string): PlanWall[] {
  const points: Vec2[] = Array.from({ length: 12 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 12;
    return { x: Math.cos(angle) * 23, z: Math.sin(angle) * 14 };
  });
  return points.map((point, index) => glassPartition(
    `${prefix}-atrium-${index + 1}`,
    point.x,
    point.z,
    points[(index + 1) % points.length].x,
    points[(index + 1) % points.length].z,
    1.4
  ));
}

function megaCore(prefix: string, top = false): PlanObstacle[] {
  const stairs: Array<[number, number]> = [[-48, -26], [48, -26], [-48, 28], [48, 28]];
  const elevators: Array<[number, number]> = [[-44, -22], [-44, 22], [44, -22], [44, 22], [-28, 0], [28, 0]];
  const escalators: Array<[number, number]> = [[-11, -18], [11, -18], [-11, 18], [11, 18]];
  return [
    ...stairs.map(([x, z], index) => top ? topLanding(`${prefix}-landing-${index + 1}`, x, z, 90) : presetObstacle(`${prefix}-stairs-${index + 1}`, "stairs-straight", x, z, 90)),
    ...elevators.map(([x, z], index) => presetObstacle(`${prefix}-elevator-${index + 1}`, "elevator", x, z, 90)),
    ...escalators.map(([x, z], index) => presetObstacle(`${prefix}-escalator-${index + 1}`, "escalator", x, z, 90))
  ];
}

function megaShopRing(prefix: string, total: number) {
  const definitions = [
    { name: "north-inner", weight: 116, start: -58, end: 58, front: -21, back: -14, horizontal: true },
    { name: "north-outer", weight: 116, start: -58, end: 58, front: -31, back: -43, horizontal: true },
    { name: "south-inner", weight: 116, start: -58, end: 58, front: 21, back: 14, horizontal: true },
    { name: "south-outer", weight: 116, start: -58, end: 58, front: 31, back: 44, horizontal: true },
    { name: "west-inner", weight: 54, start: -27, end: 27, front: -35, back: -23, horizontal: false },
    { name: "east-inner", weight: 54, start: -27, end: 27, front: 35, back: 23, horizontal: false }
  ];
  const totalWeight = definitions.reduce((sum, item) => sum + item.weight, 0);
  const counts = definitions.map((item) => Math.floor(total * item.weight / totalWeight));
  for (let index = 0; counts.reduce((sum, value) => sum + value, 0) < total; index = (index + 1) % counts.length) counts[index] += 1;
  const bands = definitions.map((item, index) => shopBand(`${prefix}-${item.name}`, counts[index], item.start, item.end, item.front, item.back, item.horizontal));
  return { walls: bands.flatMap((item) => item.walls), doors: bands.flatMap((item) => item.doors) };
}

function megaRetailFloor(id: string, name: string, index: number, units: number): FloorPlan {
  const ring = megaShopRing(id, units);
  return floor(id, name, index, [...megaEnvelope(id), ...megaAtrium(id), ...ring.walls], [
    ...ring.doors,
    windowOpening(`${id}-facade-window-east`, `${id}-envelope-3`, 0.5, 7),
    windowOpening(`${id}-facade-window-west`, `${id}-envelope-7`, 0.5, 7)
  ], [
    ...gridPresets(`${id}-fixtures-a`, ["clothing-rack", "display-stand", "shelving-unit"], [-52, -40, -28, 28, 40, 52], [-36, -27, 27, 36]),
    ...gridPresets(`${id}-kiosks`, ["display-stand", "concierge-desk"], [-17, 0, 17], [-10, 10]),
    ...megaCore(`${id}-core`)
  ], 4.2);
}

function megaParkingFloor(index: number): FloorPlan {
  const id = `mega-parking-b${Math.abs(index)}`;
  return floor(id, `پارکینگ مگامال B${Math.abs(index)}`, index, [
    ...megaEnvelope(id, 3.6),
    partition(`${id}-lane-west`, -9, -38, -9, 38, 1.2),
    partition(`${id}-lane-east`, 9, -38, 9, 38, 1.2)
  ], [
    door(`${id}-vehicle-entry`, `${id}-envelope-1`, 0.5, 6),
    windowOpening(`${id}-vent-east`, `${id}-envelope-3`, 0.5, 4),
    windowOpening(`${id}-vent-west`, `${id}-envelope-7`, 0.5, 4)
  ], [
    ...gridPresets(`${id}-vehicles`, ["sedan", "suv", "pickup", "van"], [-52, -39, -25, -15, 15, 25, 39, 52], [-32, -11, 11, 32], 90),
    ...presetObstacles(`${id}-traffic`, [["parking-barrier", 0, -40], ["guard-booth", 7, -38], ["speed-bump", 0, -34], ["equipment-rack", 57, 37]]),
    ...megaCore(`${id}-core`)
  ], 3.6);
}

function megaMallPlan(): BuildingPlan {
  const parking = [-3, -2, -1].map(megaParkingFloor);
  const hyper = floor("mega-hyper-ground", "همکف، هایپرمارکت ۱۱٬۰۰۰ مترمربعی و ورودی مترو", 0, [
    ...megaEnvelope("mega-hyper-ground"),
    glassPartition("mega-hyper-ground-front", -58, -32, 58, -32),
    partition("mega-hyper-ground-stock", -58, 28, 58, 28),
    partition("mega-hyper-ground-service", 52, -32, 52, 44)
  ], [
    door("mega-hyper-main-entry", "mega-hyper-ground-envelope-1", 0.5, 5),
    door("mega-hyper-stock-door", "mega-hyper-ground-stock", 0.82, 2.4),
    door("mega-hyper-service-door", "mega-hyper-ground-service", 0.75, 2),
    windowOpening("mega-hyper-window-east", "mega-hyper-ground-envelope-3", 0.5, 7),
    windowOpening("mega-hyper-window-west", "mega-hyper-ground-envelope-7", 0.5, 7)
  ], [
    ...gridPresets("mega-hyper-aisles", ["shelving-unit"], [-48, -40, -32, -24, -16, -8, 8, 16, 24, 32, 40, 48], [-22, -12, -2, 8, 18]),
    ...gridPresets("mega-hyper-checkouts", ["checkout-counter"], [-38, -30, -22, -14, -6, 6, 14, 22, 30, 38], [-28]),
    ...gridPresets("mega-hyper-cold", ["display-fridge"], [-42, -28, -14, 0, 14, 28, 42], [24]),
    ...megaCore("mega-hyper-core")
  ], 4.2);
  const retail1 = megaRetailFloor("mega-retail-1", "طبقه اول، گالری مد، خدمات و ۱۰۵ واحد", 1, 105);
  const retail2 = megaRetailFloor("mega-retail-2", "طبقه دوم، ۱۰۵ واحد، سرای غذا و تراس", 2, 105);
  retail2.obstacles.push(...Array.from({ length: 8 }, (_, index) => tableChairs(`mega-food-table-${index + 1}`, 34 + (index % 4) * 7, -12 + Math.floor(index / 4) * 8, 0, "dining-chair")).flat());
  const leisure = floor("mega-leisure-3", "طبقه سوم، شهربازی ۶٬۰۰۰ مترمربعی و ورزش", 3, [
    ...megaEnvelope("mega-leisure-3", 4.8),
    ...megaAtrium("mega-leisure-3"),
    partition("mega-leisure-3-play", 8, -40, 8, 40, 4.8),
    partition("mega-leisure-3-food", 8, 12, 66, 12, 4.8)
  ], [
    door("mega-leisure-play-door", "mega-leisure-3-play", 0.5, 2.4),
    door("mega-leisure-food-door", "mega-leisure-3-food", 0.55, 2),
    windowOpening("mega-leisure-window-east", "mega-leisure-3-envelope-3", 0.5, 8)
  ], [
    obstacle("mega-play-zone", "شهربازی سرپوشیده مگامال", "block", -28, 2, 62, 72, 1.2, false),
    ...gridPresets("mega-play-assets", ["display-stand", "vending-machine", "waiting-bench"], [-52, -38, -24, -10], [-28, -10, 10, 28]),
    ...Array.from({ length: 10 }, (_, index) => tableChairs(`mega-leisure-table-${index + 1}`, 20 + (index % 5) * 9, 20 + Math.floor(index / 5) * 8, 0, "dining-chair")).flat(),
    ...megaCore("mega-leisure-core")
  ], 4.8);
  const cinema = floor("mega-cinema-4", "طبقه چهارم، پردیس سینمایی ۱۰ سالن و لابی", 4, [
    ...megaEnvelope("mega-cinema-4", 5),
    partition("mega-cinema-lobby-line", -66, 5, 66, 5, 5),
    ...[-52, -26, 0, 26, 52].flatMap((x, index) => [
      partition(`mega-cinema-divider-n-${index}`, x, -40, x, 5, 5),
      partition(`mega-cinema-divider-s-${index}`, x, 5, x, 42, 5)
    ])
  ], [
    ...Array.from({ length: 10 }, (_, index) => door(`mega-cinema-hall-door-${index + 1}`, "mega-cinema-lobby-line", (index + 0.5) / 10, 1.8)),
    windowOpening("mega-cinema-lobby-window", "mega-cinema-4-envelope-1", 0.5, 8)
  ], [
    ...Array.from({ length: 10 }, (_, index) => obstacle(`mega-cinema-hall-${index + 1}`, `سالن سینما ${index + 1}`, "block", -52 + (index % 5) * 26, index < 5 ? -18 : 24, 22, 27, 3.6, true)),
    ...gridPresets("mega-cinema-lobby", ["waiting-bench", "vending-machine", "queue-barrier"], [-42, -25, -8, 8, 25, 42], [0]),
    ...megaCore("mega-cinema-core", true)
  ], 5);
  return stackBuilding([...parking, hyper, retail1, retail2, leisure, cinema], hyper.id);
}

function clinicalFixtures(prefix: string, variant: ObstacleVariant, xs: number[], zs: number[]): PlanObstacle[] {
  return gridPresets(prefix, [variant], xs, zs, 90);
}

function hospitalFloor(id: string, name: string, index: number, specialty: "emergency" | "surgery" | "ward" | "maternity" | "admin", top = false): FloorPlan {
  const rooms = centralCorridorRooms(id, -34, 34, -24, 24, specialty === "ward" || specialty === "maternity" ? 8 : 6, 3.8);
  const common: PlanObstacle[] = [
    ...standardFacilityCore(`${id}-core`, top, 29),
    presetObstacle(`${id}-nurse`, "nurse-station", 0, 0),
    presetObstacle(`${id}-rack`, "equipment-rack", 31, 20)
  ];
  const specialtyAssets: PlanObstacle[] = specialty === "emergency" ? [
    ...clinicalFixtures(`${id}-exam`, "exam-table", [-27, -16, -5, 7, 18, 29], [-14]),
    ...clinicalFixtures(`${id}-stretcher`, "stretcher", [-25, -13, -1, 11, 23], [14]),
    ...gridPresets(`${id}-waiting`, ["waiting-bench"], [-26, -17, -8, 8, 17, 26], [0]),
    ...gridPresets(`${id}-medical-carts`, ["medical-cart"], [-22, 0, 22], [-7, 7])
  ] : specialty === "surgery" ? [
    ...clinicalFixtures(`${id}-surgery-tables`, "exam-table", [-26, -13, 0, 13, 26], [-14]),
    ...clinicalFixtures(`${id}-icu-beds`, "hospital-bed", [-26, -17, -8, 8, 17, 26], [14]),
    ...gridPresets(`${id}-screens`, ["privacy-screen"], [-22, -11, 11, 22], [10]),
    ...gridPresets(`${id}-carts`, ["medical-cart"], [-26, -13, 0, 13, 26], [-8, 8])
  ] : specialty === "ward" || specialty === "maternity" ? [
    ...clinicalFixtures(`${id}-beds-north`, "hospital-bed", [-29, -21, -13, -5, 5, 13, 21, 29], [-14]),
    ...clinicalFixtures(`${id}-beds-south`, "hospital-bed", [-29, -21, -13, -5, 5, 13, 21, 29], [14]),
    ...gridPresets(`${id}-screens`, ["privacy-screen"], [-25, -17, -9, 9, 17, 25], [-10, 10]),
    ...gridPresets(`${id}-carts`, ["medical-cart"], [-28, -14, 14, 28], [-5, 5])
  ] : [
    ...gridPresets(`${id}-desks`, ["office-desk", "office-chair"], [-27, -18, -9, 9, 18, 27], [-14, 14]),
    ...tableChairs(`${id}-meeting-west`, -18, 0),
    ...tableChairs(`${id}-meeting-east`, 18, 0),
    ...gridPresets(`${id}-rehab`, ["waiting-bench", "medical-cart"], [-28, -18, 18, 28], [-8, 8])
  ];
  const floorPlan = floor(id, name, index, [
    ...rectangle(`${id}-shell`, -36, -26, 36, 26, 3.8),
    ...rooms.walls
  ], [
    ...rooms.doors,
    ...(index === 0 ? [door(`${id}-main-door`, `${id}-shell-south`, 0.5, specialty === "emergency" ? 3.2 : 1.8)] : []),
    windowOpening(`${id}-window-north-a`, `${id}-shell-north`, 0.25, 6),
    windowOpening(`${id}-window-north-b`, `${id}-shell-north`, 0.75, 6),
    windowOpening(`${id}-window-south-a`, `${id}-shell-south`, 0.25, 5),
    windowOpening(`${id}-window-south-b`, `${id}-shell-south`, 0.75, 5)
  ], [...common, ...specialtyAssets], 3.8);
  if (specialty === "emergency") {
    floorPlan.obstacles.push(obstacle(`${id}-ambulance`, "آمبولانس اورژانس", "vehicle", 30, 22, 5.7, 2.1, 2.5, true, 90));
  }
  return floorPlan;
}

function generalHospitalPlan(): BuildingPlan {
  const floors = [
    hospitalFloor("hospital-ground", "همکف، اورژانس، تریاژ، تصویربرداری و درمانگاه", 0, "emergency"),
    hospitalFloor("hospital-first", "طبقه اول، اتاق‌های عمل، ریکاوری و ICU", 1, "surgery"),
    hospitalFloor("hospital-second", "طبقه دوم، بخش‌های بستری داخلی و جراحی", 2, "ward"),
    hospitalFloor("hospital-third", "طبقه سوم، زنان، زایمان و اطفال", 3, "maternity"),
    hospitalFloor("hospital-fourth", "طبقه چهارم، مدیریت، آموزش، توان‌بخشی و خدمات", 4, "admin", true)
  ];
  return stackBuilding(floors, "hospital-ground");
}

function secureOfficeFloor(id: string, name: string, index: number, top = false, halfSpan = 24, shellHalfWidth = 30, shellHalfDepth = 22): FloorPlan {
  const rooms = centralCorridorRooms(id, -shellHalfWidth + 3, shellHalfWidth - 3, -shellHalfDepth + 2, shellHalfDepth - 2, 6, 3.6);
  return floor(id, name, index, [...rectangle(`${id}-shell`, -shellHalfWidth, -shellHalfDepth, shellHalfWidth, shellHalfDepth, 3.6), ...rooms.walls], [
    ...rooms.doors,
    ...(index === 0 ? [door(`${id}-entry`, `${id}-shell-south`, 0.5, 2.2)] : []),
    windowOpening(`${id}-window-a`, `${id}-shell-north`, 0.3, 4),
    windowOpening(`${id}-window-b`, `${id}-shell-north`, 0.7, 4)
  ], [
    ...standardFacilityCore(`${id}-core`, top, halfSpan),
    ...gridPresets(`${id}-workstations`, ["office-desk", "office-chair", "filing-cabinet"], [-23, -14, -5, 5, 14, 23], [-13, 13]),
    ...gridPresets(`${id}-lockers`, ["locker-row"], [-23, -8, 8, 23], [-18, 18]),
    ...tableChairs(`${id}-briefing-west`, -15, 0),
    ...tableChairs(`${id}-briefing-east`, 15, 0),
    presetObstacle(`${id}-rack`, "equipment-rack", 26, 18)
  ], 3.6);
}

function policeStationPlan(): BuildingPlan {
  const basement = floor("police-basement", "زیرزمین، پارکینگ سازمانی، بایگانی و نگهداری موقت", -1, [
    ...rectangle("police-basement-shell", -30, -22, 30, 22, 3.6),
    partition("police-basement-secure", 8, -22, 8, 22),
    partition("police-basement-cells", 8, 4, 30, 4),
    partition("police-basement-cell-a", 19, 4, 19, 22)
  ], [
    door("police-basement-gate", "police-basement-shell-south", 0.2, 5),
    door("police-basement-secure-door", "police-basement-secure", 0.5, 1.4),
    door("police-basement-cell-door-a", "police-basement-cells", 0.25, 1.1),
    door("police-basement-cell-door-b", "police-basement-cells", 0.75, 1.1),
    windowOpening("police-basement-vent", "police-basement-shell-east", 0.5, 2.5)
  ], [
    ...gridPresets("police-basement-vehicles", ["sedan", "suv", "van"], [-22, -12, -2], [-14, -5, 5, 14], 90),
    ...gridPresets("police-basement-archive", ["filing-cabinet", "locker-row"], [14, 24], [-14, -6]),
    ...gridPresets("police-basement-cells-assets", ["metal-bunk"], [14, 24], [13], 90),
    ...standardFacilityCore("police-basement-core", false, 24)
  ], 3.6);
  const ground = secureOfficeFloor("police-ground", "همکف، پیشخوان خدمات، گزارش، انتظار و مصاحبه", 0);
  ground.obstacles.push(
    ...gridPresets("police-ground-counter", ["service-counter"], [-15, -5, 5, 15], [-7]),
    ...gridPresets("police-ground-waiting", ["waiting-bench"], [-20, -10, 10, 20], [7])
  );
  const first = secureOfficeFloor("police-first", "طبقه اول، عملیات، فرماندهی، اداری و اتاق جلسات", 1);
  const second = secureOfficeFloor("police-second", "طبقه دوم، آموزش، توجیه، رفاه و مدیریت", 2, true);
  return stackBuilding([basement, ground, first, second], ground.id);
}

function barracksCampusPlan(): BuildingPlan {
  const ground = floor("barracks-ground", "همکف، محوطه پادگان، گیت، ستاد، درمانگاه و خدمات", 0, [
    ...rectangle("barracks-yard", -62, -42, 62, 42, 2.4),
    ...rectangle("barracks-ground-shell", -42, -27, 42, 27, 3.6),
    partition("barracks-ground-spine", -42, 0, 42, 0),
    partition("barracks-ground-admin", -12, -27, -12, 27),
    partition("barracks-ground-clinic", 18, 0, 18, 27)
  ], [
    door("barracks-main-gate", "barracks-yard-south", 0.5, 7),
    door("barracks-main-entry", "barracks-ground-shell-south", 0.5, 2.4),
    door("barracks-admin-door", "barracks-ground-admin", 0.3, 1.4),
    door("barracks-clinic-door", "barracks-ground-clinic", 0.55, 1.4),
    windowOpening("barracks-ground-window-north", "barracks-ground-shell-north", 0.5, 8)
  ], [
    ...gridPresets("barracks-roads", ["road"], [-45, -20, 5, 30, 50], [34]),
    ...gridPresets("barracks-vehicles", ["sedan", "pickup", "van", "truck"], [-48, -34, -20, 30, 44, 55], [25], 90),
    ...gridPresets("barracks-landscape", ["grass", "deciduous", "conifer", "light-pole"], [-52, -36, 36, 52], [-32, 32]),
    ...presetObstacles("barracks-gate-assets", [["gate-sliding", 0, 41], ["guard-booth", 7, 38], ["parking-barrier", -6, 38], ["camera-pole", -58, 35], ["camera-pole", 58, 35]]),
    ...gridPresets("barracks-admin-assets", ["office-desk", "office-chair", "filing-cabinet"], [-34, -25, -17, -5, 5], [-18, -8, 8, 18]),
    ...gridPresets("barracks-clinic-assets", ["exam-table", "medical-cart", "waiting-bench"], [25, 34], [8, 18]),
    ...standardFacilityCore("barracks-ground-core", false, 35)
  ], 3.6);
  const dormRooms = centralCorridorRooms("barracks-dorm", -40, 40, -25, 25, 8, 3.6);
  const dorm = floor("barracks-first", "طبقه اول، آسایشگاه‌ها، رختکن و فضاهای بهداشتی", 1, [...rectangle("barracks-first-shell", -42, -27, 42, 27, 3.6), ...dormRooms.walls], [
    ...dormRooms.doors,
    windowOpening("barracks-first-window-north", "barracks-first-shell-north", 0.5, 8),
    windowOpening("barracks-first-window-south", "barracks-first-shell-south", 0.5, 8)
  ], [
    ...gridPresets("barracks-bunks-n", ["metal-bunk"], [-36, -27, -18, -9, 9, 18, 27, 36], [-16]),
    ...gridPresets("barracks-bunks-s", ["metal-bunk"], [-36, -27, -18, -9, 9, 18, 27, 36], [16]),
    ...gridPresets("barracks-lockers", ["locker-row"], [-35, -21, -7, 7, 21, 35], [-23, 23]),
    ...standardFacilityCore("barracks-first-core", false, 35)
  ], 3.6);
  const training = secureOfficeFloor("barracks-second", "طبقه دوم، آموزش نظری، فرماندهی و جلسات", 2, false, 35, 42, 27);
  const welfare = floor("barracks-third", "طبقه سوم، غذاخوری، کتابخانه، ورزش و رفاه", 3, [
    ...rectangle("barracks-third-shell", -42, -27, 42, 27, 3.8),
    partition("barracks-third-food", 8, -27, 8, 27),
    partition("barracks-third-library", -42, 8, 8, 8)
  ], [
    door("barracks-third-food-door", "barracks-third-food", 0.5, 1.8),
    windowOpening("barracks-third-window-north", "barracks-third-shell-north", 0.5, 8)
  ], [
    ...Array.from({ length: 12 }, (_, index) => tableChairs(`barracks-dining-${index + 1}`, 17 + (index % 4) * 7, -17 + Math.floor(index / 4) * 9, 0, "dining-chair")).flat(),
    ...gridPresets("barracks-library", ["library-shelf", "student-desk"], [-34, -25, -16, -7], [14, 22]),
    ...gridPresets("barracks-gym", ["gym-bleacher", "locker-row"], [-30, -10], [-15]),
    ...standardFacilityCore("barracks-third-core", true, 35)
  ], 3.8);
  return stackBuilding([ground, dorm, training, welfare], ground.id);
}

function classroomAssets(prefix: string, xOffset: number, zOffset: number): PlanObstacle[] {
  return [
    ...gridPresets(`${prefix}-desks`, ["student-desk"], [-4, 0, 4].map((x) => x + xOffset), [-4, 0, 4].map((z) => z + zOffset)),
    presetObstacle(`${prefix}-board`, "whiteboard", xOffset, zOffset - 6, 0),
    presetObstacle(`${prefix}-teacher`, "office-desk", xOffset + 5, zOffset - 5)
  ];
}

function schoolCampusPlan(): BuildingPlan {
  const classroomFloor = (id: string, name: string, index: number, top = false) => {
    const rooms = centralCorridorRooms(id, -38, 38, -26, 26, 4, 3.7);
    const centers: Array<[number, number]> = [[-28, -15], [-9, -15], [9, -15], [28, -15], [-28, 15], [-9, 15], [9, 15], [28, 15]];
    return floor(id, name, index, [...rectangle(`${id}-shell`, -40, -28, 40, 28, 3.7), ...rooms.walls], [
      ...rooms.doors,
      windowOpening(`${id}-window-north-a`, `${id}-shell-north`, 0.25, 6),
      windowOpening(`${id}-window-north-b`, `${id}-shell-north`, 0.75, 6),
      windowOpening(`${id}-window-south-a`, `${id}-shell-south`, 0.25, 6),
      windowOpening(`${id}-window-south-b`, `${id}-shell-south`, 0.75, 6)
    ], [
      ...centers.flatMap(([x, z], roomIndex) => classroomAssets(`${id}-class-${roomIndex + 1}`, x, z)),
      ...standardFacilityCore(`${id}-core`, top, 34)
    ], 3.7);
  };
  const ground = classroomFloor("school-ground", "همکف، ورودی، مدیریت، کلاس‌های پایه و حیاط", 0);
  ground.walls.unshift(...rectangle("school-yard", -58, -42, 58, 42, 2.2));
  ground.doors.push(door("school-yard-gate", "school-yard-south", 0.5, 5), door("school-main-entry", "school-ground-shell-south", 0.5, 2.4));
  ground.obstacles.push(
    ...gridPresets("school-yard-landscape", ["grass", "deciduous", "light-pole", "waiting-bench"], [-48, -32, 32, 48], [-34, 34]),
    ...presetObstacles("school-yard-security", [["gate-sliding", 0, 41], ["guard-booth", 7, 38], ["camera-pole", -54, 34], ["camera-pole", 54, 34]])
  );
  const first = classroomFloor("school-first", "طبقه اول، کلاس‌ها، اتاق معلمان و مشاوره", 1);
  const second = classroomFloor("school-second", "طبقه دوم، آزمایشگاه‌ها، کارگاه و کتابخانه", 2);
  second.obstacles.push(
    ...gridPresets("school-labs", ["lab-bench"], [-30, -22, -14, 14, 22, 30], [-17, -10]),
    ...gridPresets("school-library", ["library-shelf"], [-30, -22, -14, 14, 22, 30], [12, 19])
  );
  const third = floor("school-third", "طبقه سوم، سالن چندمنظوره، ورزش، هنر و بام آموزشی", 3, [
    ...rectangle("school-third-shell", -40, -28, 40, 28, 4.2),
    partition("school-third-gym", 10, -28, 10, 28, 4.2),
    partition("school-third-art", -40, 8, 10, 8, 4.2)
  ], [
    door("school-third-gym-door", "school-third-gym", 0.5, 2),
    door("school-third-art-door", "school-third-art", 0.5, 1.6),
    windowOpening("school-third-window-north", "school-third-shell-north", 0.5, 8)
  ], [
    ...gridPresets("school-bleachers", ["gym-bleacher"], [20, 30], [-20, 20]),
    ...gridPresets("school-art-benches", ["lab-bench", "student-desk"], [-30, -20, -10, 0], [-15, -7, 16]),
    ...standardFacilityCore("school-third-core", true, 34)
  ], 4.2);
  return stackBuilding([ground, first, second, third], ground.id);
}

export function createSamplePlan(id: SamplePlanId): BuildingPlan {
  switch (id) {
    case "luxury-villa": return luxuryVillaPlan();
    case "modern-office": return modernOfficePlan();
    case "retail-gallery": return retailGalleryPlan();
    case "factory-campus": return factoryCampusPlan();
    case "residential-parking": return residentialParkingPlan();
    case "kourosh-mall": return kouroshMallPlan();
    case "mega-mall": return megaMallPlan();
    case "general-hospital": return generalHospitalPlan();
    case "police-station": return policeStationPlan();
    case "barracks-campus": return barracksCampusPlan();
    case "school-campus": return schoolCampusPlan();
  }
}

export type { SamplePlanId };
