/**
 * Backend Spatial Hazard & Safety Engine for Assistive Navigation
 */

export function processSpatialHazards(
  object_detections = [],
  depth_map_hazards = {},
  user_movement_state = { walking_speed_m_s: 1.2, heading: 0 }
) {
  let primaryHazardType = null;
  let minDistanceM = 999.0;
  let hazardXCenter = 0.0;

  if (depth_map_hazards && (depth_map_hazards.pothole_detected || depth_map_hazards.curb_drop)) {
    const dist = typeof depth_map_hazards.hazard_distance_m === 'number'
      ? depth_map_hazards.hazard_distance_m
      : 1.5;

    if (dist <= 2.0) {
      minDistanceM = dist;
      hazardXCenter = typeof depth_map_hazards.hazard_angle === 'number'
        ? Math.max(-1.0, Math.min(1.0, depth_map_hazards.hazard_angle))
        : 0.0;

      primaryHazardType = depth_map_hazards.pothole_detected ? 'pothole' : 'curb_drop';
    }
  }

  if (Array.isArray(object_detections)) {
    object_detections.forEach(obj => {
      const depth = typeof obj.depth_m === 'number' ? obj.depth_m : 999.0;
      if (depth <= 2.0 && depth < minDistanceM) {
        minDistanceM = depth;
        hazardXCenter = typeof obj.x_center === 'number'
          ? Math.max(-1.0, Math.min(1.0, obj.x_center))
          : 0.0;

        const labelLower = (obj.label || '').toLowerCase();
        if (labelLower.includes('branch') || labelLower.includes('tree')) {
          primaryHazardType = 'branch';
        } else if (labelLower.includes('drop') || labelLower.includes('curb') || labelLower.includes('step')) {
          primaryHazardType = 'curb_drop';
        } else if (labelLower.includes('hole') || labelLower.includes('pothole')) {
          primaryHazardType = 'pothole';
        } else {
          primaryHazardType = 'obstacle';
        }
      }
    });
  }

  if (!primaryHazardType || minDistanceM > 2.0) {
    return {
      hazard_present: false,
      severity: "NONE",
      spatial_audio: {
        pan: 0.0,
        pitch_hz: 440,
        pulse_rate_ms: 1000
      },
      spoken_alert: null
    };
  }

  const severity = minDistanceM < 1.2 ? "CRITICAL" : "WARNING";
  const pan = Number(hazardXCenter.toFixed(2));
  const pitch_hz = Math.round(880 - (minDistanceM / 2.0) * 440);
  const pulse_rate_ms = Math.max(100, Math.round(minDistanceM * 200));

  let spoken_alert = "";
  const directionText = pan < -0.2 ? "step right" : (pan > 0.2 ? "step left" : "stop");

  switch (primaryHazardType) {
    case 'pothole':
      spoken_alert = `Pothole ahead, ${directionText}.`;
      break;
    case 'curb_drop':
      spoken_alert = severity === "CRITICAL" ? "Drop-off ahead, stop now." : "Curb drop ahead, caution.";
      break;
    case 'branch':
      spoken_alert = "Low branch overhead, duck.";
      break;
    case 'obstacle':
    default:
      spoken_alert = `Obstacle ahead, ${directionText}.`;
      break;
  }

  const wordCount = spoken_alert.trim().split(/\s+/).length;
  if (wordCount > 5) {
    spoken_alert = "Hazard ahead, stop now.";
  }

  return {
    hazard_present: true,
    severity: severity,
    spatial_audio: {
      pan: pan,
      pitch_hz: pitch_hz,
      pulse_rate_ms: pulse_rate_ms
    },
    spoken_alert: spoken_alert
  };
}
