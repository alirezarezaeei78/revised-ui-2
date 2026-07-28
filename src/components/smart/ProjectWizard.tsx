"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Bookmark, Cable, Check, ChevronLeft, CircleAlert, FileDown, Info, Layers3, LoaderCircle, MapPinned, Mic, Moon, PencilRuler, Plus, RotateCcw, Save, Settings2, ShieldCheck, Sparkles, SquareStack, Trash2 } from "lucide-react";
import type { ProjectBrief, ProjectCameraConfig, ProjectCameraUnit, ProjectZone, RecommendationPlan, RecommendationResult } from "@/src/domain/catalog/types";
import { createEmptyPlan, defaultCameraOptics, type BuildingPlan, type PlanCameraDefinition } from "@/src/domain/planner/types";
import type { PlanSummary } from "@/src/components/planner/FloorPlanDesigner";
import { TASK_LABELS, TASK_MINIMUM_PPM } from "@/src/lib/recommendation/camera-constraints";
import { PlanResultMaps } from "@/src/components/planner/PlanResultMaps";
import { createSamplePlan, type SamplePlanId } from "@/src/lib/planner/sample-plans";

const formatFaCount = (value: number) => new Intl.NumberFormat("fa-IR").format(value);

/**
 * The designer pulls in three.js and only renders on demand, so it is split out of the
 * wizard bundle and never runs on the server.
 */
const FloorPlanDesigner = dynamic(
  () => import("@/src/components/planner/FloorPlanDesigner").then((module) => module.FloorPlanDesigner),
  {
    ssr: false,
    loading: () => <div className="plan-designer-loading"><LoaderCircle className="is-spinning" size={26} /><span>در حال آماده‌سازی محیط طراحی...</span></div>
  }
);

const DEFAULTS_KEY = "hamyar-project-defaults-v3";
const SOLUTION_KEY = "hamyar-preferred-solution-v2";
const formatPrice = (value: number) => `${new Intl.NumberFormat("fa-IR").format(value)} تومان`;

const initialBrief: ProjectBrief = {
  projectType: "shop", cameraCount: 8, outdoorCount: 2, entrances: 2, goal: "mixed", archiveDays: 30, budget: "balanced", preferredBrand: "Tiandy",
  siteAreaM2: 320, floors: 1, maxCableRunM: 90, remoteViewingUsers: 3, upsRuntimeMinutes: 15, budgetMinIrt: 150_000_000, budgetMaxIrt: 280_000_000,
  recordingMode: "motion", motionActivityPercent: 45, bitrateMode: "VBR", recordAudio: false, audioBitrateKbps: 64, filesystemOverheadPercent: 5, vbrSafetyMarginPercent: 20, reservePercent: 10,
  lowLightPriority: true, audioRequired: false, localRecordingFallback: true, redundancyRequired: false,
  zones: [
    { id: "entrance", name: "ورودی اصلی", cameraCount: 2, outdoor: false, goal: "face-identify", targetDistanceM: 5, sceneWidthM: 2.5, mountingHeightM: 3, targetHeightM: 1.7, cameraTiltDeg: 15 },
    { id: "sales", name: "سالن و صندوق", cameraCount: 4, outdoor: false, goal: "monitor", targetDistanceM: 10, sceneWidthM: 9, mountingHeightM: 3.2, targetHeightM: 1.5, cameraTiltDeg: 12 },
    { id: "outside", name: "نمای بیرونی", cameraCount: 2, outdoor: true, goal: "monitor", targetDistanceM: 15, sceneWidthM: 12, mountingHeightM: 4, targetHeightM: 1.5, cameraTiltDeg: 10 }
  ]
};

const projectTypes = [["shop", "فروشگاه"], ["office", "اداری"], ["factory", "کارخانه"], ["parking", "پارکینگ"], ["residential", "مسکونی"]] as const;
const taskOptions = Object.entries(TASK_LABELS) as Array<[ProjectZone["goal"], string]>;
const housingLabels: Record<ProjectCameraConfig["housing"], string> = {
  dome: "دام",
  turret: "تورت",
  bullet: "بولت",
  ptz: "چرخشی PTZ"
};

function defaultCameraConfig(zone: Pick<ProjectZone, "name" | "outdoor" | "goal">): ProjectCameraConfig {
  const plateCamera = zone.goal === "anpr" || zone.goal === "plate-capture";
  const faceCamera = zone.goal === "face-capture" || zone.goal === "face-identify";
  return {
    label: zone.name || "دوربین",
    housing: plateCamera || faceCamera || zone.outdoor ? "bullet" : "turret",
    megapixel: plateCamera ? 8 : faceCamera ? 5 : 4,
    sensorWidthMm: 5.12,
    focalMm: plateCamera || faceCamera ? 12 : 2.8,
    irRangeM: plateCamera ? 60 : faceCamera || zone.outdoor ? 50 : 30,
    maxRangeM: plateCamera ? 60 : faceCamera ? 45 : zone.outdoor ? 45 : 35,
    microphone: false,
    colorNightVision: false,
    weatherproof: zone.outdoor
  };
}

function cameraConfigFor(zone: ProjectZone): ProjectCameraConfig {
  return { ...defaultCameraConfig(zone), ...zone.cameraConfig };
}

function suggestedHousing(
  zone: Pick<ProjectZone, "outdoor" | "goal">,
  index: number,
  total: number
): ProjectCameraConfig["housing"] {
  if (zone.goal === "anpr" || zone.goal === "plate-capture") return "bullet";
  if (zone.outdoor) {
    return zone.goal === "monitor" && total >= 4 && index === total - 1 ? "ptz" : "bullet";
  }
  if (zone.goal === "monitor") return index % 2 === 0 ? "turret" : "dome";
  if (zone.goal === "face-capture" || zone.goal === "face-identify") {
    return index % 2 === 0 ? "bullet" : "dome";
  }
  return "turret";
}

function camerasFor(zone: ProjectZone): ProjectCameraUnit[] {
  const geometry = {
    targetDistanceM: zone.targetDistanceM,
    sceneWidthM: zone.sceneWidthM,
    mountingHeightM: zone.mountingHeightM,
    targetHeightM: zone.targetHeightM,
    cameraTiltDeg: zone.cameraTiltDeg,
    minimumPpm: zone.minimumPpm || TASK_MINIMUM_PPM[zone.goal],
    measuredBitrateKbps: zone.measuredBitrateKbps
  };
  if (zone.cameras?.length) return zone.cameras.map((camera) => ({ ...geometry, ...camera }));
  const config = cameraConfigFor(zone);
  return Array.from({ length: Math.max(1, zone.cameraCount) }, (_, index) => ({
    ...config,
    housing: suggestedHousing(zone, index, Math.max(1, zone.cameraCount)),
    ...geometry,
    id: `camera-${index + 1}`,
    label: zone.cameraCount > 1 ? `${config.label} ${formatFaCount(index + 1)}` : config.label
  }));
}

function buildCameraDefinitions(zones: ProjectZone[]): PlanCameraDefinition[] {
  return zones.flatMap((zone) =>
    camerasFor(zone).map((camera) => ({
      id: `${zone.id}-${camera.id}`,
      zoneId: zone.id,
      groupName: zone.name,
      name: camera.label,
      housing: camera.housing,
      goal: zone.goal,
      optics: {
        ...defaultCameraOptics,
        megapixel: camera.megapixel,
        sensorWidthMm: camera.sensorWidthMm,
        focalMm: camera.focalMm,
        mountHeightM: camera.mountingHeightM,
        tiltDeg: camera.cameraTiltDeg,
        irRangeM: camera.irRangeM,
        maxRangeM: camera.maxRangeM
      },
      features: {
        microphone: camera.microphone,
        colorNightVision: camera.colorNightVision,
        weatherproof: camera.weatherproof
      }
    }))
  );
}

type WizardPreset = {
  id: string;
  title: string;
  brief: Partial<ProjectBrief>;
  zones: ProjectZone[];
  planId?: SamplePlanId;
  description?: string;
};

