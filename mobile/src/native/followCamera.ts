export type CameraPose = { latitude: number; longitude: number; heading: number; zoom: number; pitch: number };
export type CameraMode = 'course' | 'north';

export const shortestBearingDelta = (from: number, to: number) => ((to - from) % 360 + 540) % 360 - 180;

/** Geographic course is clockwise from true north. Device orientation is deliberately absent. */
export function followCameraTarget(point: { latitude: number; longitude: number; bearingDeg: number | null },
  mode: CameraMode, driving: boolean, speedMps: number, zoom: number, previousHeading: number): CameraPose {
  const heading = driving && mode === 'course' ? point.bearingDeg ?? previousHeading : 0;
  const aheadM = driving && point.bearingDeg != null ? Math.max(30, Math.min(80, 30 + speedMps * 3)) : 0;
  const radians = (point.bearingDeg ?? 0) * Math.PI / 180;
  return {
    latitude: point.latitude + Math.cos(radians) * aheadM / 111320,
    longitude: point.longitude + Math.sin(radians) * aheadM / (111320 * Math.max(.1, Math.cos(point.latitude * Math.PI / 180))),
    heading, zoom, pitch: driving ? 40 : 0,
  };
}

/** One interruptible frame stream for position, bearing, zoom and pitch; never queues SDK animations. */
export function advanceFollowCamera(from: CameraPose, to: CameraPose, elapsedMs: number, returning: boolean): CameraPose {
  const fraction = 1 - Math.exp(-Math.max(0, Math.min(64, elapsedMs)) / (returning ? 150 : 65));
  // Course has its own damping so a small change cannot swing the whole map
  // within a couple of frames. Translation still follows the marker promptly.
  const headingFraction = 1 - Math.exp(-Math.max(0, Math.min(64, elapsedMs)) / (returning ? 150 : 180));
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * fraction,
    longitude: from.longitude + (to.longitude - from.longitude) * fraction,
    heading: from.heading + shortestBearingDelta(from.heading, to.heading) * headingFraction,
    zoom: from.zoom + (to.zoom - from.zoom) * fraction,
    pitch: from.pitch + (to.pitch - from.pitch) * fraction,
  };
}
