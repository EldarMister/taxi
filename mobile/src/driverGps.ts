import { distanceBetween, normalizeBearing, shortestAngleDelta } from './navigation';
import type { NavigationFix } from './navigation';

export const DRIVER_GPS_CONFIG = {
  requestIntervalMs: 1000,
  movingUploadMinMs: 900,
  stationaryUploadMinMs: 2500,
  maxFixAgeMs: 30_000,
  maxFutureMs: 5_000,
  maxAccuracyM: 80,
  maxReportedSpeedMps: 100,
  maximumTravelSpeedMps: 45,
  jumpAllowanceM: 35,
  jumpConfirmationMaxGapMs: 10_000,
  jumpConfirmationMinRadiusM: 15,
  jumpConfirmationMaxRadiusM: 40,
  stationarySpeedMps: .7,
  stationaryNoiseMinM: 5,
  stationaryNoiseMaxM: 18,
  stationaryNoiseAccuracyFactor: .35,
  stationaryConfirmations: 2,
  courseStartSpeedMps: 2,
  courseContinueSpeedMps: 1.1,
  courseMaxPositionAccuracyM: 35,
  courseMaxAccuracyDeg: 40,
  courseDeadbandDeg: 5,
  courseImmediateTurnDeg: 18,
  courseConfirmationMaxIntervalMs: 1500,
  displacementMinM: 8,
  displacementUncertaintyFactor: 1.5,
  displacementMaxAgeMs: 15_000,
} as const;

/** True-north direction of displacement, clockwise in degrees. Never a compass heading. */
export function displacementCourse(from: NavigationFix, to: NavigationFix): number {
  const rad = Math.PI / 180;
  const longitude = (to.longitude - from.longitude) * rad;
  const a = from.latitude * rad, b = to.latitude * rad;
  return normalizeBearing(Math.atan2(Math.sin(longitude) * Math.cos(b),
    Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(longitude)) / rad);
}

/** One stateful, route-independent filter shared by foreground and background GPS.
 * Position acquisition and bearing validation run at measurement frequency. The
 * Small course noise is held inside a deadband; a modest deviation needs a
 * second measurement on the same side. Clear turns pass immediately and the
 * map animates them at frame frequency, without delaying position acquisition.
 */
export class DriverGpsFilter {
  private previousRaw: NavigationFix | null = null;
  private previous: NavigationFix | null = null;
  private pendingJump: NavigationFix | null = null;
  private courseAnchor: NavigationFix | null = null;
  private lastCourse: number | undefined;
  private pendingCourse: number | undefined;
  private moving = false;
  private stationaryCount = 0;
  private newestTimestamp = -Infinity;
  lastDropReason = '';

  reset() {
    this.previousRaw = this.previous = this.pendingJump = this.courseAnchor = null;
    this.lastCourse = this.pendingCourse = undefined; this.moving = false; this.stationaryCount = 0;
    this.newestTimestamp = -Infinity; this.lastDropReason = '';
  }

