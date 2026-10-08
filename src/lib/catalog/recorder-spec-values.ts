import type { RecorderSpecs } from "@/src/domain/catalog/types";

/** Values in the order used by the recorder_specs INSERT statement. */
export function recorderSpecValues(record: RecorderSpecs & { product_id: string }): unknown[] {
  return [
    record.product_id, record.technology, record.channels, record.incomingBandwidthMbps,
    record.maxDecodeMp, record.driveBays, record.maxDriveCapacityTb, record.raidLevels,
    record.builtInPoePorts, record.codecs, record.maxCameraResolutionMp,
    record.outgoingBandwidthMbps ?? null, record.decodeCapacityMp ?? null,
    record.maxSimultaneousDecodeChannels ?? null, record.basePowerW ?? null,
    record.drivePowerPerBayW ?? null
  ];
}
