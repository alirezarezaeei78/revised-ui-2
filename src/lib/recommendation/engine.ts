import type {
  CameraSpecs, CatalogProduct, ProductEvaluation, ProjectBrief, ProjectZone, RecommendationPlan,
  RecommendationResult, RecorderSpecs, StorageSpecs, SwitchSpecs, UpsSpecs
} from "@/src/domain/catalog/types";
import { calculateUpsRequirements, evaluateUps } from "@/src/lib/calculators/power";
import { calculateRaidUsable, type RaidLevel } from "@/src/lib/calculators/raid";
import { calculateSurveillanceStorage } from "@/src/lib/calculators/storage";
import { evaluateCameraForZone, TASK_LABELS, TASK_MINIMUM_PPM, type CameraZoneEvaluation } from "@/src/lib/recommendation/camera-constraints";
import { buildEngineeringMap, calculateInfrastructure } from "@/src/lib/recommendation/engineering-layout";
import type { BitrateCalibrationFactors } from "@/src/lib/calibration/bitrate";

export const RECOMMENDATION_ENGINE_VERSION = "3.0.0";
export const RECOMMENDATION_INPUT_VERSION = "2.0.0";
export const RECOMMENDATION_STANDARDS = ["IEC 62676-4:2014 (PPM/DORI)", "RFC 3021 (/31)", "IEEE 802.3 PoE/Ethernet design limits"];

const planProfiles = [
  { id: "economy", title: "اقتصادی", subtitle: "کم‌هزینه‌ترین ترکیب عبوری از قیود محاسبه‌شده", ppmFactor: 1, expansion: 1, raid: false, ups: false },
  { id: "balanced", title: "متعادل", subtitle: "حاشیه بیشتر تصویر و ظرفیت با هزینه کنترل‌شده", ppmFactor: 1.15, expansion: 1.25, raid: false, ups: true },
  { id: "professional", title: "حرفه‌ای", subtitle: "PPM، افزونگی و توسعه‌پذیری بالاتر", ppmFactor: 1.35, expansion: 1.6, raid: true, ups: true }
] as const;

type PlanProfile = (typeof planProfiles)[number];
type CameraSelection = { zone: ProjectZone; product: CatalogProduct; specs: CameraSpecs; evaluation: CameraZoneEvaluation; relaxed?: boolean };
type StorageSelection = { storage: CatalogProduct; driveCount: number; raidLevel: RaidLevel; hotSpareCount: number; rawTb: number; usableTb: number; cost: number };
type RecorderStorageSelection = StorageSelection & { recorder: CatalogProduct; codec: string };
type SwitchSelection = { product: CatalogProduct; quantity: number; poeBudgetW: number; expansionPorts: number };

const round = (value: number, digits = 1) => Number(value.toFixed(digits));
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const productCost = (product: CatalogProduct, quantity = 1) => product.price * quantity;
const available = (product: CatalogProduct) => product.stockStatus !== "out_of_stock" && product.price > 0;
const unavailableReason = (product: CatalogProduct) => product.stockStatus === "out_of_stock" ? "محصول ناموجود است." : "قیمت معتبر برای این محصول ثبت نشده است.";

