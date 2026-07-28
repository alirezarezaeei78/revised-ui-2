import type { ProjectBrief, ProjectCameraConfig, ProjectCameraUnit, ProjectZone, SurveillanceTask } from "@/src/domain/catalog/types";
import { TASK_MINIMUM_PPM } from "@/src/lib/recommendation/camera-constraints";

const projectTypes = ["shop", "office", "factory", "parking", "residential"];
const budgets = ["economy", "balanced", "professional"];
const tasks: SurveillanceTask[] = ["monitor", "face-capture", "face-identify", "plate-capture", "anpr"];
const cameraHousings: ProjectCameraConfig["housing"][] = ["dome", "turret", "bullet", "ptz"];

const normalizeTask = (value: unknown): SurveillanceTask => {
  const task = String(value);
  if (task === "general") return "monitor";
  if (task === "face") return "face-identify";
  if (task === "plate") return "plate-capture";
  if (!tasks.includes(task as SurveillanceTask)) throw new Error("هدف نظارتی یکی از ناحیه‌ها معتبر نیست.");
  return task as SurveillanceTask;
};

export function parseProjectBrief(value: unknown): ProjectBrief {
  if (!value || typeof value !== "object") throw new Error("اطلاعات پروژه معتبر نیست.");
  const input = value as Record<string, unknown>;
  const zones = parseZones(input.zones);
  const cameraCount = zones.length ? zones.reduce((sum, zone) => sum + zone.cameraCount, 0) : Math.round(Number(input.cameraCount));
  const outdoorCount = zones.length ? zones.filter((zone) => zone.outdoor).reduce((sum, zone) => sum + zone.cameraCount, 0) : Math.round(Number(input.outdoorCount));
  const entrances = Math.round(Number(input.entrances));
  const archiveDays = Math.round(Number(input.archiveDays));
  if (!projectTypes.includes(String(input.projectType))) throw new Error("نوع پروژه معتبر نیست.");
  if (!budgets.includes(String(input.budget))) throw new Error("اولویت خرید معتبر نیست.");
  if (!Number.isFinite(cameraCount) || cameraCount < 2 || cameraCount > 64) throw new Error("تعداد دوربین باید بین ۲ تا ۶۴ باشد.");
  if (!Number.isFinite(outdoorCount) || outdoorCount < 0 || outdoorCount > cameraCount) throw new Error("تعداد دوربین بیرونی معتبر نیست.");
  if (!Number.isFinite(entrances) || entrances < 0 || entrances > 20) throw new Error("تعداد ورودی معتبر نیست.");
  if (!Number.isFinite(archiveDays) || archiveDays < 1 || archiveDays > 180) throw new Error("مدت آرشیو باید بین ۱ تا ۱۸۰ روز باشد.");

  const goal = String(input.goal) === "mixed" ? "mixed" : zones.length ? summarizeGoal(zones) : normalizeTask(input.goal);
  const siteAreaM2 = optionalNumber(input.siteAreaM2, 20, 100000);
  const floors = optionalNumber(input.floors, 1, 20);
  const maxCableRunM = optionalNumber(input.maxCableRunM, 10, 250);
  const remoteViewingUsers = optionalNumber(input.remoteViewingUsers, 1, 100);
  const upsRuntimeMinutes = optionalNumber(input.upsRuntimeMinutes, 5, 120);
  const budgetMinIrt = optionalNumber(input.budgetMinIrt, 0, 10_000_000_000);
  const budgetMaxIrt = optionalNumber(input.budgetMaxIrt, 1_000_000, 10_000_000_000);
  if (budgetMinIrt !== undefined && budgetMaxIrt !== undefined && budgetMinIrt > budgetMaxIrt) throw new Error("حداقل بودجه نمی‌تواند از حداکثر بودجه بیشتر باشد.");

  const recordingMode = input.recordingMode === "motion" ? "motion" : "continuous";
  const bitrateMode = input.bitrateMode === "CBR" ? "CBR" : "VBR";
  const motionActivityPercent = requiredNumber(input.motionActivityPercent ?? 35, 1, 100, "درصد فعالیت Motion");
  const audioBitrateKbps = requiredNumber(input.audioBitrateKbps ?? 64, 16, 320, "بیت‌ریت صدا");
  const filesystemOverheadPercent = requiredNumber(input.filesystemOverheadPercent ?? 5, 0, 50, "سربار فایل‌سیستم");
  const vbrSafetyMarginPercent = requiredNumber(input.vbrSafetyMarginPercent ?? 20, 0, 100, "حاشیه VBR");
  const reservePercent = requiredNumber(input.reservePercent ?? 10, 0, 50, "فضای رزرو");
  const recordAudio = Boolean(input.recordAudio);

  return {
    projectType: input.projectType as ProjectBrief["projectType"], cameraCount, outdoorCount, entrances,
    goal, archiveDays, budget: input.budget as ProjectBrief["budget"],
    preferredBrand: typeof input.preferredBrand === "string" ? input.preferredBrand.slice(0, 60) : undefined,
    siteAreaM2, floors, maxCableRunM, remoteViewingUsers, upsRuntimeMinutes, budgetMinIrt, budgetMaxIrt,
    recordingMode, motionActivityPercent, bitrateMode, recordAudio, audioBitrateKbps,
    filesystemOverheadPercent, vbrSafetyMarginPercent, reservePercent,
    lowLightPriority: Boolean(input.lowLightPriority), audioRequired: Boolean(input.audioRequired) || recordAudio,
    localRecordingFallback: Boolean(input.localRecordingFallback), redundancyRequired: Boolean(input.redundancyRequired), zones
  };
}

