/**
 * Spatial Audio Synthesizer Service for Assistive Navigation
 * Translates relative headings and step distances into binaural spatial audio coordinates
 * for directional audio beacons and turn cues.
 */

export interface SpatialAudioParameters {
  panning: number;            // -1.0 (hard left) to 1.0 (hard right), 0.0 (center)
  frequency_hz: number;       // Higher pitch as user nears target/waypoint
  gain: number;               // 0.0 to 1.0 volume intensity
  pulse_interval_ms: number;  // Pulse rate (ms between audio bursts)
}

export class SpatialAudioSynthesizer {
  /**
   * Maps relative heading degree to normalized stereo panning position
   * 0° -> 0.0 (Ahead)
   * 90° -> 0.85 (Right branch)
   * 180° -> -1.0 (U-turn / Behind)
   * 270° -> -0.85 (Left branch)
   */
  public calculatePanning(headingRelativeDeg: number): number {
    const deg = ((headingRelativeDeg % 360) + 360) % 360;

    if (deg >= 345 || deg <= 15) {
      return 0.0; // Dead ahead
    } else if (deg > 15 && deg < 180) {
      // Map (15, 180] -> [0.2, 1.0]
      const ratio = (deg - 15) / (180 - 15);
      return Number((0.2 + ratio * 0.8).toFixed(2));
    } else {
      // Map (180, 345) -> [-1.0, -0.2]
      const ratio = (deg - 180) / (345 - 180);
      return Number((-1.0 + ratio * 0.8).toFixed(2));
    }
  }

  /**
   * Distance-to-sound parameters mapping:
   * - Near (< 1.5m / ~2 steps): High pitch (880 Hz), max gain (1.0), rapid pulse (100ms)
   * - Mid (1.5m - 4.0m / 3-6 steps): Mid pitch (440 Hz), medium gain (0.7), 300ms pulse
   * - Far (> 4.0m / > 6 steps): Low pitch (220 Hz), subtle gain (0.4), 600ms pulse
   */
  public calculateDistanceParameters(distanceMeters: number): {
    frequency_hz: number;
    gain: number;
    pulse_interval_ms: number;
  } {
    if (distanceMeters < 1.5) {
      return { frequency_hz: 880, gain: 1.0, pulse_interval_ms: 100 };
    } else if (distanceMeters <= 4.0) {
      return { frequency_hz: 440, gain: 0.7, pulse_interval_ms: 300 };
    } else {
      return { frequency_hz: 220, gain: 0.4, pulse_interval_ms: 600 };
    }
  }

  /**
   * Synthesizes full 3D audio beacon state for an active navigation segment
   */
  public generateBeaconParameters(
    headingRelativeDeg: number,
    remainingSteps: number,
    stepLengthMeters: number = 0.70
  ): SpatialAudioParameters {
    const distanceMeters = Math.max(0.5, remainingSteps * stepLengthMeters);
    const panning = this.calculatePanning(headingRelativeDeg);
    const distanceParams = this.calculateDistanceParameters(distanceMeters);

    return {
      panning,
      frequency_hz: distanceParams.frequency_hz,
      gain: distanceParams.gain,
      pulse_interval_ms: distanceParams.pulse_interval_ms
    };
  }
}

