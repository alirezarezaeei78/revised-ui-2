"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type * as THREE_NS from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  defaultCameraOptics,
  isSelected,
  soleSelection,
  toggleSelection,
  type FloorPlan,
  type PlanBackdrop,
  type PlanDefaults,
  type PlanSelection,
  type PlanSelectionRef,
  type PlanTool,
  type PlanViewMode,
  type WallDrawMode,
  type Vec2
} from "@/src/domain/planner/types";
import { elementsInRect, mergeSelection } from "@/src/lib/planner/selection";
import { isCardinalAngle, snapRotationAngle } from "@/src/lib/planner/rotation";
import { computeCameraCoverage, type CameraCoverage } from "@/src/lib/planner/coverage";
import {
  collectOccluders,
  collectRightAngleCorners,
  distance,
  projectPointToWall,
  rectFromPoints,
  snapPoint
} from "@/src/lib/planner/geometry";
import {
  buildCameraMarker,
  buildCoverageMesh,
  buildDoorMesh,
  buildFloorFootprintGuide,
  buildOverallDimensionGuide,
  buildFloorSlab,
  buildObstacleMesh,
  buildObstacleRotateHandle,
  buildMarqueeRect,
  buildPreviewLine,
  buildPreviewRect,
  buildRightAngleMarker,
  buildWallWithDoors,
  buildYawHandle,
  buildBackdrop,
  buildBackdropMesh,
  collectDimensionLabels,
  applyObjectOpacity,
  disposeGroup
} from "@/src/lib/planner/scene-builders";

type ThreeModule = typeof THREE_NS;

type Bundle = {
  THREE: ThreeModule;
  renderer: THREE_NS.WebGLRenderer;
  scene: THREE_NS.Scene;
  topCamera: THREE_NS.OrthographicCamera;
  orbitCamera: THREE_NS.PerspectiveCamera;
  topControls: OrbitControls;
  orbitControls: OrbitControls;
  groups: Record<"content" | "coverage" | "cameras" | "backdrop" | "preview" | "placement" | "reference", THREE_NS.Group>;
  ground: THREE_NS.Mesh;
  fineGrid: THREE_NS.GridHelper;
  majorGrid: THREE_NS.GridHelper;
  raycaster: THREE_NS.Raycaster;
  groundPlane: THREE_NS.Plane;
  sceneGeneration: number;
  frame: number;
};

function configureControlBindings(bundle: Bundle) {
  const { THREE, topControls, orbitControls } = bundle;
  topControls.enableZoom = true;
  topControls.enablePan = true;
  topControls.enableRotate = false;
  /*
   * The left button always belongs to the tools in the plan view: it draws, or in select
   * mode it rubber-bands. Panning moved to the right button, which is why the canvas
   * suppresses the browser context menu.
   */
  topControls.mouseButtons = {
    LEFT: null,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.PAN
  };
  orbitControls.enableZoom = true;
  orbitControls.enablePan = true;
  orbitControls.enableRotate = true;
  // Orbiting still needs a drag, and a marquee over a perspective view is meaningless,
  // so the 3D view keeps the left button for rotation.
  orbitControls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.ROTATE,
    RIGHT: THREE.MOUSE.PAN
  };
}

function configureViewMode(
  bundle: Bundle,
  props: Pick<PlanCanvasProps, "viewMode" | "floor" | "buildingFloors">
) {
  const { topControls, orbitControls, topCamera, orbitCamera } = bundle;
  if (props.viewMode === "top") {
    topControls.target.set(orbitControls.target.x, 0, orbitControls.target.z);
    topCamera.position.set(orbitControls.target.x, 100, orbitControls.target.z);
    topControls.enabled = true;
    orbitControls.enabled = false;
    topControls.update();
    return;
  }

  const floors = props.buildingFloors?.length ? props.buildingFloors : [props.floor];
  const minElevation = props.viewMode === "building"
    ? Math.min(...floors.map((item) => item.elevationM), 0)
    : 0;
  const maxElevation = props.viewMode === "building"
    ? Math.max(...floors.map((item) => item.elevationM + item.heightM))
    : 0;
  const verticalSpan = Math.max(maxElevation - minElevation, 3.2);
  const targetY = props.viewMode === "building" ? (minElevation + maxElevation) / 2 : 0;
  orbitControls.target.set(topControls.target.x, targetY, topControls.target.z);
  const radius = props.viewMode === "building" ? Math.max(28, verticalSpan * 2.25) : 24;
  orbitCamera.position.set(
    topControls.target.x + radius * 0.72,
    targetY + radius * 0.62,
    topControls.target.z + radius * 0.72
  );
  orbitControls.enabled = true;
  topControls.enabled = false;
  orbitControls.update();
}

function configureGroundSurface(
  bundle: Bundle,
  props: Pick<PlanCanvasProps, "viewMode" | "buildingFloors" | "focusedFloorId">
) {
  const groundMaterial = bundle.ground.material as THREE_NS.MeshStandardMaterial;
  const fineMaterial = bundle.fineGrid.material as THREE_NS.Material & { opacity: number };
  const majorMaterial = bundle.majorGrid.material as THREE_NS.Material & { opacity: number };
  const floors = props.buildingFloors ?? [];
  const hasBasement = floors.some((item) => item.elevationM < -0.01);
  const focusedFloor = props.focusedFloorId
    ? floors.find((item) => item.id === props.focusedFloorId)
    : null;
  const revealingBasements = props.viewMode === "building"
    && hasBasement
    && (!props.focusedFloorId || (focusedFloor?.elevationM ?? 0) < -0.01);
  const showingBuildingWithBasement = props.viewMode === "building" && hasBasement;

  groundMaterial.transparent = showingBuildingWithBasement;
  groundMaterial.opacity = revealingBasements ? 0.045 : showingBuildingWithBasement ? 0.16 : 1;
  groundMaterial.depthWrite = !showingBuildingWithBasement;
  groundMaterial.needsUpdate = true;
  fineMaterial.opacity = revealingBasements ? 0.12 : showingBuildingWithBasement ? 0.28 : 0.82;
  majorMaterial.opacity = revealingBasements ? 0.2 : showingBuildingWithBasement ? 0.38 : 0.68;
  fineMaterial.needsUpdate = true;
  majorMaterial.needsUpdate = true;
}

