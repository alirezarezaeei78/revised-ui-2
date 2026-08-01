import type { ObstacleKind, ObstacleVariant, PlanObstacle } from "@/src/domain/planner/types";

export type ObstaclePreset = {
  id: ObstacleVariant;
  group: "vehicle" | "tree" | "structure";
  label: string;
  description: string;
  kind: ObstacleKind;
  widthM: number;
  depthM: number;
  heightM: number;
};

export const obstaclePresets: ObstaclePreset[] = [
  { id: "sedan", group: "vehicle", label: "خودروی سواری", description: "سدان شهری", kind: "vehicle", widthM: 4.5, depthM: 1.8, heightM: 1.45 },
  { id: "suv", group: "vehicle", label: "شاسی‌بلند", description: "خودروی SUV", kind: "vehicle", widthM: 4.8, depthM: 1.95, heightM: 1.8 },
  { id: "pickup", group: "vehicle", label: "وانت", description: "کابین و فضای بار", kind: "vehicle", widthM: 5.3, depthM: 1.9, heightM: 1.75 },
  { id: "van", group: "vehicle", label: "ون", description: "خودروی خدماتی", kind: "vehicle", widthM: 5.4, depthM: 2.05, heightM: 2.45 },
  { id: "truck", group: "vehicle", label: "کامیون", description: "خودروی سنگین", kind: "vehicle", widthM: 8.2, depthM: 2.5, heightM: 3.35 },
  { id: "deciduous", group: "tree", label: "درخت پهن‌برگ", description: "تاج گرد و متراکم", kind: "tree", widthM: 4.5, depthM: 4.5, heightM: 6 },
  { id: "conifer", group: "tree", label: "درخت سوزنی‌برگ", description: "فرم مخروطی", kind: "tree", widthM: 3.2, depthM: 3.2, heightM: 7 },
  { id: "palm", group: "tree", label: "نخل", description: "تنه بلند و تاج باز", kind: "tree", widthM: 4, depthM: 4, heightM: 7.5 },
  { id: "stairs-straight", group: "structure", label: "راه‌پله مستقیم", description: "اتصال عمودی طبقات", kind: "stairs", widthM: 4.2, depthM: 1.4, heightM: 3.2 }
];

export function obstaclePreset(variant?: ObstacleVariant) {
  return obstaclePresets.find((item) => item.id === variant);
}

export function applyObstaclePreset(obstacle: PlanObstacle, preset: ObstaclePreset): PlanObstacle {
  return {
    ...obstacle,
    label: preset.label,
    kind: preset.kind,
    variant: preset.id,
    widthM: preset.widthM,
    depthM: preset.depthM,
    heightM: preset.heightM,
    blocksView: true
  };
}
