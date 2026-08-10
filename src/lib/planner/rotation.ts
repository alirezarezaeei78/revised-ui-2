const CARDINAL_SNAP_TOLERANCE_DEG = 3;

/** Gives the four architectural axes a small magnetic target without making free rotation feel stepped. */
export function snapRotationAngle(angleDeg: number, snapToFifteen = false): number {
  const normalized = (angleDeg % 360 + 360) % 360;
  const cardinal = (Math.round(normalized / 90) * 90) % 360;
  const cardinalDistance = Math.abs(((normalized - cardinal + 540) % 360) - 180);
  if (cardinalDistance <= CARDINAL_SNAP_TOLERANCE_DEG) return cardinal;
  return snapToFifteen ? (Math.round(normalized / 15) * 15) % 360 : Math.round(normalized) % 360;
}

export function isCardinalAngle(angleDeg: number): boolean {
  const normalized = (angleDeg % 360 + 360) % 360;
  return normalized % 90 === 0;
}
