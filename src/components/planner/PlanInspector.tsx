"use client";

import { Blinds, BrickWall, Camera, Compass, Cuboid, DoorOpen, Layers, Ruler, Trash2, X } from "lucide-react";
import {
  soleSelection,
  type FloorPlan,
  type PlanDefaults,
  type PlanObstacle,
  type PlanSelection,
  type PlanSelectionRef,
  type PlanTool,
  type WallDrawMode
} from "@/src/domain/planner/types";
import { deleteSelection, describeElement, summariseSelection } from "@/src/lib/planner/selection";
import type { CameraHousing, SurveillanceTask } from "@/src/domain/catalog/types";
import { cameraFovDeg, computeCameraCoverage, focalForTask } from "@/src/lib/planner/coverage";
import { collectOccluders } from "@/src/lib/planner/geometry";
import { sensorOptions } from "@/src/lib/chatbot/slots";
import { housingLabels } from "@/src/lib/planner/camera-templates";
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
  /*
   * A plural selection replaces the property editor entirely.
   *
   * Editing one element's lens or wall height means nothing when twelve things are
   * selected, so the panel switches to what is actually actionable in bulk: seeing what
   * is held, and removing it.
   */
  if (selection.length > 1) {
    return (
      <MultiSelectionPanel
        floor={floor}
        selection={selection}
        onFloorChange={onFloorChange}
        onSelect={onSelect}
      />
    );
  }

  const sole = soleSelection(selection);
  if (!sole) {
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

  if (sole.kind === "wall") {
    const wall = floor.walls.find((item) => item.id === sole.id);
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
        <header>
          <Ruler size={17} aria-hidden="true" /><strong>دیوار</strong>
          <DeleteAction
            label="حذف دیوار"
            onDelete={() => {
              onFloorChange({
                ...floor,
                walls: floor.walls.filter((item) => item.id !== wall.id),
                doors: (floor.doors ?? []).filter((door) => door.wallId !== wall.id)
              });
              onSelect([]);
            }}
          />
        </header>
        <div className="plan-field-readout"><span>طول</span><strong>{span.toFixed(2)} متر</strong></div>
        <NumberField label="ارتفاع" unit="متر" value={wall.heightM} min={0.3} max={12} step={0.1} onChange={(value) => update({ heightM: value })} />
        <NumberField label="ضخامت" unit="متر" value={wall.thicknessM} min={0.05} max={1} step={0.05} onChange={(value) => update({ thicknessM: value })} />
        <label className="plan-check">
          <input type="checkbox" checked={wall.blocksView} onChange={(event) => update({ blocksView: event.target.checked })} />
          <span>مانع دید است (شیشه را بردارید)</span>
        </label>
      </aside>
    );
  }

  if (sole.kind === "door") {
    const door = (floor.doors ?? []).find((item) => item.id === sole.id);
    if (!door) return null;
    const wall = floor.walls.find((item) => item.id === door.wallId);
    if (!wall) return null;
    const isWindow = door.type === "window";
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
        <header>
          {isWindow ? <Blinds size={17} aria-hidden="true" /> : <DoorOpen size={17} aria-hidden="true" />}
          <strong>{isWindow ? "پنجره" : "در"}</strong>
          <DeleteAction
            label={isWindow ? "حذف پنجره" : "حذف در"}
            onDelete={() => {
              onFloorChange({ ...floor, doors: (floor.doors ?? []).filter((item) => item.id !== door.id) });
              onSelect([]);
            }}
          />
        </header>
        <div className="plan-field-readout"><span>دیوار میزبان</span><strong>{wallLengthM.toFixed(2)} متر</strong></div>
        <NumberField
          label={isWindow ? "عرض پنجره" : "عرض در"}
          unit="متر"
          value={door.widthM}
          min={0.5}
          max={Math.max(0.5, wallLengthM - 0.2)}
          step={0.05}
          onChange={(widthM) => update({ widthM })}
        />
        <NumberField
          label={isWindow ? "ارتفاع پنجره" : "ارتفاع در"}
          unit="متر"
          value={door.heightM}
          min={0.5}
          max={Math.max(0.5, wall.heightM - 0.1)}
          step={0.05}
          onChange={(heightM) => update({ heightM })}
        />
        {isWindow ? (
          <NumberField
            label="ارتفاع کف پنجره"
            unit="متر"
            value={door.sillHeightM ?? 0.9}
            min={0}
            max={Math.max(0, wall.heightM - door.heightM - 0.05)}
            step={0.05}
            onChange={(sillHeightM) => update({ sillHeightM })}
          />
        ) : null}
        <NumberField
          label="موقعیت روی دیوار"
          unit="درصد"
          value={Math.round(door.offset * 100)}
          min={5}
          max={95}
          step={1}
          onChange={(offsetPercent) => update({ offset: offsetPercent / 100 })}
        />
        {isWindow ? (
          <div className="plan-tool-tip">
            <span>پنجره فقط یک عنصر ظاهری روی دیوار است و پوشش دوربین را تغییر نمی‌دهد. برای دیوار شیشه‌ای که دید از آن عبور می‌کند، از ابزار «جدار شیشه‌ای» استفاده کنید.</span>
          </div>
        ) : (
          <>
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
          </>
        )}
      </aside>
    );
  }

  if (sole.kind === "obstacle") {
    const obstacle = floor.obstacles.find((item) => item.id === sole.id);
    if (!obstacle) return null;
    const update = (patch: Partial<typeof obstacle>) =>
      onFloorChange({ ...floor, obstacles: floor.obstacles.map((item) => (item.id === obstacle.id ? { ...item, ...patch } : item)) });

    return (
      <aside className="plan-inspector">
        <header>
          <Ruler size={17} aria-hidden="true" /><strong>مانع</strong>
          <DeleteAction
            label="حذف مانع"
            onDelete={() => {
              onFloorChange({ ...floor, obstacles: floor.obstacles.filter((item) => item.id !== obstacle.id) });
              onSelect([]);
            }}
          />
        </header>
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
      </aside>
    );
  }

  const camera = floor.cameras.find((item) => item.id === sole.id);
  if (!camera) return null;

  const update = (patch: Partial<typeof camera>) =>
    onFloorChange({ ...floor, cameras: floor.cameras.map((item) => (item.id === camera.id ? { ...item, ...patch } : item)) });
  const updateOptics = (patch: Partial<typeof camera.optics>) => update({ optics: { ...camera.optics, ...patch } });

  const coverage = computeCameraCoverage(camera, collectOccluders(floor.walls, floor.obstacles, floor.doors), 48);
  const fov = cameraFovDeg(camera);

  const features = camera.features ?? { microphone: false, colorNightVision: false, weatherproof: false };
  const updateFeatures = (patch: Partial<typeof features>) => update({ features: { ...features, ...patch } });
  const housing = camera.housing ?? "turret";
  const behavior = housingBehavior[housing];

  return (
    <aside className="plan-inspector">
      <header>
        <Camera size={17} aria-hidden="true" /><strong>مشخصات دوربین</strong>
        <DeleteAction
          label="حذف دوربین"
          onDelete={() => {
            onFloorChange({ ...floor, cameras: floor.cameras.filter((item) => item.id !== camera.id) });
            onSelect([]);
          }}
        />
      </header>

      <label className="plan-text-field">
        <span>نام</span>
        <input value={camera.name} onChange={(event) => update({ name: event.target.value })} />
      </label>

      {camera.groupName ? (
        <div className="plan-defined-camera-group"><span>نوع دستگاه</span><strong>{camera.groupName}</strong></div>
      ) : null}

      {/* Body style first: it changes how the camera mounts and how the coverage reads. */}
      <fieldset className="plan-housing-picker">
        <legend>شکل و بدنه دوربین</legend>
        <div>
          {(Object.keys(housingLabels) as CameraHousing[]).map((value) => (
            <button
              key={value}
              type="button"
              className={housing === value ? "active" : ""}
              onClick={() => update({ housing: value })}
            >
              {housingLabels[value]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className={`plan-camera-housing-note is-${housing}`}>
        <Compass size={16} aria-hidden="true" />
        <div><strong>{behavior.title}</strong><span>{behavior.description}</span></div>
      </div>

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
      <NumberField
        label={housing === "ptz" ? "جهت اولیه گشت PTZ" : "زاویه چرخش"}
        unit="درجه"
        value={camera.yawDeg}
        min={0}
        max={359}
        step={5}
        onChange={(value) => update({ yawDeg: value })}
      />
      <NumberField label="بُرد مؤثر" unit="متر" value={camera.optics.maxRangeM} min={2} max={120} step={1} onChange={(value) => updateOptics({ maxRangeM: value })} />
      <NumberField label="برد دید در شب" unit="متر" value={camera.optics.irRangeM} min={0} max={200} step={5} onChange={(value) => updateOptics({ irRangeM: value })} />

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

      <fieldset className="plan-feature-picker">
        <legend>ویژگی‌ها</legend>
        <label className="plan-check">
          <input type="checkbox" checked={features.microphone} onChange={(event) => updateFeatures({ microphone: event.target.checked })} />
          <span>میکروفون داخلی</span>
        </label>
        <label className="plan-check">
          <input type="checkbox" checked={features.colorNightVision} onChange={(event) => updateFeatures({ colorNightVision: event.target.checked })} />
          <span>دید در شب رنگی</span>
        </label>
        <label className="plan-check">
          <input
            type="checkbox"
            checked={features.weatherproof}
            onChange={(event) => updateFeatures({ weatherproof: event.target.checked })}
          />
          <span>مقاوم فضای باز</span>
        </label>
        <label className="plan-check">
          <input
            type="checkbox"
            checked={Boolean(camera.outdoor)}
            onChange={(event) => update({ outdoor: event.target.checked })}
          />
          <span>نصب در فضای باز</span>
        </label>
      </fieldset>

      <div className="plan-dori-readout">
        <div><span>زاویه دید</span><strong>{fov.toFixed(1)}°</strong></div>
        {coverage.bands.map((band) => (
          <div key={band.key} className={band.polygon.length >= 3 ? "" : "is-hidden-band"}>
            <span><i style={{ background: band.color }} />{band.label}</span>
            <strong>{formatFa(band.distanceM, 1)} m</strong>
          </div>
        ))}
      </div>

      {coverage.truncatedByRange ? (
        <div className="plan-range-warning">
          <div>
            <strong>{formatFa(coverage.visibleBandCount)} ناحیه از ۴ ناحیه نمایش داده می‌شود</strong>
            <span>
              بُرد مؤثر ({formatFa(camera.optics.maxRangeM, 1)} متر) کوتاه‌تر از فاصله کشف
              ({formatFa(coverage.doriDistances.detect, 1)} متر) است، بنابراین نواحی بیرونی حذف شده‌اند.
            </span>
          </div>
          <button
            type="button"
            onClick={() => updateOptics({ maxRangeM: Math.round(Math.min(120, coverage.doriDistances.detect) * 10) / 10 })}
          >
            تنظیم بُرد روی فاصله کشف
          </button>
        </div>
      ) : null}

      <p className="plan-inspector-note">تنظیمات کدک، نرخ فریم و بیت‌ریت این دوربین در مرحله بعد مشخص می‌شود.</p>
    </aside>
  );
}

function MultiSelectionPanel({
  floor,
  selection,
  onFloorChange,
  onSelect
}: {
  floor: FloorPlan;
  selection: PlanSelection;
  onFloorChange: (floor: FloorPlan) => void;
  onSelect: (selection: PlanSelection) => void;
}) {
  const groups = summariseSelection(selection);
  const cameraCount = selection.filter((item) => item.kind === "camera").length;
  const wallCount = selection.filter((item) => item.kind === "wall").length;

  const removeOne = (ref: PlanSelectionRef) => {
    onFloorChange(deleteSelection(floor, [ref]));
    onSelect(selection.filter((item) => !(item.kind === ref.kind && item.id === ref.id)));
  };

  const removeAll = () => {
    onFloorChange(deleteSelection(floor, selection));
    onSelect([]);
  };

  const removeKind = (kind: PlanSelectionRef["kind"]) => {
    const targets = selection.filter((item) => item.kind === kind);
    onFloorChange(deleteSelection(floor, targets));
    onSelect(selection.filter((item) => item.kind !== kind));
  };

  return (
    <aside className="plan-inspector plan-multi-inspector">
      <header>
        <Layers size={17} aria-hidden="true" />
        <strong>{formatFa(selection.length)} آیتم انتخاب شد</strong>
        <button type="button" className="plan-clear-selection" onClick={() => onSelect([])} title="لغو انتخاب" aria-label="لغو انتخاب">
          <X size={15} aria-hidden="true" />
        </button>
      </header>

      <div className="plan-multi-summary">
        {groups.map((group) => (
          <button key={group.kind} type="button" onClick={() => removeKind(group.kind)} title={`حذف همه ${group.label}`}>
            <span>{group.label}</span>
            <strong>{formatFa(group.count)}</strong>
            <Trash2 size={12} aria-hidden="true" />
          </button>
        ))}
      </div>

      {wallCount > 0 ? (
        <p className="plan-inspector-note">حذف دیوار، در و پنجره‌های روی آن را هم پاک می‌کند.</p>
      ) : null}

      <div className="plan-multi-list">
        {selection.map((ref) => (
          <div key={`${ref.kind}-${ref.id}`}>
            <span className={`plan-multi-dot is-${ref.kind}`} aria-hidden="true" />
            <span>{describeElement(floor, ref)}</span>
            <button type="button" onClick={() => removeOne(ref)} title="حذف این آیتم" aria-label="حذف این آیتم">
              <Trash2 size={13} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      <button type="button" className="plan-delete-all" onClick={removeAll}>
        <Trash2 size={15} aria-hidden="true" />
        حذف هر {formatFa(selection.length)} آیتم انتخاب‌شده
      </button>

      {cameraCount > 0 ? (
        <p className="plan-inspector-note">
          برای ویرایش مشخصات یک دوربین، فقط همان را انتخاب کنید.
        </p>
      ) : null}
    </aside>
  );
}

/**
 * Destructive action pinned to a panel header.
 *
 * Kept at the top so it stays reachable without scrolling past a long property list,
 * and rendered as an icon so it never competes with the panel title for attention.
 */
function DeleteAction({ label, onDelete }: { label: string; onDelete: () => void }) {
  return (
    <button type="button" className="plan-delete" onClick={onDelete} title={label} aria-label={label}>
      <Trash2 size={15} aria-hidden="true" />
    </button>
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
