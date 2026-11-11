/**
 * Spatial Hazard & Safety Engine for Assistive Navigation
 * Processes live depth maps and object bounding boxes to prioritize immediate safety warnings
 * over navigation instructions for blind and low-vision users.
 */

/**
 * Main Spatial Hazard & Safety Engine processing function
 * 
 * @param {Array} object_detections - Array of objects: [{ label: string, x_center: float (-1.0 to 1.0), depth_m: float }]
 * @param {object} depth_map_hazards - { pothole_detected: bool, curb_drop: bool, hazard_angle: float (-1.0 to 1.0), hazard_distance_m: float }
 * @param {object} user_movement_state - { walking_speed_m_s: float, heading: number }
 * @returns {object} JSON response matching requested schema
 */
export function processSpatialHazards(
  object_detections = [],
  depth_map_hazards = {},
  user_movement_state = { walking_speed_m_s: 1.2, heading: 0 }
) {
  let primaryHazardType = null;
  let minDistanceM = 999.0;
  let hazardXCenter = 0.0;
  let isDepthMapHazard = false;

  // 1. Evaluate monocular depth map hazards
  if (depth_map_hazards && (depth_map_hazards.pothole_detected || depth_map_hazards.curb_drop)) {
    const dist = typeof depth_map_hazards.hazard_distance_m === 'number'
      ? depth_map_hazards.hazard_distance_m
      : 1.5;

    if (dist <= 2.0) {
      minDistanceM = dist;
      isDepthMapHazard = true;
      hazardXCenter = typeof depth_map_hazards.hazard_angle === 'number'
        ? Math.max(-1.0, Math.min(1.0, depth_map_hazards.hazard_angle))
        : 0.0;

      primaryHazardType = depth_map_hazards.pothole_detected ? 'pothole' : 'curb_drop';
    }
  }

  // 2. Evaluate YOLO object detections (low-hanging branches, obstacles, stairs, vehicles)
  if (Array.isArray(object_detections)) {
    object_detections.forEach(obj => {
      const depth = typeof obj.depth_m === 'number' ? obj.depth_m : 999.0;
      if (depth <= 2.0 && depth < minDistanceM) {
        minDistanceM = depth;
        isDepthMapHazard = false;
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

  // RULE 1: If no hazards within 2 meters, return safe status
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

  // Determine Severity based on distance (<1.2m = CRITICAL, 1.2m - 2.0m = WARNING)
  const severity = minDistanceM < 1.2 ? "CRITICAL" : "WARNING";

  // RULE 2: Map X-center (-1.0 to +1.0) and distance to spatial audio parameters
  const pan = Number(hazardXCenter.toFixed(2));

  // Closer distance = higher pitch frequency (440 Hz to 880 Hz)
  const pitch_hz = Math.round(880 - (minDistanceM / 2.0) * 440);

  // Closer distance = faster pulse rate (100ms for 0.5m, up to 400ms for 2.0m)
  const pulse_rate_ms = Math.max(100, Math.round(minDistanceM * 200));

  // RULE 3: Formulate concise spoken alert strictly UNDER 5 WORDS
  let spoken_alert = "";
  const directionText = pan < -0.2 ? "step right" : (pan > 0.2 ? "step left" : "stop");

  switch (primaryHazardType) {
    case 'pothole':
      spoken_alert = `Pothole ahead, ${directionText}.`; // 3-4 words
      break;
    case 'curb_drop':
      spoken_alert = severity === "CRITICAL" ? "Drop-off ahead, stop now." : "Curb drop ahead, caution."; // 4 words
      break;
    case 'branch':
      spoken_alert = "Low branch overhead, duck."; // 4 words
      break;
    case 'obstacle':
    default:
      spoken_alert = `Obstacle ahead, ${directionText}.`; // 3-4 words
      break;
  }

  // Enforce word count limit (< 5 words)
  const wordCount = spoken_alert.trim().split(/\s+/).length;
  if (wordCount > 5) {
    spoken_alert = "Hazard ahead, stop now."; // Fallback 4 words
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