export type PlanCanvasProps = {
  floor: FloorPlan;
  tool: PlanTool;
  wallDrawMode: WallDrawMode;
  viewMode: PlanViewMode;
  selection: PlanSelection;
  snapM: number;
  defaults: PlanDefaults;
  pendingBackdrop?: PlanBackdrop | null;
  showCoverage: boolean;
  readOnly?: boolean;
  buildingFloors?: FloorPlan[];
  focusedFloorId?: string | null;
  referenceFloor?: FloorPlan | null;
  onSelect: (selection: PlanSelection) => void;
  onFloorChange: (floor: FloorPlan) => void;
  onHint: (hint: string | null) => void;
  onDropCamera?: (definitionId: string, position: Vec2) => void;
  onDropPreset?: (presetId: string, position: Vec2) => void;
  onPlaceBackdrop?: (center: Vec2) => void;
  onCancelBackdropPlacement?: () => void;
};

type DragState =
  | { kind: "move-camera"; id: string }
  | { kind: "move-obstacle"; id: string }
  | { kind: "yaw"; id: string }
  | { kind: "rotate-obstacle"; id: string }
  | { kind: "marquee"; start: Vec2; additive: boolean }
  | null;

/** Below this the drag reads as a click, so an empty-space click still clears selection. */
const MARQUEE_MIN_SPAN_M = 0.25;

const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;