function requiredNumber(value: unknown, min: number, max: number, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`${label} خارج از محدوده مجاز است.`);
  return parsed;
}

function optionalNumber(value: unknown, min: number, max: number) {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredNumber(value, min, max, "یکی از مقادیر عددی پروژه");
}

function summarizeGoal(zones: ProjectZone[]): ProjectBrief["goal"] {
  const distinct = new Set(zones.map((zone) => zone.goal));
  return distinct.size === 1 ? zones[0].goal : "mixed";
}

function parseZones(value: unknown): ProjectZone[] {
  if (!Array.isArray(value)) return [];
  if (value.length > 20) throw new Error("حداکثر ۲۰ گروه برای هر پروژه قابل تعریف است.");
  return value.map((zone, index) => {
    if (!zone || typeof zone !== "object") throw new Error("اطلاعات یکی از ناحیه‌ها معتبر نیست.");
    const item = zone as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name.slice(0, 80).trim() : `ناحیه ${index + 1}`;
    if (!name) throw new Error("نام ناحیه نمی‌تواند خالی باشد.");
    const goal = normalizeTask(item.goal);
    const targetDistanceM = requiredNumber(item.targetDistanceM, 0.5, 500, `فاصله هدف در ناحیه ${name}`);
    const sceneWidthM = requiredNumber(item.sceneWidthM, 0.5, 200, `عرض صحنه در ناحیه ${name}`);
    const mountingHeightM = requiredNumber(item.mountingHeightM, 1.5, 30, `ارتفاع نصب در ناحیه ${name}`);
    const targetHeightM = requiredNumber(item.targetHeightM, 0, 5, `ارتفاع هدف در ناحیه ${name}`);
    const cameraTiltDeg = requiredNumber(item.cameraTiltDeg, 0, 89, `زاویه Tilt در ناحیه ${name}`);
    const minimumPpm = optionalNumber(item.minimumPpm, 10, 1_000);
    const measuredBitrateKbps = optionalNumber(item.measuredBitrateKbps, 16, 100_000);
    const cameras = parseCameraUnits(item.cameras, name, {
      targetDistanceM,
      sceneWidthM,
      mountingHeightM,
      targetHeightM,
      cameraTiltDeg,
      minimumPpm: minimumPpm || TASK_MINIMUM_PPM[goal],
      measuredBitrateKbps
    });
    const cameraCount = cameras?.length ?? Math.round(Number(item.cameraCount));
    if (!Number.isFinite(cameraCount) || cameraCount < 1 || cameraCount > 32) throw new Error("تعداد دوربین هر ناحیه باید بین ۱ تا ۳۲ باشد.");
    return {
      id: typeof item.id === "string" ? item.id.slice(0, 80) : `zone-${index}`,
      name,
      cameraCount,
      outdoor: Boolean(item.outdoor),
      goal,
      targetDistanceM,
      sceneWidthM,
      mountingHeightM,
      targetHeightM,
      cameraTiltDeg,
      minimumPpm,
      measuredBitrateKbps,
      cameras,
      cameraConfig: parseCameraConfig(item.cameraConfig, name)
    };
  });
}

