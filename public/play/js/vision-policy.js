// vision-policy.js — shared, runtime-independent rendering thresholds.
export const VISION_NEAR_RADIUS = 6;
export const VISION_CONE_HALF_ANGLE_DEG = 60;
export const VISION_RAY_COUNT = 64;

// Geometry-only visibility field. Wall clipping is applied by the renderer with nearestWallT.
export function isWithinVisibilityField({ distance, angleDeg }) {
  return distance <= VISION_NEAR_RADIUS || Math.abs(angleDeg) <= VISION_CONE_HALF_ANGLE_DEG;
}
