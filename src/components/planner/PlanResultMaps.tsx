"use client";

import { useMemo } from "react";
import type { BuildingPlan, FloorPlan, PlanDoor, PlanWall } from "@/src/domain/planner/types";
import type { CatalogProduct, RecommendationPlan } from "@/src/domain/catalog/types";
import { computeFloorCoverage, doriLevels } from "@/src/lib/planner/coverage";
import { boundsOf, obstacleCorners } from "@/src/lib/planner/geometry";
import { formatFa } from "@/src/lib/chatbot/persian";

/**
 * Read-only view of the drawn floors with the chosen plan applied.
 *
 * Rendered as SVG rather than reusing the WebGL editor: the results page is printed to
 * PDF, and a canvas does not survive `window.print()`. SVG also keeps one lightweight
 * element per floor instead of one WebGL context each.
 */

const PADDING_M = 2;

export function PlanResultMaps({ plan, recommendation }: { plan: BuildingPlan; recommendation?: RecommendationPlan }) {
  const cameraProducts = useMemo(
    () => (recommendation?.items ?? []).filter((item) => item.product.category === "camera").map((item) => item.product),
    [recommendation]
  );

  const placedTotal = plan.floors.reduce((sum, floor) => sum + floor.cameras.length, 0);
  if (!placedTotal) return null;

  return (
    <section className="plan-result-maps">
      <div className="plan-result-head">
        <div>
          <span>نقشه اجرایی پروژه</span>
          <strong>{formatFa(plan.floors.length)} طبقه · {formatFa(placedTotal)} دوربین جانمایی‌شده</strong>
        </div>
        <div className="plan-result-legend">
          {doriLevels.map((level) => (
            <span key={level.key}><i style={{ background: level.color }} />{level.label}</span>
          ))}
        </div>
      </div>

      {plan.floors.map((floor) => (
        <FloorSvg key={floor.id} floor={floor} cameraProducts={cameraProducts} />
      ))}

      <p className="plan-result-note">
        رنگ‌ها سطح تراکم پیکسل بر اساس EN 62676-4 هستند و با احتساب دیوارها و موانعی که ترسیم کرده‌اید محاسبه شده‌اند.
        محصول پیشنهادی هر دوربین از پلن انتخابی گرفته شده است.
      </p>
    </section>
  );
}

