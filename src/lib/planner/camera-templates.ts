import type {
  CameraHousing,
  CameraStreamConfig,
  ProjectCameraTemplate,
  ProjectCameraUnit,
  ProjectZone,
  StreamQuality,
  SurveillanceTask,
  VideoCodec
} from "@/src/domain/catalog/types";
import type { BuildingPlan, PlanCamera, Vec2 } from "@/src/domain/planner/types";
import { defaultCameraOptics } from "@/src/domain/planner/types";
import { TASK_MINIMUM_PPM } from "@/src/lib/recommendation/camera-constraints";
import { doriDetectRangeM } from "@/src/lib/planner/coverage";
import { horizontalFovDeg, sceneWidthAtDistanceM } from "@/src/lib/calculators/optics";

/**
 * Device types and their encoder settings.
 *
 * The wizard defines a handful of camera types once, then drops them onto the plan as
 * many times as needed. Everything a placement needs to exist independently is copied at
 * drop time, so later edits to a template never silently rewrite cameras already sited.
 */

export const codecLabels: Record<VideoCodec, string> = {
  "H.264": "H.264 (AVC)",
  "H.265": "H.265 (HEVC)",
  "H.265+": "H.265+ / Smart"
};

export const qualityLabels: Record<StreamQuality, string> = {
  standard: "استاندارد",
  high: "بالا",
  highest: "بیشینه"
};

export const housingLabels: Record<CameraHousing, string> = {
  dome: "دام سقفی",
  turret: "تورت",
  bullet: "بولت",
  ptz: "چرخشی PTZ"
};

/**
 * Codec efficiency relative to H.264 at equal perceived quality.
 *
 * H.265 saves roughly 40–50%; H.265+ adds ROI encoding and long GOP on top, which only
 * pays off in low-motion scenes. The conservative 0.42 keeps sizing honest rather than
 * quoting the vendor best case.
 */
const codecFactor: Record<VideoCodec, number> = {
  "H.264": 1,
  "H.265": 0.55,
  "H.265+": 0.42
};

const qualityFactor: Record<StreamQuality, number> = {
  standard: 0.8,
  high: 1,
  highest: 1.3
};

/**
 * Reference H.264 bitrate at 25 fps, in kbps, keyed by nominal megapixel.
 * Interpolated between anchors so unusual sensors still land somewhere sensible.
 */
const referenceAnchors: [number, number][] = [
  [1, 2_048],
  [2, 4_096],
  [3, 5_500],
  [4, 8_192],
  [5, 10_240],
  [6, 12_000],
  [8, 16_384],
  [12, 22_000]
];

/**
 * Estimated main-stream bitrate.
 *
 * Frame rate scales sub-linearly: halving fps does not halve bitrate because intra
 * frames and scene detail dominate at low rates. The exponent of 0.7 matches the
 * behaviour published for typical surveillance encoders closely enough for sizing.
 */
export function estimateBitrateKbps(
  megapixel: number,
  codec: VideoCodec,
  fps: number,
  quality: StreamQuality
): number {
  const clampedMp = Math.max(0.3, megapixel);
  let base = clampedMp * 2_048;
  for (let index = 0; index < referenceAnchors.length; index += 1) {
    if (clampedMp <= referenceAnchors[index][0]) {
      if (index === 0) { base = referenceAnchors[0][1] * (clampedMp / referenceAnchors[0][0]); break; }
      const [lowMp, lowKbps] = referenceAnchors[index - 1];
      const [highMp, highKbps] = referenceAnchors[index];
      base = lowKbps + ((clampedMp - lowMp) / (highMp - lowMp)) * (highKbps - lowKbps);
      break;
    }
  }
  const fpsFactor = Math.pow(Math.max(1, fps) / 25, 0.7);
  return Math.round(base * codecFactor[codec] * qualityFactor[quality] * fpsFactor);
}