export function PlanCanvas(props: PlanCanvasProps) {
  const {
    floor, tool, viewMode, selection, showCoverage, readOnly, buildingFloors,
    focusedFloorId, referenceFloor, onSelect, onFloorChange, onHint
  } = props;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const labelHostRef = useRef<HTMLDivElement | null>(null);
  const smartGuideLabelHostRef = useRef<HTMLDivElement | null>(null);
  const bundleRef = useRef<Bundle | null>(null);
  const draftRef = useRef<{ kind: "wall" | "obstacle" | "measure"; start: Vec2 } | null>(null);
  const dragRef = useRef<DragState>(null);

  const latest = useRef(props);
  useEffect(() => { latest.current = props; });

  const coverages = useMemo<CameraCoverage[]>(() => {
    if (!showCoverage) return [];
    const occluders = collectOccluders(floor.walls, floor.obstacles, floor.doors);
    return floor.cameras.map((camera) => computeCameraCoverage(camera, occluders, 64));
  }, [floor, showCoverage]);

  /* ── Scene lifecycle (mount once) ────────────────────────────────── */
  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    const host = hostRef.current;
    if (!host) return;

    (async () => {
      const [THREE, controlsModule] = await Promise.all([
        import("three"),
        import("three/examples/jsm/controls/OrbitControls.js")
      ]);
      if (disposed || !hostRef.current) return;

      const width = host.clientWidth || 800;
      const height = host.clientHeight || 520;
      const aspect = width / height;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0xeaf3f7, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();

      const frustum = 30;
      const topCamera = new THREE.OrthographicCamera(
        (-frustum * aspect) / 2, (frustum * aspect) / 2, frustum / 2, -frustum / 2, 0.1, 1000
      );
      topCamera.position.set(0, 100, 0);
      topCamera.up.set(0, 0, -1);
      topCamera.lookAt(0, 0, 0);

      const orbitCamera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
      orbitCamera.position.set(20, 18, 20);
      orbitCamera.lookAt(0, 0, 0);

      /*
       * One controls instance per camera.
       *
       * The previous version swapped `controls.object` at runtime, which leaves the
       * internal spherical state describing the *old* camera — that was the jumpy,
       * glitchy rotation. Two instances with only one enabled keeps each camera's
       * state coherent.
       */
      const topControls = new controlsModule.OrbitControls(topCamera, renderer.domElement);
      topControls.enableRotate = false;
      topControls.screenSpacePanning = true;
      topControls.enableDamping = false;

      const orbitControls = new controlsModule.OrbitControls(orbitCamera, renderer.domElement);
      orbitControls.enableDamping = true;
      orbitControls.dampingFactor = 0.08;
      orbitControls.maxPolarAngle = Math.PI / 2.05;
      orbitControls.enabled = false;

      const drawingToolActive = latest.current.tool !== "select";
      topControls.mouseButtons = {
        LEFT: drawingToolActive ? null : THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.PAN
      };
      orbitControls.mouseButtons = {
        LEFT: drawingToolActive ? null : THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.ROTATE,
        RIGHT: THREE.MOUSE.PAN
      };

      scene.add(new THREE.HemisphereLight(0xdff4ff, 0x8aa181, 1.35));
      const sun = new THREE.DirectionalLight(0xfff4df, 2.2);
      sun.position.set(18, 32, 14);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -45;
      sun.shadow.camera.right = 45;
      sun.shadow.camera.top = 45;
      sun.shadow.camera.bottom = -45;
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 90;
      sun.shadow.bias = -0.0005;
      scene.add(sun);
      const fill = new THREE.DirectionalLight(0x9edcff, 0.7);
      fill.position.set(-16, 12, -10);
      scene.add(fill);

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(200, 200),
        new THREE.MeshStandardMaterial({ color: 0xf3f8f7, roughness: 0.94, metalness: 0 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.035;
      ground.receiveShadow = true;
      scene.add(ground);

      // Two grid densities make scale readable without turning the canvas into visual noise:
      // a one-metre construction grid and a stronger five-metre navigation grid.
      const fineGrid = new THREE.GridHelper(200, 200, 0x75a9c4, 0xc3dce8);
      (fineGrid.material as THREE_NS.Material).transparent = true;
      (fineGrid.material as THREE_NS.Material).opacity = 0.82;
      (fineGrid.material as THREE_NS.Material).depthWrite = false;
      scene.add(fineGrid);

      const majorGrid = new THREE.GridHelper(200, 40, 0x397fa5, 0x82b5cd);
      (majorGrid.material as THREE_NS.Material).transparent = true;
      (majorGrid.material as THREE_NS.Material).opacity = 0.68;
      (majorGrid.material as THREE_NS.Material).depthWrite = false;
      majorGrid.position.y = 0.008;
      scene.add(majorGrid);

      const groups = {
        content: new THREE.Group(),
        coverage: new THREE.Group(),
        cameras: new THREE.Group(),
        backdrop: new THREE.Group(),
        preview: new THREE.Group(),
        placement: new THREE.Group(),
        reference: new THREE.Group()
      };
      Object.values(groups).forEach((group) => scene.add(group));

      const bundle: Bundle = {
        THREE, renderer, scene, topCamera, orbitCamera, topControls, orbitControls, groups,
        ground, fineGrid, majorGrid,
        raycaster: new THREE.Raycaster(),
        groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
        sceneGeneration: 0,
        frame: 0
      };
      bundleRef.current = bundle;
      // The async Three.js import can finish after the React view/tool effects have
      // already run. Configure the newly-created controls here as well, otherwise a
      // remount in orbit/building mode leaves OrbitControls disabled.
      configureControlBindings(bundle);
      configureViewMode(bundle, latest.current);

      const activeCamera = () => (latest.current.viewMode === "top" ? topCamera : orbitCamera);

      const renderLoop = () => {
        bundle.frame = requestAnimationFrame(renderLoop);
        if (latest.current.viewMode === "top") topControls.update();
        else orbitControls.update();
        renderer.render(scene, activeCamera());
        updateLabelPositions(bundle, activeCamera(), labelHostRef.current);
        updateLabelPositions(bundle, activeCamera(), smartGuideLabelHostRef.current);
      };
      renderLoop();

      const resize = () => {
        const node = hostRef.current;
        if (!node) return;
        const w = node.clientWidth || 800;
        const h = node.clientHeight || 520;
        const ratio = w / h;
        renderer.setSize(w, h);
        topCamera.left = (-frustum * ratio) / 2;
        topCamera.right = (frustum * ratio) / 2;
        topCamera.updateProjectionMatrix();
        orbitCamera.aspect = ratio;
        orbitCamera.updateProjectionMatrix();
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);

      syncScene(bundle, latest.current, coverages);
      if (latest.current.pendingBackdrop) {
        groups.backdrop.visible = false;
        ensureBackdropPlacement(bundle, latest.current.pendingBackdrop);
      }
      const initialSelection = soleSelection(latest.current.selection);
      renderLabels(labelHostRef.current, collectDimensionLabels(
        latest.current.floor,
        initialSelection?.kind === "wall" ? initialSelection.id : undefined
      ));
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      const bundle = bundleRef.current;
      if (!bundle) return;
      cancelAnimationFrame(bundle.frame);
      Object.values(bundle.groups).forEach(disposeGroup);
      bundle.topControls.dispose();
      bundle.orbitControls.dispose();
      bundle.renderer.dispose();
      bundle.renderer.domElement.remove();
      bundleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Rebuild scene content only when the data actually changes ───── */
  useEffect(() => {
    const bundle = bundleRef.current;
    if (!bundle) return;
    syncScene(bundle, { floor, selection, viewMode, buildingFloors, focusedFloorId, referenceFloor }, coverages);
    const selected = soleSelection(selection);
    renderLabels(labelHostRef.current, viewMode === "building" ? [] : collectDimensionLabels(
      floor,
      selected?.kind === "wall" ? selected.id : undefined
    ));
  }, [floor, selection, coverages, buildingFloors, focusedFloorId, referenceFloor, viewMode]);

  useEffect(() => {
    const bundle = bundleRef.current;
    if (!bundle) return;
    bundle.groups.backdrop.visible = !props.pendingBackdrop;
    if (!props.pendingBackdrop) {
      disposeGroup(bundle.groups.placement);
      return;
    }

    ensureBackdropPlacement(bundle, props.pendingBackdrop);
  }, [props.pendingBackdrop]);

  /* ── View mode & tool wiring ─────────────────────────────────────── */
  useEffect(() => {
    const bundle = bundleRef.current;
    if (!bundle) return;
    configureViewMode(bundle, latest.current);
  }, [viewMode, buildingFloors]);

  useEffect(() => {
    const bundle = bundleRef.current;
    if (!bundle) return;
    configureControlBindings(bundle);
  }, [tool]);

  /* ── Pointer helpers ─────────────────────────────────────────────── */
  const ndcFor = useCallback((clientX: number, clientY: number) => {
    const bundle = bundleRef.current!;
    const rect = bundle.renderer.domElement.getBoundingClientRect();
    return new bundle.THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
  }, []);

  const planPointAt = useCallback((clientX: number, clientY: number): Vec2 | null => {
    const bundle = bundleRef.current;
    if (!bundle) return null;
    bundle.raycaster.setFromCamera(
      ndcFor(clientX, clientY),
      latest.current.viewMode === "top" ? bundle.topCamera : bundle.orbitCamera
    );
    const hit = new bundle.THREE.Vector3();
    return bundle.raycaster.ray.intersectPlane(bundle.groundPlane, hit) ? { x: hit.x, z: hit.z } : null;
  }, [ndcFor]);

  const pickAt = useCallback((clientX: number, clientY: number): { kind: string; id: string } | null => {
    const bundle = bundleRef.current;
    if (!bundle) return null;
    bundle.raycaster.setFromCamera(
      ndcFor(clientX, clientY),
      latest.current.viewMode === "top" ? bundle.topCamera : bundle.orbitCamera
    );
    // Cameras and their yaw handles are tested first so a handle always wins over a wall.
    const targets = [...bundle.groups.cameras.children, ...bundle.groups.content.children];
    for (const hit of bundle.raycaster.intersectObjects(targets, true)) {
      const data = hit.object.userData as { kind?: string; id?: string; floorId?: string };
      if (data.floorId && data.floorId !== latest.current.floor.id) continue;
      if (data.kind && data.id) return { kind: data.kind, id: data.id };
    }
    return null;
  }, [ndcFor]);

  const setControlsEnabled = useCallback((enabled: boolean) => {
    const bundle = bundleRef.current;
    if (!bundle) return;
    if (latest.current.viewMode === "top") bundle.topControls.enabled = enabled;
    else bundle.orbitControls.enabled = enabled;
  }, []);

  const handleCanvasDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const current = latest.current;
    if (current.readOnly) return;

    // Presets are checked first: their payload type is distinct, and a preset drag must
    // never be mistaken for a camera by falling through to the text/plain fallback.
    const presetId = event.dataTransfer.getData("application/x-hamyar-preset");
    if (presetId && current.onDropPreset) {
      event.preventDefault();
      const point = planPointAt(event.clientX, event.clientY);
      if (!point) {
        current.onHint("محل رها کردن روی نقشه معتبر نیست");
        return;
      }
      current.onDropPreset(presetId, snapPoint(point, current.snapM));
      return;
    }

    const definitionId = event.dataTransfer.getData("application/x-hamyar-camera")
      || event.dataTransfer.getData("text/plain");
    if (!definitionId || !current.onDropCamera) return;
    event.preventDefault();
    const point = planPointAt(event.clientX, event.clientY);
    if (!point) {
      current.onHint("محل رها کردن دوربین روی نقشه معتبر نیست");
      return;
    }
    current.onDropCamera(definitionId, snapPoint(point, current.snapM));
  }, [planPointAt]);

  /* ── Interaction ─────────────────────────────────────────────────── */
  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button === 1) {
      // OrbitControls owns middle-button drags; preventing the browser default avoids
      // the auto-scroll cursor while preserving the control's pointer sequence.
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    const current = latest.current;
    if (current.readOnly) return;

    const point = planPointAt(event.clientX, event.clientY);
    if (!point) return;
    if (current.pendingBackdrop) {
      current.onPlaceBackdrop?.(point);
      return;
    }
    const snapped = snapPoint(point, current.snapM);
    const picked = pickAt(event.clientX, event.clientY);
    const activeDraft = draftRef.current;

    /*
     * Inspecting an existing object must not require leaving the active drawing tool.
     * A click on an object opens its properties whenever no two-click/chain operation is
     * underway — except for the opening tools, which need wall clicks to place a door or
     * window on the wall that was clicked.
     */
    const openingTool = current.tool === "door" || current.tool === "window";
    if (
      current.tool !== "select"
      && !activeDraft
      && picked
      && !(openingTool && picked.kind === "wall")
    ) {
      const kind = picked.kind === "camera-yaw" ? "camera" : picked.kind;
      if (kind === "wall" || kind === "door" || kind === "obstacle" || kind === "camera") {
        onSelect([{ kind, id: picked.id }]);
        onHint("مشخصات آیتم در پنل سمت راست باز شد؛ برای ادامه طراحی روی فضای خالی کلیک کنید");
        return;
      }
    }

    if (current.tool === "select") {
      if (picked?.kind === "camera-yaw") {
        dragRef.current = { kind: "yaw", id: picked.id };
        // Suspending the controls is what stops the view panning under a drag.
        setControlsEnabled(false);
        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
        onHint("بکشید تا جهت دوربین تغییر کند");
        return;
      }

      if (picked?.kind === "obstacle-rotate") {
        dragRef.current = { kind: "rotate-obstacle", id: picked.id };
        setControlsEnabled(false);
        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
        onHint("بکشید تا جهت این عنصر تغییر کند");
        return;
      }

      const additive = event.shiftKey || event.ctrlKey || event.metaKey;

      if (!picked) {
        // Empty space: begin a rubber band. It only becomes a selection once the drag
        // covers real ground, so a plain click still means "clear".
        if (current.viewMode === "top") {
          dragRef.current = { kind: "marquee", start: point, additive };
          setControlsEnabled(false);
          (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
          onHint("بکشید تا آیتم‌های داخل کادر انتخاب شوند");
        }
        if (!additive) onSelect([]);
        return;
      }

      const ref = { kind: picked.kind, id: picked.id } as PlanSelectionRef;
      const alreadySelected = isSelected(current.selection, ref.kind, ref.id);

      if (additive) {
        onSelect(toggleSelection(current.selection, ref));
        return;
      }

      // Dragging one of several selected items keeps the group, so a multi-selection can
      // be nudged without collapsing back to a single element.
      if (!alreadySelected) onSelect([ref]);

      if (picked.kind === "camera" || picked.kind === "obstacle") {
        dragRef.current = { kind: picked.kind === "camera" ? "move-camera" : "move-obstacle", id: picked.id };
        setControlsEnabled(false);
        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      }
      return;
    }

    if (current.tool === "door" || current.tool === "window") {
      const isWindow = current.tool === "window";
      const noun = isWindow ? "پنجره" : "در";
      const wall = picked?.kind === "wall"
        ? current.floor.walls.find((item) => item.id === picked.id)
        : undefined;
      if (!wall) {
        onHint(`برای افزودن ${noun}، مستقیماً روی یک دیوار کلیک کنید`);
        return;
      }
      const wallLengthM = distance(wall.a, wall.b);
      if (wallLengthM < 0.7) {
        onHint(`طول این دیوار برای افزودن ${noun} کافی نیست`);
        return;
      }
      const widthM = isWindow
        ? Math.min(1.4, Math.max(0.6, wallLengthM - 0.2))
        : Math.min(0.9, Math.max(0.6, wallLengthM - 0.2));
      const projection = projectPointToWall(point, wall, widthM / 2 + 0.1);
      // Openings share one list, so a new window must clear existing doors as well.
      const overlaps = (current.floor.doors ?? []).some((door) =>
        door.wallId === wall.id
        && Math.abs((door.offset - projection.offset) * wallLengthM) < (door.widthM + widthM) / 2 + 0.1
      );
      if (overlaps) {
        onHint("این قسمت از دیوار قبلاً بازشو دارد؛ نقطه دیگری را انتخاب کنید");
        return;
      }

      const sillHeightM = isWindow ? Math.min(1, Math.max(0.4, wall.heightM * 0.3)) : 0;
      const heightM = isWindow
        ? Math.max(0.5, Math.min(1.4, wall.heightM - sillHeightM - 0.3))
        : Math.min(2.1, wall.heightM - 0.1);
      const door = {
        id: nextId(isWindow ? "win" : "door"),
        wallId: wall.id,
        type: isWindow ? ("window" as const) : ("door" as const),
        offset: projection.offset,
        widthM,
        heightM,
        sillHeightM,
        hinge: "start" as const,
        openAngleDeg: isWindow ? 0 : 45,
        // Glass bounds the room without blocking the view through it.
        blocksView: !isWindow
      };
      onFloorChange({ ...current.floor, doors: [...(current.floor.doors ?? []), door] });
      onSelect([{ kind: "door", id: door.id }]);
      onHint(isWindow
        ? "پنجره روی دیوار قرار گرفت؛ ارتفاع کف و ابعاد از پنل مشخصات قابل تنظیم است"
        : "در روی دیوار قرار گرفت؛ جهت بازشو و ابعاد را از پنل مشخصات تنظیم کنید");
      return;
    }

    if (current.tool === "camera") {
      const camera = {
        id: nextId("cam"),
        name: `دوربین ${current.floor.cameras.length + 1}`,
        position: snapped,
        yawDeg: 0,
        goal: "monitor" as const,
        optics: { ...defaultCameraOptics, mountHeightM: current.defaults.cameraMountHeightM }
      };
      onFloorChange({ ...current.floor, cameras: [...current.floor.cameras, camera] });
      onSelect([{ kind: "camera", id: camera.id }]);
      return;
    }

    const draft = draftRef.current;
    if (!draft) {
      onSelect([]);
      draftRef.current = { kind: current.tool as "wall" | "obstacle" | "measure", start: snapped };
      onHint(current.tool === "wall"
        ? current.wallDrawMode === "line"
          ? "نقطه پایان دیوار خطی را انتخاب کنید — Esc برای لغو"
          : current.wallDrawMode === "glass"
            ? "نقطه پایان جدار شیشه‌ای را انتخاب کنید — Esc برای لغو"
            : "گوشه مقابل مستطیل را انتخاب کنید — Esc برای لغو"
        : "نقطه مقابل را بزنید");
      return;
    }

    if (draft.kind === "wall") {
      const isGlass = current.wallDrawMode === "glass";
      if (current.wallDrawMode === "line" || isGlass) {
        const lengthM = distance(draft.start, snapped);
        if (lengthM >= 0.1) {
          onFloorChange({
            ...current.floor,
            walls: [...current.floor.walls, {
              id: nextId("wall"),
              a: draft.start,
              b: snapped,
              heightM: current.defaults.wallHeightM,
              // Glazing is thinner than masonry and, crucially, is not an occluder.
              thicknessM: isGlass ? Math.min(0.08, current.defaults.wallThicknessM) : current.defaults.wallThicknessM,
              blocksView: !isGlass
            }]
          });
          onHint(isGlass
            ? `جدار شیشه‌ای به طول ${lengthM.toFixed(2)} متر رسم شد — دید دوربین از آن عبور می‌کند`
            : `دیوار خطی به طول ${lengthM.toFixed(2)} متر رسم شد`);
        } else {
          onHint("طول دیوار باید حداقل ۱۰ سانتی‌متر باشد");
        }
        draftRef.current = null;
        const bundle = bundleRef.current;
        if (bundle) disposeGroup(bundle.groups.preview);
        clearSmartGuideLabel(smartGuideLabelHostRef.current);
        return;
      }

      const widthM = Math.abs(snapped.x - draft.start.x);
      const depthM = Math.abs(snapped.z - draft.start.z);
      if (widthM >= 0.2 && depthM >= 0.2) {
        const minX = Math.min(draft.start.x, snapped.x);
        const maxX = Math.max(draft.start.x, snapped.x);
        const minZ = Math.min(draft.start.z, snapped.z);
        const maxZ = Math.max(draft.start.z, snapped.z);
        const corners: Vec2[] = [
          { x: minX, z: minZ },
          { x: maxX, z: minZ },
          { x: maxX, z: maxZ },
          { x: minX, z: maxZ }
        ];
        const walls = corners.map((a, index) => ({
          id: nextId("wall"),
          a,
          b: corners[(index + 1) % corners.length],
          heightM: current.defaults.wallHeightM,
          thicknessM: current.defaults.wallThicknessM,
          blocksView: true
        }));
        onFloorChange({
          ...current.floor,
          walls: [...current.floor.walls, ...walls]
        });
        onHint(`مستطیل ${widthM.toFixed(2)} × ${depthM.toFixed(2)} متر رسم شد`);
      } else {
        onHint("طول و عرض مستطیل باید حداقل ۲۰ سانتی‌متر باشد");
      }
      draftRef.current = null;
      const bundle = bundleRef.current;
      if (bundle) disposeGroup(bundle.groups.preview);
      clearSmartGuideLabel(smartGuideLabelHostRef.current);
      return;
    }

    if (draft.kind === "obstacle") {
      const widthM = Math.abs(snapped.x - draft.start.x);
      const depthM = Math.abs(snapped.z - draft.start.z);
      if (widthM >= 0.2 && depthM >= 0.2) {
        const obstacle = {
          id: nextId("obs"), label: `مانع ${current.floor.obstacles.length + 1}`, kind: "block" as const,
          center: { x: (draft.start.x + snapped.x) / 2, z: (draft.start.z + snapped.z) / 2 },
          widthM, depthM, heightM: current.defaults.obstacleHeightM, rotationDeg: 0, blocksView: true
        };
        onFloorChange({ ...current.floor, obstacles: [...current.floor.obstacles, obstacle] });
        onSelect([{ kind: "obstacle", id: obstacle.id }]);
      }
      draftRef.current = null;
      onHint(null);
      return;
    }

    onHint(`فاصله اندازه‌گیری‌شده: ${distance(draft.start, snapped).toFixed(2)} متر`);
    draftRef.current = null;
  }, [onFloorChange, onHint, onSelect, pickAt, planPointAt, setControlsEnabled]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const bundle = bundleRef.current;
    const current = latest.current;
    if (!bundle || current.readOnly) return;

    const point = planPointAt(event.clientX, event.clientY);
    if (!point) return;

    if (current.pendingBackdrop) {
      const preview = bundle.groups.placement.children[0] ?? ensureBackdropPlacement(bundle, current.pendingBackdrop);
      if (preview) preview.position.set(point.x, 0.012, point.z);
      onHint("تصویر همراه ماوس حرکت می‌کند؛ برای ثبت محل روی نقشه کلیک کنید — Esc برای لغو");
      return;
    }

    const drag = dragRef.current;
    if (drag) {
      if (drag.kind === "marquee") {
        const rect = rectFromPoints(drag.start, point);
        disposeGroup(bundle.groups.preview);
        bundle.groups.preview.add(buildMarqueeRect(bundle.THREE, drag.start, point));
        const hits = elementsInRect(current.floor, rect);
        onHint(hits.length
          ? `${hits.length} آیتم داخل کادر`
          : "کادر را روی آیتم‌های موردنظر بکشید");
        return;
      }

      if (drag.kind === "rotate-obstacle") {
        const obstacle = current.floor.obstacles.find((item) => item.id === drag.id);
        if (!obstacle) return;
        // Plan-space angles run clockwise from +x, while the mesh rotation is negated,
        // so the pointer bearing is flipped back here to keep the arrow under the cursor.
        const bearing = Math.atan2(point.z - obstacle.center.z, point.x - obstacle.center.x);
        const rawDeg = (-(bearing * 180) / Math.PI + 360) % 360;
        // The four architectural axes have a 3° magnetic target; Shift keeps the wider
        // 15° stepping available for other deliberate alignments.
        const rotationDeg = snapRotationAngle(rawDeg, event.shiftKey);
        onFloorChange({
          ...current.floor,
          obstacles: current.floor.obstacles.map((item) => item.id === drag.id ? { ...item, rotationDeg } : item)
        });
        onHint(isCardinalAngle(rotationDeg)
          ? `زاویه: ${rotationDeg.toFixed(0)}° — قفل روی جهت قائم`
          : `زاویه: ${rotationDeg.toFixed(0)}°${event.shiftKey ? " (پله ۱۵ درجه)" : " — Shift برای پله ۱۵ درجه"}`);
        return;
      }

      if (drag.kind === "yaw") {
        const camera = current.floor.cameras.find((item) => item.id === drag.id);
        if (!camera) return;
        // Point the camera wherever the pointer is, in whole degrees.
        const rawYawDeg = (Math.atan2(point.z - camera.position.z, point.x - camera.position.x) * 180) / Math.PI;
        const yawDeg = snapRotationAngle(rawYawDeg, event.shiftKey);
        onFloorChange({
          ...current.floor,
          cameras: current.floor.cameras.map((item) => item.id === drag.id ? { ...item, yawDeg } : item)
        });
        onHint(isCardinalAngle(yawDeg)
          ? `جهت دوربین: ${yawDeg.toFixed(0)}° — قفل روی جهت قائم`
          : `جهت دوربین: ${yawDeg.toFixed(0)}°${event.shiftKey ? " (پله ۱۵ درجه)" : ""}`);
        return;
      }

      const snapped = snapPoint(point, current.snapM);
      if (drag.kind === "move-camera") {
        onFloorChange({
          ...current.floor,
          cameras: current.floor.cameras.map((item) => item.id === drag.id ? { ...item, position: snapped } : item)
        });
      } else {
        onFloorChange({
          ...current.floor,
          obstacles: current.floor.obstacles.map((item) => item.id === drag.id ? { ...item, center: snapped } : item)
        });
      }
      return;
    }

    const draft = draftRef.current;
    disposeGroup(bundle.groups.preview);
    if (!draft) {
      clearSmartGuideLabel(smartGuideLabelHostRef.current);
      return;
    }

    const snapped = snapPoint(point, current.snapM);
    if (draft.kind === "obstacle" || (draft.kind === "wall" && latest.current.wallDrawMode === "rectangle")) {
      clearSmartGuideLabel(smartGuideLabelHostRef.current);
      bundle.groups.preview.add(buildPreviewRect(
        bundle.THREE,
        draft.start,
        snapped,
        draft.kind === "wall" ? 0xe6572f : undefined
      ));
      const widthM = Math.abs(snapped.x - draft.start.x).toFixed(2);
      const depthM = Math.abs(snapped.z - draft.start.z).toFixed(2);
      onHint(draft.kind === "wall"
        ? `طول ${widthM} متر × عرض ${depthM} متر — کلیک برای ساخت چهار دیوار`
        : `${widthM} × ${depthM} متر`);
    } else {
      const line = buildPreviewLine(bundle.THREE, draft.start, snapped);
      (line as THREE_NS.Line).computeLineDistances();
      bundle.groups.preview.add(line);
      clearSmartGuideLabel(smartGuideLabelHostRef.current);
      onHint(draft.kind === "wall"
        ? `طول دیوار ${distance(draft.start, snapped).toFixed(2)} متر — کلیک برای رسم`
        : `فاصله ${distance(draft.start, snapped).toFixed(2)} متر`);
    }
  }, [onFloorChange, onHint, planPointAt]);

  const endDrag = useCallback((event?: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setControlsEnabled(true);

    const bundle = bundleRef.current;
    if (bundle) disposeGroup(bundle.groups.preview);
    if (drag.kind !== "marquee") return;

    const current = latest.current;
    const end = event ? planPointAt(event.clientX, event.clientY) : null;
    if (!end) { onHint(null); return; }

    const rect = rectFromPoints(drag.start, end);
    // A drag too small to be deliberate is treated as the click it probably was.
    if (rect.maxX - rect.minX < MARQUEE_MIN_SPAN_M && rect.maxZ - rect.minZ < MARQUEE_MIN_SPAN_M) {
      onHint(null);
      return;
    }

    const hits = elementsInRect(current.floor, rect);
    onSelect(drag.additive ? mergeSelection(current.selection, hits) : hits);
    onHint(hits.length ? `${hits.length} آیتم انتخاب شد` : "آیتمی داخل کادر نبود");
  }, [onHint, onSelect, planPointAt, setControlsEnabled]);

  const cancelDraft = useCallback(() => {
    draftRef.current = null;
    const bundle = bundleRef.current;
    if (bundle) disposeGroup(bundle.groups.preview);
    clearSmartGuideLabel(smartGuideLabelHostRef.current);
    onHint(null);
  }, [onHint]);

  useEffect(() => {
    if (draftRef.current) cancelDraft();
  }, [tool, cancelDraft]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && latest.current.pendingBackdrop) {
        latest.current.onCancelBackdropPlacement?.();
        return;
      }
      if (event.key === "Escape") cancelDraft();
      // Nudging yaw from the keyboard is far more precise than any drag.
      const current = latest.current;
      const soleCamera = soleSelection(current.selection);
      if (soleCamera?.kind !== "camera" || current.readOnly) return;
      if (event.key !== "[" && event.key !== "]") return;
      const delta = event.key === "]" ? 5 : -5;
      onFloorChange({
        ...current.floor,
        cameras: current.floor.cameras.map((item) =>
          item.id === soleCamera.id ? { ...item, yawDeg: (item.yawDeg + delta + 360) % 360 } : item)
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelDraft, onFloorChange]);

  return (
    <div className="plan-canvas-wrap">
      <div
        ref={hostRef}
        className={`plan-canvas tool-${readOnly ? "readonly" : tool}`}
        onDragOver={(event) => {
          const types = event.dataTransfer.types;
          const accepts = (latest.current.onDropCamera && types.includes("application/x-hamyar-camera"))
            || (latest.current.onDropPreset && types.includes("application/x-hamyar-preset"));
          if (!accepts) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={handleCanvasDrop}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }}
        onContextMenu={(event) => {
          // Always suppressed: the right button is the pan gesture, and a browser menu
          // appearing mid-drag would abandon it.
          event.preventDefault();
          if (latest.current.pendingBackdrop) latest.current.onCancelBackdropPlacement?.();
          else if (draftRef.current) cancelDraft();
        }}
      />
      <div ref={labelHostRef} className="plan-dimension-layer" aria-hidden="true" />
      <div ref={smartGuideLabelHostRef} className="plan-smart-guide-layer" aria-hidden="true" />
    </div>
  );
}

