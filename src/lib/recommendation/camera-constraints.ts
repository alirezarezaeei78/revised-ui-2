import type { CameraSpecs, ProjectBrief, ProjectZone, SurveillanceTask } from "@/src/domain/catalog/types";

export const TASK_MINIMUM_PPM: Record<SurveillanceTask, number> = {
  monitor: 25,
  "face-capture": 125,
  "face-identify": 250,
  "plate-capture": 250,
  anpr: 400
};

export const TASK_LABELS: Record<SurveillanceTask, string> = {
  monitor: "پایش و تشخیص حضور",
  "face-capture": "ثبت تصویر چهره",
  "face-identify": "شناسایی هویت چهره",
  "plate-capture": "ثبت تصویر پلاک",
  anpr: "خواندن خودکار پلاک (ANPR)"
};

const degrees = (radians: number) => radians * 180 / Math.PI;
const radians = (degreesValue: number) => degreesValue * Math.PI / 180;

export type CameraZoneEvaluation = {
  accepted: boolean;
  requiredPpm: number;
  actualPpm: number;
  requiredHorizontalFovDeg: number;
  selectedHorizontalFovDeg: number;
  actualSceneWidthM: number;
  slantDistanceM: number;
  requiredTiltDeg: number;
  verticalFovDeg: number;
  reasons: string[];
  failedConstraints: string[];
};

export function evaluateCameraForZone(specs: CameraSpecs, zone: ProjectZone, brief: Pick<ProjectBrief, "audioRequired" | "lowLightPriority" | "localRecordingFallback">): CameraZoneEvaluation {
  const heightDeltaM = Math.max(0, zone.mountingHeightM - zone.targetHeightM);
  const slantDistanceM = Math.hypot(zone.targetDistanceM, heightDeltaM);
  const requiredHorizontalFovDeg = degrees(2 * Math.atan(zone.sceneWidthM / (2 * Math.max(0.1, slantDistanceM))));
  const minimumFov = Math.min(specs.horizontalFovMin, specs.horizontalFovMax);
  const maximumFov = Math.max(specs.horizontalFovMin, specs.horizontalFovMax);
  const selectedHorizontalFovDeg = Math.max(minimumFov, Math.min(maximumFov, requiredHorizontalFovDeg));
  const actualSceneWidthM = 2 * slantDistanceM * Math.tan(radians(selectedHorizontalFovDeg) / 2);
  const actualPpm = specs.resolutionWidth / Math.max(0.1, actualSceneWidthM);
  const requiredPpm = zone.minimumPpm || TASK_MINIMUM_PPM[zone.goal];
  const verticalFovDeg = degrees(2 * Math.atan(Math.tan(radians(selectedHorizontalFovDeg) / 2) * (specs.resolutionHeight / specs.resolutionWidth)));
  const requiredTiltDeg = degrees(Math.atan2(heightDeltaM, Math.max(0.1, zone.targetDistanceM)));
  const reasons: string[] = [];
  const failedConstraints: string[] = [];

  if (requiredHorizontalFovDeg > maximumFov + 0.5) failedConstraints.push(`HFOV لازم ${requiredHorizontalFovDeg.toFixed(1)}° از حداکثر ${maximumFov.toFixed(1)}° بیشتر است.`);
  else reasons.push(`عرض ${zone.sceneWidthM}m در فاصله ${zone.targetDistanceM}m با HFOV ${selectedHorizontalFovDeg.toFixed(1)}° پوشش داده می‌شود.`);

  if (actualPpm < requiredPpm) failedConstraints.push(`تراکم ${actualPpm.toFixed(0)} PPM از حد ${requiredPpm} PPM کمتر است.`);
  else reasons.push(`${actualPpm.toFixed(0)} PPM در برابر حداقل ${requiredPpm} PPM.`);

  if (Math.abs(requiredTiltDeg - zone.cameraTiltDeg) > verticalFovDeg / 2) {
    failedConstraints.push(`هدف با Tilt ${requiredTiltDeg.toFixed(1)}° خارج از VFOV دوربین در زاویه نصب ${zone.cameraTiltDeg}° است.`);
  } else reasons.push(`ارتفاع و Tilt، هدف را داخل VFOV ${verticalFovDeg.toFixed(1)}° نگه می‌دارند.`);

  if (zone.outdoor && !/^IP6[6-9]/.test(specs.ipRating)) failedConstraints.push("درجه حفاظت برای فضای بیرونی کافی نیست.");
  if (zone.goal === "face-capture" || zone.goal === "face-identify") {
    if (!specs.aiFeatures.includes("تشخیص چهره")) failedConstraints.push("قابلیت تشخیص/ثبت چهره در مشخصات محصول نیست.");
  }
  if (zone.goal === "anpr" && !specs.aiFeatures.includes("پلاک‌خوانی")) failedConstraints.push("قابلیت ANPR در مشخصات محصول نیست.");
  if (zone.cameraConfig) {
    const config = zone.cameraConfig;
    if (specs.cameraType !== config.housing) failedConstraints.push(`نوع بدنه باید ${config.housing} باشد.`);
    if (specs.resolutionMp < config.megapixel) failedConstraints.push(`رزولوشن از تنظیم گروه (${config.megapixel}MP) کمتر است.`);
    if (config.focalMm < specs.focalMinMm || config.focalMm > specs.focalMaxMm) failedConstraints.push(`لنز ${config.focalMm}mm در بازه لنز محصول نیست.`);
    if (specs.irRangeM < config.irRangeM) failedConstraints.push(`برد IR از تنظیم گروه (${config.irRangeM}m) کمتر است.`);
    if (config.microphone && !specs.microphone) failedConstraints.push("تنظیم گروه به میکروفون داخلی نیاز دارد.");
    if (config.colorNightVision && !specs.aiFeatures.includes("دید رنگی شب")) failedConstraints.push("تنظیم گروه به دید در شب رنگی نیاز دارد.");
    if (config.weatherproof && !/^IP6[6-9]/.test(specs.ipRating)) failedConstraints.push("تنظیم گروه به بدنه مقاوم فضای باز نیاز دارد.");
  }
  if (brief.audioRequired && !specs.microphone) failedConstraints.push("میکروفون داخلی ندارد.");
  if (brief.lowLightPriority && specs.irRangeM < slantDistanceM && !specs.aiFeatures.includes("دید رنگی شب")) failedConstraints.push("برد IR از فاصله مایل هدف کمتر است.");
  if (brief.localRecordingFallback && !specs.localStorageGb) failedConstraints.push("حافظه محلی پشتیبان ندارد.");

  return {
    accepted: failedConstraints.length === 0,
    requiredPpm,
    actualPpm,
    requiredHorizontalFovDeg,
    selectedHorizontalFovDeg,
    actualSceneWidthM,
    slantDistanceM,
    requiredTiltDeg,
    verticalFovDeg,
    reasons,
    failedConstraints
  };
}