function parseCameraUnits(
  value: unknown,
  zoneName: string,
  defaults: Pick<ProjectCameraUnit, "targetDistanceM" | "sceneWidthM" | "mountingHeightM" | "targetHeightM" | "cameraTiltDeg" | "minimumPpm" | "measuredBitrateKbps">
): ProjectCameraUnit[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) throw new Error(`فهرست دوربین‌های گروه ${zoneName} معتبر نیست.`);
  const ids = new Set<string>();
  return value.map((camera, index) => {
    if (!camera || typeof camera !== "object") throw new Error(`دوربین ${index + 1} در گروه ${zoneName} معتبر نیست.`);
    const item = camera as Record<string, unknown>;
    const config = parseCameraConfig(item, zoneName);
    if (!config) throw new Error(`تنظیمات دوربین ${index + 1} در گروه ${zoneName} ناقص است.`);
    const id = typeof item.id === "string" && item.id.trim() ? item.id.slice(0, 80) : `camera-${index + 1}`;
    if (ids.has(id)) throw new Error(`شناسه دوربین‌ها در گروه ${zoneName} باید یکتا باشد.`);
    ids.add(id);
    return {
      id,
      ...config,
      targetDistanceM: optionalNumber(item.targetDistanceM, 0.5, 500) ?? defaults.targetDistanceM,
      sceneWidthM: optionalNumber(item.sceneWidthM, 0.5, 200) ?? defaults.sceneWidthM,
      mountingHeightM: optionalNumber(item.mountingHeightM, 1.5, 30) ?? defaults.mountingHeightM,
      targetHeightM: optionalNumber(item.targetHeightM, 0, 5) ?? defaults.targetHeightM,
      cameraTiltDeg: optionalNumber(item.cameraTiltDeg, 0, 89) ?? defaults.cameraTiltDeg,
      minimumPpm: optionalNumber(item.minimumPpm, 10, 1_000) ?? defaults.minimumPpm,
      measuredBitrateKbps: optionalNumber(item.measuredBitrateKbps, 16, 100_000) ?? defaults.measuredBitrateKbps
    };
  });
}

function parseCameraConfig(value: unknown, zoneName: string): ProjectCameraConfig | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") throw new Error(`تنظیمات دوربین گروه ${zoneName} معتبر نیست.`);
  const item = value as Record<string, unknown>;
  const housing = String(item.housing) as ProjectCameraConfig["housing"];
  if (!cameraHousings.includes(housing)) throw new Error(`نوع بدنه دوربین گروه ${zoneName} معتبر نیست.`);
  const label = typeof item.label === "string" ? item.label.slice(0, 80).trim() : "";
  if (!label) throw new Error(`نام دوربین گروه ${zoneName} نمی‌تواند خالی باشد.`);
  return {
    label,
    housing,
    megapixel: requiredNumber(item.megapixel, 1, 32, `رزولوشن دوربین گروه ${zoneName}`),
    sensorWidthMm: requiredNumber(item.sensorWidthMm, 1, 20, `عرض سنسور دوربین گروه ${zoneName}`),
    focalMm: requiredNumber(item.focalMm, 1, 120, `لنز دوربین گروه ${zoneName}`),
    irRangeM: requiredNumber(item.irRangeM, 0, 300, `برد IR دوربین گروه ${zoneName}`),
    maxRangeM: requiredNumber(item.maxRangeM, 2, 300, `برد مؤثر دوربین گروه ${zoneName}`),
    microphone: Boolean(item.microphone),
    colorNightVision: Boolean(item.colorNightVision),
    weatherproof: Boolean(item.weatherproof)
  };
}
