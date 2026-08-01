"use client";

import { BrickWall, Camera, Compass, Cuboid, DoorOpen, Ruler, Trash2 } from "lucide-react";
import type { FloorPlan, PlanDefaults, PlanObstacle, PlanSelection, PlanTool, WallDrawMode } from "@/src/domain/planner/types";
import type { CameraHousing, SurveillanceTask } from "@/src/domain/catalog/types";
import { cameraFovDeg, computeCameraCoverage, focalForTask } from "@/src/lib/planner/coverage";
import { collectOccluders } from "@/src/lib/planner/geometry";
import { sensorOptions } from "@/src/lib/chatbot/slots";
import { formatFa } from "@/src/lib/chatbot/persian";
import { applyObstaclePreset, obstaclePreset, obstaclePresets } from "@/src/lib/planner/obstacle-presets";

/**
 * Property editor for whatever is selected.
 *
 * Camera optics live on the placement itself, so a plate reader on the ramp and a wide
 * turret over the till can sit on the same floor with different lenses, sensors and
 * mounting heights.
 */

const taskLabels: Record<SurveillanceTask, string> = {
  monitor: "دید کلی",
  "face-capture": "ثبت چهره",
  "face-identify": "شناسایی چهره",
  "plate-capture": "ثبت پلاک",
  anpr: "پلاک‌خوانی خودکار"
};

const megapixelOptions = [2, 3, 4, 5, 6, 8, 12];

const housingBehavior: Record<CameraHousing, { title: string; description: string }> = {
  bullet: {
    title: "دید ثابت و جهت‌دار",
    description: "مناسب پیرامون و مسیرهای طولی؛ محل نصب دیواری و جهت دید آن ثابت است."
  },
  dome: {
    title: "نصب سقفی و پوشش کم‌جلب‌توجه",
    description: "لنز داخل محفظه دام ثابت است؛ جهت دید دارد اما ظاهر آن جهت دوربین را کمتر آشکار می‌کند."
  },
  turret: {
    title: "تنظیم‌پذیر دیواری یا سقفی",
    description: "هد دوربین آزادانه تنظیم می‌شود و برای فضاهای داخلی با دسترسی ساده‌تر مناسب است."
  },
  ptz: {
    title: "گشت چرخشی ۳۶۰ درجه",
    description: "محدوده نمایش‌داده‌شده پوشش بالقوه گشت PTZ است؛ همه جهت‌ها به‌صورت هم‌زمان ضبط نمی‌شوند."
  }
};

