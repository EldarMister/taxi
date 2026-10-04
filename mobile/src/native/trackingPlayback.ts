/** Measured vehicle motion, independent of React, map rotation and phone heading. */
export type PlaybackFix = {
  latitude: number; longitude: number;
  measuredAtMs?: number; measuredAt?: number; timestamp?: number;
  courseDeg?: number | null; bearingDeg?: number | null;
  /** Legacy NavigationFix GPS-course alias; never a phone compass reading. */
  heading?: number | null;
  courseAccuracyDeg?: number | null; courseSource?: 'gps' | 'displacement' | null;
  speedMps?: number | null; speed?: number | null;
  accuracyM?: number | null; accuracy?: number | null;
  driverId?: string; orderId?: string; tripId?: string; assignmentId?: string;
  trackingSessionId?: string; trackingStartedAtMs?: number; trackingStartedAt?: number;
  sequence?: number; stateVersion?: number;
  /** Transient client-hook flag: ordering and jump/reacquisition already checked. */
  playbackPositionValidated?: boolean;
};
export type PlaybackFrame = {
  latitude: number; longitude: number; bearingDeg: number | null;
  measuredAtMs: number; stale: boolean; bufferMs: number;
};
type Fix = PlaybackFix & { at: number; received: number; age: number; bearing: number | null };
type Transition = { from: PlaybackFrame; to: Fix; started: number; duration: number };
type BearingTransition = { from: number; to: number; started: number; duration: number };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const clock = () => typeof performance === 'undefined' ? Date.now() : performance.now();
const at = (p: PlaybackFix) => p.measuredAtMs ?? p.measuredAt ?? p.timestamp ?? NaN;
const accuracy = (p: PlaybackFix) => p.accuracyM !== undefined ? p.accuracyM : p.accuracy;
const speed = (p: PlaybackFix) => p.speedMps !== undefined ? p.speedMps : p.speed;
const sessionStart = (p: PlaybackFix) => p.trackingStartedAtMs ?? p.trackingStartedAt;
const scope = (p: PlaybackFix) => `${p.driverId ?? ''}:${p.orderId ?? p.tripId ?? ''}:${p.assignmentId ?? ''}`;
export const normalizePlaybackBearing = (value: number) => ((value % 360) + 360) % 360;
export function interpolatePlaybackBearing(from: number | null, to: number | null, fraction: number): number | null {
  if (from == null) return to;
  if (to == null) return from;
  return normalizePlaybackBearing(from + (((to - from + 540) % 360) - 180) * clamp(fraction, 0, 1));
}
function metres(a: PlaybackFix, b: PlaybackFix) {
  const east = (((b.longitude - a.longitude + 540) % 360) - 180) * Math.cos((a.latitude + b.latitude) * Math.PI / 360);
  return Math.hypot(b.latitude - a.latitude, east) * 111195;
}
function interpolate(a: PlaybackFrame, b: Fix, fraction: number, stale: boolean, bufferMs: number): PlaybackFrame {
  const t = clamp(fraction, 0, 1);
  const longitudeDelta = ((b.longitude - a.longitude + 540) % 360) - 180;
  return { latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: ((a.longitude + longitudeDelta * t + 540) % 360) - 180,
    bearingDeg: interpolatePlaybackBearing(a.bearingDeg, b.bearing, t),
    measuredAtMs: a.measuredAtMs + (b.at - a.measuredAtMs) * t, stale, bufferMs };
}
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 1000;
}

/**
 * Call ingest once per measurement, sample on RAF with the SAME monotonic clock.
 * Client playback is one adaptive measurement interval behind the latest fix;
 * it never extrapolates. Local playback corrects each fix in 100–350 ms and
 * predicts at most 750 ms / 15 m with accurate, moving GPS measurements.
 * No planned route or phone compass participates in vehicle position/bearing.
 */
export class TrackingPlayback {
  private readonly mode: 'client' | 'local';
  private readonly wallNow: () => number;
  private points: Fix[] = [];
  private intervals: number[] = [];
  private clockOffsets: number[] = [];
  private retiredSessions = new Set<string>();
  private rendered: PlaybackFrame | null = null;
  private transition: Transition | null = null;
  private bearingTransition: BearingTransition | null = null;
  private cursor = 0;
  private lastSample: number | null = null;
  private buffer = 1200;
  private jitter = 0;
  private pendingJump: PlaybackFix | null = null;

