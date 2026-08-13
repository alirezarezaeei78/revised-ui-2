import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  cameraFromTemplate,
  createBlankCamera,
  createTemplate,
  defaultCameraTemplates,
  effectiveBitrateKbps,
  estimateBitrateKbps,
  zonesFromPlan,
  zonesFromTemplates
} from "@/src/lib/planner/camera-templates";
import { createEmptyPlan } from "@/src/domain/planner/types";

describe("bitrate model", () => {
  test("higher resolution costs more bitrate", () => {
    const two = estimateBitrateKbps(2, "H.265", 25, "high");
    const eight = estimateBitrateKbps(8, "H.265", 25, "high");
    assert.ok(eight > two * 2, `expected 8MP to cost well over 2× a 2MP stream, got ${two} vs ${eight}`);
  });

  test("newer codecs cost less at equal settings", () => {
    const h264 = estimateBitrateKbps(4, "H.264", 25, "high");
    const h265 = estimateBitrateKbps(4, "H.265", 25, "high");
    const smart = estimateBitrateKbps(4, "H.265+", 25, "high");
    assert.ok(h265 < h264 && smart < h265, `expected H.264 > H.265 > H.265+, got ${h264}/${h265}/${smart}`);
    // H.265 should land near the published 40–50% saving rather than an optimistic best case.
    assert.ok(h265 / h264 > 0.45 && h265 / h264 < 0.65);
  });

  test("frame rate scales sub-linearly", () => {
    const low = estimateBitrateKbps(4, "H.265", 12, "high");
    const high = estimateBitrateKbps(4, "H.265", 25, "high");
    assert.ok(high > low, "more frames should cost more");
    assert.ok(high < low * 2, "doubling fps must not double the bitrate");
  });

  test("motion recording reduces the effective archive load", () => {
    const stream = {
      codec: "H.265", fps: 20, bitrateMode: "VBR", bitrateKbps: 4000, quality: "high",
      audioEnabled: false, recordingMode: "motion", motionActivityPercent: 25
    };
    assert.equal(effectiveBitrateKbps(stream), 1000);
    assert.equal(effectiveBitrateKbps({ ...stream, recordingMode: "continuous" }), 4000);
  });

  test("audio adds its own bitrate", () => {
    const stream = {
      codec: "H.265", fps: 20, bitrateMode: "VBR", bitrateKbps: 2000, quality: "high",
      audioEnabled: true, recordingMode: "continuous", motionActivityPercent: 40
    };
    assert.equal(effectiveBitrateKbps(stream), 2064);
  });
});

describe("templates are reusable", () => {
  test("dropping the same type twice yields two independent cameras", () => {
    const template = defaultCameraTemplates()[0];
    const first = cameraFromTemplate(template, { x: 1, z: 1 }, 1);
    const second = cameraFromTemplate(template, { x: 5, z: 5 }, 2);

    assert.notEqual(first.id, second.id);
    assert.equal(first.templateId, second.templateId);

    // Retuning one placement must not touch the other, nor the template it came from.
    first.optics.focalMm = 12;
    assert.notEqual(second.optics.focalMm, 12);
    assert.notEqual(template.focalMm, 12);
  });

  test("a blank camera carries usable defaults", () => {
    const camera = createBlankCamera({ x: 0, z: 0 }, 1, 3.4);
    assert.equal(camera.templateId, undefined);
    assert.equal(camera.optics.mountHeightM, 3.4);
    assert.ok(camera.stream, "a blank camera still needs encoder settings");
  });

  test("changing resolution keeps the suggested bitrate in step", () => {
    const template = createTemplate({ megapixel: 2 });
    const suggested = estimateBitrateKbps(2, template.stream.codec, template.stream.fps, template.stream.quality);
    assert.equal(template.stream.bitrateKbps, suggested);
  });
});

describe("zone derivation", () => {
  const planWithCameras = () => {
    const plan = createEmptyPlan();
    const template = defaultCameraTemplates()[0];
    const outdoor = { ...defaultCameraTemplates()[2], outdoor: true };
    plan.floors[0].cameras = [
      cameraFromTemplate(template, { x: 1, z: 1 }, 1),
      cameraFromTemplate(template, { x: 4, z: 1 }, 2),
      { ...cameraFromTemplate(outdoor, { x: 8, z: 8 }, 1), outdoor: true }
    ];
    return plan;
  };

  test("placed cameras become zones grouped by goal and exposure", () => {
    const zones = zonesFromPlan(planWithCameras());
    assert.equal(zones.reduce((sum, zone) => sum + zone.cameraCount, 0), 3);
    assert.ok(zones.some((zone) => zone.outdoor), "the outdoor camera needs its own zone");
  });

  test("each derived camera keeps its own measured bitrate", () => {
    const plan = planWithCameras();
    plan.floors[0].cameras[0].stream = {
      ...plan.floors[0].cameras[0].stream,
      bitrateKbps: 9000,
      recordingMode: "continuous"
    };
    const units = zonesFromPlan(plan).flatMap((zone) => zone.cameras ?? []);
    assert.ok(units.some((unit) => unit.measuredBitrateKbps === 9000),
      "a per-camera bitrate edit must survive into the engine payload");
  });

  test("derived geometry is usable by the engine", () => {
    for (const zone of zonesFromPlan(planWithCameras())) {
      for (const unit of zone.cameras ?? []) {
        assert.ok(unit.sceneWidthM > 0, "scene width must be recoverable from the optics");
        assert.ok(unit.targetDistanceM > 0);
        assert.ok(unit.minimumPpm > 0);
      }
    }
  });

  test("template quantities drive the quick-estimate path", () => {
    const templates = defaultCameraTemplates();
    const zones = zonesFromTemplates(templates);
    const expected = templates.reduce((sum, template) => sum + template.quantity, 0);
    assert.equal(zones.reduce((sum, zone) => sum + zone.cameraCount, 0), expected);
  });

  test("a zero-quantity type contributes nothing", () => {
    const zones = zonesFromTemplates([{ ...defaultCameraTemplates()[0], quantity: 0 }]);
    assert.equal(zones.length, 0);
  });
});