/* ── Scene sync ────────────────────────────────────────────────────── */

function syncScene(
  bundle: Bundle,
  props: Pick<PlanCanvasProps, "floor" | "selection" | "viewMode" | "buildingFloors" | "focusedFloorId" | "referenceFloor">,
  coverages: CameraCoverage[]
) {
  const { THREE, groups } = bundle;
  const { floor, selection, buildingFloors, focusedFloorId, referenceFloor, viewMode } = props;
  const sceneGeneration = ++bundle.sceneGeneration;

  disposeGroup(groups.content);
  disposeGroup(groups.cameras);
  disposeGroup(groups.coverage);
  disposeGroup(groups.backdrop);
  disposeGroup(groups.reference);

  if (viewMode === "building" && buildingFloors) {
    configureGroundSurface(bundle, { viewMode, buildingFloors, focusedFloorId });
    const showingAllFloors = focusedFloorId === null;
    for (const stackedFloor of buildingFloors) {
      const isFocused = Boolean(focusedFloorId && stackedFloor.id === focusedFloorId);
      const opacity = isFocused ? 1 : (showingAllFloors ? 0.52 : 0.075);
      const floorGroup = new THREE.Group();
      floorGroup.position.y = stackedFloor.elevationM;
      floorGroup.userData = { kind: "building-floor", floorId: stackedFloor.id, floorOpacity: opacity };
      floorGroup.add(buildFloorSlab(THREE, stackedFloor, isFocused));
      // Keep the envelope legible without rebuilding the old "stack of combs" effect.
      // In the all-floor view, furniture and equipment remain visible while the hundreds
      // of shop partitions stay collapsed to each level's architectural shell.
      const visibleWalls = isFocused
        ? stackedFloor.walls
        : stackedFloor.walls.filter((wall) => /(?:shell|envelope|estate|yard)-/.test(wall.id));
      for (const wall of visibleWalls) {
        const doors = (stackedFloor.doors ?? []).filter((door) => door.wallId === wall.id);
        floorGroup.add(buildWallWithDoors(THREE, wall, isFocused ? doors : [], false));
      }
      if (isFocused || showingAllFloors) {
        for (const obstacle of stackedFloor.obstacles) {
          floorGroup.add(buildObstacleMesh(THREE, obstacle, false, {
            floorId: stackedFloor.id,
            sceneGeneration
          }));
        }
        for (const door of stackedFloor.doors ?? []) {
          const wall = stackedFloor.walls.find((item) => item.id === door.wallId);
          if (wall) floorGroup.add(buildDoorMesh(THREE, door, wall, false));
        }
        for (const camera of stackedFloor.cameras) {
          floorGroup.add(buildCameraMarker(
            THREE,
            camera.id,
            camera.position,
            camera.optics.mountHeightM,
            camera.yawDeg,
            false,
            camera.housing
          ));
        }
      }
      applyObjectOpacity(floorGroup, opacity);
      groups.content.add(floorGroup);
    }
    return;
  }

  configureGroundSurface(bundle, { viewMode, buildingFloors, focusedFloorId });

  if (referenceFloor) groups.reference.add(buildFloorFootprintGuide(THREE, referenceFloor));

  const backdrop = buildBackdrop(THREE, floor);
  if (backdrop) groups.backdrop.add(backdrop);
  groups.content.add(buildOverallDimensionGuide(THREE, floor));

  for (const wall of floor.walls) {
    const doors = (floor.doors ?? []).filter((door) => door.wallId === wall.id);
    groups.content.add(buildWallWithDoors(THREE, wall, doors, isSelected(selection, "wall", wall.id)));
  }
  for (const corner of collectRightAngleCorners(floor.walls)) {
    groups.content.add(buildRightAngleMarker(THREE, corner));
  }
  for (const obstacle of floor.obstacles) {
    const obstacleSelected = isSelected(selection, "obstacle", obstacle.id);
    // Only the sole selection gets a handle: a marquee over twenty items should not
    // scatter twenty overlapping arrows across the plan.
    if (obstacleSelected && selection.length === 1) {
      groups.content.add(buildObstacleRotateHandle(THREE, obstacle));
    }
    groups.content.add(buildObstacleMesh(
      THREE,
      obstacle,
      obstacleSelected,
      { floorId: floor.id, sceneGeneration }
    ));
  }
  for (const door of floor.doors ?? []) {
    const wall = floor.walls.find((item) => item.id === door.wallId);
    if (wall) groups.content.add(buildDoorMesh(THREE, door, wall, isSelected(selection, "door", door.id)));
  }
  for (const camera of floor.cameras) {
    const cameraSelected = isSelected(selection, "camera", camera.id);
    groups.cameras.add(buildCameraMarker(
      THREE,
      camera.id,
      camera.position,
      camera.optics.mountHeightM,
      camera.yawDeg,
      cameraSelected,
      camera.housing
    ));
    if (cameraSelected) groups.cameras.add(buildYawHandle(THREE, camera.id, camera.position, camera.optics.mountHeightM, camera.yawDeg));
  }
  for (const coverage of coverages) {
    groups.coverage.add(buildCoverageMesh(THREE, coverage));
  }
}