  constructor(options: { mode?: 'client' | 'local'; wallNow?: () => number } = {}) {
    this.mode = options.mode ?? 'client';
    this.wallNow = options.wallNow ?? Date.now;
  }

  reset() {
    this.points = []; this.intervals = []; this.clockOffsets = []; this.retiredSessions.clear();
    this.rendered = null; this.transition = null; this.bearingTransition = null; this.cursor = 0; this.lastSample = null;
    this.buffer = 1200; this.jitter = 0;
    this.pendingJump = null;
  }

  ingest(point: PlaybackFix, receivedAtMs = clock(), ageAtReceiptMs?: number): boolean {
    const measured = at(point), precision = accuracy(point), velocity = speed(point);
    if (!Number.isFinite(receivedAtMs) || !Number.isFinite(measured) || measured < 0
      || !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90
      || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180
      || precision != null && (!Number.isFinite(precision) || precision < 0 || precision > 100)
      || velocity != null && (!Number.isFinite(velocity) || velocity < 0 || velocity > 100)
      || point.courseAccuracyDeg != null && (!Number.isFinite(point.courseAccuracyDeg) || point.courseAccuracyDeg < 0 || point.courseAccuracyDeg > 180)
      || point.courseSource != null && point.courseSource !== 'gps' && point.courseSource !== 'displacement'
      || point.sequence != null && (!Number.isInteger(point.sequence) || point.sequence < 1)) return false;
    let previous: Fix | undefined = this.points[this.points.length - 1];
    let reacquired = false;
    if (previous && scope(previous) !== scope(point)) { this.reset(); previous = undefined; }
    if (previous) {
      if (measured <= previous.at || point.trackingSessionId && this.retiredSessions.has(point.trackingSessionId)
        || point.stateVersion != null && previous.stateVersion != null && point.stateVersion <= previous.stateVersion) return false;
      if (point.trackingSessionId === previous.trackingSessionId && point.sequence != null && previous.sequence != null
        && point.sequence <= previous.sequence) return false;
      if (point.trackingSessionId && previous.trackingSessionId && point.trackingSessionId !== previous.trackingSessionId
        && sessionStart(point) != null && sessionStart(previous) != null && sessionStart(point)! <= sessionStart(previous)!) return false;
      const seconds = (measured - previous.at) / 1000;
      const tolerance = 25 + Math.min(60, (precision ?? 15) + (accuracy(previous) ?? 15));
      if (this.mode === 'client' && !point.playbackPositionValidated
        && seconds <= 30 && metres(previous, point) > seconds * 55 + tolerance) {
        const candidate = this.pendingJump, candidateTime = candidate ? at(candidate) : 0;
        const confirms = candidate && candidate.trackingSessionId === point.trackingSessionId
          && measured > candidateTime && measured - candidateTime <= 5000
          && precision != null && precision <= 25 && accuracy(candidate) != null && accuracy(candidate)! <= 25
          && (point.sequence == null || candidate.sequence == null || point.sequence > candidate.sequence)
          && metres(candidate, point) <= (measured - candidateTime) / 1000 * 55 + tolerance;
        if (!confirms) { if (!candidate || measured > candidateTime) this.pendingJump = point; return false; }
        reacquired = true;
      }
    }
    // Materialize the current frame before replacing a target, so recovery and
    // local retargeting always begin at the position actually being displayed.
    this.pendingJump = null;
    const visible = this.sample(receivedAtMs);
    let bearing = previous?.bearing ?? null;
    const declaredCourse = point.courseDeg !== undefined ? point.courseDeg
      : point.bearingDeg !== undefined ? point.bearingDeg : point.heading;
    const distance = previous ? metres(previous, point) : 0;
    const confidentlyMoving = velocity != null ? velocity >= .8
      : previous != null && distance >= Math.max(6, (precision ?? 15) + (accuracy(previous) ?? 15));
    // The producer's validated/held course must survive slow motion. Its GPS
    // filter can accumulate a much longer displacement baseline than this
    // renderer's immediately preceding packet. Missing source is legacy data.
    const validatedCourse = point.courseSource !== undefined;
    if ((validatedCourse || confidentlyMoving) && declaredCourse != null && Number.isFinite(declaredCourse)
      && declaredCourse >= 0 && declaredCourse < 360
      && (point.courseAccuracyDeg == null || Number.isFinite(point.courseAccuracyDeg)
        && point.courseAccuracyDeg >= 0 && point.courseAccuracyDeg <= 45)) bearing = declaredCourse;
    else if (!validatedCourse && confidentlyMoving && previous && measured - previous.at <= 10000
      && precision != null && precision <= 25 && accuracy(previous) != null && accuracy(previous)! <= 25
      && distance >= Math.max(6, (precision + accuracy(previous)!) * .8)) {
      const east = (((point.longitude - previous.longitude + 540) % 360) - 180) * Math.cos(point.latitude * Math.PI / 180);
      bearing = normalizePlaybackBearing(Math.atan2(east, point.latitude - previous.latitude) * 180 / Math.PI);
    }
    const age = Number.isFinite(ageAtReceiptMs) ? Math.max(0, ageAtReceiptMs!) : Math.max(0, this.wallNow() - measured);
    const next: Fix = { ...point, at: measured, received: receivedAtMs, age, bearing };
    const sessionChanged = !!previous?.trackingSessionId && !!point.trackingSessionId && previous.trackingSessionId !== point.trackingSessionId;
    const recovered = previous != null && (reacquired || visible?.stale || measured - previous.at > 15000 || sessionChanged
      || metres(previous, point) > (measured - previous.at) / 1000 * 55 + 85);
    if (sessionChanged && previous?.trackingSessionId) this.retiredSessions.add(previous.trackingSessionId);
    if (!previous) {
      this.points = [next]; this.cursor = measured; this.lastSample = receivedAtMs;
      this.rendered = this.frame(next, age > 15000); return true;
    }
    if (this.mode === 'local' || recovered || this.transition) {
      if (recovered) { this.intervals = []; this.clockOffsets = []; this.jitter = 0; }
      this.points = [next];
      this.transition = { from: visible!, to: next, started: receivedAtMs,
        duration: this.mode === 'local' ? clamp((measured - previous.at) * .35, 100, 350) : 800 };
      if (this.mode === 'local' && visible?.bearingDeg != null && bearing != null
        && this.bearingTransition?.to !== bearing) {
        const degrees = Math.abs(((bearing - visible.bearingDeg + 540) % 360) - 180);
        this.bearingTransition = degrees < .01 ? null : { from: visible.bearingDeg, to: bearing,
          started: receivedAtMs, duration: clamp(180 + degrees * 5, 250, 1050) };
      }
      this.lastSample = receivedAtMs;
      return true;
    }
    const interval = measured - previous.at;
    if (interval >= 200 && interval <= 10000) {
      this.intervals.push(interval); if (this.intervals.length > 5) this.intervals.shift();
      this.jitter = this.jitter * .7 + Math.abs(receivedAtMs - previous.received - interval) * .3;
      this.buffer = clamp(median(this.intervals) * 1.05 + 150 + this.jitter, 650, 6000);
    }
    this.clockOffsets.push(receivedAtMs - measured);
    if (this.clockOffsets.length > 12) this.clockOffsets.shift();
    this.points.push(next);
    // Keep the currently displayed segment even during a burst of network data.
    while (this.points.length > 2 && this.points[1].at < this.cursor) this.points.shift();
    if (this.points.length > 64) this.points.splice(1, this.points.length - 64);
    return true;
  }

