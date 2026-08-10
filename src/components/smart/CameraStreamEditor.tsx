"use client";

import { useMemo } from "react";
import { CircleAlert, Gauge, Wand2 } from "lucide-react";
import type { CameraStreamConfig, StreamQuality, VideoCodec } from "@/src/domain/catalog/types";
import type { BuildingPlan } from "@/src/domain/planner/types";
import {
  codecLabels,
  defaultStreamConfig,
  effectiveBitrateKbps,
  estimateBitrateKbps,
  housingLabels,
  qualityLabels
} from "@/src/lib/planner/camera-templates";
import { formatFa } from "@/src/lib/chatbot/persian";

/**
 * Per-camera encoder settings.
 *
 * One row per sited camera, because archive load is dominated by a handful of
 * high-frame-rate cameras rather than by the site average. The total shown here is what
 * the capacity engine consumes, so an edit is visible in the storage figure immediately.
 */

const codecs = Object.keys(codecLabels) as VideoCodec[];
const qualities = Object.keys(qualityLabels) as StreamQuality[];
const fpsOptions = [8, 12, 15, 20, 25, 30, 50, 60];

export function CameraStreamEditor({
  plan,
  onPlanChange
}: {
  plan: BuildingPlan;
  onPlanChange: (plan: BuildingPlan) => void;
}) {
  const rows = useMemo(
    () => plan.floors.flatMap((floor) => floor.cameras.map((camera) => ({ floor, camera }))),
    [plan.floors]
  );

  const totals = useMemo(() => {
    let rawKbps = 0;
    let effectiveKbps = 0;
    for (const { camera } of rows) {
      const stream = camera.stream ?? defaultStreamConfig;
      rawKbps += stream.bitrateKbps;
      effectiveKbps += effectiveBitrateKbps(stream);
    }
    return { rawKbps, effectiveKbps };
  }, [rows]);

  const updateStream = (floorId: string, cameraId: string, patch: Partial<CameraStreamConfig>) => {
    onPlanChange({
      ...plan,
      floors: plan.floors.map((floor) => floor.id !== floorId ? floor : {
        ...floor,
        cameras: floor.cameras.map((camera) => camera.id !== cameraId
          ? camera
          : { ...camera, stream: { ...(camera.stream ?? defaultStreamConfig), ...patch } })
      })
    });
  };

  const applySuggestedBitrate = (floorId: string, cameraId: string) => {
    const target = rows.find((row) => row.camera.id === cameraId);
    if (!target) return;
    const stream = target.camera.stream ?? defaultStreamConfig;
    updateStream(floorId, cameraId, {
      bitrateKbps: estimateBitrateKbps(target.camera.optics.megapixel, stream.codec, stream.fps, stream.quality)
    });
  };

  const applyToAll = (patch: Partial<CameraStreamConfig>) => {
    onPlanChange({
      ...plan,
      floors: plan.floors.map((floor) => ({
        ...floor,
        cameras: floor.cameras.map((camera) => ({ ...camera, stream: { ...(camera.stream ?? defaultStreamConfig), ...patch } }))
      }))
    });
  };

  if (!rows.length) {
    return (
      <div className="plan-placement-status">
        <CircleAlert size={17} aria-hidden="true" />
        <div>
          <strong>هنوز دوربینی روی نقشه نیست</strong>
          <small>برای تنظیم کدک و بیت‌ریت، ابتدا در مرحله قبل دوربین‌ها را جانمایی کنید.</small>
        </div>
      </div>
    );
  }

  return (
    <section className="camera-stream-editor">
      <div className="camera-stream-summary">
        <div className="is-primary">
          <Gauge size={18} aria-hidden="true" />
          <span>بار واقعی ضبط</span>
          <strong>{formatFa(totals.effectiveKbps / 1000, 1)}</strong>
          <small>مگابیت بر ثانیه</small>
        </div>
        <div>
          <span>بار اوج شبکه</span>
          <strong>{formatFa(totals.rawKbps / 1000, 1)}</strong>
          <small>مگابیت بر ثانیه</small>
        </div>
        <div>
          <span>دوربین‌ها</span>
          <strong>{formatFa(rows.length)}</strong>
          <small>جانمایی‌شده</small>
        </div>
      </div>

      <div className="camera-stream-bulk">
        <span>اعمال روی همه:</span>
        {codecs.map((codec) => (
          <button key={codec} type="button" onClick={() => applyToAll({ codec })}>{codecLabels[codec]}</button>
        ))}
        <button type="button" onClick={() => applyToAll({ recordingMode: "continuous" })}>ضبط پیوسته</button>
        <button type="button" onClick={() => applyToAll({ recordingMode: "motion" })}>ضبط بر اساس حرکت</button>
      </div>

      <div className="camera-stream-table" role="table">
        <div className="camera-stream-row is-head" role="row">
          <span>دوربین</span>
          <span>کدک</span>
          <span>فریم</span>
          <span>کیفیت</span>
          <span>حالت</span>
          <span>بیت‌ریت</span>
          <span>ضبط</span>
          <span>صدا</span>
          <span>بار مؤثر</span>
        </div>

        {rows.map(({ floor, camera }) => {
          const stream = camera.stream ?? defaultStreamConfig;
          const suggested = estimateBitrateKbps(camera.optics.megapixel, stream.codec, stream.fps, stream.quality);
          // A large gap usually means the resolution or codec changed after the bitrate
          // was set by hand, which quietly skews the whole storage estimate.
          const drifted = Math.abs(stream.bitrateKbps - suggested) > suggested * 0.35;
          return (
            <div className="camera-stream-row" role="row" key={camera.id}>
              <span className="camera-stream-identity">
                <strong>{camera.name}</strong>
                <small>{floor.name} · {camera.optics.megapixel}MP · {housingLabels[camera.housing ?? "turret"]}</small>
              </span>

              <select value={stream.codec} onChange={(event) => updateStream(floor.id, camera.id, { codec: event.target.value as VideoCodec })}>
                {codecs.map((codec) => <option key={codec} value={codec}>{codecLabels[codec]}</option>)}
              </select>

              <select value={stream.fps} onChange={(event) => updateStream(floor.id, camera.id, { fps: Number(event.target.value) })}>
                {fpsOptions.map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}
              </select>

              <select value={stream.quality} onChange={(event) => updateStream(floor.id, camera.id, { quality: event.target.value as StreamQuality })}>
                {qualities.map((quality) => <option key={quality} value={quality}>{qualityLabels[quality]}</option>)}
              </select>

              <select value={stream.bitrateMode} onChange={(event) => updateStream(floor.id, camera.id, { bitrateMode: event.target.value as "VBR" | "CBR" })}>
                <option value="VBR">VBR</option>
                <option value="CBR">CBR</option>
              </select>

              <span className={drifted ? "camera-stream-bitrate is-drifted" : "camera-stream-bitrate"}>
                <input
                  type="number"
                  min={64}
                  max={65_536}
                  step={64}
                  value={stream.bitrateKbps}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    if (Number.isFinite(parsed)) updateStream(floor.id, camera.id, { bitrateKbps: Math.min(65_536, Math.max(64, Math.round(parsed))) });
                  }}
                />
                <button
                  type="button"
                  onClick={() => applySuggestedBitrate(floor.id, camera.id)}
                  title={`مقدار پیشنهادی برای این تنظیمات: ${suggested} Kbps`}
                  aria-label="اعمال بیت‌ریت پیشنهادی"
                >
                  <Wand2 size={13} aria-hidden="true" />
                </button>
              </span>

              <span className="camera-stream-recording">
                <select value={stream.recordingMode} onChange={(event) => updateStream(floor.id, camera.id, { recordingMode: event.target.value as "continuous" | "motion" })}>
                  <option value="continuous">پیوسته</option>
                  <option value="motion">حرکتی</option>
                </select>
                {stream.recordingMode === "motion" ? (
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={stream.motionActivityPercent}
                    aria-label="درصد فعالیت صحنه"
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      if (Number.isFinite(parsed)) updateStream(floor.id, camera.id, { motionActivityPercent: Math.min(100, Math.max(1, Math.round(parsed))) });
                    }}
                  />
                ) : null}
              </span>

              <label className="camera-stream-audio">
                <input
                  type="checkbox"
                  checked={stream.audioEnabled}
                  disabled={!camera.features?.microphone}
                  onChange={(event) => updateStream(floor.id, camera.id, { audioEnabled: event.target.checked })}
                />
                <span>{camera.features?.microphone ? "فعال" : "بدون میکروفون"}</span>
              </label>

              <span className="camera-stream-effective">{formatFa(effectiveBitrateKbps(stream))} Kbps</span>
            </div>
          );
        })}
      </div>

      <p className="camera-stream-note">
        «بار مؤثر» با احتساب حالت ضبط و صدا محاسبه می‌شود و همین عدد مبنای برآورد فضای هارد و پهنای باند است.
        دکمه جادویی کنار هر بیت‌ریت، مقدار پیشنهادی همان رزولوشن و کدک را اعمال می‌کند.
      </p>
    </section>
  );
}
