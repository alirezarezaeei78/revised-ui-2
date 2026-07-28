"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrickWall,
  Check,
  Copy,
  Cuboid,
  Camera as CameraIcon,
  DoorOpen,
  Eye,
  Grid3x3,
  Image as ImageIcon,
  Layers,
  MousePointer2,
  Move3d,
  Plus,
  Ruler,
  Redo2,
  RotateCcw,
  Settings2,
  Sparkles,
  TriangleAlert,
  Trash2,
  Undo2,
  Minus
} from "lucide-react";
import {
  createEmptyPlan,
  createFloor,
  defaultPlanDefaults,
  duplicateFloor,
  type BuildingPlan,
  type FloorPlan,
  type PlanBackdrop,
  type PlanCameraDefinition,
  type PlanSelection,
  type PlanTool,
  type PlanViewMode,
  type Vec2
} from "@/src/domain/planner/types";
import { PlanCanvas } from "@/src/components/planner/PlanCanvas";
import { PlanInspector } from "@/src/components/planner/PlanInspector";
import { computeFloorCoverage } from "@/src/lib/planner/coverage";
import { floorAreaM2, largestClosedWallLoop } from "@/src/lib/planner/geometry";
import {
  optimiseCameraPlacement,
  type SmartPlacementReport
} from "@/src/lib/planner/smart-placement";
import { formatFa } from "@/src/lib/chatbot/persian";

const cameraHousingLabel: Record<PlanCameraDefinition["housing"], string> = {
  bullet: "بولت",
  dome: "دام سقفی",
  turret: "تورت",
  ptz: "PTZ چرخشی"
};

/**
 * Site designer.
 *
 * Owns the whole building: floors, the active floor's geometry, the uploaded backdrop
 * and its scale. Emits a summary upward so the wizard can use the drawn area and camera
 * count instead of asking the user to type a floor area.
 */

export type PlanSummary = {
  totalAreaM2: number;
  floorCount: number;
  cameraCount: number;
  coveredPercent: number;
};

/** `mode` decides which tools exist: the environment is drawn first, cameras are placed later. */
export type DesignerMode = "environment" | "cameras";

const allTools: { id: PlanTool; label: string; icon: typeof MousePointer2; hint: string; modes: DesignerMode[] }[] = [
  { id: "select", label: "انتخاب", icon: MousePointer2, hint: "انتخاب و جابه‌جایی عناصر — دستگیره نارنجی جهت دوربین را می‌چرخاند", modes: ["environment", "cameras"] },
  { id: "wall", label: "دیوار", icon: BrickWall, hint: "کلیک کنید تا زنجیره دیوار بکشید؛ کلیک راست یا Esc پایان", modes: ["environment"] },
  { id: "door", label: "در", icon: DoorOpen, hint: "روی یک دیوار کلیک کنید تا در به همان نقطه متصل شود", modes: ["environment"] },
  { id: "obstacle", label: "مانع", icon: Cuboid, hint: "دو نقطه مقابل هم را بزنید", modes: ["environment"] },
  { id: "camera", label: "افزودن دوربین", icon: CameraIcon, hint: "روی نقشه کلیک کنید تا دوربین اضافه شود", modes: ["cameras"] },
  { id: "measure", label: "اندازه‌گیری", icon: Ruler, hint: "دو نقطه را بزنید تا فاصله را ببینید", modes: ["environment", "cameras"] }
];