const presets: WizardPreset[] = [
  { id: "retail", title: "فروشگاه کوچک", brief: { projectType: "shop", siteAreaM2: 180, entrances: 1, archiveDays: 21 }, zones: [{ id: "p1", name: "ورودی و صندوق", cameraCount: 3, outdoor: false, goal: "face-capture", targetDistanceM: 4, sceneWidthM: 3, mountingHeightM: 3, targetHeightM: 1.7, cameraTiltDeg: 15 }, { id: "p2", name: "سالن فروش", cameraCount: 3, outdoor: false, goal: "monitor", targetDistanceM: 9, sceneWidthM: 8, mountingHeightM: 3.2, targetHeightM: 1.5, cameraTiltDeg: 12 }] },
  { id: "parking", title: "پارکینگ", brief: { projectType: "parking", siteAreaM2: 1200, entrances: 2, archiveDays: 45, lowLightPriority: true }, zones: [{ id: "p1", name: "رمپ ورود", cameraCount: 2, outdoor: true, goal: "anpr", targetDistanceM: 14, sceneWidthM: 3.5, mountingHeightM: 4, targetHeightM: 0.8, cameraTiltDeg: 13 }, { id: "p2", name: "محوطه پارک", cameraCount: 8, outdoor: false, goal: "monitor", targetDistanceM: 18, sceneWidthM: 14, mountingHeightM: 4, targetHeightM: 1.5, cameraTiltDeg: 9 }, { id: "p3", name: "مسیر عابر", cameraCount: 2, outdoor: false, goal: "face-capture", targetDistanceM: 7, sceneWidthM: 4, mountingHeightM: 3, targetHeightM: 1.7, cameraTiltDeg: 11 }] },
  { id: "factory", title: "کارخانه", brief: { projectType: "factory", siteAreaM2: 4500, floors: 2, entrances: 4, archiveDays: 60, redundancyRequired: true }, zones: [{ id: "p1", name: "خط تولید", cameraCount: 12, outdoor: false, goal: "monitor", targetDistanceM: 20, sceneWidthM: 16, mountingHeightM: 5, targetHeightM: 1.5, cameraTiltDeg: 10 }, { id: "p2", name: "انبار", cameraCount: 6, outdoor: false, goal: "monitor", targetDistanceM: 16, sceneWidthM: 12, mountingHeightM: 4.5, targetHeightM: 1.5, cameraTiltDeg: 10 }, { id: "p3", name: "گیت خودرو", cameraCount: 4, outdoor: true, goal: "anpr", targetDistanceM: 16, sceneWidthM: 4, mountingHeightM: 4, targetHeightM: 0.8, cameraTiltDeg: 12 }] }
];

const samplePresets: WizardPreset[] = [
  {
    id: "luxury-villa-sample",
    title: "خانه‌باغ مجلل ۴ طبقه",
    description: "باغ، استخر، سوئیت‌ها و روف‌گاردن",
    planId: "luxury-villa",
    brief: { projectType: "residential", siteAreaM2: 1728, floors: 4, entrances: 4, archiveDays: 45, lowLightPriority: true },
    zones: [
      { id: "villa-gates", name: "ورودی‌ها و دروازه", cameraCount: 3, outdoor: true, goal: "face-identify", targetDistanceM: 8, sceneWidthM: 5, mountingHeightM: 3.5, targetHeightM: 1.7, cameraTiltDeg: 12 },
      { id: "villa-garden", name: "باغ، استخر و پیرامون", cameraCount: 4, outdoor: true, goal: "monitor", targetDistanceM: 18, sceneWidthM: 14, mountingHeightM: 4, targetHeightM: 1.5, cameraTiltDeg: 10 },
      { id: "villa-interior", name: "فضاهای داخلی و راهروها", cameraCount: 5, outdoor: false, goal: "monitor", targetDistanceM: 9, sceneWidthM: 7, mountingHeightM: 3.1, targetHeightM: 1.5, cameraTiltDeg: 12 },
      { id: "villa-roof", name: "روف‌گاردن و تراس", cameraCount: 2, outdoor: true, goal: "monitor", targetDistanceM: 12, sceneWidthM: 9, mountingHeightM: 3.4, targetHeightM: 1.5, cameraTiltDeg: 10 }
    ]
  },
  {
    id: "modern-office-sample",
    title: "اداری مدرن ۳ طبقه",
    description: "لابی، فضای باز و اتاق جلسات",
    planId: "modern-office",
    brief: { projectType: "office", siteAreaM2: 792, floors: 3, entrances: 2, archiveDays: 30 },
    zones: [
      { id: "office-lobby", name: "لابی و ورودی", cameraCount: 2, outdoor: false, goal: "face-identify", targetDistanceM: 6, sceneWidthM: 4, mountingHeightM: 3, targetHeightM: 1.7, cameraTiltDeg: 13 },
      { id: "office-work", name: "دفاتر و فضای کاری", cameraCount: 5, outdoor: false, goal: "monitor", targetDistanceM: 12, sceneWidthM: 10, mountingHeightM: 3.2, targetHeightM: 1.5, cameraTiltDeg: 11 },
      { id: "office-perimeter", name: "پیرامون ساختمان", cameraCount: 2, outdoor: true, goal: "monitor", targetDistanceM: 16, sceneWidthM: 12, mountingHeightM: 4, targetHeightM: 1.5, cameraTiltDeg: 10 }
    ]
  },
  {
    id: "retail-gallery-sample",
    title: "گالری و فروشگاه دوبلکس",
    description: "ویترین، صندوق، انبار و نیم‌طبقه",
    planId: "retail-gallery",
    brief: { projectType: "shop", siteAreaM2: 1040, floors: 2, entrances: 2, archiveDays: 30 },
    zones: [
      { id: "gallery-entry", name: "ورودی و ویترین", cameraCount: 2, outdoor: false, goal: "face-capture", targetDistanceM: 5, sceneWidthM: 3.5, mountingHeightM: 3, targetHeightM: 1.7, cameraTiltDeg: 14 },
      { id: "gallery-floor", name: "سالن و استندها", cameraCount: 4, outdoor: false, goal: "monitor", targetDistanceM: 11, sceneWidthM: 9, mountingHeightM: 3.3, targetHeightM: 1.5, cameraTiltDeg: 12 },
      { id: "gallery-till", name: "صندوق و انبار", cameraCount: 2, outdoor: false, goal: "face-identify", targetDistanceM: 6, sceneWidthM: 4, mountingHeightM: 3, targetHeightM: 1.5, cameraTiltDeg: 13 }
    ]
  },
  {
    id: "factory-campus-sample",
    title: "پردیس صنعتی و محوطه",
    description: "تولید، انبار، اداری و بارانداز",
    planId: "factory-campus",
    brief: { projectType: "factory", siteAreaM2: 2400, floors: 1, entrances: 3, archiveDays: 45 },
    zones: [
      { id: "campus-production", name: "سالن تولید", cameraCount: 5, outdoor: false, goal: "monitor", targetDistanceM: 18, sceneWidthM: 14, mountingHeightM: 5, targetHeightM: 1.5, cameraTiltDeg: 10 },
      { id: "campus-yard", name: "محوطه و بارانداز", cameraCount: 4, outdoor: true, goal: "monitor", targetDistanceM: 22, sceneWidthM: 16, mountingHeightM: 5, targetHeightM: 1.5, cameraTiltDeg: 9 },
      { id: "campus-gate", name: "گیت خودرو", cameraCount: 2, outdoor: true, goal: "anpr", targetDistanceM: 14, sceneWidthM: 3.5, mountingHeightM: 4, targetHeightM: 0.8, cameraTiltDeg: 12 }
    ]
  },
  {
    id: "residential-parking-sample",
    title: "مجتمع مسکونی و پارکینگ",
    description: "۴ طبقه با لابی و پارکینگ",
    planId: "residential-parking",
    brief: { projectType: "residential", siteAreaM2: 768, floors: 4, entrances: 2, archiveDays: 30 },
    zones: [
      { id: "residential-entry", name: "لابی و ورودی", cameraCount: 2, outdoor: false, goal: "face-identify", targetDistanceM: 6, sceneWidthM: 4, mountingHeightM: 3, targetHeightM: 1.7, cameraTiltDeg: 13 },
      { id: "residential-parking-zone", name: "پارکینگ", cameraCount: 4, outdoor: false, goal: "monitor", targetDistanceM: 14, sceneWidthM: 11, mountingHeightM: 3.2, targetHeightM: 1.5, cameraTiltDeg: 10 },
      { id: "residential-common", name: "راهرو و فضاهای مشترک", cameraCount: 4, outdoor: false, goal: "monitor", targetDistanceM: 9, sceneWidthM: 7, mountingHeightM: 3, targetHeightM: 1.5, cameraTiltDeg: 12 }
    ]
  }
];