export const defaultStreamConfig: CameraStreamConfig = {
  codec: "H.265",
  fps: 20,
  bitrateMode: "VBR",
  bitrateKbps: estimateBitrateKbps(4, "H.265", 20, "high"),
  quality: "high",
  audioEnabled: false,
  recordingMode: "continuous",
  motionActivityPercent: 40
};

/** Effective archive load: motion recording only writes while the scene is active. */
export function effectiveBitrateKbps(stream: CameraStreamConfig): number {
  const duty = stream.recordingMode === "continuous"
    ? 1
    : Math.max(0.01, Math.min(1, stream.motionActivityPercent / 100));
  const audio = stream.audioEnabled ? 64 : 0;
  return Math.round((stream.bitrateKbps + audio) * duty);
}

const templateSeeds: Omit<ProjectCameraTemplate, "id" | "stream">[] = [
  {
    label: "دوربین داخلی عمومی",
    housing: "turret",
    goal: "monitor",
    outdoor: false,
    quantity: 4,
    megapixel: 4,
    sensorWidthMm: 5.12,
    focalMm: 2.8,
    irRangeM: 30,
    maxRangeM: 30,
    mountingHeightM: 3,
    cameraTiltDeg: 12,
    microphone: false,
    colorNightVision: false,
    weatherproof: false
  },
  {
    label: "دوربین ورودی و چهره",
    housing: "bullet",
    goal: "face-identify",
    outdoor: false,
    quantity: 2,
    megapixel: 5,
    sensorWidthMm: 5.12,
    focalMm: 8,
    irRangeM: 40,
    maxRangeM: 25,
    mountingHeightM: 2.8,
    cameraTiltDeg: 15,
    microphone: true,
    colorNightVision: true,
    weatherproof: false
  },
  {
    label: "دوربین محوطه بیرونی",
    housing: "bullet",
    goal: "monitor",
    outdoor: true,
    quantity: 2,
    megapixel: 4,
    sensorWidthMm: 5.12,
    focalMm: 4,
    irRangeM: 50,
    maxRangeM: 45,
    mountingHeightM: 4,
    cameraTiltDeg: 10,
    microphone: false,
    colorNightVision: true,
    weatherproof: true
  }
];

export function createTemplate(seed: Partial<ProjectCameraTemplate> = {}): ProjectCameraTemplate {
  const base = templateSeeds[0];
  const merged = { ...base, ...seed };
  const stream = seed.stream ?? {
    ...defaultStreamConfig,
    bitrateKbps: estimateBitrateKbps(merged.megapixel, defaultStreamConfig.codec, defaultStreamConfig.fps, defaultStreamConfig.quality)
  };
  return {
    ...merged,
    id: seed.id ?? `tpl-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
    stream
  };
}

export function defaultCameraTemplates(): ProjectCameraTemplate[] {
  return templateSeeds.map((seed, index) =>
    createTemplate({
      ...seed,
      id: `tpl-default-${index + 1}`,
      stream: {
        ...defaultStreamConfig,
        bitrateKbps: estimateBitrateKbps(seed.megapixel, defaultStreamConfig.codec, defaultStreamConfig.fps, defaultStreamConfig.quality)
      }
    })
  );
}

/**
 * Effective range that still shows all four DORI zones.
 *
 * A hand-picked range shorter than the detect distance silently deletes the outer bands,
 * which is why some cameras drew only two or three regions. Defaulting to the optics-derived
 * detect distance keeps the full progression visible; the user can still shorten it.
 */
export function fittedRangeM(template: Pick<ProjectCameraTemplate, "megapixel" | "focalMm" | "sensorWidthMm" | "maxRangeM">): number {
  const detect = doriDetectRangeM(template.megapixel, template.focalMm, template.sensorWidthMm);
  if (!Number.isFinite(detect) || detect <= 0) return template.maxRangeM;
  return Math.round(Math.max(template.maxRangeM, Math.min(detect, 120)) * 10) / 10;
}

/** Builds an independent placement from a device type. */
export function cameraFromTemplate(
  template: ProjectCameraTemplate,
  position: Vec2,
  index: number,
  mountHeightOverrideM?: number
): PlanCamera {
  return {
    id: `cam-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
    templateId: template.id,
    name: `${template.label} ${index}`,
    groupName: template.label,
    housing: template.housing,
    outdoor: template.outdoor,
    features: {
      microphone: template.microphone,
      colorNightVision: template.colorNightVision,
      weatherproof: template.weatherproof
    },
    stream: { ...template.stream },
    position,
    yawDeg: 0,
    goal: template.goal,
    optics: {
      ...defaultCameraOptics,
      megapixel: template.megapixel,
      sensorWidthMm: template.sensorWidthMm,
      focalMm: template.focalMm,
      mountHeightM: mountHeightOverrideM ?? template.mountingHeightM,
      tiltDeg: template.cameraTiltDeg,
      irRangeM: template.irRangeM,
      maxRangeM: fittedRangeM(template)
    }
  };
}