function renderLabels(host: HTMLDivElement | null, labels: ReturnType<typeof collectDimensionLabels>) {
  if (!host) return;
  host.replaceChildren();
  for (const label of labels) {
    const node = document.createElement("span");
    node.className = `plan-dimension is-${label.kind}`;
    node.textContent = label.text;
    node.dataset.worldX = String(label.world.x);
    node.dataset.worldY = String(label.world.y);
    node.dataset.worldZ = String(label.world.z);
    host.appendChild(node);
  }
}

function updateBackdropPreviewAppearance(mesh: THREE_NS.Mesh, backdrop: PlanBackdrop) {
  const widthM = backdrop.widthPx * backdrop.metresPerPixel;
  const heightM = backdrop.heightPx * backdrop.metresPerPixel;
  mesh.scale.set(
    widthM / Number(mesh.userData.baseWidthM || widthM),
    heightM / Number(mesh.userData.baseHeightM || heightM),
    1
  );
  const material = mesh.material as THREE_NS.MeshBasicMaterial;
  material.opacity = backdrop.opacity;
  material.needsUpdate = true;
}

function ensureBackdropPlacement(bundle: Bundle, backdrop: PlanBackdrop): THREE_NS.Object3D | null {
  let mesh = bundle.groups.placement.children[0] as THREE_NS.Mesh | undefined;
  if (!mesh || mesh.userData.imageUrl !== backdrop.imageUrl) {
    disposeGroup(bundle.groups.placement);
    const preview = buildBackdropMesh(bundle.THREE, backdrop) as THREE_NS.Mesh | null;
    if (!preview) return null;
    preview.userData.imageUrl = backdrop.imageUrl;
    preview.userData.baseWidthM = backdrop.widthPx * backdrop.metresPerPixel;
    preview.userData.baseHeightM = backdrop.heightPx * backdrop.metresPerPixel;
    preview.renderOrder = 18;
    bundle.groups.placement.add(preview);
    mesh = preview;
  }
  updateBackdropPreviewAppearance(mesh, backdrop);
  return mesh;
}

function clearSmartGuideLabel(host: HTMLDivElement | null) {
  host?.replaceChildren();
}

function updateLabelPositions(bundle: Bundle, camera: THREE_NS.Camera, host: HTMLDivElement | null) {
  if (!host || !host.children.length) return;
  const { THREE, renderer } = bundle;
  const size = renderer.getSize(new THREE.Vector2());
  const vector = new THREE.Vector3();

  for (const child of Array.from(host.children) as HTMLElement[]) {
    vector.set(Number(child.dataset.worldX), Number(child.dataset.worldY), Number(child.dataset.worldZ));
    vector.project(camera);
    const behind = vector.z > 1;
    child.style.display = behind ? "none" : "block";
    if (behind) continue;
    child.style.transform = `translate(-50%, -50%) translate(${((vector.x + 1) / 2) * size.x}px, ${((-vector.y + 1) / 2) * size.y}px)`;
  }
}