const allPresets = [...presets, ...samplePresets];

function migrateSavedZone(zone: Partial<ProjectZone>, index: number): ProjectZone {
  const legacyGoal = String(zone.goal);
  const goal: ProjectZone["goal"] = legacyGoal === "general" ? "monitor" : legacyGoal === "face" ? "face-identify" : legacyGoal === "plate" ? "plate-capture" : taskOptions.some(([value]) => value === legacyGoal) ? legacyGoal as ProjectZone["goal"] : "monitor";
  const migrated = {
    id: zone.id || `zone-${index}`, name: zone.name || `ناحیه ${index + 1}`, cameraCount: zone.cameraCount ?? 1,
    outdoor: Boolean(zone.outdoor), goal,
    targetDistanceM: zone.targetDistanceM || 10, sceneWidthM: zone.sceneWidthM || 8,
    mountingHeightM: zone.mountingHeightM || 3, targetHeightM: zone.targetHeightM ?? 1.5,
    cameraTiltDeg: zone.cameraTiltDeg ?? 12, minimumPpm: zone.minimumPpm, measuredBitrateKbps: zone.measuredBitrateKbps,
    cameras: zone.cameras,
    cameraConfig: zone.cameraConfig
  };
  const cameras = camerasFor(migrated);
  return { ...migrated, cameras, cameraCount: cameras.length, cameraConfig: undefined };
}