/** Blank camera for positions that do not match any defined type. */
export function createBlankCamera(position: Vec2, index: number, mountHeightM: number): PlanCamera {
  return {
    id: `cam-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
    name: `دوربین ${index}`,
    groupName: "بدون نوع",
    housing: "turret",
    outdoor: false,
    features: { microphone: false, colorNightVision: false, weatherproof: false },
    stream: { ...defaultStreamConfig },
    position,
    yawDeg: 0,
    goal: "monitor",
    optics: { ...defaultCameraOptics, mountHeightM }
  };
}

export function planCameras(plan: BuildingPlan): { floorId: string; floorName: string; camera: PlanCamera }[] {
  return plan.floors.flatMap((floor) =>
    floor.cameras.map((camera) => ({ floorId: floor.id, floorName: floor.name, camera }))
  );
}

/**
 * Scene width the camera actually sees at its working distance.
 *
 * Needed because the engine reasons in PPM, which is pixels divided by scene width; a
 * placement stores optics and range instead, so the width is recovered here rather than
 * asked of the user twice.
 */
function sceneWidthFor(camera: PlanCamera, workingDistanceM: number): number {
  const fov = horizontalFovDeg(camera.optics.focalMm, camera.optics.sensorWidthMm);
  return Math.max(0.5, sceneWidthAtDistanceM(workingDistanceM, fov));
}

function unitFromCamera(camera: PlanCamera, index: number): ProjectCameraUnit {
  const stream = camera.stream ?? defaultStreamConfig;
  // Working distance is the useful reach rather than the hard cap: quality is quoted at
  // the range the camera is actually expected to do its job, not at its absolute limit.
  const workingDistanceM = Math.max(2, camera.optics.maxRangeM * 0.7);
  const targetHeightM = camera.goal === "anpr" || camera.goal === "plate-capture" ? 0.8 : 1.6;
  return {
    id: camera.id || `camera-${index + 1}`,
    label: camera.name || `دوربین ${index + 1}`,
    housing: camera.housing ?? "turret",
    megapixel: camera.optics.megapixel,
    sensorWidthMm: camera.optics.sensorWidthMm,
    focalMm: camera.optics.focalMm,
    irRangeM: camera.optics.irRangeM,
    maxRangeM: camera.optics.maxRangeM,
    microphone: camera.features?.microphone ?? false,
    colorNightVision: camera.features?.colorNightVision ?? false,
    weatherproof: camera.features?.weatherproof ?? Boolean(camera.outdoor),
    stream,
    targetDistanceM: workingDistanceM,
    sceneWidthM: sceneWidthFor(camera, workingDistanceM),
    mountingHeightM: camera.optics.mountHeightM,
    targetHeightM,
    cameraTiltDeg: camera.optics.tiltDeg,
    minimumPpm: TASK_MINIMUM_PPM[camera.goal],
    measuredBitrateKbps: effectiveBitrateKbps(stream)
  };
}

function unitFromTemplate(template: ProjectCameraTemplate, index: number): ProjectCameraUnit {
  const workingDistanceM = Math.max(2, template.maxRangeM * 0.7);
  const fov = horizontalFovDeg(template.focalMm, template.sensorWidthMm);
  return {
    id: `${template.id}-${index + 1}`,
    label: template.quantity > 1 ? `${template.label} ${index + 1}` : template.label,
    housing: template.housing,
    megapixel: template.megapixel,
    sensorWidthMm: template.sensorWidthMm,
    focalMm: template.focalMm,
    irRangeM: template.irRangeM,
    maxRangeM: template.maxRangeM,
    microphone: template.microphone,
    colorNightVision: template.colorNightVision,
    weatherproof: template.weatherproof,
    stream: template.stream,
    targetDistanceM: workingDistanceM,
    sceneWidthM: Math.max(0.5, sceneWidthAtDistanceM(workingDistanceM, fov)),
    mountingHeightM: template.mountingHeightM,
    targetHeightM: template.goal === "anpr" || template.goal === "plate-capture" ? 0.8 : 1.6,
    cameraTiltDeg: template.cameraTiltDeg,
    minimumPpm: TASK_MINIMUM_PPM[template.goal],
    measuredBitrateKbps: effectiveBitrateKbps(template.stream)
  };
}

function zoneShellFor(id: string, name: string, goal: SurveillanceTask, outdoor: boolean, units: ProjectCameraUnit[]): ProjectZone {
  const first = units[0];
  return {
    id,
    name,
    cameraCount: units.length,
    outdoor,
    goal,
    targetDistanceM: first?.targetDistanceM ?? 10,
    sceneWidthM: first?.sceneWidthM ?? 8,
    mountingHeightM: first?.mountingHeightM ?? 3,
    targetHeightM: first?.targetHeightM ?? 1.6,
    cameraTiltDeg: first?.cameraTiltDeg ?? 12,
    minimumPpm: TASK_MINIMUM_PPM[goal],
    cameras: units
  };
}

/**
 * Zones for the recommendation engine, built from the sited cameras.
 *
 * The engine still reasons in zones, so placements are grouped by floor and goal. Each
 * camera keeps its own unit record, and the engine expands zones back to one entry per
 * camera — so grouping here is bookkeeping, not a loss of per-camera fidelity.
 */
export function zonesFromPlan(plan: BuildingPlan): ProjectZone[] {
  const zones: ProjectZone[] = [];
  for (const floor of plan.floors) {
    if (!floor.cameras.length) continue;
    const byGoal = new Map<string, PlanCamera[]>();
    for (const camera of floor.cameras) {
      const key = `${camera.goal}|${camera.outdoor ? "out" : "in"}`;
      const bucket = byGoal.get(key);
      if (bucket) bucket.push(camera);
      else byGoal.set(key, [camera]);
    }
    for (const [key, cameras] of byGoal) {
      const [goal, exposure] = key.split("|");
      const units = cameras.map(unitFromCamera);
      zones.push(zoneShellFor(
        `${floor.id}-${goal}-${exposure}`,
        `${floor.name} — ${cameras[0].groupName || "دوربین‌ها"}`,
        goal as SurveillanceTask,
        exposure === "out",
        units
      ));
    }
  }
  return zones;
}

/** Fallback for the quick-estimate path, where nothing has been placed on a map. */
export function zonesFromTemplates(templates: ProjectCameraTemplate[]): ProjectZone[] {
  return templates
    .filter((template) => template.quantity > 0)
    .map((template) =>
      zoneShellFor(
        template.id,
        template.label,
        template.goal,
        template.outdoor,
        Array.from({ length: Math.max(1, template.quantity) }, (_, index) => unitFromTemplate(template, index))
      )
    );
}
