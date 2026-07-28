import {
  defaultPlanDefaults,
  type BuildingPlan,
  type FloorPlan,
  type ObstacleKind,
  type PlanDoor,
  type PlanObstacle,
  type PlanWall,
  type Vec2
} from "@/src/domain/planner/types";

type SamplePlanId = "luxury-villa" | "modern-office" | "retail-gallery" | "factory-campus" | "residential-parking";

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

function door(id: string, wallId: string, offset = 0.5, widthM = 1.2): PlanDoor {
  return { id, wallId, offset, widthM, heightM: 2.2, hinge: "start", openAngleDeg: 55 };
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

function villaUpperFloor(prefix: string, name: string, index: number, suiteLayout = false): FloorPlan {
  const walls = [
    ...rectangle(`${prefix}-shell`, -12, -9, 12, 9),
    partition(`${prefix}-hall-v`, 0, -9, 0, 9),
    partition(`${prefix}-north-h`, -12, -2, 12, -2),
    partition(`${prefix}-south-h`, -12, 3.5, 12, 3.5),
    partition(`${prefix}-west-v`, -6, -9, -6, 9),
    partition(`${prefix}-east-v`, 6, -9, 6, 9),
    ...(suiteLayout ? [partition(`${prefix}-suite`, 0, 0.5, 6, 0.5)] : [])
  ];
  return floor(prefix, name, index, walls, [
    door(`${prefix}-entry`, `${prefix}-shell-south`, 0.5, 1.5),
    door(`${prefix}-room-1`, `${prefix}-north-h`, 0.2),
    door(`${prefix}-room-2`, `${prefix}-north-h`, 0.8),
    door(`${prefix}-room-3`, `${prefix}-south-h`, 0.22),
    door(`${prefix}-room-4`, `${prefix}-south-h`, 0.78)
  ], [
    obstacle(`${prefix}-stairs`, "راه‌پله و آسانسور", "block", 0, 6.2, 3.2, 4.2, 2.7),
    obstacle(`${prefix}-lounge`, "نشیمن طبقه", "counter", 0, 0.6, 4.2, 2.2, 0.8, false)
  ]);
}

/** Four storeys, a walled estate, pool, garden beds, gazebo and mixed public/private rooms. */
function luxuryVillaPlan(): BuildingPlan {
  const estateWalls = rectangle("villa-estate", -24, -18, 24, 18, 2.2);
  const houseWalls = [
    ...rectangle("villa-house", -12, -9, 12, 9),
    partition("villa-lobby-v", 0, -9, 0, 9),
    partition("villa-reception-h", -12, 1.5, 12, 1.5),
    partition("villa-kitchen-v", 6.5, 1.5, 6.5, 9),
    partition("villa-office-v", -6.5, 1.5, -6.5, 9)
  ];
  const ground = floor("villa-ground", "همکف، باغ و فضاهای عمومی", 0, [...estateWalls, ...houseWalls], [
    door("villa-gate", "villa-estate-south", 0.5, 4.5),
    door("villa-main-entry", "villa-house-south", 0.5, 2),
    door("villa-garden-entry", "villa-house-north", 0.5, 1.8)
  ], [
    obstacle("villa-pool", "استخر روباز", "block", -17.5, -4, 8.5, 4.2, 0.18, false),
    obstacle("villa-gazebo", "آلاچیق", "counter", 17, -8.5, 5, 5, 2.8, false),
    obstacle("villa-fountain", "آبنما", "pillar", 0, -13.2, 3.2, 3.2, 0.35, false),
    obstacle("villa-driveway", "پارکینگ مهمان", "vehicle", 17, 10.5, 8, 5.5, 1.6, true),
    obstacle("villa-garden-west", "باغچه غربی", "shelf", -18, 10, 8, 3, 0.65, false),
    obstacle("villa-garden-east", "باغچه شرقی", "shelf", 16, 2, 5, 9, 0.65, false),
    obstacle("villa-island", "جزیره آشپزخانه", "counter", 8.8, 5.2, 3.8, 1.2, 0.95)
  ]);
  const first = villaUpperFloor("villa-first", "طبقه اول، سوئیت‌ها", 1, true);
  const second = villaUpperFloor("villa-second", "طبقه دوم، اتاق‌ها و سینما", 2);
  const roofWalls = [
    ...rectangle("villa-roof-shell", -12, -9, 12, 9, 1.25),
    ...rectangle("villa-roof-room", -5, -3.5, 5, 3.5)
  ];
  const roof = floor("villa-roof", "طبقه چهارم، روف‌گاردن", 3, roofWalls, [
    door("villa-roof-door", "villa-roof-room-south", 0.5, 1.4)
  ], [
    obstacle("villa-roof-pergola", "پرگولا", "counter", -8.5, 4.5, 5, 5, 2.5, false),
    obstacle("villa-roof-garden-a", "باغچه بام", "shelf", 8.5, -5.8, 5, 2, 0.7, false),
    obstacle("villa-roof-garden-b", "باغچه بام", "shelf", 8.5, 5.8, 5, 2, 0.7, false)
  ]);
  return building([ground, first, second, roof]);
}

function modernOfficePlan(): BuildingPlan {
  const make = (index: number, name: string) => {
    const prefix = `office-${index}`;
    const walls = [
      ...rectangle(`${prefix}-shell`, -18, -11, 18, 11),
      partition(`${prefix}-core-v`, -6, -11, -6, 11),
      partition(`${prefix}-meeting-h`, -18, 2, 18, 2),
      partition(`${prefix}-rooms-v`, 7, -11, 7, 2)
    ];
    return floor(prefix, name, index, walls, [door(`${prefix}-entry`, `${prefix}-shell-south`, 0.5, 1.8)], [
      obstacle(`${prefix}-core`, "هسته آسانسور", "block", -11.5, 5.5, 5, 5, 2.8),
      obstacle(`${prefix}-desks-a`, "ایستگاه کاری", "counter", 0, -5, 8, 2.2, 1, false),
      obstacle(`${prefix}-desks-b`, "ایستگاه کاری", "counter", 0, 6.2, 8, 2.2, 1, false)
    ]);
  };
  return building([make(0, "لابی و خدمات"), make(1, "دفترهای عملیاتی"), make(2, "مدیریت و جلسات")]);
}

function retailGalleryPlan(): BuildingPlan {
  const groundWalls = [
    ...rectangle("gallery-shell", -20, -13, 20, 13),
    partition("gallery-back", -20, 6, 20, 6),
    partition("gallery-east", 8, -13, 8, 6),
    partition("gallery-west", -8, -13, -8, 6)
  ];
  const ground = floor("gallery-ground", "گالری، صندوق و انبار", 0, groundWalls, [
    door("gallery-entry", "gallery-shell-south", 0.5, 3)
  ], [
    obstacle("gallery-island-a", "استند مرکزی", "shelf", -4, -3, 5, 2, 1.7),
    obstacle("gallery-island-b", "استند مرکزی", "shelf", 4, -3, 5, 2, 1.7),
    obstacle("gallery-till", "صندوق", "counter", 13.5, 8.5, 5, 1.3, 1.1)
  ]);
  const mezzanine = floor("gallery-mezzanine", "نیم‌طبقه اداری", 1, [
    ...rectangle("gallery-mezz-shell", -11, -8, 11, 8),
    partition("gallery-mezz-h", -11, 1, 11, 1),
    partition("gallery-mezz-v", 2, -8, 2, 8)
  ], [door("gallery-mezz-entry", "gallery-mezz-shell-south", 0.5)]);
  return building([ground, mezzanine]);
}

function factoryCampusPlan(): BuildingPlan {
  const walls = [
    ...rectangle("factory-yard", -30, -20, 30, 20, 2.4),
    ...rectangle("factory-hall", -25, -14, 12, 14, 6),
    ...rectangle("factory-office", 15, -14, 26, 2, 3.4),
    partition("factory-storage", -8, -14, -8, 14, 6)
  ];
  return building([floor("factory-ground", "محوطه، تولید، انبار و اداری", 0, walls, [
    door("factory-gate", "factory-yard-south", 0.78, 6),
    door("factory-hall-door", "factory-hall-south", 0.5, 5)
  ], [
    obstacle("factory-line-a", "خط تولید A", "shelf", -16, -6, 14, 2.4, 2),
    obstacle("factory-line-b", "خط تولید B", "shelf", -16, 0, 14, 2.4, 2),
    obstacle("factory-line-c", "خط تولید C", "shelf", -16, 6, 14, 2.4, 2),
    obstacle("factory-loading", "بارانداز", "vehicle", 21, 10, 10, 5, 2.2)
  ], 6.2)]);
}

function residentialParkingPlan(): BuildingPlan {
  const parking = floor("residential-parking", "پارکینگ و لابی", 0, [
    ...rectangle("residential-parking-shell", -16, -12, 16, 12),
    partition("residential-lobby", -4, -12, -4, 2),
    partition("residential-storage", 6, -12, 6, 2)
  ], [door("residential-gate", "residential-parking-shell-south", 0.5, 4)], [
    obstacle("residential-car-a", "جای پارک", "vehicle", -10, 6, 4.8, 2.2, 1.6),
    obstacle("residential-car-b", "جای پارک", "vehicle", 0, 6, 4.8, 2.2, 1.6),
    obstacle("residential-car-c", "جای پارک", "vehicle", 10, 6, 4.8, 2.2, 1.6)
  ]);
  const apartment = (index: number) => floor(`residential-${index}`, `طبقه مسکونی ${index}`, index, [
    ...rectangle(`residential-${index}-shell`, -16, -12, 16, 12),
    partition(`residential-${index}-hall`, 0, -12, 0, 12),
    partition(`residential-${index}-north`, -16, -2, 16, -2),
    partition(`residential-${index}-south`, -16, 5, 16, 5),
    partition(`residential-${index}-west`, -8, -12, -8, 12),
    partition(`residential-${index}-east`, 8, -12, 8, 12)
  ], [door(`residential-${index}-entry`, `residential-${index}-shell-south`, 0.5, 1.5)]);
  return building([parking, apartment(1), apartment(2), apartment(3)]);
}

export function createSamplePlan(id: SamplePlanId): BuildingPlan {
  switch (id) {
    case "luxury-villa": return luxuryVillaPlan();
    case "modern-office": return modernOfficePlan();
    case "retail-gallery": return retailGalleryPlan();
    case "factory-campus": return factoryCampusPlan();
    case "residential-parking": return residentialParkingPlan();
  }
}

export type { SamplePlanId };