  ingest(input: NavigationFix, now: number): NavigationFix | null {
    const cfg = DRIVER_GPS_CONFIG;
    if (!Number.isFinite(input.latitude) || Math.abs(input.latitude) > 90
      || !Number.isFinite(input.longitude) || Math.abs(input.longitude) > 180
      || !Number.isFinite(input.accuracy) || input.accuracy < 0 || input.accuracy > cfg.maxAccuracyM
      || !Number.isFinite(input.timestamp) || now - input.timestamp > cfg.maxFixAgeMs
      || input.timestamp - now > cfg.maxFutureMs) {
      this.lastDropReason = 'invalid-stale-or-inaccurate'; return null;
    }
    if (input.timestamp <= this.newestTimestamp) { this.lastDropReason = 'out-of-order'; return null; }
    this.newestTimestamp = input.timestamp;
    // Invalid optional sensor fields do not invalidate an otherwise useful fix.
    // Expo supplies GPS course, not phone orientation, through coords.heading.
    const raw: NavigationFix = { latitude: input.latitude, longitude: input.longitude,
      timestamp: input.timestamp, accuracy: input.accuracy,
      speed: input.speed != null && Number.isFinite(input.speed) && input.speed >= 0 && input.speed <= cfg.maxReportedSpeedMps ? input.speed : undefined,
      heading: input.heading != null && Number.isFinite(input.heading) && input.heading >= 0 && input.heading <= 360 ? normalizeBearing(input.heading) : undefined,
      courseAccuracyDeg: input.courseAccuracyDeg != null && Number.isFinite(input.courseAccuracyDeg)
        && input.courseAccuracyDeg >= 0 && input.courseAccuracyDeg <= 180 ? input.courseAccuracyDeg : null };
    const previousRaw = this.previousRaw;
    let reacquired = !previousRaw || raw.timestamp - previousRaw.timestamp > cfg.maxFixAgeMs;
    if (previousRaw && !reacquired) {
      const elapsed = (raw.timestamp - previousRaw.timestamp) / 1000;
      const allowed = cfg.jumpAllowanceM + elapsed * cfg.maximumTravelSpeedMps + Math.max(previousRaw.accuracy, raw.accuracy);
      if (distanceBetween(previousRaw, raw) > allowed) {
        const radius = Math.max(cfg.jumpConfirmationMinRadiusM,
          Math.min(cfg.jumpConfirmationMaxRadiusM, Math.max(this.pendingJump?.accuracy ?? 0, raw.accuracy)));
        if (!this.pendingJump || raw.timestamp - this.pendingJump.timestamp > cfg.jumpConfirmationMaxGapMs
          || distanceBetween(this.pendingJump, raw) > radius) {
          this.pendingJump = raw; this.lastDropReason = 'implausible-jump'; return null;
        }
        reacquired = true;
      }
    }
    this.pendingJump = null;
    if (reacquired) { this.courseAnchor = null; this.moving = false; this.stationaryCount = 0; }

    if (raw.speed != null && raw.speed >= cfg.courseStartSpeedMps) {
      this.moving = true; this.stationaryCount = 0;
    } else if (raw.speed != null && raw.speed <= cfg.stationarySpeedMps) {
      if (++this.stationaryCount >= cfg.stationaryConfirmations) this.moving = false;
    } else if (raw.speed != null) this.stationaryCount = 0;

    let course: number | undefined, source: NavigationFix['courseSource'] = null;
    let courseAccuracy: number | null = null;
    const gpsCourseUsable = raw.heading != null && raw.accuracy <= cfg.courseMaxPositionAccuracyM
      && (raw.courseAccuracyDeg == null || raw.courseAccuracyDeg <= cfg.courseMaxAccuracyDeg)
      && raw.speed != null && raw.speed >= (this.moving ? cfg.courseContinueSpeedMps : cfg.courseStartSpeedMps);
    if (gpsCourseUsable) {
      course = raw.heading; source = 'gps'; courseAccuracy = raw.courseAccuracyDeg ?? null;
    }
    const anchor = this.courseAnchor;
    if (anchor && raw.timestamp - anchor.timestamp <= cfg.displacementMaxAgeMs
      && raw.accuracy <= cfg.courseMaxPositionAccuracyM && anchor.accuracy <= cfg.courseMaxPositionAccuracyM) {
      const distance = distanceBetween(anchor, raw);
      const uncertainty = Math.hypot(anchor.accuracy, raw.accuracy);
      const seconds = (raw.timestamp - anchor.timestamp) / 1000;
      // A baseline larger than the combined GPS error is required. Keep the
      // anchor between small steps so slow travel can eventually establish it.
      if (course == null && (raw.speed == null || raw.speed > .3) && seconds > 0
        && distance >= Math.max(cfg.displacementMinM, uncertainty * cfg.displacementUncertaintyFactor)
        && distance / seconds >= .4) {
        course = displacementCourse(anchor, raw); source = 'displacement';
        courseAccuracy = Math.atan2(uncertainty, distance) * 180 / Math.PI;
      }
    }
    if (!anchor || course != null || raw.timestamp - anchor.timestamp >= cfg.displacementMaxAgeMs) this.courseAnchor = raw;
    const turning = course != null && this.lastCourse != null && Math.abs(shortestAngleDelta(this.lastCourse, course)) >= 25;
    if (course != null) {
      const delta = this.lastCourse == null ? 0 : shortestAngleDelta(this.lastCourse, course);
      const magnitude = Math.abs(delta);
      if (this.lastCourse == null || reacquired || magnitude >= cfg.courseImmediateTurnDeg
        || magnitude > cfg.courseDeadbandDeg && previousRaw != null
          && raw.timestamp - previousRaw.timestamp > cfg.courseConfirmationMaxIntervalMs) {
        // A real turn, reacquisition, or sparse GPS must not wait for another
        // packet. For normal one-second GPS, suppress isolated small spikes.
        this.lastCourse = course; this.pendingCourse = undefined;
      } else if (magnitude <= cfg.courseDeadbandDeg) {
        this.pendingCourse = undefined;
      } else if (this.pendingCourse != null
        && Math.sign(shortestAngleDelta(this.lastCourse, this.pendingCourse)) === Math.sign(delta)
        && Math.abs(shortestAngleDelta(this.pendingCourse, course)) <= cfg.courseImmediateTurnDeg) {
        this.lastCourse = course; this.pendingCourse = undefined;
      } else this.pendingCourse = course;
    } else this.pendingCourse = undefined;

    let fix: NavigationFix = { ...raw, heading: this.lastCourse, courseSource: source, courseAccuracyDeg: courseAccuracy };
    const previous = this.previous;
    if (previous && !reacquired) {
      const distance = distanceBetween(previous, raw);
      const seconds = Math.max(.05, (raw.timestamp - previous.timestamp) / 1000);
      const noise = Math.max(cfg.stationaryNoiseMinM, Math.min(cfg.stationaryNoiseMaxM,
        Math.max(previous.accuracy, raw.accuracy) * cfg.stationaryNoiseAccuracyFactor));
      const stopped = raw.speed != null ? raw.speed <= cfg.stationarySpeedMps : course == null;
      if (stopped && source == null && distance < noise) {
        // Publish the fresh measurement time even when coordinates are held.
        fix = { ...fix, latitude: previous.latitude, longitude: previous.longitude };
      } else {
        const speed = raw.speed ?? distance / seconds;
        const tau = raw.accuracy > 30 ? 1.2 : speed >= 2 ? .28 : .55;
        const alpha = Math.min(.98, Math.max(turning ? .93 : .35, 1 - Math.exp(-seconds / tau)));
        fix = { ...fix, latitude: previous.latitude + (raw.latitude - previous.latitude) * alpha,
          longitude: previous.longitude + (raw.longitude - previous.longitude) * alpha };
      }
    }
    this.previousRaw = raw; this.previous = fix; this.lastDropReason = '';
    return fix;
  }
}
