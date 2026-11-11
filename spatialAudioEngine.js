/**
 * Real-Time Spatial Audio Synthesizer Engine for Assistive Navigation
 * Converts 3D spatial target locations into normalized sound parameter objects
 * for a binaural spatial audio engine.
 */

/**
 * Maps horizontal X-center coordinate (-1.0 to 1.0) to panning position (-1.0 to 1.0)
 * Rule 1:
 * - x_center < -0.25 -> Panned Left (-1.0 to -0.2)
 * - x_center between -0.25 and 0.25 -> Centered Ahead (0.0)
 * - x_center > 0.25 -> Panned Right (0.2 to 1.0)
 */
export function calculatePanningPosition(xCenter) {
  if (typeof xCenter !== 'number' || isNaN(xCenter)) return 0.0;

  const clampedX = Math.max(-1.0, Math.min(1.0, xCenter));

  if (clampedX < -0.25) {
    // Map [-1.0, -0.25] -> [-1.0, -0.2]
    const ratio = (clampedX - (-1.0)) / (-0.25 - (-1.0));
    return Number((-1.0 + ratio * 0.8).toFixed(2));
  } else if (clampedX > 0.25) {
    // Map [0.25, 1.0] -> [0.2, 1.0]
    const ratio = (clampedX - 0.25) / (1.0 - 0.25);
    return Number((0.2 + ratio * 0.8).toFixed(2));
  } else {
    return 0.0;
  }
}

/**
 * Maps distance to pitch frequency, gain, and pulse interval rate
 * Rule 2:
 * - Near (< 1.5m): High Pitch (880 Hz), High Gain (1.0), Fast Pulse Rate (100ms interval)
 * - Medium (1.5m - 4.0m): Mid Pitch (440 Hz), Mid Gain (0.7), Moderate Pulse Rate (300ms interval)
 * - Far (> 4.0m): Low Pitch (220 Hz), Low Gain (0.4), Slow Pulse Rate (600ms interval)
 */
export function calculateDistanceAudioParameters(distanceM) {
  const dist = typeof distanceM === 'number' && !isNaN(distanceM) ? distanceM : 2.5;

  if (dist < 1.5) {
    return {
      frequency_hz: 880,
      gain: 1.0,
      pulse_interval_ms: 100
    };
  } else if (dist <= 4.0) {
    return {
      frequency_hz: 440,
      gain: 0.7,
      pulse_interval_ms: 300
    };
  } else {
    return {
      frequency_hz: 220,
      gain: 0.4,
      pulse_interval_ms: 600
    };
  }
}

/**
 * Main Spatial Audio Synthesizer Engine
 * 
 * @param {number} x_center - Object Bounding Box Center X (normalized -1.0 to 1.0)
 * @param {number} distance_m - Distance to Object in meters
 * @param {boolean} is_critical_hazard - Hazard Flag
 * @param {number|string} frame_timestamp - Optional frame timestamp
 * @returns {object} JSON object containing audio_node_config
 */
export function synthesizeSpatialAudio(
  x_center = 0.0,
  distance_m = 2.5,
  is_critical_hazard = false,
  frame_timestamp = Date.now()
) {
  // Rule 1: Calculate panning
  const pan = calculatePanningPosition(x_center);

  // Rule 2: Calculate frequency, gain, and pulse interval
  const { frequency_hz, gain, pulse_interval_ms } = calculateDistanceAudioParameters(distance_m);

  // Rule 3: Override waveform from "sine" to "sawtooth" if critical hazard is true
  const waveform_type = is_critical_hazard ? "sawtooth" : "sine";

  return {
    audio_node_config: {
      pan: pan,
      frequency_hz: frequency_hz,
      gain: gain,
      pulse_interval_ms: pulse_interval_ms,
      waveform_type: waveform_type
    }
  };
}