export function FloorPlanDesigner({
  plan: controlledPlan,
  mode = "environment",
  cameraDefinitions = [],
  onPlanChange,
  onSummaryChange
}: {
  plan?: BuildingPlan;
  mode?: DesignerMode;
  cameraDefinitions?: PlanCameraDefinition[];
  onPlanChange?: (plan: BuildingPlan) => void;
  onSummaryChange?: (summary: PlanSummary) => void;
}) {
  const [internalPlan, setInternalPlan] = useState<BuildingPlan>(() => controlledPlan ?? createEmptyPlan());
  const plan = controlledPlan ?? internalPlan;
  const tools = useMemo(
    () => allTools.filter((item) => item.modes.includes(mode) && !(mode === "cameras" && item.id === "camera")),
    [mode]
  );

  const [requestedTool, setTool] = useState<PlanTool>("select");
  /* Derived, not stored: switching mode retires tools like "دیوار", and falling back
     here avoids an effect that would setState during render. */
  const tool: PlanTool = tools.some((item) => item.id === requestedTool)
    ? requestedTool
    : "select";
  const [viewMode, setViewMode] = useState<PlanViewMode>("top");
  const [selection, setSelection] = useState<PlanSelection>(null);
  const [showCoverage, setShowCoverage] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [pendingBackdrop, setPendingBackdrop] = useState<PlanBackdrop | null>(null);
  const [showDefaults, setShowDefaults] = useState(false);
  const [smartPlacementReport, setSmartPlacementReport] = useState<SmartPlacementReport | null>(null);
  const [isOptimisingPlacement, setIsOptimisingPlacement] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pastRef = useRef<BuildingPlan[]>([]);
  const futureRef = useRef<BuildingPlan[]>([]);
  const [historyState, setHistoryState] = useState({ past: 0, future: 0 });

  const activeFloor = plan.floors.find((floor) => floor.id === plan.activeFloorId) ?? plan.floors[0];
  const designDefaults = { ...defaultPlanDefaults, ...plan.defaults };
  const placedDefinitionIds = useMemo(
    () => new Set(plan.floors.flatMap((floor) =>
      floor.cameras.map((camera) => camera.definitionId).filter((id): id is string => Boolean(id))
    )),
    [plan.floors]
  );

  const publishPlan = useCallback((next: BuildingPlan) => {
    if (onPlanChange) onPlanChange(next);
    else setInternalPlan(next);

    if (onSummaryChange) {
      const totalAreaM2 = next.floors.reduce((sum, floor) => sum + floorAreaM2(floor.walls), 0);
      const cameraCount = next.floors.reduce((sum, floor) => sum + floor.cameras.length, 0);
      const active = next.floors.find((floor) => floor.id === next.activeFloorId) ?? next.floors[0];
      const coverage = active ? computeFloorCoverage(active, 1.5) : null;
      onSummaryChange({
        totalAreaM2,
        floorCount: next.floors.length,
        cameraCount,
        coveredPercent: coverage?.coveredPercent ?? 0
      });
    }
  }, [onPlanChange, onSummaryChange]);

  const commit = useCallback((next: BuildingPlan) => {
    if (next === plan) return;
    pastRef.current = [...pastRef.current.slice(-99), plan];
    futureRef.current = [];
    setHistoryState({ past: pastRef.current.length, future: 0 });
    publishPlan(next);
  }, [plan, publishPlan]);

  const undo = useCallback(() => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current = [...futureRef.current.slice(-99), plan];
    setHistoryState({ past: pastRef.current.length, future: futureRef.current.length });
    setSelection(null);
    publishPlan(previous);
  }, [plan, publishPlan]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current = [...pastRef.current.slice(-99), plan];
    setHistoryState({ past: pastRef.current.length, future: futureRef.current.length });
    setSelection(null);
    publishPlan(next);
  }, [plan, publishPlan]);

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (key === "z") {
        event.preventDefault();
        undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [redo, undo]);

  const updateFloor = useCallback((floor: FloorPlan) => {
    commit({ ...plan, floors: plan.floors.map((item) => (item.id === floor.id ? floor : item)) });
  }, [commit, plan]);

  const placeDefinedCamera = useCallback((definitionId: string, position: Vec2) => {
    const definition = cameraDefinitions.find((item) => item.id === definitionId);
    if (!definition) {
      setHint("این دوربین دیگر در فهرست تعریف‌شده وجود ندارد");
      return;
    }
    if (plan.floors.some((floor) => floor.cameras.some((camera) => camera.definitionId === definitionId))) {
      setHint("این دوربین قبلاً روی نقشه جانمایی شده است");
      return;
    }
    const camera = {
      id: `cam-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
      definitionId: definition.id,
      zoneId: definition.zoneId,
      groupName: definition.groupName,
      name: definition.name,
      housing: definition.housing,
      features: { ...definition.features },
      position,
      yawDeg: 0,
      goal: definition.goal,
      optics: { ...definition.optics }
    };
    updateFloor({ ...activeFloor, cameras: [...activeFloor.cameras, camera] });
    setSelection({ kind: "camera", id: camera.id });
    setHint(`${definition.name} از گروه «${definition.groupName}» روی نقشه قرار گرفت`);
  }, [activeFloor, cameraDefinitions, plan.floors, updateFloor]);

  const runSmartPlacement = () => {
    if (isOptimisingPlacement) return;
    setIsOptimisingPlacement(true);
    setSmartPlacementReport(null);
    setHint("در حال تحلیل هندسه طبقات، ورودی‌ها، موانع، PPM و نقاط کور...");
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        const result = optimiseCameraPlacement(plan, cameraDefinitions);
        if (result.report.placed > 0) {
          commit(result.plan);
          setViewMode("top");
          setTool("select");
          setSelection(null);
          setShowCoverage(true);
          setHint(
            `${formatFa(result.report.placed)} دوربین جانمایی شد؛ پوشش برآوردی از `
            + `${formatFa(result.report.coverageBeforePercent, 0)}٪ به `
            + `${formatFa(result.report.coverageAfterPercent, 0)}٪ رسید.`
          );
        } else {
          setHint(result.report.warnings[0] || "همه دوربین‌های تعریف‌شده قبلاً جانمایی شده‌اند.");
        }
        setSmartPlacementReport(result.report);
        setIsOptimisingPlacement(false);
      }, 20);
    });
  };

  const coverage = useMemo(() => (activeFloor ? computeFloorCoverage(activeFloor, 1.5) : null), [activeFloor]);
  const areaM2 = useMemo(() => (activeFloor ? floorAreaM2(activeFloor.walls) : 0), [activeFloor]);
  const hasClosedPerimeter = useMemo(
    () => Boolean(activeFloor && largestClosedWallLoop(activeFloor.walls)),
    [activeFloor]
  );

  const addFloor = (copyPrevious: boolean) => {
    const index = plan.floors.length;
    const name = `طبقه ${index + 1}`;
    const source = plan.floors[plan.floors.length - 1];
    const floor = copyPrevious && source ? duplicateFloor(source, name, index) : createFloor(name, index);
    commit({ ...plan, floors: [...plan.floors, floor], activeFloorId: floor.id });
    setSelection(null);
  };

  const removeFloor = (id: string) => {
    if (plan.floors.length <= 1) return;
    const remaining = plan.floors.filter((floor) => floor.id !== id);
    commit({ ...plan, floors: remaining, activeFloorId: remaining[0].id });
    setSelection(null);
  };

  /** Reads the drawing at native size, then hands it to the pointer-based placement flow. */
  const handleBackdropUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const image = new Image();
      image.onload = () => {
        const metresPerPixel = 20 / image.width;
        setPendingBackdrop({
          imageUrl: url,
          widthPx: image.width,
          heightPx: image.height,
          originM: { x: 0, z: 0 },
          metresPerPixel,
          opacity: 0.72,
          calibrated: true
        });
        setViewMode("top");
        setTool("select");
        setSelection(null);
        setHint("تصویر به ماوس متصل است؛ آن را حرکت دهید و برای جای‌گذاری روی نقشه کلیک کنید");
      };
      image.src = url;
    };
    reader.readAsDataURL(file);
  };

  const resetPlan = () => {
    if (!window.confirm("کل نقشه، طبقات، دیوارها، درها، موانع، دوربین‌ها و تصویر پس‌زمینه پاک شوند؟")) return;
    commit(createEmptyPlan());
    setPendingBackdrop(null);
    setSelection(null);
    setTool("select");
    setViewMode("top");
    setHint("نقشه به حالت اولیه بازگشت");
  };

  const backdropControls = pendingBackdrop ?? activeFloor?.backdrop ?? null;

  const updateBackdropAppearance = (patch: Partial<Pick<PlanBackdrop, "metresPerPixel" | "opacity">>) => {
    if (pendingBackdrop) {
      setPendingBackdrop({ ...pendingBackdrop, ...patch });
    } else if (activeFloor?.backdrop) {
      updateFloor({ ...activeFloor, backdrop: { ...activeFloor.backdrop, ...patch } });
    }
  };

  const placePendingBackdrop = (center: Vec2) => {
    if (!pendingBackdrop || !activeFloor) return;
    const widthM = pendingBackdrop.widthPx * pendingBackdrop.metresPerPixel;
    const heightM = pendingBackdrop.heightPx * pendingBackdrop.metresPerPixel;
    updateFloor({
      ...activeFloor,
      backdrop: {
        ...pendingBackdrop,
        originM: { x: center.x - widthM / 2, z: center.z - heightM / 2 },
        calibrated: true
      }
    });
    setPendingBackdrop(null);
    setHint("تصویر روی نقشه قرار گرفت؛ اندازه و شفافیت از پنل سمت راست قابل تنظیم است");
  };

  const startBackdropReposition = () => {
    if (!activeFloor?.backdrop) return;
    setPendingBackdrop({ ...activeFloor.backdrop });
    setViewMode("top");
    setTool("select");
    setSelection(null);
    setHint("تصویر به ماوس متصل است؛ برای ثبت محل جدید روی نقشه کلیک کنید");
  };

  if (!activeFloor) return null;
  const activeTool = tools.find((item) => item.id === tool);

  return (
    <section className="plan-designer">
      <div className="plan-floor-rail">
        <div className="plan-floor-tabs">
          <Layers size={16} aria-hidden="true" />
          {plan.floors.map((floor) => (
            <button
              key={floor.id}
              type="button"
              className={floor.id === plan.activeFloorId ? "active" : ""}
              onClick={() => { publishPlan({ ...plan, activeFloorId: floor.id }); setSelection(null); }}
            >
              {floor.name}
              <small>{formatFa(floor.cameras.length)} دوربین</small>
            </button>
          ))}
        </div>
        {mode === "environment" ? (
          <div className="plan-floor-actions">
            <button type="button" onClick={() => addFloor(false)}><Plus size={15} aria-hidden="true" />طبقه جدید</button>
            <button type="button" onClick={() => addFloor(true)} disabled={!plan.floors.length}>
              <Copy size={15} aria-hidden="true" />تکرار نقشه قبلی
            </button>
            <button type="button" onClick={() => removeFloor(plan.activeFloorId)} disabled={plan.floors.length <= 1}>
              <Trash2 size={15} aria-hidden="true" />حذف طبقه
            </button>
            <button type="button" className="plan-reset-all" onClick={resetPlan}>
              <RotateCcw size={15} aria-hidden="true" />ریست کل نقشه
            </button>
          </div>
        ) : null}
      </div>

      <div className="plan-toolbar plan-ribbon">
        <section className="plan-ribbon-section plan-ribbon-drawing" aria-label="ترسیم و جانمایی">
          <div className="plan-tool-group">
            {tools.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={tool === item.id ? "active" : ""}
                  onClick={() => { setTool(item.id); setSelection(null); setHint(item.hint); }}
                  title={item.hint}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
          <span className="plan-ribbon-label">ترسیم و جانمایی</span>
        </section>

        <section className="plan-ribbon-section" aria-label="نمایش">
          <div className="plan-tool-group">
          <button type="button" className={viewMode === "top" ? "active" : ""} onClick={() => setViewMode("top")}>
            <Grid3x3 size={16} aria-hidden="true" /><span>نمای نقشه</span>
          </button>
          <button
            type="button"
            className={viewMode === "orbit" ? "active" : ""}
            onClick={() => setViewMode("orbit")}
            title="در نمای سه‌بعدی، اسکرول ماوس را نگه دارید و بکشید تا نما بچرخد"
          >
            <Move3d size={16} aria-hidden="true" /><span>نمای سه‌بعدی</span>
          </button>
          <button type="button" className={showCoverage ? "active" : ""} onClick={() => setShowCoverage((value) => !value)}>
            <Eye size={16} aria-hidden="true" /><span>پوشش DORI</span>
          </button>
          </div>
          <span className="plan-ribbon-label">نمایش</span>
        </section>

        <section className="plan-ribbon-section" aria-label="تنظیم نقشه">
          <div className="plan-tool-group">
            <label className="plan-snap-field">
              <span>اسنپ</span>
              <select value={plan.snapM} onChange={(event) => commit({ ...plan, snapM: Number(event.target.value) })}>
                <option value={0}>آزاد</option>
                <option value={0.1}>۱۰ سانتی‌متر</option>
                <option value={0.25}>۲۵ سانتی‌متر</option>
                <option value={0.5}>۵۰ سانتی‌متر</option>
                <option value={1}>۱ متر</option>
              </select>
            </label>
            {mode === "environment" ? (
              <button type="button" onClick={() => fileRef.current?.click()}>
                <ImageIcon size={16} aria-hidden="true" /><span>بارگذاری نقشه</span>
              </button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleBackdropUpload(file);
                event.target.value = "";
              }}
            />
          </div>
          <span className="plan-ribbon-label">تنظیم نقشه</span>
        </section>

        <div className="plan-ribbon-quick plan-history-tools" dir="ltr" aria-label="دسترسی سریع">
          <button
            type="button"
            disabled={historyState.past === 0}
            onClick={undo}
            title="واگرد (Ctrl+Z)"
            aria-label="واگرد"
          >
            <Undo2 size={16} aria-hidden="true" /><span>Undo</span>
          </button>
          <button
            type="button"
            disabled={historyState.future === 0}
            onClick={redo}
            title="از نو (Ctrl+Y)"
            aria-label="از نو"
          >
            <Redo2 size={16} aria-hidden="true" /><span>Redo</span>
          </button>
        </div>
      </div>

      <div className="plan-defaults-section">
        <button
          type="button"
          className={showDefaults ? "plan-defaults-toggle active" : "plan-defaults-toggle"}
          onClick={() => setShowDefaults((value) => !value)}
          aria-expanded={showDefaults}
        >
          <Settings2 size={16} aria-hidden="true" />
          <span>تنظیمات پیش‌فرض طراحی</span>
        </button>
        {showDefaults ? (
          <div className="plan-defaults-panel">
            <div>
              <strong>پیش‌فرض آیتم‌های جدید</strong>
              <small>آیتم‌های موجود تغییر نمی‌کنند و هرکدام از پنل مشخصات قابل ویرایش‌اند.</small>
            </div>
            <DefaultNumberField
              label="ارتفاع دیوار"
              value={designDefaults.wallHeightM}
              min={0.3}
              max={12}
              step={0.1}
              onChange={(wallHeightM) => commit({ ...plan, defaults: { ...designDefaults, wallHeightM } })}
            />
            <DefaultNumberField
              label="ضخامت دیوار"
              value={designDefaults.wallThicknessM}
              min={0.05}
              max={1}
              step={0.05}
              onChange={(wallThicknessM) => commit({ ...plan, defaults: { ...designDefaults, wallThicknessM } })}
            />
            <DefaultNumberField
              label="ارتفاع مانع"
              value={designDefaults.obstacleHeightM}
              min={0.1}
              max={12}
              step={0.1}
              onChange={(obstacleHeightM) => commit({ ...plan, defaults: { ...designDefaults, obstacleHeightM } })}
            />
            <DefaultNumberField
              label="ارتفاع نصب دوربین"
              value={designDefaults.cameraMountHeightM}
              min={1}
              max={15}
              step={0.1}
              onChange={(cameraMountHeightM) => commit({ ...plan, defaults: { ...designDefaults, cameraMountHeightM } })}
            />
          </div>
        ) : null}
      </div>

      <div className={mode === "cameras" ? "plan-workspace plan-workspace-cameras" : "plan-workspace"}>
        {mode === "cameras" ? (
          <div className="plan-camera-library">
            <section className="smart-placement-panel">
              <div className="smart-placement-heading">
                <span className="smart-placement-icon"><Sparkles size={17} aria-hidden="true" /></span>
                <div>
                  <strong>بهینه‌ساز جانمایی هوشمند</strong>
                  <small>تحلیل دیوار، ورودی، مانع، PPM، هم‌پوشانی و نقاط کور</small>
                </div>
                <em>قرارگیری پیشنهادی</em>
              </div>
              <button
                type="button"
                className="smart-placement-action"
                onClick={runSmartPlacement}
                disabled={isOptimisingPlacement || cameraDefinitions.length === 0}
              >
                <Sparkles className={isOptimisingPlacement ? "is-spinning" : undefined} size={16} aria-hidden="true" />
                {isOptimisingPlacement ? "در حال تحلیل عمیق نقشه..." : "تحلیل و ساخت چیدمان پیشنهادی"}
              </button>
              <p>دوربین‌های موجود ثابت می‌مانند؛ فقط موارد جانمایی‌نشده با یک عملیات قابل Undo اضافه می‌شوند.</p>
              {smartPlacementReport ? (
                <div className="smart-placement-result" role="status">
                  <div className="smart-placement-metrics">
                    <span><strong>{formatFa(smartPlacementReport.placed)}</strong> دوربین جدید</span>
                    <span><strong>{formatFa(smartPlacementReport.coverageBeforePercent, 0)}٪</strong> پوشش قبل</span>
                    <span className="is-improved"><strong>{formatFa(smartPlacementReport.coverageAfterPercent, 0)}٪</strong> پوشش پیشنهادی</span>
                  </div>
                  {smartPlacementReport.floorReports.some((floor) => floor.placed > 0) ? (
                    <div className="smart-placement-floors">
                      {smartPlacementReport.floorReports.filter((floor) => floor.placed > 0).map((floor) => (
                        <span key={floor.floorId}>
                          <b>{floor.floorName}</b>
                          {formatFa(floor.placed)} دوربین · {formatFa(floor.coverageAfterPercent, 0)}٪
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {smartPlacementReport.warnings.map((warning) => <small key={warning}>{warning}</small>)}
                </div>
              ) : null}
            </section>
            <CameraInventory
              definitions={cameraDefinitions}
              placedIds={placedDefinitionIds}
            />
          </div>
        ) : null}
        <PlanCanvas
          floor={activeFloor}
          tool={tool}
          viewMode={viewMode}
          selection={selection}
          snapM={plan.snapM}
          defaults={designDefaults}
          pendingBackdrop={pendingBackdrop}
          showCoverage={showCoverage}
          onSelect={setSelection}
          onFloorChange={updateFloor}
          onHint={setHint}
          onDropCamera={mode === "cameras" ? placeDefinedCamera : undefined}
          onPlaceBackdrop={placePendingBackdrop}
          onCancelBackdropPlacement={() => {
            setPendingBackdrop(null);
            setHint(activeFloor.backdrop ? "جابه‌جایی تصویر لغو شد" : "ورود تصویر لغو شد");
          }}
        />
        <div className="plan-workspace-sidebar">
          {backdropControls ? (
            <BackdropControls
              backdrop={backdropControls}
              isPlacing={Boolean(pendingBackdrop)}
              onWidthChange={(widthM) => updateBackdropAppearance({ metresPerPixel: widthM / backdropControls.widthPx })}
              onOpacityChange={(opacity) => updateBackdropAppearance({ opacity })}
              onReposition={startBackdropReposition}
              onCancel={() => {
                setPendingBackdrop(null);
                setHint(activeFloor.backdrop ? "جابه‌جایی تصویر لغو شد" : "ورود تصویر لغو شد");
              }}
              onRemove={() => {
                setPendingBackdrop(null);
                updateFloor({ ...activeFloor, backdrop: undefined });
                setHint("تصویر پس‌زمینه حذف شد");
              }}
            />
          ) : null}
          <PlanInspector
            floor={activeFloor}
            selection={selection}
            activeTool={tool}
            defaults={designDefaults}
            onDefaultsChange={(patch) => commit({ ...plan, defaults: { ...designDefaults, ...patch } })}
            onFloorChange={updateFloor}
            onSelect={setSelection}
          />
        </div>
      </div>

      {activeFloor.walls.length > 0 && !hasClosedPerimeter ? (
        <div className="plan-closure-warning" role="status">
          <TriangleAlert size={17} aria-hidden="true" />
          <div>
            <strong>مساحت هنوز قابل محاسبه نیست</strong>
            <span>دیوارها باید یک محیط کاملاً بسته بسازند؛ انتهای آخرین دیوار را به نقطه شروع متصل کنید.</span>
          </div>
        </div>
      ) : null}

      <div className="plan-statusbar">
        <span className="plan-hint">{hint ?? activeTool?.hint}</span>
        <div className="plan-metrics">
          <span className="plan-grid-readout" title="خطوط پررنگ شبکه هر ۵ متر تکرار می‌شوند">
            <Grid3x3 size={13} aria-hidden="true" />
            شبکه {formatFa(plan.gridSizeM)} متر · اسنپ {plan.snapM > 0 ? `${formatFa(plan.snapM)} متر` : "آزاد"}
          </span>
          <span>
            <strong>{hasClosedPerimeter ? formatFa(areaM2, 1) : "—"}</strong>
            {hasClosedPerimeter ? " متر مربع" : " مساحت نامعتبر"}
          </span>
          <span><strong>{formatFa(activeFloor.walls.length)}</strong> دیوار</span>
          <span><strong>{formatFa((activeFloor.doors ?? []).length)}</strong> در</span>
          <span><strong>{formatFa(activeFloor.obstacles.length)}</strong> مانع</span>
          <span><strong>{formatFa(activeFloor.cameras.length)}</strong> دوربین</span>
          {coverage ? <span><strong>{formatFa(coverage.coveredPercent, 0)}٪</strong> پوشش</span> : null}
          {coverage ? <span><strong>{formatFa(coverage.identifyPercent, 0)}٪</strong> سطح شناسایی</span> : null}
        </div>
      </div>
    </section>
  );
}

function CameraInventory({
  definitions,
  placedIds
}: {
  definitions: PlanCameraDefinition[];
  placedIds: Set<string>;
}) {
  const groups = definitions.reduce<Array<{ id: string; name: string; cameras: PlanCameraDefinition[] }>>((result, camera) => {
    const group = result.find((item) => item.id === camera.zoneId);
    if (group) group.cameras.push(camera);
    else result.push({ id: camera.zoneId, name: camera.groupName, cameras: [camera] });
    return result;
  }, []);

  return (
    <aside className="camera-inventory" aria-label="دوربین‌های تعریف‌شده">
      <header>
        <CameraIcon size={18} aria-hidden="true" />
        <div><strong>دوربین‌های تعریف‌شده</strong><small>دوربین را بکشید و روی نقشه رها کنید</small></div>
      </header>
      {groups.length > 0 ? (
        <div className="camera-inventory-groups">
          {groups.map((group) => {
            const placedCount = group.cameras.filter((camera) => placedIds.has(camera.id)).length;
            return (
              <section key={group.id} className="camera-inventory-group">
                <div className="camera-inventory-group-head">
                  <strong>{group.name}</strong>
                  <span>{formatFa(placedCount)} / {formatFa(group.cameras.length)}</span>
                </div>
                <div className="camera-inventory-list">
                  {group.cameras.map((camera) => {
                    const placed = placedIds.has(camera.id);
                    return (
                      <button
                        key={camera.id}
                        type="button"
                        className={placed ? "camera-inventory-card is-placed" : "camera-inventory-card"}
                        draggable={!placed}
                        disabled={placed}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "copy";
                          event.dataTransfer.setData("application/x-hamyar-camera", camera.id);
                          event.dataTransfer.setData("text/plain", camera.id);
                          const previousGhost = document.querySelector(".camera-drag-ghost");
                          previousGhost?.remove();
                          const ghost = document.createElement("div");
                          ghost.className = `camera-drag-ghost is-${camera.housing}`;
                          ghost.setAttribute("aria-hidden", "true");
                          const coverage = document.createElement("span");
                          coverage.className = "camera-drag-ghost-coverage";
                          const cameraBody = document.createElement("span");
                          cameraBody.className = "camera-drag-ghost-body";
                          const cameraLens = document.createElement("span");
                          cameraLens.className = "camera-drag-ghost-lens";
                          const cameraBracket = document.createElement("span");
                          cameraBracket.className = "camera-drag-ghost-bracket";
                          cameraBody.append(cameraLens);
                          ghost.append(coverage, cameraBracket, cameraBody);
                          document.body.append(ghost);
                          event.dataTransfer.setDragImage(ghost, 24, 32);
                        }}
                        onDragEnd={() => document.querySelector(".camera-drag-ghost")?.remove()}
                        title={placed ? "این دوربین جانمایی شده است؛ برای استفاده دوباره ابتدا آن را از نقشه حذف کنید" : "برای جانمایی روی نقشه بکشید"}
                      >
                        <CameraIcon size={17} aria-hidden="true" />
                        <span><strong>{camera.name}</strong><small>{camera.optics.megapixel}MP · {camera.optics.focalMm}mm · {cameraHousingLabel[camera.housing]}</small></span>
                        {placed ? <Check size={15} aria-hidden="true" /> : <span className="camera-drag-grip" aria-hidden="true">⠿</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <p className="camera-inventory-empty">ابتدا در بالای همین مرحله یک گروه و حداقل یک دوربین تعریف کنید.</p>
      )}
    </aside>
  );
}

function DefaultNumberField({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="plan-default-number">
      <span>{label}</span>
      <div>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) onChange(Math.min(max, Math.max(min, parsed)));
          }}
        />
        <small>متر</small>
      </div>
    </label>
  );
}

function BackdropControls({
  backdrop,
  isPlacing,
  onWidthChange,
  onOpacityChange,
  onReposition,
  onCancel,
  onRemove
}: {
  backdrop: PlanBackdrop;
  isPlacing: boolean;
  onWidthChange: (widthM: number) => void;
  onOpacityChange: (opacity: number) => void;
  onReposition: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const widthM = backdrop.widthPx * backdrop.metresPerPixel;
  return (
    <aside className={isPlacing ? "plan-backdrop-controls is-placing" : "plan-backdrop-controls"}>
      <header>
        <ImageIcon size={17} aria-hidden="true" />
        <div>
          <strong>{isPlacing ? "جای‌گذاری تصویر" : "تصویر زمینه نقشه"}</strong>
          <small>{isPlacing ? "تصویر را با ماوس حرکت دهید و روی محل دلخواه کلیک کنید" : "اندازه و شفافیت تصویر را تنظیم کنید"}</small>
        </div>
      </header>
      <label>
        <span><b>عرض تصویر</b><output>{formatFa(widthM, 1)} متر</output></span>
        <input type="range" min={2} max={200} step={0.5} value={widthM} onChange={(event) => onWidthChange(Number(event.target.value))} />
      </label>
      <label>
        <span><b>شفافیت</b><output>{formatFa(backdrop.opacity * 100, 0)}٪</output></span>
        <input type="range" min={0.15} max={1} step={0.05} value={backdrop.opacity} onChange={(event) => onOpacityChange(Number(event.target.value))} />
      </label>
      <div className="plan-backdrop-actions">
        {isPlacing ? (
          <button type="button" onClick={onCancel}>لغو جای‌گذاری</button>
        ) : (
          <button type="button" onClick={onReposition}><Move3d size={14} aria-hidden="true" />جابه‌جایی تصویر</button>
        )}
        <button type="button" className="plan-remove-backdrop" onClick={onRemove}>
          <Minus size={14} aria-hidden="true" />حذف تصویر
        </button>
      </div>
    </aside>
  );
}