export function ProjectWizard() {
  const [step, setStep] = useState(1);
  const wizardTopRef = useRef<HTMLElement | null>(null);
  const previousStepRef = useRef(step);
  const [brief, setBrief] = useState<ProjectBrief>(initialBrief);
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [hasSavedDefaults, setHasSavedDefaults] = useState(false);
  const [siteMode, setSiteMode] = useState<"manual" | "designer">("designer");
  const [buildingPlan, setBuildingPlan] = useState<BuildingPlan>(() => createEmptyPlan());
  const cameraDefinitions = useMemo(() => buildCameraDefinitions(brief.zones || []), [brief.zones]);

  /**
   * Only predefined inventory slots count as placed cameras. Old or imported cameras
   * without a definition id remain visible, but cannot silently satisfy the requirement.
   */
  const placement = useMemo(() => {
    const allowed = new Set(cameraDefinitions.map((camera) => camera.id));
    const placedIds = new Set(
      buildingPlan.floors.flatMap((floor) =>
        floor.cameras
          .map((camera) => camera.definitionId)
          .filter((id): id is string => Boolean(id && allowed.has(id)))
      )
    );
    const required = cameraDefinitions.length;
    const placed = placedIds.size;
    return { required, placed, complete: placed >= required && required > 0 };
  }, [cameraDefinitions, buildingPlan]);

  const planReady = siteMode === "designer" && placement.complete;

  useEffect(() => {
    const timer = window.setTimeout(() => setHasSavedDefaults(Boolean(window.localStorage.getItem(DEFAULTS_KEY))), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    const frame = window.requestAnimationFrame(() => {
      const wizard = wizardTopRef.current;
      const top = wizard ? wizard.getBoundingClientRect().top + window.scrollY - 16 : 0;
      window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  const progress = useMemo(() => `${Math.min(step, 5) * 20}%`, [step]);
  const update = <K extends keyof ProjectBrief>(key: K, value: ProjectBrief[K]) => setBrief((current) => ({ ...current, [key]: value }));

  /**
   * The drawn plan is the source of truth for area and storey count once the designer is
   * in use; camera count only follows the plan after at least one camera is placed, so
   * switching to the designer never wipes a zone breakdown the user already entered.
   */
  const applyPlanSummary = useCallback((summary: PlanSummary) => {
    setBrief((current) => ({
      ...current,
      // An open wall chain has no valid area; keep that visible as zero instead of
      // silently retaining an unrelated previous estimate.
      siteAreaM2: Math.round(summary.totalAreaM2),
      floors: summary.floorCount
    }));
  }, []);

  function syncZones(zones: ProjectZone[]) {
    const normalizedZones = zones.map((zone) => {
      const cameras = camerasFor(zone);
      return { ...zone, cameras, cameraCount: cameras.length, cameraConfig: undefined };
    });
    const distinctGoals = new Set(normalizedZones.map((zone) => zone.goal));
    const definitions = buildCameraDefinitions(normalizedZones);
    const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
    setBuildingPlan((current) => ({
      ...current,
      floors: current.floors.map((floor) => ({
        ...floor,
        cameras: floor.cameras.flatMap((camera) => {
          if (!camera.definitionId) return [camera];
          const definition = definitionById.get(camera.definitionId);
          if (!definition) return [];
          return [{
            ...camera,
            name: definition.name,
            zoneId: definition.zoneId,
            groupName: definition.groupName,
            housing: definition.housing,
            goal: definition.goal,
            optics: { ...definition.optics },
            features: { ...definition.features }
          }];
        })
      }))
    }));
    setBrief((current) => ({
      ...current, zones: normalizedZones,
      cameraCount: normalizedZones.reduce((sum, zone) => sum + zone.cameraCount, 0),
      outdoorCount: normalizedZones.filter((zone) => zone.outdoor).reduce((sum, zone) => sum + zone.cameraCount, 0),
      goal: distinctGoals.size === 1 && normalizedZones[0] ? normalizedZones[0].goal : "mixed"
    }));
  }

  function saveDefaults() {
    window.localStorage.setItem(DEFAULTS_KEY, JSON.stringify(brief));
    setHasSavedDefaults(true); setSavedMessage("تنظیمات فعلی به‌عنوان پیش‌فرض ذخیره شد.");
  }

  function loadDefaults() {
    const saved = window.localStorage.getItem(DEFAULTS_KEY);
    if (saved) { try { const parsed = JSON.parse(saved) as Partial<ProjectBrief>; const zones = parsed.zones?.map(migrateSavedZone) || initialBrief.zones; setBrief({ ...initialBrief, ...parsed, zones }); setSavedMessage("پیش‌فرض ذخیره‌شده بارگذاری شد."); } catch { setSavedMessage("پیش‌فرض ذخیره‌شده قابل خواندن نیست."); } }
  }

  function resetDefaults() {
    window.localStorage.removeItem(DEFAULTS_KEY); setHasSavedDefaults(false); setBrief(initialBrief); setSavedMessage("تنظیمات اولیه بازیابی شد.");
  }

  function applyPreset(preset: WizardPreset) {
    const zones = preset.zones.map((zone) => ({ ...zone }));
    const cameraCount = zones.reduce((sum, zone) => sum + zone.cameraCount, 0);
    const distinctGoals = new Set(zones.map((zone) => zone.goal));
    setBrief((current) => ({ ...current, ...preset.brief, zones, cameraCount, outdoorCount: zones.filter((zone) => zone.outdoor).reduce((sum, zone) => sum + zone.cameraCount, 0), goal: distinctGoals.size === 1 ? zones[0].goal : "mixed" }));
    if (preset.planId) {
      setBuildingPlan(createSamplePlan(preset.planId));
      setSiteMode("designer");
      setSavedMessage(`نمونه «${preset.title}» روی طراح بارگذاری شد؛ همه اجزا قابل ویرایش‌اند.`);
    }
  }

  async function generate() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/recommendations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(brief) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "ساخت پیشنهاد انجام نشد.");
      setResult(data); setStep(6);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "خطای ناشناخته"); }
    finally { setLoading(false); }
  }

  function retryWithCompatibleDefaults() {
    const zones = (initialBrief.zones || []).map(migrateSavedZone);
    setBrief({ ...initialBrief, zones });
    setBuildingPlan((current) => ({
      ...current,
      floors: current.floors.map((floor) => ({ ...floor, cameras: [] }))
    }));
    setResult(null);
    setError("");
    setStep(2);
  }

  // The drawn plan only reaches the results when it was actually used and completed.
  if (step === 6 && result) return <RecommendationResults result={result} plan={planReady ? buildingPlan : undefined} onReset={() => { setResult(null); setStep(1); }} onUseCompatibleDefaults={retryWithCompatibleDefaults} />;

  const stepTitles = ["شناخت محیط", "تعریف گروه‌های دوربین", "جانمایی دوربین‌ها", "نیاز تصویری", "زیرساخت و اولویت"];
  return <section ref={wizardTopRef} className="wizard-shell advanced-wizard">
    <div className="wizard-progress-head">
      <div><span>مرحله {step} از ۵</span><strong>{stepTitles[step - 1]}</strong></div>
      <div className="wizard-persistence">
        {hasSavedDefaults && <button type="button" onClick={loadDefaults}><Bookmark size={14} />بارگذاری پیش‌فرض</button>}
        <button type="button" onClick={saveDefaults}><Save size={14} />ذخیره پیش‌فرض</button>
        <button type="button" onClick={resetDefaults} aria-label="بازنشانی"><RotateCcw size={14} /></button>
      </div>
    </div>
    <div className="wizard-progress"><span style={{ width: progress }} /></div>
    {savedMessage && <button type="button" className="saved-toast" onClick={() => setSavedMessage("")}><Check size={14} />{savedMessage}</button>}

    {step === 1 && <div className="wizard-stage-layout wizard-stage-layout-fluid">
      <WizardVisual image="/assets/wizard-environment.webp" title="نقشه اولیه پوشش" description="ابعاد و نوع محیط روی تعداد دوربین، مقاومت بدنه و پیچیدگی کابل‌کشی اثر دارد." tips={["متراژ تقریبی کافی است", "تعداد طبقات را جدا حساب کنید", "ورودی‌های مهم را فراموش نکنید"]} />
      <div className="wizard-step">
        <div className="wizard-copy align-start"><p className="eyebrow">شروع طراحی</p><h1>پروژه را بهتر بشناسیم</h1><p>می‌توانید از یک سناریوی آماده شروع و جزئیات را بعداً ویرایش کنید.</p></div>
        <div className="preset-row">{allPresets.map((preset) => <button type="button" className={preset.planId ? "sample-preset" : undefined} key={preset.id} onClick={() => applyPreset(preset)} title={preset.description}><Sparkles size={14} /><span>{preset.title}{preset.description && <small>{preset.description}</small>}</span>{preset.planId && <em>نمونه</em>}</button>)}</div>
        <div className="choice-grid choice-grid-five">{projectTypes.map(([value, label]) => <button type="button" key={value} className={brief.projectType === value ? "choice-card selected" : "choice-card"} onClick={() => update("projectType", value)}><span>{label}</span>{brief.projectType === value && <Check size={18} />}</button>)}</div>
        <div className="site-mode-choice">
          <button type="button" className={siteMode === "designer" ? "site-mode-card selected" : "site-mode-card"} onClick={() => setSiteMode("designer")}>
            <span className="site-mode-badge">پیشنهاد ما</span>
            <PencilRuler size={20} aria-hidden="true" />
            <strong>طراحی یا بارگذاری نقشه محیط</strong>
            <p>محیط را بکشید یا پلان خود را بارگذاری کنید. جانمایی دوربین‌ها، زوایای دید و پوشش DORI روی همین نقشه محاسبه و در خروجی نهایی چاپ می‌شود.</p>
            {siteMode === "designer" && <Check size={18} />}
          </button>
          <button type="button" className={siteMode === "manual" ? "site-mode-card selected" : "site-mode-card"} onClick={() => setSiteMode("manual")}>
            <SquareStack size={20} aria-hidden="true" />
            <strong>فقط متراژ تقریبی</strong>
            <p>سریع‌تر است، اما نقشه پوشش، تحلیل نقاط کور و جانمایی دوربین در خروجی نخواهید داشت.</p>
            {siteMode === "manual" && <Check size={18} />}
          </button>
        </div>

        {siteMode === "manual" ? (
          <div className="field-grid three-fields">
            <LabeledNumber label="مساحت تقریبی" value={brief.siteAreaM2 || 0} unit="متر مربع" min={20} max={100000} onChange={(value) => update("siteAreaM2", value)} />
            <NumberField label="تعداد طبقات" value={brief.floors || 1} min={1} max={20} onChange={(value) => update("floors", value)} />
            <NumberField label="ورودی‌های مهم" value={brief.entrances} min={0} max={20} onChange={(value) => update("entrances", value)} />
          </div>
        ) : (
          <>
            <div className="plan-stage-note">
              <Info size={16} aria-hidden="true" />
              <p>در این مرحله فقط <strong>محیط</strong> را بسازید: دیوارها، موانع و طبقات. پس از تعریف گروه‌ها، جانمایی دوربین‌ها در صفحه مخصوص اجرا می‌شود.</p>
            </div>
            <FloorPlanDesigner plan={buildingPlan} mode="environment" onPlanChange={setBuildingPlan} onSummaryChange={applyPlanSummary} />
            <div className="field-grid two-fields">
              <NumberField label="ورودی‌های مهم" value={brief.entrances} min={0} max={20} onChange={(value) => update("entrances", value)} />
              <LabeledNumber label="مساحت محاسبه‌شده از نقشه" value={Math.round(brief.siteAreaM2 || 0)} unit="متر مربع" min={0} max={1000000} onChange={(value) => update("siteAreaM2", value)} />
            </div>
          </>
        )}
      </div>
    </div>}

    {step === 2 && <div className="wizard-camera-config-page">
      <div className="wizard-camera-config-intro">
        <WizardVisual image="/assets/wizard-environment.webp" title="هندسه اختصاصی هر دوربین" description="PPM و پوشش هر دوربین از عرض صحنه، فاصله هدف، ارتفاع نصب و Tilt همان دوربین محاسبه می‌شود." tips={["Face و ANPR می‌توانند در یک گروه باشند", "ارتفاع نصب بین دوربین‌ها مستقل است", "حداقل PPM برای هر ردیف قابل تنظیم است"]} />
        <div className="wizard-camera-config-copy">
          <div className="wizard-copy align-start"><p className="eyebrow">تعریف موجودی و جانمایی</p><h1>گروه‌های دوربین را تعریف کنید</h1><p>هر دوربین مشخصات اپتیکی و هندسه هدف مستقل دارد. گروه‌ها فقط برای نظم پروژه‌اند و هیچ مقدار فنی را به همه دوربین‌ها تحمیل نمی‌کنند.</p></div>
          <div className="camera-overview-stats">
            <div className="is-primary"><CameraCountIcon /><span>کل دوربین‌ها</span><strong>{formatFaCount(brief.cameraCount)}</strong><small>واحد تعریف‌شده</small></div>
            <div><MapPinned size={18} /><span>دوربین بیرونی</span><strong>{formatFaCount(brief.outdoorCount)}</strong><small>{brief.cameraCount ? `${formatFaCount(Math.round((brief.outdoorCount / brief.cameraCount) * 100))}٪ از کل` : "بدون دوربین"}</small></div>
            <div><Layers3 size={18} /><span>گروه‌ها</span><strong>{formatFaCount(brief.zones?.length || 0)}</strong><small>ناحیه مستقل</small></div>
          </div>
          <div className="camera-group-directory">
            <div className="camera-group-directory-head"><strong>فهرست گروه‌ها</strong><small>ترتیب نمایش در مرحله جانمایی</small></div>
            <div className={(brief.zones?.length || 0) > 8 ? "camera-group-directory-list is-scrollable" : "camera-group-directory-list"}>
              {(brief.zones || []).map((zone, index) => (
                <div key={zone.id}>
                  <span className="camera-group-order">{formatFaCount(index + 1)}</span>
                  <span><strong>{zone.name}</strong><small>{TASK_LABELS[zone.goal]}</small></span>
                  <span className="camera-group-count">{formatFaCount(camerasFor(zone).length)} دوربین</span>
                  {zone.outdoor ? <span className="camera-group-outdoor"><MapPinned size={11} />بیرونی</span> : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="wizard-camera-groups">
        <div className="wizard-camera-groups-head"><div><strong>گروه‌ها و دوربین‌ها</strong><small>مشخصات هر دوربین را در کارت خودش کامل کنید.</small></div><span>{formatFaCount(brief.cameraCount)} دوربین تعریف‌شده</span></div>
        <div className="zone-editor">{(brief.zones || []).map((zone, index) => <ZoneRow key={zone.id} zone={zone} onChange={(next) => syncZones((brief.zones || []).map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={() => syncZones((brief.zones || []).filter((_, itemIndex) => itemIndex !== index))} />)}</div>
        <button type="button" className="add-zone-button" disabled={(brief.zones?.length || 0) >= 20} onClick={() => {
          const zone: ProjectZone = { id: `zone-${Date.now()}`, name: "گروه جدید", cameraCount: 1, outdoor: false, goal: "monitor", targetDistanceM: 10, sceneWidthM: 8, mountingHeightM: 3, targetHeightM: 1.5, cameraTiltDeg: 12 };
          syncZones([...(brief.zones || []), { ...zone, cameras: [{ ...camerasFor(zone)[0], label: "دوربین ۱" }] }]);
        }}><Plus size={17} />افزودن گروه دوربین</button>
      </div>
    </div>}

    {step === 3 && <div className="wizard-step wizard-camera-placement-page">
      <div className="wizard-copy align-start"><p className="eyebrow">اجرای جانمایی</p><h1>دوربین‌های تعریف‌شده را روی نقشه قرار دهید</h1><p>فهرست سمت چپ بر اساس گروه‌ها ساخته شده است. هر دوربین را بکشید و روی محل نصب رها کنید؛ دوربین جدید و دلخواه از داخل نقشه ساخته نمی‌شود.</p></div>
      {siteMode === "designer" ? <div className="plan-placement-stage">
        <div className={placement.complete ? "plan-placement-status is-complete" : "plan-placement-status"}>
          {placement.complete ? <Check size={17} aria-hidden="true" /> : <CircleAlert size={17} aria-hidden="true" />}
          <div>
            <strong>
              {placement.complete
                ? `هر ${formatFaCount(placement.required)} دوربین تعریف‌شده جانمایی شد`
                : `${formatFaCount(placement.placed)} از ${formatFaCount(placement.required)} دوربین جانمایی شده`}
            </strong>
            <small>
              {placement.complete
                ? "جانمایی کامل است؛ جهت هر دوربین را روی نقشه تنظیم کنید."
                : `${formatFaCount(Math.max(0, placement.required - placement.placed))} دوربین دیگر در فهرست سمت چپ باقی مانده است.`}
            </small>
          </div>
        </div>
        <FloorPlanDesigner
          plan={buildingPlan}
          mode="cameras"
          cameraDefinitions={cameraDefinitions}
          onPlanChange={setBuildingPlan}
          onSummaryChange={applyPlanSummary}
        />
      </div> : <div className="plan-placement-status is-complete"><Check size={17} /><div><strong>پروژه در حالت برآورد سریع است</strong><small>جانمایی نقشه غیرفعال است و تعداد دوربین‌ها از گروه‌های مرحله قبل استفاده می‌شود.</small></div></div>}
    </div>}

    {step === 4 && <div className="wizard-stage-layout">
      <WizardVisual image="/assets/wizard-analytics.webp" title="پروفایل ضبط و ظرفیت" description="Storage از Duty Cycle ضبط، VBR، صدا، سربار فایل‌سیستم و فضای رزرو ساخته می‌شود." tips={["Motion را با درصد فعالیت واقعی تنظیم کنید", "VBR برای صحنه شلوغ حاشیه می‌خواهد", "ضبط صدا به بیت‌ریت جدا نیاز دارد"]} />
      <div className="wizard-step">
        <div className="wizard-copy align-start"><p className="eyebrow">کیفیت و پروفایل ضبط</p><h1>تصویر چگونه ضبط و نگهداری شود؟</h1><p>هدف تصویری هر ناحیه در مرحله قبل تعیین شده و اینجا رفتار ضبط و ضرایب ظرفیت مشخص می‌شود.</p></div>
        <div className="task-summary-grid">{Array.from(new Set((brief.zones || []).map((zone) => zone.goal))).map((goal) => <div key={goal}><strong>{TASK_LABELS[goal]}</strong><span>حد پایه {TASK_MINIMUM_PPM[goal]} PPM</span></div>)}</div>
        <div className="archive-field"><label><span>مدت نگهداری آرشیو</span><strong>{new Intl.NumberFormat("fa-IR").format(brief.archiveDays)} روز</strong></label><input type="range" min={7} max={180} value={brief.archiveDays} onChange={(event) => update("archiveDays", Number(event.target.value))} /><div><span>۷ روز</span><span>۱۸۰ روز</span></div></div>
        <div className="field-grid three-fields">
          <label className="wizard-select"><span>روش ضبط</span><select value={brief.recordingMode} onChange={(event) => update("recordingMode", event.target.value as ProjectBrief["recordingMode"])}><option value="continuous">پیوسته ۲۴/۷</option><option value="motion">براساس Motion/Event</option></select></label>
          <label className="wizard-select"><span>کنترل Bitrate</span><select value={brief.bitrateMode} onChange={(event) => update("bitrateMode", event.target.value as ProjectBrief["bitrateMode"])}><option value="VBR">VBR</option><option value="CBR">CBR</option></select></label>
          {brief.recordingMode === "motion" ? <LabeledNumber label="فعالیت صحنه" value={brief.motionActivityPercent} unit="٪" min={1} max={100} onChange={(value) => update("motionActivityPercent", value)} /> : <LabeledNumber label="Duty Cycle" value={100} unit="٪" min={100} max={100} onChange={() => undefined} />}
        </div>
        <div className="field-grid three-fields">
          <LabeledNumber label="سربار فایل/Metadata" value={brief.filesystemOverheadPercent} unit="٪" min={0} max={50} onChange={(value) => update("filesystemOverheadPercent", value)} />
          <LabeledNumber label="حاشیه VBR" value={brief.vbrSafetyMarginPercent} unit="٪" min={0} max={100} onChange={(value) => update("vbrSafetyMarginPercent", value)} />
          <LabeledNumber label="فضای رزرو" value={brief.reservePercent} unit="٪" min={0} max={50} onChange={(value) => update("reservePercent", value)} />
        </div>
        <div className="feature-toggle-grid">
          <FeatureToggle icon={<Moon size={18} />} title="اولویت دید در شب" description="مدل‌های IR قوی‌تر و سنسور بهتر" checked={Boolean(brief.lowLightPriority)} onChange={(value) => update("lowLightPriority", value)} />
          <FeatureToggle icon={<Mic size={18} />} title="میکروفون داخلی" description="فقط مدل‌های دارای ضبط صدا" checked={Boolean(brief.audioRequired)} onChange={(value) => { update("audioRequired", value); if (!value) update("recordAudio", false); }} />
          <FeatureToggle icon={<Mic size={18} />} title="ذخیره صدای دوربین" description={`${brief.audioBitrateKbps}Kbps برای هر دوربین`} checked={brief.recordAudio} onChange={(value) => { update("recordAudio", value); if (value) update("audioRequired", true); }} />
        </div>
        {brief.recordAudio && <LabeledNumber label="بیت‌ریت صدای هر دوربین" value={brief.audioBitrateKbps} unit="Kbps" min={16} max={320} onChange={(value) => update("audioBitrateKbps", value)} />}
      </div>
    </div>}

    {step === 5 && <div className="wizard-stage-layout">
      <WizardVisual image="/assets/wizard-plans.webp" title="راهکارهای قابل مقایسه" description="قیود قابل محاسبه کنترل می‌شوند و مواردی که به بازدید یا دیتاشیت تکمیلی نیاز دارند، جداگانه اعلام می‌شوند." tips={["تمام اقلام هر پلن قابل ویرایش‌اند", "پلن منتخب را می‌توانید ذخیره کنید", "قیمت‌ها در این فاز نمایشی‌اند"]} />
      <div className="wizard-step">
        <div className="wizard-copy align-start"><p className="eyebrow">زیرساخت و خرید</p><h1>محدودیت‌های اجرایی را مشخص کنید</h1><p>این اطلاعات روی نوع سوئیچ، NVR، افزونگی و تجهیزات برق اثر می‌گذارد.</p></div>
        <div className="choice-grid choice-grid-three">{([[
          "economy", "اقتصادی", "کمترین هزینه با رعایت الزامات"
        ], ["balanced", "متعادل", "بهترین نسبت هزینه به عملکرد"], ["professional", "حرفه‌ای", "افزونگی، هوشمندی و توسعه"]] as const).map(([value, title, description]) => <button type="button" key={value} className={brief.budget === value ? "choice-card plan-choice selected" : "choice-card plan-choice"} onClick={() => update("budget", value)}><span><strong>{title}</strong><small>{description}</small></span>{brief.budget === value && <Check size={18} />}</button>)}</div>
        <div className="field-grid three-fields">
          <label className="wizard-select"><span>برند ترجیحی</span><select value={brief.preferredBrand || ""} onChange={(event) => update("preferredBrand", event.target.value)}><option value="">بدون ترجیح</option><option value="Tiandy">Tiandy</option><option value="OptiNet">OptiNet</option><option value="Hikvision">Hikvision</option><option value="LevelOne">LevelOne</option></select></label>
          <LabeledNumber label="بلندترین مسیر کابل" value={brief.maxCableRunM || 0} unit="متر" min={10} max={250} onChange={(value) => update("maxCableRunM", value)} />
          <NumberField label="کاربران مشاهده همزمان" value={brief.remoteViewingUsers || 1} min={1} max={100} onChange={(value) => update("remoteViewingUsers", value)} />
        </div>
        <div className="field-grid two-fields budget-fields">
          <LabeledNumber label="حداقل بودجه تجهیزات" value={brief.budgetMinIrt || 0} unit="تومان" min={0} max={10_000_000_000} onChange={(value) => update("budgetMinIrt", value)} />
          <LabeledNumber label="سقف بودجه تجهیزات" value={brief.budgetMaxIrt || 0} unit="تومان" min={1_000_000} max={10_000_000_000} onChange={(value) => update("budgetMaxIrt", value)} />
        </div>
        <label className="wizard-select"><span>زمان پشتیبانی موردنیاز UPS</span><select value={brief.upsRuntimeMinutes || 15} onChange={(event) => update("upsRuntimeMinutes", Number(event.target.value))}><option value={5}>خاموش‌سازی امن (۵ دقیقه)</option><option value={15}>۱۵ دقیقه</option><option value={30}>۳۰ دقیقه</option><option value={60}>۶۰ دقیقه</option></select></label>
        <div className="feature-toggle-grid">
          <FeatureToggle icon={<ShieldCheck size={18} />} title="افزونگی ذخیره‌سازی" description="اولویت NVR دارای RAID و ظرفیت رزرو" checked={Boolean(brief.redundancyRequired)} onChange={(value) => update("redundancyRequired", value)} />
          <FeatureToggle icon={<Cable size={18} />} title="ضبط محلی پشتیبان" description="ترجیح دوربین دارای حافظه داخلی" checked={Boolean(brief.localRecordingFallback)} onChange={(value) => update("localRecordingFallback", value)} />
        </div>
        <div className="brief-summary"><ShieldCheck size={22} /><div><strong>آماده تحلیل مهندسی {brief.zones?.length || 0} ناحیه</strong><p>{brief.cameraCount} دوربین در {brief.floors} طبقه، {brief.remoteViewingUsers} کاربر همزمان، {brief.archiveDays} روز آرشیو و سقف بودجه {formatPrice(brief.budgetMaxIrt || 0)} بررسی می‌شود.</p></div></div>
      </div>
    </div>}

    {error && <p className="wizard-error"><CircleAlert size={17} />{error}</p>}
    <div className="wizard-actions">
      <button className="secondary-action" disabled={step === 1 || loading} onClick={() => setStep((value) => Math.max(1, value - 1))}><ArrowRight size={17} />مرحله قبل</button>
      {step === 3 && siteMode === "designer" && !placement.complete
        ? <span className="wizard-block-note"><CircleAlert size={15} />ابتدا همه دوربین‌ها را روی نقشه جانمایی کنید</span>
        : null}
      {step < 5
        ? <button className="primary-action" disabled={step === 3 && siteMode === "designer" && !placement.complete} onClick={() => {
          if (step === 2) syncZones(brief.zones || []);
          setStep((value) => value + 1);
        }}>ادامه<ArrowLeft size={17} /></button>
        : <button className="primary-action" disabled={loading || brief.cameraCount < 2} onClick={generate}>{loading ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}{loading ? "در حال تحلیل..." : "ساخت سه پلن هوشمند"}</button>}
    </div>
  </section>;
}

function WizardVisual({ image, title, description, tips }: { image: string; title: string; description: string; tips: string[] }) {
  return <aside className="wizard-visual"><div className="wizard-visual-image"><Image src={image} alt="" fill sizes="(max-width: 900px) 100vw, 38vw" priority /></div><div className="wizard-visual-copy"><span><Info size={15} />راهنمای این مرحله</span><h2>{title}</h2><p>{description}</p><ul>{tips.map((tip) => <li key={tip}><Check size={13} />{tip}</li>)}</ul></div></aside>;
}

function ZoneRow({ zone, onChange, onRemove }: { zone: ProjectZone; onChange: (zone: ProjectZone) => void; onRemove: () => void }) {
  const cameras = camerasFor(zone);
  const updateCameras = (next: ProjectCameraUnit[]) => onChange({ ...zone, cameras: next, cameraCount: next.length, cameraConfig: undefined });
  return <article className="zone-row">
    <div className="zone-row-main">
      <label><span>نام گروه / ناحیه</span><input value={zone.name} onChange={(event) => onChange({ ...zone, name: event.target.value })} /></label>
      <label><span>هدف مهندسی گروه</span><select value={zone.goal} onChange={(event) => {
        const goal = event.target.value as ProjectZone["goal"];
        onChange({ ...zone, goal, minimumPpm: TASK_MINIMUM_PPM[goal], cameras: cameras.map((camera) => ({ ...camera, minimumPpm: TASK_MINIMUM_PPM[goal] })) });
      }}>{taskOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="zone-camera-total"><span>دوربین‌های گروه</span><strong>{formatFaCount(cameras.length)}</strong></div>
      <label className="zone-outdoor"><input type="checkbox" checked={zone.outdoor} onChange={(event) => onChange({ ...zone, outdoor: event.target.checked })} /><span>فضای باز</span></label>
      <button type="button" className="zone-add-camera" disabled={cameras.length >= 32} onClick={() => {
        const source = cameras.at(-1)!;
        updateCameras([...cameras, {
          ...source,
          id: `camera-${Date.now().toString(36)}`,
          label: `دوربین ${formatFaCount(cameras.length + 1)}`,
          housing: suggestedHousing(zone, cameras.length, cameras.length + 1)
        }]);
      }}><Plus size={14} />افزودن دوربین</button>
      <button type="button" className="zone-delete" onClick={onRemove} aria-label={`حذف ${zone.name}`}><Trash2 size={16} /></button>
    </div>
    <div className="zone-camera-list">
      <div className="zone-camera-list-head" aria-hidden="true">
        <span>نام دوربین</span><span>بدنه</span><span>MP</span><span>لنز</span><span>IR</span><span>برد</span><span>فاصله m</span><span>عرض m</span><span>نصب m</span><span>هدف m</span><span>Tilt °</span><span>PPM</span><span>Kbps</span><span>ویژگی</span><span />
      </div>
      {cameras.map((camera) => (
        <CompactCameraRow
          key={camera.id}
          camera={camera}
          removable={cameras.length > 1}
          onChange={(next) => updateCameras(cameras.map((item) => item.id === camera.id ? next : item))}
          onRemove={() => updateCameras(cameras.filter((item) => item.id !== camera.id))}
        />
      ))}
    </div>
  </article>;
}

function CompactCameraRow({
  camera,
  removable,
  onChange,
  onRemove
}: {
  camera: ProjectCameraUnit;
  removable: boolean;
  onChange: (camera: ProjectCameraUnit) => void;
  onRemove: () => void;
}) {
  const patch = (next: Partial<ProjectCameraUnit>) => onChange({ ...camera, ...next });
  return (
    <div className="zone-camera-item">
      <input aria-label="نام دوربین" value={camera.label} onChange={(event) => patch({ label: event.target.value })} />
      <select aria-label="نوع بدنه" value={camera.housing} onChange={(event) => patch({ housing: event.target.value as ProjectCameraConfig["housing"] })}>
        {Object.entries(housingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <CompactCameraNumber label="رزولوشن" value={camera.megapixel} min={1} max={32} step={1} onChange={(megapixel) => patch({ megapixel })} />
      <CompactCameraNumber label="لنز" value={camera.focalMm} min={1} max={120} step={0.5} onChange={(focalMm) => patch({ focalMm })} />
      <CompactCameraNumber label="برد IR" value={camera.irRangeM} min={0} max={300} step={5} onChange={(irRangeM) => patch({ irRangeM })} />
      <CompactCameraNumber label="برد مؤثر" value={camera.maxRangeM} min={2} max={300} step={1} onChange={(maxRangeM) => patch({ maxRangeM })} />
      <CompactCameraNumber label="فاصله هدف" value={camera.targetDistanceM} min={0.5} max={500} step={0.5} onChange={(targetDistanceM) => patch({ targetDistanceM })} />
      <CompactCameraNumber label="عرض صحنه" value={camera.sceneWidthM} min={0.5} max={200} step={0.5} onChange={(sceneWidthM) => patch({ sceneWidthM })} />
      <CompactCameraNumber label="ارتفاع نصب" value={camera.mountingHeightM} min={1.5} max={30} step={0.1} onChange={(mountingHeightM) => patch({ mountingHeightM })} />
      <CompactCameraNumber label="ارتفاع هدف" value={camera.targetHeightM} min={0} max={5} step={0.1} onChange={(targetHeightM) => patch({ targetHeightM })} />
      <CompactCameraNumber label="زاویه Tilt" value={camera.cameraTiltDeg} min={0} max={89} step={1} onChange={(cameraTiltDeg) => patch({ cameraTiltDeg })} />
      <CompactCameraNumber label="حداقل PPM" value={camera.minimumPpm} min={10} max={1000} step={5} onChange={(minimumPpm) => patch({ minimumPpm })} />
      <CompactCameraNumber label="Bitrate واقعی" value={camera.measuredBitrateKbps || 0} min={0} max={100000} step={64} onChange={(value) => patch({ measuredBitrateKbps: value > 0 ? value : undefined })} />
      <div className="camera-feature-menu">
        <button type="button" className="camera-feature-trigger" aria-label={`ویژگی‌های ${camera.label}`} aria-haspopup="true">
          <Settings2 size={14} />
          {[camera.microphone, camera.colorNightVision, camera.weatherproof].filter(Boolean).length > 0 ? <small>{[camera.microphone, camera.colorNightVision, camera.weatherproof].filter(Boolean).length}</small> : null}
        </button>
        <div className="camera-feature-popover" role="group" aria-label={`ویژگی‌های ${camera.label}`}>
          <strong>ویژگی‌های دوربین</strong>
          <FeatureMenuToggle icon={<Mic size={13} />} label="صدای داخلی" checked={camera.microphone} onChange={(microphone) => patch({ microphone })} />
          <FeatureMenuToggle icon={<Moon size={13} />} label="دید شب رنگی" checked={camera.colorNightVision} onChange={(colorNightVision) => patch({ colorNightVision })} />
          <FeatureMenuToggle icon={<ShieldCheck size={13} />} label="مقاوم فضای باز" checked={camera.weatherproof} onChange={(weatherproof) => patch({ weatherproof })} />
        </div>
      </div>
      <button type="button" className="zone-camera-item-delete" disabled={!removable} onClick={onRemove} aria-label={`حذف ${camera.label}`}><Trash2 size={14} /></button>
    </div>
  );
}

function CompactCameraNumber({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <input aria-label={label} type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value))))} />;
}

function FeatureMenuToggle({ icon, label, checked, onChange }: { icon: React.ReactNode; label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label><span>{icon}{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) { return <label className="wizard-number"><span>{label}</span><div><button onClick={() => onChange(Math.max(min, value - 1))} type="button">−</button><strong>{new Intl.NumberFormat("fa-IR").format(value)}</strong><button onClick={() => onChange(Math.min(max, value + 1))} type="button">+</button></div></label>; }
function LabeledNumber({ label, value, unit, min, max, onChange }: { label: string; value: number; unit: string; min: number; max: number; onChange: (value: number) => void }) { return <label className="wizard-labeled-number"><span>{label}</span><div><input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value))))} /><small>{unit}</small></div></label>; }
function FeatureToggle({ icon, title, description, checked, onChange }: { icon: React.ReactNode; title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className={checked ? "feature-toggle active" : "feature-toggle"}><span className="feature-toggle-icon">{icon}</span><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>; }
function CameraCountIcon() { return <span className="camera-count-icon">●</span>; }

function RecommendationResults({ result, plan, onReset, onUseCompatibleDefaults }: { result: RecommendationResult; plan?: BuildingPlan; onReset: () => void; onUseCompatibleDefaults: () => void }) {
  const [activePlan, setActivePlan] = useState(result.project.budget);
  const [quantities, setQuantities] = useState<Record<string, Record<string, number>>>({});
  const [saved, setSaved] = useState(false);
  const [savingVersion, setSavingVersion] = useState(false);
  const [saveVersionMessage, setSaveVersionMessage] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const raw = window.localStorage.getItem(SOLUTION_KEY);
      if (!raw) return;
      try {
        const stored = JSON.parse(raw) as { planId?: string; quantities?: { productId: string; quantity: number }[] };
        const plan = result.plans.find((item) => item.id === stored.planId);
        if (!plan || !stored.quantities) return;
        setActivePlan(plan.id);
        setQuantities({ [plan.id]: Object.fromEntries(stored.quantities.map((item) => [item.productId, item.quantity])) });
        setSaved(true);
      } catch { /* ignore an invalid local draft */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [result.plans]);
  const selected = result.plans.find((plan) => plan.id === activePlan) || result.plans[0];
  const quantityFor = (plan: RecommendationPlan, productId: string, initial: number) => quantities[plan.id]?.[productId] ?? initial;
  const editedTotal = selected?.items.reduce((sum, item) => sum + item.product.price * quantityFor(selected, item.product.id, item.quantity), 0) || 0;
  const setQuantity = (plan: RecommendationPlan, productId: string, value: number) => setQuantities((current) => ({ ...current, [plan.id]: { ...current[plan.id], [productId]: Math.max(0, Math.min(99, value)) } }));
  const saveSolution = async () => {
    if (!selected || savingVersion) return;
    const selectedQuantities = selected.items.map((item) => ({ productId: item.product.id, quantity: quantityFor(selected, item.product.id, item.quantity) }));
    const localVersion = { project: result.project, planId: selected.id, quantities: selectedQuantities, calculation: result.calculation, engineeringMap: selected.engineeringMap, infrastructure: selected.infrastructure, savedAt: new Date().toISOString() };
    window.localStorage.setItem(SOLUTION_KEY, JSON.stringify(localVersion));
    setSaved(true);
    setSavingVersion(true);
    setSaveVersionMessage("نسخه محلی ذخیره شد؛ در حال ثبت تاریخچه سرور...");
    try {
      const response = await fetch("/api/projects/versions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: result.project, plan: selected, quantities: selectedQuantities, calculation: result.calculation })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "ثبت نسخه سرور انجام نشد.");
      setSaveVersionMessage(`نسخه ${new Intl.NumberFormat("fa-IR").format(data.version.version_number)} در تاریخچه سرور ذخیره شد.`);
    } catch (error) {
      setSaveVersionMessage(`${error instanceof Error ? error.message : "ثبت نسخه سرور انجام نشد."} نسخه محلی محفوظ است.`);
    } finally {
      setSavingVersion(false);
    }
  };
  const printEngineeringReport = () => {
    const details = Array.from(document.querySelectorAll<HTMLDetailsElement>(".recommendation-results details"));
    const previous = details.map((item) => item.open);
    details.forEach((item) => { item.open = true; });
    window.print();
    window.setTimeout(() => details.forEach((item, index) => { item.open = previous[index]; }), 250);
  };

  return <section className="recommendation-results">
    <div className="results-hero"><div><p className="eyebrow">پیشنهاد اولیه آماده است</p><h1>سناریوهای قابل ویرایش</h1><p>موتور {result.calculation.engineVersion} · ورودی {result.calculation.inputVersion} · {result.calculation.inputFingerprint}</p><small className="calculation-standards">{result.calculation.standardVersions.join(" · ")}</small></div><div className="result-actions"><button className="secondary-action" onClick={onReset}>ویرایش نیازها</button><button className="secondary-action" onClick={printEngineeringReport}><FileDown size={16} />خروجی PDF مهندسی</button><button className="primary-action" onClick={saveSolution} disabled={savingVersion}><Save size={16} />{savingVersion ? "در حال ذخیره نسخه..." : saved ? "ذخیره نسخه جدید" : "ذخیره پلن و نسخه محاسبه"}</button>{saveVersionMessage ? <small>{saveVersionMessage}</small> : null}</div></div>
    {selected && <div className="metric-strip"><Metric label="PPM متوسط / حداقل" value={`${selected.metrics.averagePpm} / ${selected.metrics.minimumPpm}`} /><Metric label="Incoming / Remote" value={`${selected.metrics.bandwidthMbps} / ${selected.metrics.outgoingBandwidthMbps} Mbps`} /><Metric label="تقاضای Decode" value={`${selected.metrics.decodeDemandMp} MP`} /><Metric label="Storage پایه / نهایی" value={`${selected.metrics.storageBaseTb} / ${selected.metrics.storageRequiredTb} TB`} /><Metric label="فضای usable / خام" value={`${selected.metrics.storageUsableTb} / ${selected.metrics.storageRawTb} TB`} /><Metric label="آرایش دیسک" value={selected.metrics.raidLevel} /><Metric label="بار / بودجه PoE" value={`${selected.metrics.poeLoadW} / ${selected.metrics.poeBudgetW} W`} /><Metric label="نقاط توزیع شبکه" value={`${selected.metrics.switchLocations}`} /><Metric label="Duty Cycle ضبط" value={`${Math.round(selected.metrics.recordingDutyCycle * 100)}%`} /><Metric label="زمان پشتیبانی" value={selected.metrics.estimatedRuntimeMin ? `${selected.metrics.estimatedRuntimeMin} min` : "لحاظ نشده"} /><Metric label="وضوح بیشینه" value={`${selected.metrics.recommendedResolutionMp} MP`} /></div>}
    <div className="plan-tabs">{result.plans.map((plan) => <button key={plan.id} className={selected?.id === plan.id ? "active" : ""} onClick={() => setActivePlan(plan.id)}><span>{plan.title}</span><small>امتیاز محاسبه‌شده {new Intl.NumberFormat("fa-IR").format(plan.score)} از ۱۰۰</small></button>)}</div>
    {selected && <>{plan ? <PlanResultMaps plan={plan} recommendation={selected} /> : null}<div className="infrastructure-grid"><Metric label="کابل مسی با ذخیره" value={`${selected.infrastructure.copperCableM} m`} /><Metric label="Backbone فیبر" value={`${selected.infrastructure.fiberBackboneM} m`} /><Metric label="Rack" value={`${selected.infrastructure.rackCount} × ${selected.infrastructure.recommendedRackU}U`} /><Metric label="Patch Panel / SFP" value={`${selected.infrastructure.patchPanelCount} / ${selected.infrastructure.sfpModuleCount}`} /></div></>}
    {selected && <div className="selected-plan"><div className="selected-plan-head"><div><span className="plan-score">امتیاز فعلی {selected.score}/۱۰۰</span><h2>پلن {selected.title}</h2><p>{selected.subtitle}</p></div><div className="plan-price"><span>برآورد ویرایش‌شده تجهیزات</span><strong>{formatPrice(editedTotal)}</strong><small>{editedTotal !== selected.totalPrice ? `مبلغ اولیه ${formatPrice(selected.totalPrice)}` : "قیمت‌ها نمایشی و غیرقابل استناد هستند"}</small></div></div>
      <div className="solution-items">{selected.items.map((item) => { const qty = quantityFor(selected, item.product.id, item.quantity); const image = item.product.images?.[0]; return <article key={item.product.id} className={qty === 0 ? "solution-item removed" : "solution-item"}>{image ? <div className="solution-product-image"><Image src={image.url} alt={image.alt} fill sizes="64px" /></div> : <div className="product-symbol">{item.product.category.toUpperCase()}</div>}<div className="solution-item-copy"><div><span className="item-quantity">{qty === 0 ? "حذف‌شده" : `${new Intl.NumberFormat("fa-IR").format(qty)} عدد`}</span><h3>{item.product.name}</h3><small>{item.product.sku} · {item.product.stockStatus === "in_stock" ? "موجود" : "موجودی محدود"}</small>{item.product.dataQuality?.status === "estimated" && <div className="estimated-specs-notice"><span className="estimated-badge">⚠️ محاسبات تخمینی:</span><span className="estimated-warnings">{item.product.dataQuality.warnings.join(" · ")}</span></div>}</div><ul>{item.reasons.map((reason) => <li key={reason}><Check size={14} />{reason}</li>)}</ul></div><div className="item-edit"><strong className="item-price">{formatPrice(item.product.price * qty)}</strong><div><button type="button" onClick={() => setQuantity(selected, item.product.id, qty - 1)}>−</button><span>{qty}</span><button type="button" onClick={() => setQuantity(selected, item.product.id, qty + 1)}>+</button></div>{qty > 0 ? <button type="button" className="remove-item" onClick={() => setQuantity(selected, item.product.id, 0)}><Trash2 size={13} />حذف</button> : <button type="button" className="restore-item" onClick={() => setQuantity(selected, item.product.id, item.quantity)}><RotateCcw size={13} />بازگردانی</button>}</div></article>; })}</div>
      <div className="why-plan"><Sparkles size={20} /><div><strong>چرا این ترکیب؟</strong><p>{selected.highlights.join(" · ")}</p></div></div>
      <details className="rejected-options"><summary>دامنه بررسی فنی این پلن <ChevronLeft size={16} /></summary><ul>{selected.constraints.checked.map((item) => <li key={item}><strong>بررسی شده</strong><span>{item}</span></li>)}{selected.constraints.pending.map((item) => <li key={item}><strong>نیازمند بررسی تکمیلی</strong><span>{item}</span></li>)}</ul></details>
      <details className="rejected-options"><summary>جزئیات امتیاز محاسبه‌شده <ChevronLeft size={16} /></summary><ul>{Object.entries(selected.scoreBreakdown).map(([key, value]) => <li key={key}><strong>{scoreLabels[key as keyof RecommendationPlan["scoreBreakdown"]]}</strong><span>{value}</span></li>)}</ul></details></div>}
    {selected && <details className="product-evaluation-report"><summary>گزارش قبول و رد تمام محصولات ({selected.evaluations.length} محصول) <ChevronLeft size={16} /></summary><div>{selected.evaluations.map((evaluation) => <article key={evaluation.productId} className={`evaluation-row ${evaluation.status}`}><div><span>{evaluation.status === "selected" ? "انتخاب‌شده" : evaluation.status === "accepted" ? "قابل قبول" : "ردشده"}</span><strong>{evaluation.productName}</strong><small>{evaluation.category}</small></div><ul>{[...evaluation.reasons, ...evaluation.failedConstraints].map((reason) => <li key={reason}>{reason}</li>)}</ul></article>)}</div></details>}
    {!selected && <div className="wizard-error no-plan-state"><CircleAlert size={18} /><div><strong>هیچ پلنی تمام قیود فعلی را تأمین نکرد</strong><span>می‌توانید گزارش ردها را بررسی کنید یا با تنظیمات سازگار با موجودی فعلی دوباره شروع کنید.</span></div><button type="button" onClick={onUseCompatibleDefaults}><RotateCcw size={14} />بارگذاری پیش‌فرض سازگار</button></div>}
    {result.rejected.length > 0 && <details className="rejected-options"><summary>چرا بعضی گزینه‌ها حذف شدند؟ <ChevronLeft size={16} /></summary><ul>{result.rejected.map((item, index) => <li key={`${item.productName}-${item.reason}-${index}`}><strong>{item.productName}</strong><span>{item.reason}</span></li>)}</ul></details>}
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong dir="ltr">{value}</strong></div>; }

const scoreLabels: Record<keyof RecommendationPlan["scoreBreakdown"], string> = {
  technicalFit: "تطابق قیود محاسبه‌شده",
  capacityHeadroom: "حاشیه ظرفیت",
  imageQuality: "کیفیت تصویر اولیه",
  reliability: "قابلیت اطمینان",
  stockAvailability: "موجودی",
  priceFit: "تناسب هزینه",
  preferredBrand: "برند ترجیحی"
};