  sample(nowMs = clock()): PlaybackFrame | null {
    const latest = this.points[this.points.length - 1];
    if (!latest) return null;
    const elapsed = Math.max(0, nowMs - latest.received);
    const stale = latest.age + elapsed > 15000;
    if (this.mode === 'local') {
      const target = this.localTarget(latest, elapsed);
      this.rendered = this.frame(target, stale);
      if (this.transition) {
        const transition = this.transition;
        const fraction = clamp((nowMs - transition.started) / transition.duration, 0, 1);
        const initialTarget = this.localTarget(latest, 0);
        const corrected = interpolate(transition.from, initialTarget, 1 - (1 - fraction) ** 2, stale, 0);
        // Correct the position error while the measured velocity continues to
        // advance. This avoids braking at every one-second GPS measurement.
        this.rendered = { ...corrected,
          latitude: corrected.latitude + target.latitude - initialTarget.latitude,
          longitude: ((corrected.longitude + target.longitude - initialTarget.longitude + 540) % 360) - 180 };
        if (fraction === 1) this.transition = null;
      }
      // A large change in course needs a longer animation than a GPS position
      // correction. Keep those clocks separate: a U-turn must not whip the map
      // around in 350 ms or slow down the measured position to look smoother.
      if (this.bearingTransition) {
        const turn = this.bearingTransition;
        const fraction = clamp((nowMs - turn.started) / turn.duration, 0, 1);
        const eased = fraction * fraction * (3 - 2 * fraction);
        this.rendered.bearingDeg = interpolatePlaybackBearing(turn.from, turn.to, eased);
        if (fraction === 1) this.bearingTransition = null;
      }
      this.lastSample = nowMs;
      return this.rendered;
    }
    if (this.transition) {
      const transition = this.transition;
      const fraction = clamp((nowMs - transition.started) / transition.duration, 0, 1);
      // A short ease-out is only for recovery/local retargeting. Normal client
      // interpolation has continuous measurement-time progression, not an ease
      // that brakes to a stop for every packet.
      this.rendered = interpolate(transition.from, transition.to, 1 - (1 - fraction) ** 2, stale, this.bufferMs);
      this.lastSample = nowMs;
      if (fraction === 1) { this.transition = null; this.cursor = latest.at; }
      return this.rendered;
    }
    const delta = this.lastSample == null ? 0 : Math.max(0, nowMs - this.lastSample);
    this.lastSample = nowMs;
    if (this.points.length < 2 || stale) {
      this.cursor = latest.at;
      this.rendered = this.frame(latest, stale); return this.rendered;
    }
    const offset = Math.min(...this.clockOffsets);
    const desired = Math.min(latest.at, nowMs - offset - this.buffer);
    const error = desired - (this.cursor + delta);
    const rate = clamp(1 + error / Math.max(1000, this.buffer), .5, 1.35);
    this.cursor = Math.min(latest.at, this.cursor + delta * rate);
    // All corners supported by received measurements are retained in order.
    while (this.points.length > 2 && this.points[1].at <= this.cursor) this.points.shift();
    const a = this.points[0], b = this.points[1];
    this.rendered = interpolate(this.frame(a, false), b, (this.cursor - a.at) / (b.at - a.at), stale, this.bufferMs);
    return this.rendered;
  }

