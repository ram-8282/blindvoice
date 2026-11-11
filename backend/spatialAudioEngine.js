/**
 * Backend Real-Time Spatial Audio Synthesizer Engine for Assistive Navigation
 */

export function calculatePanningPosition(xCenter) {
  if (typeof xCenter !== 'number' || isNaN(xCenter)) return 0.0;
  const clampedX = Math.max(-1.0, Math.min(1.0, xCenter));

  if (clampedX < -0.25) {
    const ratio = (clampedX - (-1.0)) / (-0.25 - (-1.0));
    return Number((-1.0 + ratio * 0.8).toFixed(2));
  } else if (clampedX > 0.25) {
    const ratio = (clampedX - 0.25) / (1.0 - 0.25);
    return Number((0.2 + ratio * 0.8).toFixed(2));
  } else {
    return 0.0;
  }
}

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

export function synthesizeSpatialAudio(
  x_center = 0.0,
  distance_m = 2.5,
  is_critical_hazard = false,
  frame_timestamp = Date.now()
) {
  const pan = calculatePanningPosition(x_center);
  const { frequency_hz, gain, pulse_interval_ms } = calculateDistanceAudioParameters(distance_m);
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
