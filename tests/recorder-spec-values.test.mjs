import test from "node:test";
import assert from "node:assert/strict";
import { recorderSpecValues } from "../src/lib/catalog/recorder-spec-values.ts";

const recorder = {
  product_id: "recorder-1", technology: "NVR", channels: 16,
  incomingBandwidthMbps: 160, maxDecodeMp: 8, driveBays: 2,
  maxDriveCapacityTb: 10, raidLevels: [], builtInPoePorts: 0,
  codecs: ["H.265"], maxCameraResolutionMp: 8
};

test("WooCommerce recorder insert preserves optional bandwidth, decoding and power specs", () => {
  const values = recorderSpecValues({
    ...recorder, outgoingBandwidthMbps: 128, decodeCapacityMp: 32,
    maxSimultaneousDecodeChannels: 4, basePowerW: 20, drivePowerPerBayW: 6
  });
  assert.equal(values.length, 16);
  assert.deepEqual(values.slice(11), [128, 32, 4, 20, 6]);
});

test("missing recorder specs become SQL null and explicit zero remains zero", () => {
  assert.deepEqual(recorderSpecValues(recorder).slice(11), [null, null, null, null, null]);
  assert.equal(recorderSpecValues({ ...recorder, basePowerW: 0 })[14], 0);
});