export function PlanInspector({
  floor,
  selection,
  activeTool,
  wallDrawMode,
  defaults,
  onDefaultsChange,
  onFloorChange,
  onSelect
}: {
  floor: FloorPlan;
  selection: PlanSelection;
  activeTool: PlanTool;
  wallDrawMode: WallDrawMode;
  defaults: PlanDefaults;
  onDefaultsChange: (patch: Partial<PlanDefaults>) => void;
  onFloorChange: (floor: FloorPlan) => void;
  onSelect: (selection: PlanSelection) => void;
}) {
  if (!selection) {
    if (activeTool === "wall") {
      return (
        <aside className="plan-inspector plan-tool-inspector">
          <header><BrickWall size={18} aria-hidden="true" /><strong>مشخصات دیوار در حال رسم</strong></header>
          <p>{wallDrawMode === "line"
            ? "با انتخاب دو نقطه، یک دیوار خطی ساخته می‌شود."
            : "با انتخاب دو گوشه، چهار ضلع یک فضای مستطیلی ساخته می‌شود."} این مقادیر روی دیوارهای جدید اعمال خواهند شد.</p>
          <NumberField label="ارتفاع دیوار" unit="متر" value={defaults.wallHeightM} min={0.3} max={12} step={0.1} onChange={(wallHeightM) => onDefaultsChange({ wallHeightM })} />
          <NumberField label="ضخامت دیوار" unit="متر" value={defaults.wallThicknessM} min={0.05} max={1} step={0.05} onChange={(wallThicknessM) => onDefaultsChange({ wallThicknessM })} />
          <div className="plan-tool-tip"><Ruler size={15} aria-hidden="true" /><span>{wallDrawMode === "line"
            ? "نقطه شروع را کلیک کنید؛ طول دیوار با حرکت ماوس نمایش داده می‌شود و کلیک دوم آن را می‌سازد."
            : "گوشه اول را کلیک کنید؛ با حرکت ماوس طول و عرض زنده نمایش داده می‌شود و کلیک دوم مستطیل را می‌سازد."}</span></div>
        </aside>
      );
    }

    if (activeTool === "obstacle") {
      return (
        <aside className="plan-inspector plan-tool-inspector">
          <header><Cuboid size={18} aria-hidden="true" /><strong>مشخصات مانع جدید</strong></header>
          <p>این ابزار فقط برای رسم مانع سفارشی است. ماشین، درخت و پله هرکدام ابزار جداگانه بالای نقشه دارند.</p>
          <NumberField label="ارتفاع پیش‌فرض" unit="متر" value={defaults.obstacleHeightM} min={0.1} max={12} step={0.1} onChange={(obstacleHeightM) => onDefaultsChange({ obstacleHeightM })} />
          <div className="plan-tool-tip"><span>نقطه اول و سپس گوشه مقابل مانع را انتخاب کنید.</span></div>
        </aside>
      );
    }

    if (activeTool === "camera") {
      return (
        <aside className="plan-inspector plan-tool-inspector">
          <header><Camera size={18} aria-hidden="true" /><strong>مشخصات دوربین جدید</strong></header>
          <p>ارتفاع زیر روی دوربین‌های جدید اعمال می‌شود؛ لنز و جهت هر دوربین بعد از جای‌گذاری قابل تنظیم است.</p>
          <NumberField label="ارتفاع نصب" unit="متر" value={defaults.cameraMountHeightM} min={1} max={15} step={0.1} onChange={(cameraMountHeightM) => onDefaultsChange({ cameraMountHeightM })} />
          <div className="plan-tool-tip"><span>برای افزودن دوربین روی موقعیت موردنظر کلیک کنید.</span></div>
        </aside>
      );
    }

    if (activeTool === "door") {
      return (
        <aside className="plan-inspector plan-tool-inspector">
          <header><DoorOpen size={18} aria-hidden="true" /><strong>افزودن در</strong></header>
          <p>روی بدنه یک دیوار کلیک کنید. پس از جای‌گذاری، عرض، ارتفاع، سمت لولا و زاویه بازشدگی همین‌جا نمایش داده می‌شوند.</p>
          <div className="plan-field-readout"><span>عرض اولیه</span><strong>۰٫۹ متر</strong></div>
          <div className="plan-field-readout"><span>ارتفاع اولیه</span><strong>۲٫۱ متر</strong></div>
          <div className="plan-tool-tip"><span>درها به دیوار متصل می‌مانند و با حذف دیوار پاک می‌شوند.</span></div>
        </aside>
      );
    }

    return (
      <aside className="plan-inspector plan-inspector-empty">
        <Compass size={26} aria-hidden="true" />
        <strong>چیزی انتخاب نشده</strong>
        <p>با ابزار «انتخاب» روی دیوار، در، مانع یا دوربین کلیک کنید تا مشخصاتش را اینجا تنظیم کنید.</p>
      </aside>
    );
  }

  if (selection.kind === "wall") {
    const wall = floor.walls.find((item) => item.id === selection.id);
    if (!wall) return null;
    const span = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z);
    const update = (patch: Partial<typeof wall>) => {
      const nextHeight = patch.heightM ?? wall.heightM;
      onFloorChange({
        ...floor,
        walls: floor.walls.map((item) => (item.id === wall.id ? { ...item, ...patch } : item)),
        doors: (floor.doors ?? []).map((door) =>
          door.wallId === wall.id && door.heightM >= nextHeight
            ? { ...door, heightM: Math.max(0.5, nextHeight - 0.1) }
            : door
        )
      });
    };

    return (
      <aside className="plan-inspector">
        <header><Ruler size={17} aria-hidden="true" /><strong>دیوار</strong></header>
        <div className="plan-field-readout"><span>طول</span><strong>{span.toFixed(2)} متر</strong></div>
        <NumberField label="ارتفاع" unit="متر" value={wall.heightM} min={0.3} max={12} step={0.1} onChange={(value) => update({ heightM: value })} />
        <NumberField label="ضخامت" unit="متر" value={wall.thicknessM} min={0.05} max={1} step={0.05} onChange={(value) => update({ thicknessM: value })} />
        <label className="plan-check">
          <input type="checkbox" checked={wall.blocksView} onChange={(event) => update({ blocksView: event.target.checked })} />
          <span>مانع دید است (شیشه را بردارید)</span>
        </label>
        <button type="button" className="plan-delete" onClick={() => {
          onFloorChange({
            ...floor,
            walls: floor.walls.filter((item) => item.id !== wall.id),
            doors: (floor.doors ?? []).filter((door) => door.wallId !== wall.id)
          });
          onSelect(null);
        }}>
          <Trash2 size={15} aria-hidden="true" />حذف دیوار
        </button>
      </aside>
    );
  }

  if (selection.kind === "door") {
    const door = (floor.doors ?? []).find((item) => item.id === selection.id);
    if (!door) return null;
    const wall = floor.walls.find((item) => item.id === door.wallId);
    if (!wall) return null;
    const wallLengthM = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z);
    const update = (patch: Partial<typeof door>) => {
      const nextWidthM = Math.min(patch.widthM ?? door.widthM, Math.max(0.5, wallLengthM - 0.2));
      const edgeOffset = Math.min(0.49, (nextWidthM / 2 + 0.1) / wallLengthM);
      const nextOffset = Math.max(edgeOffset, Math.min(1 - edgeOffset, patch.offset ?? door.offset));
      onFloorChange({
        ...floor,
        doors: (floor.doors ?? []).map((item) =>
          item.id === door.id ? { ...item, ...patch, widthM: nextWidthM, offset: nextOffset } : item
        )
      });
    };

    return (
      <aside className="plan-inspector">
        <header><DoorOpen size={17} aria-hidden="true" /><strong>در</strong></header>
        <div className="plan-field-readout"><span>دیوار میزبان</span><strong>{wallLengthM.toFixed(2)} متر</strong></div>
        <NumberField
          label="عرض در"
          unit="متر"
          value={door.widthM}
          min={0.5}
          max={Math.max(0.5, wallLengthM - 0.2)}
          step={0.05}
          onChange={(widthM) => update({ widthM })}
        />
        <NumberField
          label="ارتفاع در"
          unit="متر"
          value={door.heightM}
          min={0.5}
          max={Math.max(0.5, wall.heightM - 0.1)}
          step={0.05}
          onChange={(heightM) => update({ heightM })}
        />
        <NumberField
          label="موقعیت روی دیوار"
          unit="درصد"
          value={Math.round(door.offset * 100)}
          min={5}
          max={95}
          step={1}
          onChange={(offsetPercent) => update({ offset: offsetPercent / 100 })}
        />
        <label className="plan-text-field">
          <span>سمت لولا</span>
          <select value={door.hinge} onChange={(event) => update({ hinge: event.target.value as typeof door.hinge })}>
            <option value="start">ابتدای بازشو</option>
            <option value="end">انتهای بازشو</option>
          </select>
        </label>
        <NumberField
          label="میزان بازشدگی"
          unit="درجه"
          value={door.openAngleDeg}
          min={0}
          max={90}
          step={5}
          onChange={(openAngleDeg) => update({ openAngleDeg })}
        />
        <button type="button" className="plan-delete" onClick={() => {
          onFloorChange({ ...floor, doors: (floor.doors ?? []).filter((item) => item.id !== door.id) });
          onSelect(null);
        }}>
          <Trash2 size={15} aria-hidden="true" />حذف در
        </button>
      </aside>
    );
  }

  if (selection.kind === "obstacle") {
    const obstacle = floor.obstacles.find((item) => item.id === selection.id);
    if (!obstacle) return null;
    const update = (patch: Partial<typeof obstacle>) =>
      onFloorChange({ ...floor, obstacles: floor.obstacles.map((item) => (item.id === obstacle.id ? { ...item, ...patch } : item)) });

    return (
      <aside className="plan-inspector">
        <header><Ruler size={17} aria-hidden="true" /><strong>مانع</strong></header>
        <label className="plan-text-field">
          <span>نوع مانع</span>
          <select
            value={obstacle.variant ?? "custom"}
            onChange={(event) => {
              const preset = obstaclePreset(event.target.value as PlanObstacle["variant"]);
              if (preset) update(applyObstaclePreset(obstacle, preset));
              else update({ kind: "block", variant: undefined });
            }}
          >
            <option value="custom">مانع سفارشی</option>
            <optgroup label="خودروها">
              {obstaclePresets.filter((item) => item.group === "vehicle").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </optgroup>
            <optgroup label="درخت‌ها">
              {obstaclePresets.filter((item) => item.group === "tree").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </optgroup>
            <optgroup label="سازه‌ها">
              {obstaclePresets.filter((item) => item.group === "structure").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </optgroup>
          </select>
        </label>
        <label className="plan-text-field">
          <span>نام</span>
          <input value={obstacle.label} onChange={(event) => update({ label: event.target.value })} />
        </label>
        <NumberField label="طول" unit="متر" value={obstacle.widthM} min={0.1} max={60} step={0.1} onChange={(value) => update({ widthM: value })} />
        <NumberField label="عرض" unit="متر" value={obstacle.depthM} min={0.1} max={60} step={0.1} onChange={(value) => update({ depthM: value })} />
        <NumberField label="ارتفاع" unit="متر" value={obstacle.heightM} min={0.1} max={12} step={0.1} onChange={(value) => update({ heightM: value })} />
        <NumberField label="چرخش" unit="درجه" value={obstacle.rotationDeg} min={0} max={359} step={5} onChange={(value) => update({ rotationDeg: value })} />
        <label className="plan-check">
          <input type="checkbox" checked={obstacle.blocksView} onChange={(event) => update({ blocksView: event.target.checked })} />
          <span>جلوی دید دوربین را می‌گیرد</span>
        </label>
        <button type="button" className="plan-delete" onClick={() => { onFloorChange({ ...floor, obstacles: floor.obstacles.filter((item) => item.id !== obstacle.id) }); onSelect(null); }}>
          <Trash2 size={15} aria-hidden="true" />حذف مانع
        </button>
      </aside>
    );
  }

  const camera = floor.cameras.find((item) => item.id === selection.id);
  if (!camera) return null;

  const update = (patch: Partial<typeof camera>) =>
    onFloorChange({ ...floor, cameras: floor.cameras.map((item) => (item.id === camera.id ? { ...item, ...patch } : item)) });
  const updateOptics = (patch: Partial<typeof camera.optics>) => update({ optics: { ...camera.optics, ...patch } });

  const coverage = computeCameraCoverage(camera, collectOccluders(floor.walls, floor.obstacles, floor.doors), 48);
  const fov = cameraFovDeg(camera);

  if (camera.definitionId) {
    const housing = camera.housing === "bullet" ? "بولت"
      : camera.housing === "dome" ? "دام"
        : camera.housing === "ptz" ? "چرخشی PTZ" : "تورت";
    const features = [
      camera.features?.microphone ? "میکروفون" : "",
      camera.features?.colorNightVision ? "دید در شب رنگی" : "",
      camera.features?.weatherproof ? "مقاوم فضای باز" : ""
    ].filter(Boolean);
    const behavior = housingBehavior[camera.housing ?? "turret"];

    return (
      <aside className="plan-inspector plan-defined-camera-inspector">
        <header><Camera size={17} aria-hidden="true" /><strong>{camera.name}</strong></header>
        <div className="plan-defined-camera-group"><span>گروه</span><strong>{camera.groupName || "بدون گروه"}</strong></div>
        <div className={`plan-camera-housing-note is-${camera.housing ?? "turret"}`}>
          <Compass size={16} aria-hidden="true" />
          <div><strong>{behavior.title}</strong><span>{behavior.description}</span></div>
        </div>
        <p>مشخصات فنی این دوربین از گروه تعریف‌شده می‌آید و در مرحله جانمایی قفل است.</p>
        <div className="plan-field-grid">
          <div className="plan-field-readout"><span>نوع بدنه</span><strong>{housing}</strong></div>
          <div className="plan-field-readout"><span>هدف</span><strong>{taskLabels[camera.goal]}</strong></div>
          <div className="plan-field-readout"><span>رزولوشن</span><strong>{camera.optics.megapixel} MP</strong></div>
          <div className="plan-field-readout"><span>لنز</span><strong>{camera.optics.focalMm} mm</strong></div>
          <div className="plan-field-readout"><span>ارتفاع نصب</span><strong>{camera.optics.mountHeightM} متر</strong></div>
          <div className="plan-field-readout"><span>برد مؤثر</span><strong>{camera.optics.maxRangeM} متر</strong></div>
        </div>
        {features.length > 0 ? <div className="plan-camera-feature-chips">{features.map((feature) => <span key={feature}>{feature}</span>)}</div> : null}
        <NumberField
          label={camera.housing === "ptz" ? "جهت اولیه گشت PTZ" : "جهت دوربین"}
          unit="درجه"
          value={camera.yawDeg}
          min={0}
          max={359}
          step={5}
          onChange={(value) => update({ yawDeg: value })}
        />
        <div className="plan-dori-readout">
          <div><span>زاویه دید</span><strong>{fov.toFixed(1)}°</strong></div>
          <div><span>کشف</span><strong>{formatFa(coverage.doriDistances.detect, 1)} m</strong></div>
          <div><span>بازشناسی</span><strong>{formatFa(coverage.doriDistances.recognize, 1)} m</strong></div>
          <div><span>شناسایی</span><strong>{formatFa(coverage.doriDistances.identify, 1)} m</strong></div>
        </div>
        <button type="button" className="plan-delete" onClick={() => { onFloorChange({ ...floor, cameras: floor.cameras.filter((item) => item.id !== camera.id) }); onSelect(null); }}>
          <Trash2 size={15} aria-hidden="true" />برداشتن از نقشه
        </button>
      </aside>
    );
  }

  return (
    <aside className="plan-inspector">
      <header><Camera size={17} aria-hidden="true" /><strong>دوربین</strong></header>

      <label className="plan-text-field">
        <span>نام</span>
        <input value={camera.name} onChange={(event) => update({ name: event.target.value })} />
      </label>

      <label className="plan-text-field">
        <span>هدف نظارتی</span>
        <select value={camera.goal} onChange={(event) => update({ goal: event.target.value as SurveillanceTask })}>
          {Object.entries(taskLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>

      <div className="plan-field-grid">
        <label className="plan-text-field">
          <span>رزولوشن</span>
          <select value={camera.optics.megapixel} onChange={(event) => updateOptics({ megapixel: Number(event.target.value) })}>
            {megapixelOptions.map((value) => <option key={value} value={value}>{value} مگاپیکسل</option>)}
          </select>
        </label>
        <label className="plan-text-field">
          <span>سنسور</span>
          <select value={camera.optics.sensorWidthMm} onChange={(event) => updateOptics({ sensorWidthMm: Number(event.target.value) })}>
            {Object.entries(sensorOptions).map(([label, width]) => <option key={label} value={width}>{label} اینچ</option>)}
          </select>
        </label>
      </div>

      <NumberField label="فاصله کانونی" unit="میلی‌متر" value={camera.optics.focalMm} min={1} max={80} step={0.5} onChange={(value) => updateOptics({ focalMm: value })} />
      <NumberField label="ارتفاع نصب" unit="متر" value={camera.optics.mountHeightM} min={1} max={15} step={0.1} onChange={(value) => updateOptics({ mountHeightM: value })} />
      <NumberField label="زاویه چرخش" unit="درجه" value={camera.yawDeg} min={0} max={359} step={5} onChange={(value) => update({ yawDeg: value })} />
      <NumberField label="بُرد مؤثر" unit="متر" value={camera.optics.maxRangeM} min={2} max={120} step={1} onChange={(value) => updateOptics({ maxRangeM: value })} />

      <button
        type="button"
        className="plan-fit-button"
        onClick={() => {
          const suggested = focalForTask(camera.goal, camera.optics.maxRangeM * 0.7, camera.optics.megapixel, camera.optics.sensorWidthMm);
          if (suggested > 0) updateOptics({ focalMm: Math.round(suggested * 10) / 10 });
        }}
      >
        تنظیم خودکار لنز برای «{taskLabels[camera.goal]}»
      </button>

      <div className="plan-dori-readout">
        <div><span>زاویه دید</span><strong>{fov.toFixed(1)}°</strong></div>
        <div><span>کشف</span><strong>{formatFa(coverage.doriDistances.detect, 1)} m</strong></div>
        <div><span>مشاهده</span><strong>{formatFa(coverage.doriDistances.observe, 1)} m</strong></div>
        <div><span>بازشناسی</span><strong>{formatFa(coverage.doriDistances.recognize, 1)} m</strong></div>
        <div><span>شناسایی</span><strong>{formatFa(coverage.doriDistances.identify, 1)} m</strong></div>
      </div>

      <button type="button" className="plan-delete" onClick={() => { onFloorChange({ ...floor, cameras: floor.cameras.filter((item) => item.id !== camera.id) }); onSelect(null); }}>
        <Trash2 size={15} aria-hidden="true" />حذف دوربین
      </button>
    </aside>
  );
}

function NumberField({
  label, unit, value, min, max, step, onChange
}: { label: string; unit: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return (
    <label className="plan-number-field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) onChange(Math.min(max, Math.max(min, parsed)));
          }}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}
