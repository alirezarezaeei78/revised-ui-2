"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrickWall,
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
  type PlanSelection,
  type PlanTool,
  type PlanViewMode,
  type Vec2
} from "@/src/domain/planner/types";
import { PlanCanvas } from "@/src/components/planner/PlanCanvas";
import { PlanInspector } from "@/src/components/planner/PlanInspector";
import { computeFloorCoverage } from "@/src/lib/planner/coverage";
import { floorAreaM2, traceWallLoop } from "@/src/lib/planner/geometry";
import { formatFa } from "@/src/lib/chatbot/persian";

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
  onPlanChange,
  onSummaryChange
}: {
  plan?: BuildingPlan;
  mode?: DesignerMode;
  onPlanChange?: (plan: BuildingPlan) => void;
  onSummaryChange?: (summary: PlanSummary) => void;
}) {
  const [internalPlan, setInternalPlan] = useState<BuildingPlan>(() => controlledPlan ?? createEmptyPlan());
  const plan = controlledPlan ?? internalPlan;
  const tools = useMemo(() => allTools.filter((item) => item.modes.includes(mode)), [mode]);

  const [requestedTool, setTool] = useState<PlanTool>("select");
  /* Derived, not stored: switching mode retires tools like "دیوار", and falling back
     here avoids an effect that would setState during render. */
  const tool: PlanTool = tools.some((item) => item.id === requestedTool)
    ? requestedTool
    : mode === "cameras" ? "camera" : "select";
  const [viewMode, setViewMode] = useState<PlanViewMode>("top");
  const [selection, setSelection] = useState<PlanSelection>(null);
  const [showCoverage, setShowCoverage] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [pendingBackdrop, setPendingBackdrop] = useState<PlanBackdrop | null>(null);
  const [showDefaults, setShowDefaults] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pastRef = useRef<BuildingPlan[]>([]);
  const futureRef = useRef<BuildingPlan[]>([]);
  const [historyState, setHistoryState] = useState({ past: 0, future: 0 });

  const activeFloor = plan.floors.find((floor) => floor.id === plan.activeFloorId) ?? plan.floors[0];
  const designDefaults = { ...defaultPlanDefaults, ...plan.defaults };

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

  const coverage = useMemo(() => (activeFloor ? computeFloorCoverage(activeFloor, 1.5) : null), [activeFloor]);
  const areaM2 = useMemo(() => (activeFloor ? floorAreaM2(activeFloor.walls) : 0), [activeFloor]);
  const hasClosedPerimeter = useMemo(
    () => Boolean(activeFloor && traceWallLoop(activeFloor.walls)),
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

      <div className="plan-toolbar">
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

        <div className="plan-tool-group plan-history-tools" dir="ltr">
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

      <div className="plan-workspace">
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
