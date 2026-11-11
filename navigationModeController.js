/**
 * Multi-Modal Navigation Fallback Controller
 *
 *  Mode A  GPS             - a GPS fix with accuracy < 15 m arrived recently.
 *  Mode B  DEAD_RECKONING  - GPS missing, stale or degraded (typical indoors); position advances
 *                            by counted steps x step length from the last anchor.
 *  Mode C  VISUAL_MATCH    - the camera matched an expected route landmark; the dead-reckoning
 *                            anchor is reset there (clearing accumulated drift) and this mode is
 *                            held briefly so the user gets confirmation.
 *
 * Pure logic: time is injected so it can be unit tested without a browser.
 */

export const NAV_MODES = {
  GPS: { key: 'GPS', badge: 'GPS ONLINE' },
  DEAD_RECKONING: { key: 'DEAD_RECKONING', badge: 'INDOOR DEAD RECKONING' },
  VISUAL_MATCH: { key: 'VISUAL_MATCH', badge: 'VISUAL MATCH CONFIRMED' }
};

export class NavigationModeController {
  constructor({
    gpsAccuracyThresholdM = 15,
    gpsStaleMs = 10000,
    visualHoldMs = 6000,
    stepLengthM = 0.7,
    now = () => Date.now()
  } = {}) {
    this.gpsAccuracyThresholdM = gpsAccuracyThresholdM;
    this.gpsStaleMs = gpsStaleMs;
    this.visualHoldMs = visualHoldMs;
    this.stepLengthM = stepLengthM;
    this.now = now;

    this.lastGoodFix = null;   // { lat, lon, accuracy, time }
    this.lastFixAccuracy = null;
    this.anchor = { type: 'none', name: null, time: now() };
    this.stepsSinceAnchor = 0;
    this.totalSteps = 0;
    this.visualUntil = 0;
    this.lastCorrection = null; // { landmark, driftMeters, time }
  }

  setStepLength(m) {
    if (m > 0) this.stepLengthM = m;
  }

  /** Feed a Geolocation reading. Only accurate fixes (< threshold) count as GPS ONLINE. */
  updateGps({ lat, lon, accuracy }) {
    this.lastFixAccuracy = accuracy;
    if (typeof accuracy === 'number' && accuracy < this.gpsAccuracyThresholdM) {
      this.lastGoodFix = { lat, lon, accuracy, time: this.now() };
      this.anchor = { type: 'gps', name: null, time: this.now(), lat, lon };
      this.stepsSinceAnchor = 0;
    }
  }

  addSteps(n = 1) {
    this.stepsSinceAnchor += n;
    this.totalSteps += n;
  }

  /** Mode C trigger: a camera frame matched an expected route landmark. Recalibrates. */
  confirmVisualMatch(landmarkName) {
    const driftMeters = Number((this.stepsSinceAnchor * this.stepLengthM).toFixed(1));
    this.lastCorrection = { landmark: landmarkName, driftMeters, time: this.now() };
    this.anchor = { type: 'landmark', name: landmarkName, time: this.now() };
    this.stepsSinceAnchor = 0;
    this.visualUntil = this.now() + this.visualHoldMs;
  }

  isGpsHealthy() {
    return Boolean(this.lastGoodFix) && this.now() - this.lastGoodFix.time <= this.gpsStaleMs;
  }

  getMode() {
    if (this.now() < this.visualUntil) return NAV_MODES.VISUAL_MATCH;
    if (this.isGpsHealthy()) return NAV_MODES.GPS;
    return NAV_MODES.DEAD_RECKONING;
  }

  getStatus() {
    const mode = this.getMode();
    const distanceSinceAnchorM = Number((this.stepsSinceAnchor * this.stepLengthM).toFixed(1));
    let detail;
    if (mode === NAV_MODES.GPS) {
      detail = `GPS accuracy ±${Math.round(this.lastGoodFix.accuracy)} m`;
    } else if (mode === NAV_MODES.VISUAL_MATCH) {
      detail = `Re-anchored at ${this.lastCorrection.landmark} (corrected ${this.lastCorrection.driftMeters} m drift)`;
    } else {
      const anchorText = this.anchor.type === 'landmark' ? `since ${this.anchor.name}`
        : this.anchor.type === 'gps' ? 'since last GPS fix' : 'since start';
      const gpsText = this.lastFixAccuracy == null ? 'no GPS signal'
        : `GPS degraded (±${Math.round(this.lastFixAccuracy)} m)`;
      detail = `${this.stepsSinceAnchor} steps / ${distanceSinceAnchorM} m ${anchorText} — ${gpsText}`;
    }
    return { mode: mode.key, badge: mode.badge, detail, stepsSinceAnchor: this.stepsSinceAnchor, distanceSinceAnchorM, totalSteps: this.totalSteps };
  }
}

/**
 * Accelerometer step detector (peak detection with hysteresis on |a|, gravity included).
 * Walking produces a ~1.1-1.3 g peak per step; minIntervalMs rejects double counts.
 */
export class StepDetector {
  constructor({ highThreshold = 11.2, lowThreshold = 10.2, minIntervalMs = 280 } = {}) {
    this.high = highThreshold;
    this.low = lowThreshold;
    this.minIntervalMs = minIntervalMs;
    this.armed = true;
    this.lastStepTime = -Infinity;
  }

  /** @returns {boolean} true when this sample completes a step */
  push(ax, ay, az, timeMs) {
    const mag = Math.sqrt(ax * ax + ay * ay + az * az);
    if (this.armed && mag > this.high && timeMs - this.lastStepTime >= this.minIntervalMs) {
      this.armed = false;
      this.lastStepTime = timeMs;
      return true;
    }
    if (!this.armed && mag < this.low) this.armed = true;
    return false;
  }
}