function FloorSvg({ floor, cameraProducts }: { floor: FloorPlan; cameraProducts: CatalogProduct[] }) {
  const coverage = useMemo(() => computeFloorCoverage(floor, 1.5), [floor]);

  const view = useMemo(() => {
    const points = [
      ...floor.walls.flatMap((wall) => [wall.a, wall.b]),
      ...floor.obstacles.flatMap(obstacleCorners),
      ...floor.cameras.map((camera) => camera.position),
      ...coverage.cameras.flatMap((item) => item.polygon)
    ];
    const bounds = boundsOf(points);
    if (!bounds) return null;
    return {
      minX: bounds.minX - PADDING_M,
      minZ: bounds.minZ - PADDING_M,
      width: Math.max(1, bounds.maxX - bounds.minX + PADDING_M * 2),
      height: Math.max(1, bounds.maxZ - bounds.minZ + PADDING_M * 2)
    };
  }, [floor, coverage]);

  if (!view) return null;

  const toPath = (points: { x: number; z: number }[]) =>
    points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.z.toFixed(2)}`).join(" ") + " Z";

  return (
    <article className="plan-result-floor">
      <header>
        <strong>{floor.name}</strong>
        <span>
          {formatFa(coverage.areaM2, 1)} متر مربع · {formatFa(floor.cameras.length)} دوربین · {formatFa((floor.doors ?? []).length)} در ·
          {coverage.hasPtzPatrol ? "پوشش بالقوه با گشت PTZ" : "پوشش"} {formatFa(coverage.coveredPercent, 0)}٪ · سطح شناسایی {formatFa(coverage.identifyPercent, 0)}٪
        </span>
      </header>

      <div className="plan-result-canvas">
        <svg
          viewBox={`${view.minX} ${view.minZ} ${view.width} ${view.height}`}
          role="img"
          aria-label={`نقشه ${floor.name} با پوشش دوربین‌ها`}
        >
          {floor.backdrop?.calibrated ? (
            <image
              href={floor.backdrop.imageUrl}
              x={floor.backdrop.originM.x}
              y={floor.backdrop.originM.z}
              width={floor.backdrop.widthPx * floor.backdrop.metresPerPixel}
              height={floor.backdrop.heightPx * floor.backdrop.metresPerPixel}
              opacity={floor.backdrop.opacity}
              preserveAspectRatio="none"
            />
          ) : null}

          {/* Widest band first so the tighter, higher-quality zones paint over it. */}
          {coverage.cameras.map((item) =>
            [...item.bands].reverse().map((band) =>
              band.polygon.length >= 3 ? (
                <path key={`${item.cameraId}-${band.key}`} d={toPath(band.polygon)} fill={band.color} fillOpacity={0.18} stroke="none" />
              ) : null
            )
          )}

          {floor.obstacles.map((obstacle) => (
            <path
              key={obstacle.id}
              d={toPath(obstacleCorners(obstacle))}
              fill={obstacle.blocksView ? "#94a3b8" : "#cbd5e1"}
              fillOpacity={0.75}
              stroke="#64748b"
              strokeWidth={0.06}
            />
          ))}

          {floor.walls.map((wall) => (
            <line
              key={wall.id}
              x1={wall.a.x} y1={wall.a.z} x2={wall.b.x} y2={wall.b.z}
              stroke={wall.blocksView ? "#334155" : "#93c5fd"}
              strokeWidth={Math.max(0.12, wall.thicknessM)}
              strokeLinecap="square"
            />
          ))}

          {(floor.doors ?? []).map((door) => {
            const wall = floor.walls.find((item) => item.id === door.wallId);
            return wall ? <DoorSvg key={door.id} door={door} wall={wall} /> : null;
          })}

          {floor.cameras.map((camera, index) => {
            const item = coverage.cameras.find((entry) => entry.cameraId === camera.id);
            const heading = ((camera.yawDeg * Math.PI) / 180);
            return (
              <g key={camera.id}>
                {item ? (
                  <line
                    x1={camera.position.x} y1={camera.position.z}
                    x2={camera.position.x + Math.cos(heading) * 1.6}
                    y2={camera.position.z + Math.sin(heading) * 1.6}
                    stroke="#0f5f99" strokeWidth={0.12}
                  />
                ) : null}
                <circle cx={camera.position.x} cy={camera.position.z} r={0.42} fill="#0f5f99" stroke="#fff" strokeWidth={0.14} />
                <text
                  x={camera.position.x} y={camera.position.z + 0.16}
                  textAnchor="middle" fontSize={0.5} fill="#fff" fontWeight="700"
                >
                  {index + 1}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <ol className="plan-result-schedule">
        {floor.cameras.map((camera, index) => {
          const item = coverage.cameras.find((entry) => entry.cameraId === camera.id);
          // Products cycle across placements: the plan quotes model counts, not per-position picks.
          const product = cameraProducts.length ? cameraProducts[index % cameraProducts.length] : undefined;
          return (
            <li key={camera.id}>
              <span className="plan-result-index">{formatFa(index + 1)}</span>
              <div>
                <strong>{camera.name}</strong>
                <small>
                  {formatFa(camera.optics.megapixel)} مگاپیکسل · لنز {formatFa(camera.optics.focalMm, 1)} میلی‌متر ·
                  ارتفاع {formatFa(camera.optics.mountHeightM, 1)} متر · زاویه {formatFa(item?.fovDeg ?? 0, 1)}°
                </small>
                {item ? (
                  <small className="plan-result-dori">
                    شناسایی تا {formatFa(item.doriDistances.identify, 1)} m ·
                    بازشناسی تا {formatFa(item.doriDistances.recognize, 1)} m
                  </small>
                ) : null}
              </div>
              {product ? <span className="plan-result-product">{product.name}</span> : null}
            </li>
          );
        })}
      </ol>
    </article>
  );
}

function DoorSvg({ door, wall }: { door: PlanDoor; wall: PlanWall }) {
  const dx = wall.b.x - wall.a.x;
  const dz = wall.b.z - wall.a.z;
  const span = Math.hypot(dx, dz) || 0.01;
  const u = { x: dx / span, z: dz / span };
  const normal = { x: -u.z, z: u.x };
  const center = { x: wall.a.x + dx * door.offset, z: wall.a.z + dz * door.offset };
  const hingeSign = door.hinge === "start" ? -1 : 1;
  const hinge = {
    x: center.x + u.x * door.widthM * hingeSign / 2,
    z: center.z + u.z * door.widthM * hingeSign / 2
  };
  const closedDirection = { x: -u.x * hingeSign, z: -u.z * hingeSign };
  const angle = (door.openAngleDeg * Math.PI) / 180;
  const openDirection = {
    x: closedDirection.x * Math.cos(angle) + normal.x * Math.sin(angle),
    z: closedDirection.z * Math.cos(angle) + normal.z * Math.sin(angle)
  };
  const openEnd = { x: hinge.x + openDirection.x * door.widthM, z: hinge.z + openDirection.z * door.widthM };
  const arc = Array.from({ length: 17 }, (_, index) => {
    const radians = angle * (index / 16);
    return {
      x: hinge.x + (closedDirection.x * Math.cos(radians) + normal.x * Math.sin(radians)) * door.widthM,
      z: hinge.z + (closedDirection.z * Math.cos(radians) + normal.z * Math.sin(radians)) * door.widthM
    };
  });
  const arcPath = arc.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(3)},${point.z.toFixed(3)}`).join(" ");
  const openingStart = { x: center.x - u.x * door.widthM / 2, z: center.z - u.z * door.widthM / 2 };
  const openingEnd = { x: center.x + u.x * door.widthM / 2, z: center.z + u.z * door.widthM / 2 };

  return (
    <g>
      <line
        x1={openingStart.x} y1={openingStart.z} x2={openingEnd.x} y2={openingEnd.z}
        stroke="#fff" strokeWidth={Math.max(0.18, wall.thicknessM + 0.08)}
      />
      <line x1={hinge.x} y1={hinge.z} x2={openEnd.x} y2={openEnd.z} stroke="#9a5b2c" strokeWidth={0.1} />
      <path d={arcPath} fill="none" stroke="#b7791f" strokeWidth={0.06} strokeDasharray="0.16 0.09" />
      <circle cx={hinge.x} cy={hinge.z} r={0.09} fill="#9a5b2c" />
    </g>
  );
}