  private get bufferMs() { return this.mode === 'local' ? 0 : this.buffer; }
  private localTarget(point: Fix, elapsed: number): Fix {
    const velocity = speed(point), precision = accuracy(point);
    if (velocity == null || velocity < 1.5 || velocity > 55 || precision == null || precision > 20
      || point.bearing == null || point.age > 1500
      || point.courseSource === null
      || point.courseAccuracyDeg != null && point.courseAccuracyDeg > 45) return point;
    // No indefinite extrapolation. On prolonged loss, ease back to the actual
    // last measurement so a stale marker never asserts a predicted position.
    const settle = 1 - clamp((point.age + elapsed - 15000) / 350, 0, 1);
    const distance = Math.min(15, velocity * Math.min(750, point.age + elapsed) / 1000) * settle;
    const radians = point.bearing * Math.PI / 180;
    return { ...point, latitude: clamp(point.latitude + Math.cos(radians) * distance / 111195, -90, 90),
      longitude: ((point.longitude + Math.sin(radians) * distance / (111195 * Math.max(.01, Math.cos(point.latitude * Math.PI / 180))) + 540) % 360) - 180 };
  }
  private frame(point: Fix, stale: boolean): PlaybackFrame {
    return { latitude: point.latitude, longitude: point.longitude, bearingDeg: point.bearing,
      measuredAtMs: point.at, stale, bufferMs: this.bufferMs };
  }
}