function inputFingerprint(brief: ProjectBrief) {
  const value = JSON.stringify(brief);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function calculationMetadata(brief: ProjectBrief) {
  return { engineVersion: RECOMMENDATION_ENGINE_VERSION, inputVersion: RECOMMENDATION_INPUT_VERSION, standardVersions: RECOMMENDATION_STANDARDS, inputFingerprint: inputFingerprint(brief) };
}

function zoneWithProfilePpm(zone: ProjectZone, profile: PlanProfile): ProjectZone {
  const basePpm = zone.minimumPpm || TASK_MINIMUM_PPM[zone.goal];
  return { ...zone, minimumPpm: Math.round(basePpm * profile.ppmFactor) };
}

/** One catalog camera is selected per independently configured camera row. */
function expandCameraZones(zones: ProjectZone[]): ProjectZone[] {
  return zones.flatMap((zone) => {
    if (!zone.cameras?.length) return [zone];
    return zone.cameras.map((camera) => ({
      ...zone,
      id: `${zone.id}-${camera.id}`,
      name: `${zone.name} / ${camera.label}`,
      cameraCount: 1,
      cameras: [camera],
      targetDistanceM: camera.targetDistanceM,
      sceneWidthM: camera.sceneWidthM,
      mountingHeightM: camera.mountingHeightM,
      targetHeightM: camera.targetHeightM,
      cameraTiltDeg: camera.cameraTiltDeg,
      minimumPpm: camera.minimumPpm,
      measuredBitrateKbps: camera.measuredBitrateKbps,
      cameraConfig: {
        label: camera.label,
        housing: camera.housing,
        megapixel: camera.megapixel,
        sensorWidthMm: camera.sensorWidthMm,
        focalMm: camera.focalMm,
        irRangeM: camera.irRangeM,
        maxRangeM: camera.maxRangeM,
        microphone: camera.microphone,
        colorNightVision: camera.colorNightVision,
        weatherproof: camera.weatherproof
      }
    }));
  });
}

function evaluateCameraProduct(product: CatalogProduct, zones: ProjectZone[], brief: ProjectBrief) {
  const specs = product.specs as CameraSpecs;
  return zones.map((zone) => ({ zone, evaluation: evaluateCameraForZone(specs, zone, brief) }));
}

function selectCameras(products: CatalogProduct[], zones: ProjectZone[], brief: ProjectBrief, profile: PlanProfile) {
  const selections: CameraSelection[] = [];
  for (const originalZone of zones) {
    const zone = zoneWithProfilePpm(originalZone, profile);
    const candidates = products
      .filter((product) => product.category === "camera" && available(product))
      .map((product) => ({ product, specs: product.specs as CameraSpecs, evaluation: evaluateCameraForZone(product.specs as CameraSpecs, zone, brief) }))
      .sort((a, b) => {
        const acceptedA = a.evaluation.accepted ? 0 : 1;
        const acceptedB = b.evaluation.accepted ? 0 : 1;
        const preferredA = brief.preferredBrand && a.product.brand === brief.preferredBrand ? 0 : 1;
        const preferredB = brief.preferredBrand && b.product.brand === brief.preferredBrand ? 0 : 1;
        return acceptedA - acceptedB
          || a.evaluation.failedConstraints.length - b.evaluation.failedConstraints.length
          || preferredA - preferredB
          || productCost(a.product) - productCost(b.product)
          || b.evaluation.actualPpm - a.evaluation.actualPpm;
      });
    const selected = candidates[0];
    if (!selected) return { selections: [], failedZone: zone };
    // A sparse live catalogue should not collapse the complete engineering result.
    // Keep the closest in-stock item, but carry every failed constraint into the UI so
    // it is visibly a review candidate rather than a falsely certified match.
    selections.push({ zone, ...selected, relaxed: !selected.evaluation.accepted });
  }
  return { selections };
}

function normalizedRaidLevels(specs: RecorderSpecs): RaidLevel[] {
  return specs.raidLevels
    .map((value) => value.replace(/RAID\s*/i, "") as RaidLevel)
    .filter((value): value is RaidLevel => ["0", "1", "5", "6", "10"].includes(value));
}

function recorderRuntimeSpecs(specs: RecorderSpecs) {
  return {
    outgoingBandwidthMbps: specs.outgoingBandwidthMbps || specs.incomingBandwidthMbps * 0.5,
    decodeCapacityMp: specs.decodeCapacityMp || specs.maxDecodeMp * Math.min(specs.channels, 8),
    maxSimultaneousDecodeChannels: specs.maxSimultaneousDecodeChannels || Math.min(specs.channels, 16)
  };
}

function commonCodec(cameraSelections: CameraSelection[], recorderSpecs: RecorderSpecs) {
  return recorderSpecs.codecs.find((codec) => cameraSelections.every((camera) => camera.specs.codecs.includes(codec)));
}

function recorderFailures(
  specs: RecorderSpecs,
  cameraSelections: CameraSelection[],
  requiredChannels: number,
  incomingBandwidthMbps: number,
  outgoingBandwidthMbps: number,
  decodeDemandMp: number,
  simultaneousDecodeChannels: number
) {
  const runtime = recorderRuntimeSpecs(specs);
  const failures: string[] = [];
  if (specs.channels < requiredChannels) failures.push(`کانال ${specs.channels} < ${requiredChannels}`);
  if (specs.incomingBandwidthMbps < incomingBandwidthMbps * 1.2) failures.push(`ورودی ${specs.incomingBandwidthMbps}Mbps کمتر از نیاز با حاشیه ۲۰٪ است.`);
  if (runtime.outgoingBandwidthMbps < outgoingBandwidthMbps * 1.2) failures.push(`خروجی ${round(runtime.outgoingBandwidthMbps)}Mbps کمتر از نیاز Remote است.`);
  if (runtime.decodeCapacityMp < decodeDemandMp) failures.push(`Decode ${round(runtime.decodeCapacityMp)}MP کمتر از تقاضای ${round(decodeDemandMp)}MP است.`);
  if (runtime.maxSimultaneousDecodeChannels < simultaneousDecodeChannels) failures.push(`Decode هم‌زمان ${runtime.maxSimultaneousDecodeChannels} کانال کمتر از ${simultaneousDecodeChannels} است.`);
  const maxResolution = Math.max(...cameraSelections.map((camera) => camera.specs.resolutionMp));
  if (specs.maxCameraResolutionMp < maxResolution) failures.push(`حداکثر وضوح ${specs.maxCameraResolutionMp}MP کمتر از دوربین ${maxResolution}MP است.`);
  if (!commonCodec(cameraSelections, specs)) failures.push("Codec مشترک با تمام دوربین‌های انتخابی ندارد.");
  return failures;
}

function storageOptions(
  products: CatalogProduct[], recorder: CatalogProduct, requiredStorageTb: number,
  requireRaid: boolean, professional: boolean
): StorageSelection[] {
  const specs = recorder.specs as RecorderSpecs;
  const availableLevels = normalizedRaidLevels(specs);
  const levels = requireRaid
    ? (["6", "10", "5", "1"] as RaidLevel[]).filter((level) => availableLevels.includes(level))
    : (["none"] as RaidLevel[]);
  const options: StorageSelection[] = [];
  for (const storage of products.filter((product) => product.category === "storage" && available(product))) {
    const drive = storage.specs as StorageSpecs;
    if (drive.capacityTb > specs.maxDriveCapacityTb) continue;
    for (const raidLevel of levels) {
      for (let driveCount = 1; driveCount <= specs.driveBays; driveCount += 1) {
        const hotSpareCount = professional && requireRaid ? 1 : 0;
        const capacity = calculateRaidUsable(Array.from({ length: driveCount }, () => drive.capacityTb), raidLevel, hotSpareCount);
        if (!capacity.valid || capacity.usableTb < requiredStorageTb) continue;
        options.push({ storage, driveCount, raidLevel, hotSpareCount, rawTb: capacity.rawTb, usableTb: capacity.usableTb, cost: productCost(storage, driveCount) });
      }
    }
  }
  return options.sort((a, b) => a.cost - b.cost || a.rawTb - b.rawTb);
}

function selectRecorderAndStorage(
  products: CatalogProduct[], cameraSelections: CameraSelection[], profile: PlanProfile,
  incomingBandwidthMbps: number, outgoingBandwidthMbps: number, decodeDemandMp: number,
  simultaneousDecodeChannels: number, requiredStorageTb: number, requireRaid: boolean
): RecorderStorageSelection | undefined {
  const requiredChannels = Math.min(80, Math.ceil(cameraSelections.reduce((sum, item) => sum + item.zone.cameraCount, 0) * profile.expansion));
  const candidates: Array<RecorderStorageSelection & { totalCost: number }> = [];
  for (const recorder of products.filter((product) => product.category === "recorder" && available(product))) {
    const specs = recorder.specs as RecorderSpecs;
    const failures = recorderFailures(specs, cameraSelections, requiredChannels, incomingBandwidthMbps, outgoingBandwidthMbps, decodeDemandMp, simultaneousDecodeChannels);
    if (requireRaid && normalizedRaidLevels(specs).length === 0) failures.push("RAID پشتیبانی نمی‌شود.");
    if (failures.length) continue;
    const storage = storageOptions(products, recorder, requiredStorageTb, requireRaid, profile.id === "professional")[0];
    const codec = commonCodec(cameraSelections, specs);
    if (!storage || !codec) continue;
    candidates.push({ recorder, codec, ...storage, totalCost: productCost(recorder) + storage.cost });
  }
  return candidates.sort((a, b) => a.totalCost - b.totalCost)[0];
}

function switchCandidate(
  product: CatalogProduct, cameraCount: number, floorCount: number, poeLoadW: number,
  maxCameraW: number, bandwidthMbps: number, professional: boolean, maxCableRunM: number
): { selection?: SwitchSelection; failures: string[] } {
  const specs = product.specs as SwitchSpecs;
  const failures: string[] = [];
  if (!available(product)) failures.push(unavailableReason(product));
  if (specs.maxPowerPerPortW < maxCameraW) failures.push(`توان هر پورت ${specs.maxPowerPerPortW}W کمتر از ${maxCameraW}W است.`);
  if (professional && !specs.managed) failures.push("برای پلن حرفه‌ای Managed نیست.");
  if (maxCableRunM > 100 && specs.extendRangeM < maxCableRunM) failures.push("برد کابل اعلام‌شده کمتر از مسیر پروژه است.");
  if (specs.uplinkGbps * 1_000 < (bandwidthMbps / floorCount) * 1.2) failures.push("Uplink هر طبقه کمتر از ترافیک با حاشیه ۲۰٪ است.");
  if (failures.length) return { failures };

  let quantity = Math.max(1, floorCount);
  while (quantity <= cameraCount) {
    const camerasPerSwitch = Math.ceil(cameraCount / quantity);
    const powerPerSwitch = poeLoadW / quantity;
    if (camerasPerSwitch <= specs.poePorts && powerPerSwitch * 1.2 <= specs.poeBudgetW) break;
    quantity += 1;
  }
  if (quantity > cameraCount) return { failures: ["ترکیب تعداد پورت و بودجه PoE برای توزیع طبقات کافی نیست."] };
  return {
    failures,
    selection: { product, quantity, poeBudgetW: specs.poeBudgetW * quantity, expansionPorts: specs.poePorts * quantity - cameraCount }
  };
}

function selectSwitch(
  products: CatalogProduct[], cameraCount: number, floorCount: number, poeLoadW: number,
  maxCameraW: number, bandwidthMbps: number, professional: boolean, maxCableRunM: number
) {
  return products
    .filter((product) => product.category === "switch")
    .map((product) => switchCandidate(product, cameraCount, floorCount, poeLoadW, maxCameraW, bandwidthMbps, professional, maxCableRunM).selection)
    .filter((selection): selection is SwitchSelection => Boolean(selection))
    .sort((a, b) => productCost(a.product, a.quantity) - productCost(b.product, b.quantity))[0];
}

function calculateUpsLoadW(poeLoadW: number, networkSwitch: SwitchSelection, recorder: CatalogProduct, storage: CatalogProduct, driveCount: number) {
  const switchSpecs = networkSwitch.product.specs as SwitchSpecs;
  const recorderSpecs = recorder.specs as RecorderSpecs;
  const storageSpecs = storage.specs as StorageSpecs;
  const switchInputW = poeLoadW / (switchSpecs.poeEfficiency || 0.9) + (switchSpecs.systemPowerW || 12) * networkSwitch.quantity;
  const recorderAndDrivesW = (recorderSpecs.basePowerW || 25) + (storageSpecs.activePowerW || recorderSpecs.drivePowerPerBayW || 9) * driveCount;
  return switchInputW + recorderAndDrivesW + 12;
}

function selectUps(products: CatalogProduct[], loadW: number, runtimeMin: number) {
  return products
    .filter((product) => product.category === "ups" && available(product))
    .map((product) => ({ product, evaluation: evaluateUps(product.specs as UpsSpecs, loadW, runtimeMin) }))
    .filter(({ evaluation }) => evaluation.wattCapacityOk && evaluation.vaCapacityOk && evaluation.runtimeOk)
    .sort((a, b) => productCost(a.product) - productCost(b.product))[0];
}

function remoteRequirements(cameraSelections: CameraSelection[], remoteUsers: number) {
  const expanded = cameraSelections.flatMap((selection) => Array.from({ length: selection.zone.cameraCount }, () => selection.specs));
  const simultaneousDecodeChannels = Math.min(expanded.length, Math.max(1, remoteUsers) * 4);
  const viewed = [...expanded].sort((a, b) => b.resolutionMp - a.resolutionMp).slice(0, simultaneousDecodeChannels);
  const decodeDemandMp = viewed.reduce((sum, specs) => sum + specs.resolutionMp * Math.min(1, specs.maxFps / 25), 0);
  const outgoingBandwidthMbps = viewed.reduce((sum, specs) => sum + specs.recommendedBitrateKbps * 0.25, 0) / 1_000;
  return { simultaneousDecodeChannels, decodeDemandMp, outgoingBandwidthMbps };
}

function cameraEvaluations(products: CatalogProduct[], zones: ProjectZone[], brief: ProjectBrief, selectedIds: Set<string>): ProductEvaluation[] {
  return products.filter((product) => product.category === "camera").map((product) => {
    if (!available(product)) return { productId: product.id, productName: product.name, category: product.category, status: "rejected", reasons: [], failedConstraints: [unavailableReason(product)] };
    const evaluations = evaluateCameraProduct(product, zones, brief);
    const passed = evaluations.filter(({ evaluation }) => evaluation.accepted);
    const selected = selectedIds.has(product.id);
    return {
      productId: product.id, productName: product.name, category: product.category,
      status: selected ? "selected" : passed.length ? "accepted" : "rejected",
      reasons: passed.map(({ zone, evaluation }) => `${zone.name}: ${round(evaluation.actualPpm)} PPM و پوشش هندسی معتبر`),
      failedConstraints: passed.length ? [] : evaluations.flatMap(({ zone, evaluation }) => evaluation.failedConstraints.slice(0, 2).map((reason) => `${zone.name}: ${reason}`))
    };
  });
}

function catalogEvaluations(
  products: CatalogProduct[], plan: RecommendationPlan, cameraSelections: CameraSelection[], zones: ProjectZone[], brief: ProjectBrief,
  profile: PlanProfile, storageRequiredTb: number, incomingBandwidthMbps: number, outgoingBandwidthMbps: number,
  decodeDemandMp: number, simultaneousDecodeChannels: number, floorCount: number, poeLoadW: number, maxCameraW: number,
  upsLoadW: number, requiredRuntimeMin: number, requireRaid: boolean
) {
  const selectedIds = new Set(plan.items.map((item) => item.product.id));
  const evaluations: ProductEvaluation[] = cameraEvaluations(products, zones, brief, selectedIds);
  const requiredChannels = Math.min(80, Math.ceil(brief.cameraCount * profile.expansion));
  const selectedRecorder = plan.items.find((item) => item.product.category === "recorder")!.product;

  for (const product of products.filter((item) => item.category === "recorder")) {
    const failures = recorderFailures(product.specs as RecorderSpecs, cameraSelections, requiredChannels, incomingBandwidthMbps, outgoingBandwidthMbps, decodeDemandMp, simultaneousDecodeChannels);
    if (requireRaid && normalizedRaidLevels(product.specs as RecorderSpecs).length === 0) failures.push("RAID پشتیبانی نمی‌شود.");
    if (!storageOptions(products, product, storageRequiredTb, requireRaid, profile.id === "professional").length) failures.push("هیچ ترکیب هاردی ظرفیت usable لازم را تأمین نمی‌کند.");
    if (!available(product)) failures.push(unavailableReason(product));
    evaluations.push({
      productId: product.id, productName: product.name, category: product.category,
      status: selectedIds.has(product.id) ? "selected" : failures.length ? "rejected" : "accepted",
      reasons: failures.length ? [] : [`${(product.specs as RecorderSpecs).channels} کانال، Codec/Decode/Bandwidth و Storage معتبر`],
      failedConstraints: failures
    });
  }

  for (const product of products.filter((item) => item.category === "storage")) {
    const options = storageOptions([product], selectedRecorder, storageRequiredTb, requireRaid, profile.id === "professional");
    const failures = options.length ? [] : ["با تعداد Bay، سقف ظرفیت دیسک و RAID دستگاه منتخب به ظرفیت usable لازم نمی‌رسد."];
    if (!available(product)) failures.push(unavailableReason(product));
    evaluations.push({ productId: product.id, productName: product.name, category: product.category, status: selectedIds.has(product.id) ? "selected" : failures.length ? "rejected" : "accepted", reasons: failures.length ? [] : [`قابل استفاده در ${options.length} آرایش معتبر دیسک`], failedConstraints: failures });
  }

  for (const product of products.filter((item) => item.category === "switch")) {
    const result = switchCandidate(product, brief.cameraCount, floorCount, poeLoadW, maxCameraW, incomingBandwidthMbps, profile.id === "professional", brief.maxCableRunM || 100);
    evaluations.push({ productId: product.id, productName: product.name, category: product.category, status: selectedIds.has(product.id) ? "selected" : result.failures.length ? "rejected" : "accepted", reasons: result.selection ? [`${result.selection.quantity} دستگاه برای ${floorCount} محل توزیع، PoE و Uplink کافی`]: [], failedConstraints: result.failures });
  }

  for (const product of products.filter((item) => item.category === "ups")) {
    const result = evaluateUps(product.specs as UpsSpecs, upsLoadW, requiredRuntimeMin);
    const failures: string[] = [];
    if (!available(product)) failures.push(unavailableReason(product));
    if (!result.wattCapacityOk) failures.push("توان خروجی با حاشیه ۲۵٪ کافی نیست.");
    if (!result.vaCapacityOk) failures.push("ظرفیت VA کافی نیست.");
    if (!result.runtimeOk) failures.push(`Runtime برآوردی ${round(result.estimatedRuntimeMin)} دقیقه کمتر از ${requiredRuntimeMin} دقیقه است.`);
    evaluations.push({ productId: product.id, productName: product.name, category: product.category, status: selectedIds.has(product.id) ? "selected" : failures.length ? "rejected" : "accepted", reasons: failures.length ? [] : [`توان و VA کافی؛ Runtime برآوردی ${round(result.estimatedRuntimeMin)} دقیقه`], failedConstraints: failures });
  }
  return evaluations;
}

function scorePlan(plan: RecommendationPlan, brief: ProjectBrief, minPrice: number, maxPrice: number) {
  const recorder = plan.items.find((item) => item.product.category === "recorder")!.product.specs as RecorderSpecs;
  const networkSwitch = plan.items.find((item) => item.product.category === "switch")!.product.specs as SwitchSpecs;
  const runtime = recorderRuntimeSpecs(recorder);
  const technicalRatios = [
    recorder.incomingBandwidthMbps / Math.max(0.1, plan.metrics.bandwidthMbps * 1.2),
    runtime.outgoingBandwidthMbps / Math.max(0.1, plan.metrics.outgoingBandwidthMbps * 1.2),
    runtime.decodeCapacityMp / Math.max(0.1, plan.metrics.decodeDemandMp),
    plan.metrics.poeBudgetW / Math.max(0.1, plan.metrics.poeLoadW * 1.2),
    plan.metrics.storageUsableTb / Math.max(0.1, plan.metrics.storageRequiredTb)
  ];
  const technicalFit = 35 * technicalRatios.reduce((sum, ratio) => sum + clamp01(ratio), 0) / technicalRatios.length;
  const capacityHeadroom = 15 * technicalRatios.reduce((sum, ratio) => sum + clamp01(ratio - 1), 0) / technicalRatios.length;
  const imageQuality = 15 * clamp01(plan.metrics.averagePpm / Math.max(1, plan.metrics.minimumPpm * 1.5));
  const reliability = 10 * ([plan.metrics.raidLevel !== "بدون RAID" ? 0.35 : 0, plan.metrics.hotSpareDrives ? 0.2 : 0, networkSwitch.managed ? 0.15 : 0, networkSwitch.surgeProtection ? 0.15 : 0, plan.metrics.estimatedRuntimeMin ? 0.15 : 0].reduce((sum, value) => sum + value, 0));
  const totalQuantity = plan.items.reduce((sum, item) => sum + item.quantity, 0);
  const stockAvailability = totalQuantity ? 10 * plan.items.reduce((sum, item) => sum + (item.product.stockStatus === "in_stock" ? 1 : item.product.stockStatus === "low_stock" ? 0.55 : 0) * clamp01(item.product.stockQuantity / Math.max(1, item.quantity)) * item.quantity, 0) / totalQuantity : 0;
  let priceFit: number;
  if (brief.budgetMaxIrt) {
    if (brief.budgetMinIrt && plan.totalPrice < brief.budgetMinIrt) priceFit = 8 + 2 * clamp01(plan.totalPrice / brief.budgetMinIrt);
    else priceFit = plan.totalPrice <= brief.budgetMaxIrt ? 10 : 10 * clamp01(1 - (plan.totalPrice - brief.budgetMaxIrt) / brief.budgetMaxIrt);
  }
  else {
    const target = brief.budget === "economy" ? 0 : brief.budget === "balanced" ? 0.5 : 1;
    const position = maxPrice === minPrice ? target : (plan.totalPrice - minPrice) / (maxPrice - minPrice);
    priceFit = 10 * clamp01(1 - Math.abs(position - target));
  }
  const cameras = plan.items.filter((item) => item.product.category === "camera");
  const cameraCount = cameras.reduce((sum, item) => sum + item.quantity, 0);
  const preferredCount = brief.preferredBrand ? cameras.filter((item) => item.product.brand === brief.preferredBrand).reduce((sum, item) => sum + item.quantity, 0) : 0;
  const preferredBrand = brief.preferredBrand && cameraCount ? 5 * preferredCount / cameraCount : 0;
  plan.scoreBreakdown = { technicalFit: round(technicalFit), capacityHeadroom: round(capacityHeadroom), imageQuality: round(imageQuality), reliability: round(reliability), stockAvailability: round(stockAvailability), priceFit: round(priceFit), preferredBrand: round(preferredBrand) };
  plan.score = Math.round(Object.values(plan.scoreBreakdown).reduce((sum, value) => sum + value, 0));
}

export function recommendProducts(products: CatalogProduct[], brief: ProjectBrief, calibrationFactors: BitrateCalibrationFactors = {}): RecommendationResult {
  const zones = brief.zones?.length ? expandCameraZones(brief.zones) : [];
  const rejected: RecommendationResult["rejected"] = [];
  const plans: RecommendationPlan[] = [];
  if (!zones.length) return { project: brief, plans, rejected: [{ productName: "پروژه", reason: "حداقل یک ناحیه با هندسه کامل لازم است." }], generatedAt: new Date().toISOString(), dataMode: "mock-fallback", calculation: calculationMetadata(brief) };

  for (const profile of planProfiles) {
    const cameraResult = selectCameras(products, zones, brief, profile);
    if (!cameraResult.selections.length) {
      rejected.push({ productName: `دوربین ناحیه ${cameraResult.failedZone?.name || "نامشخص"}`, reason: "هیچ دوربینی هم‌زمان PPM، FOV، ارتفاع/Tilt و قابلیت تحلیلی این ناحیه را تأمین نمی‌کند." });
      continue;
    }
    const cameraSelections = cameraResult.selections;
    const relaxedSelections = cameraSelections.filter((selection) => selection.relaxed);
    for (const selection of relaxedSelections) {
      rejected.push({
        productName: `بازبینی دوربین ${selection.zone.name}`,
        reason: `نزدیک‌ترین کالای موجود انتخاب شد؛ ${selection.evaluation.failedConstraints.join("؛ ")}`
      });
    }
    const totalVideoBitrateKbps = cameraSelections.reduce((sum, item) => sum + (item.zone.measuredBitrateKbps || item.specs.recommendedBitrateKbps * (calibrationFactors[item.zone.goal] || 1)) * item.zone.cameraCount, 0);
    const bandwidthMbps = totalVideoBitrateKbps / 1_000;
    const storage = calculateSurveillanceStorage({
      totalVideoBitrateKbps, cameraCount: brief.cameraCount, archiveDays: brief.archiveDays,
      recordingMode: brief.recordingMode, motionActivityPercent: brief.motionActivityPercent,
      bitrateMode: brief.bitrateMode, recordAudio: brief.recordAudio, audioBitrateKbps: brief.audioBitrateKbps,
      filesystemOverheadPercent: brief.filesystemOverheadPercent, vbrSafetyMarginPercent: brief.vbrSafetyMarginPercent,
      reservePercent: brief.reservePercent
    });
    const designStorageTb = storage.requiredStorageTb * (profile.id === "professional" ? 1.2 : 1);
    const remote = remoteRequirements(cameraSelections, brief.remoteViewingUsers || 1);
    const requireRaid = profile.raid || Boolean(brief.redundancyRequired);
    const recorderStorage = selectRecorderAndStorage(products, cameraSelections, profile, bandwidthMbps, remote.outgoingBandwidthMbps, remote.decodeDemandMp, remote.simultaneousDecodeChannels, designStorageTb, requireRaid);
    if (!recorderStorage) {
      rejected.push({ productName: `NVR/Storage پلن ${profile.title}`, reason: "هیچ ترکیبی تمام قیود Channel، Incoming/Outgoing، Decode، Codec و ظرفیت usable را تأمین نکرد." });
      continue;
    }

    const poeLoadW = cameraSelections.reduce((sum, item) => sum + item.specs.maxPowerW * item.zone.cameraCount, 0);
    const maxCameraW = Math.max(...cameraSelections.map((item) => item.specs.maxPowerW));
    const floorCount = Math.min(brief.cameraCount, Math.max(1, brief.floors || 1));
    const networkSwitch = selectSwitch(products, brief.cameraCount, floorCount, poeLoadW, maxCameraW, bandwidthMbps, profile.id === "professional", brief.maxCableRunM || 100);
    if (!networkSwitch) {
      rejected.push({ productName: `شبکه پلن ${profile.title}`, reason: "هیچ توپولوژی سوئیچی Per-port PoE، بودجه کل، Uplink، مسیر کابل و تعداد طبقات را تأمین نکرد." });
      continue;
    }

    const upsLoadW = calculateUpsLoadW(poeLoadW, networkSwitch, recorderStorage.recorder, recorderStorage.storage, recorderStorage.driveCount);
    const requiredRuntimeMin = brief.upsRuntimeMinutes || 15;
    const upsSelection = profile.ups ? selectUps(products, upsLoadW, requiredRuntimeMin) : undefined;
    if (profile.ups && !upsSelection) {
      rejected.push({ productName: `UPS پلن ${profile.title}`, reason: "هیچ UPS موجودی W، VA و Runtime لازم را تأمین نمی‌کند." });
      continue;
    }

    const cameraItemMap = new Map<string, { product: CatalogProduct; quantity: number; reasons: string[] }>();
    for (const selection of cameraSelections) {
      const reviewLabel = selection.relaxed ? " ⚠ نیازمند بازبینی" : "";
      const reason = `${selection.zone.name}: ${TASK_LABELS[selection.zone.goal]}، ${round(selection.evaluation.actualPpm)} PPM، HFOV ${round(selection.evaluation.selectedHorizontalFovDeg)}°${reviewLabel}`;
      const existing = cameraItemMap.get(selection.product.id);
      if (existing) { existing.quantity += selection.zone.cameraCount; existing.reasons.push(reason); }
      else cameraItemMap.set(selection.product.id, { product: selection.product, quantity: selection.zone.cameraCount, reasons: [reason, `فاصله مایل ${round(selection.evaluation.slantDistanceM)}m و Tilt لازم ${round(selection.evaluation.requiredTiltDeg)}°`] });
    }
    const recorderSpecs = recorderStorage.recorder.specs as RecorderSpecs;
    const raidLabel = recorderStorage.raidLevel === "none" ? "بدون RAID" : `RAID ${recorderStorage.raidLevel}`;
    const upsEvaluation = upsSelection?.evaluation;
    const items = [
      ...cameraItemMap.values(),
      { product: recorderStorage.recorder, quantity: 1, reasons: [`Codec مشترک ${recorderStorage.codec}`, `Decode ${round(recorderRuntimeSpecs(recorderSpecs).decodeCapacityMp)}MP برای تقاضای ${round(remote.decodeDemandMp)}MP`, `Incoming/Outgoing ${recorderSpecs.incomingBandwidthMbps}/${round(recorderRuntimeSpecs(recorderSpecs).outgoingBandwidthMbps)}Mbps`] },
      { product: recorderStorage.storage, quantity: recorderStorage.driveCount, reasons: [`${round(recorderStorage.usableTb)}TB usable از ${round(recorderStorage.rawTb)}TB خام`, `${raidLabel}${recorderStorage.hotSpareCount ? ` + ${recorderStorage.hotSpareCount} Hot Spare` : ""}`, `نیاز محاسبه‌شده ${round(storage.requiredStorageTb)}TB`] },
      { product: networkSwitch.product, quantity: networkSwitch.quantity, reasons: [`${networkSwitch.quantity} محل توزیع برای ${floorCount} طبقه`, `${round(networkSwitch.poeBudgetW)}W بودجه برای بار ${round(poeLoadW)}W`, `Per-port ${maxCameraW}W و Uplink با حاشیه ۲۰٪`] },
      ...(upsSelection ? [{ product: upsSelection.product, quantity: 1, reasons: [`بار واقعی ${round(upsLoadW)}W`, `Runtime برآوردی ${round(upsEvaluation!.estimatedRuntimeMin)} دقیقه`] }] : [])
    ];
    const totalPrice = items.reduce((sum, item) => sum + productCost(item.product, item.quantity), 0);
    const ppmValues = cameraSelections.map((item) => item.evaluation.actualPpm);
    const requiredPpmValues = cameraSelections.map((item) => item.evaluation.requiredPpm);
    const budgetDeltaIrt = brief.budgetMaxIrt === undefined ? undefined : totalPrice - brief.budgetMaxIrt;
    const engineeringMap = buildEngineeringMap(brief, cameraSelections.map((item) => ({
      zone: item.zone, productId: item.product.id, productName: item.product.name,
      resolutionWidth: item.specs.resolutionWidth, horizontalFovDeg: item.evaluation.selectedHorizontalFovDeg,
      verticalFovDeg: item.evaluation.verticalFovDeg, actualPpm: item.evaluation.actualPpm
    })));
    const infrastructure = calculateInfrastructure(brief, engineeringMap, networkSwitch.quantity, upsLoadW, calculateUpsRequirements(upsLoadW).requiredOutputW);
    const plan: RecommendationPlan = {
      id: profile.id, title: profile.title, subtitle: profile.subtitle, score: 0, totalPrice, items,
      highlights: [
        ...(relaxedSelections.length ? [`${relaxedSelections.length} دوربین نزدیک به نیاز؛ بازبینی فنی لازم`] : []),
        `${round(Math.min(...ppmValues))} PPM حداقل واقعی`,
        `${round(storage.recordingDutyCycle * 100)}٪ چرخه ضبط`,
        `${round(remote.outgoingBandwidthMbps)}Mbps مشاهده Remote`,
        `${floorCount} نقطه توزیع شبکه`
      ],
      metrics: {
        bandwidthMbps: round(bandwidthMbps), storageBaseTb: round(storage.baseStorageTb), storageRequiredTb: round(storage.requiredStorageTb),
        storageRawTb: round(recorderStorage.rawTb), storageUsableTb: round(recorderStorage.usableTb), raidLevel: raidLabel,
        hotSpareDrives: recorderStorage.hotSpareCount, poeLoadW: round(poeLoadW), poeBudgetW: round(networkSwitch.poeBudgetW),
        upsLoadW: round(upsLoadW), upsRequiredW: round(calculateUpsRequirements(upsLoadW).requiredOutputW),
        estimatedRuntimeMin: upsEvaluation ? round(upsEvaluation.estimatedRuntimeMin) : undefined, requiredRuntimeMin: profile.ups ? requiredRuntimeMin : undefined,
        expansionPorts: networkSwitch.expansionPorts, recommendedResolutionMp: Math.max(...cameraSelections.map((item) => item.specs.resolutionMp)),
        minimumPpm: round(Math.min(...requiredPpmValues)), averagePpm: round(ppmValues.reduce((sum, value) => sum + value, 0) / ppmValues.length),
        outgoingBandwidthMbps: round(remote.outgoingBandwidthMbps), decodeDemandMp: round(remote.decodeDemandMp), switchLocations: floorCount,
        recordingDutyCycle: round(storage.recordingDutyCycle, 2), budgetMinIrt: brief.budgetMinIrt, budgetMaxIrt: brief.budgetMaxIrt, budgetDeltaIrt
      },
      scoreBreakdown: { technicalFit: 0, capacityHeadroom: 0, imageQuality: 0, reliability: 0, stockAvailability: 0, priceFit: 0, preferredBrand: 0 },
      constraints: {
        checked: ["PPM، عرض صحنه و HFOV هر ناحیه", "ارتفاع، فاصله و Tilt", "تفکیک Face/Plate/ANPR", "Channel، Incoming/Outgoing، Decode و Codec NVR", "Per-port PoE، بودجه کل و Uplink", "توزیع سوئیچ براساس طبقات", "Motion/VBR/Audio/Overhead/Reserve ذخیره‌سازی", "W، VA و Runtime برآوردی UPS", "بودجه عددی تجهیزات"],
        pending: [
          ...relaxedSelections.flatMap((selection) =>
            selection.evaluation.failedConstraints.map((reason) => `${selection.zone.name}: ${reason}`)
          ),
          "سرعت، شاتر و زاویه افقی/عمودی پلاک در ANPR",
          "Occlusion و موانع واقعی سایت",
          "Runtime از منحنی رسمی بار UPS",
          "هزینه کابل‌کشی و نصب"
        ]
      },
      evaluations: [], engineeringMap, infrastructure
    };
    plan.evaluations = catalogEvaluations(products, plan, cameraSelections, zones.map((zone) => zoneWithProfilePpm(zone, profile)), brief, profile, designStorageTb, bandwidthMbps, remote.outgoingBandwidthMbps, remote.decodeDemandMp, remote.simultaneousDecodeChannels, floorCount, poeLoadW, maxCameraW, upsLoadW, requiredRuntimeMin, requireRaid);
    plans.push(plan);
  }

  const prices = plans.map((plan) => plan.totalPrice);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  for (const plan of plans) scorePlan(plan, brief, minPrice, maxPrice);
  const rejectedProducts = plans[0]?.evaluations.filter((item) => item.status === "rejected").map((item) => ({ productName: item.productName, reason: item.failedConstraints.join("؛ ") })) || [];
  return { project: brief, plans, rejected: [...rejected, ...rejectedProducts], generatedAt: new Date().toISOString(), dataMode: "mock-fallback", calculation: calculationMetadata(brief) };
}
