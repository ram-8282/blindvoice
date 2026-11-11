/**
 * Vision Analysis Engine for Assistive Navigation
 * Pure functions (no DOM) that turn raw YOLO detections into spatially-aware, speakable facts:
 *  - horizontal zone (LEFT / CENTER / RIGHT) from the box center
 *  - proximity category from the box's share of the frame area
 *  - hazard classification + the central focal zone check for priority alerts
 *  - signage detection and parsing of OCR text read from a cropped sign box
 *
 * Detections use source-pixel coordinates: { label, score, x, y, w, h }.
 */

// ---------------------------------------------------------------------------------------------
// Spatial grid
// ---------------------------------------------------------------------------------------------

export const HORIZONTAL_ZONES = [
  { key: 'LEFT', max: 1 / 3, phrase: 'ahead on your left' },
  { key: 'CENTER', max: 2 / 3, phrase: 'ahead' },
  { key: 'RIGHT', max: Infinity, phrase: 'ahead on your right' }
];

/** Map a normalized x center (0 = left edge, 1 = right edge) to LEFT / CENTER / RIGHT. */
export function getHorizontalZone(xCenterNorm) {
  const x = Math.min(1, Math.max(0, Number(xCenterNorm) || 0));
  return HORIZONTAL_ZONES.find(z => x < z.max) || HORIZONTAL_ZONES[2];
}

// Central focal zone: the middle 60% of the viewfinder on both axes (20% margin on each side).
export const FOCAL_ZONE = { xMin: 0.2, xMax: 0.8, yMin: 0.2, yMax: 0.8 };

export function isInFocalZone(xCenterNorm, yCenterNorm, zone = FOCAL_ZONE) {
  return xCenterNorm >= zone.xMin && xCenterNorm <= zone.xMax &&
         yCenterNorm >= zone.yMin && yCenterNorm <= zone.yMax;
}

// ---------------------------------------------------------------------------------------------
// Proximity from bounding-box area ratio
// ---------------------------------------------------------------------------------------------

// A box filling >= 20% of the frame is roughly within arm's reach for typical indoor objects;
// 4-20% is a few steps away; anything smaller is far. Monocular estimate, not a depth sensor.
export const PROXIMITY_LEVELS = [
  { key: 'IMMEDIATE', minAreaRatio: 0.20, label: 'Immediate / < 1m', spoken: 'less than 1 meter', approxMeters: 0.8 },
  { key: 'CLOSE', minAreaRatio: 0.04, label: 'Close / 2-3m', spoken: '2 meters', approxMeters: 2.5 },
  { key: 'FAR', minAreaRatio: 0, label: 'Far / > 5m', spoken: 'more than 5 meters', approxMeters: 6 }
];

export function estimateProximity(boxW, boxH, frameW, frameH) {
  const frameArea = frameW * frameH;
  const areaRatio = frameArea > 0 ? Math.max(0, boxW * boxH) / frameArea : 0;
  const level = PROXIMITY_LEVELS.find(p => areaRatio >= p.minAreaRatio) || PROXIMITY_LEVELS[2];
  return { ...level, areaRatio: Number(areaRatio.toFixed(4)) };
}

// ---------------------------------------------------------------------------------------------
// Hazard classes
// ---------------------------------------------------------------------------------------------

// Canonical hazard classes. `aliases` includes labels from the current indoor model so
// existing detections map onto them; a retrained model emitting the canonical names works as-is.
export const HAZARD_CLASSES = {
  staircase: { level: 'HIGH', name: 'Staircase', aliases: ['staircase', 'stairs', 'stairway', 'stairs_sign', 'steps'] },
  pothole: { level: 'HIGH', name: 'Pothole', aliases: ['pothole', 'hole'] },
  low_hanging_obstacle: { level: 'HIGH', name: 'Low hanging obstacle', aliases: ['low_hanging_obstacle', 'low_branch', 'branch', 'overhang'] },
  wet_floor_sign: { level: 'LOW', name: 'Wet floor sign', aliases: ['wet_floor_sign', 'wet_floor'] },
  construction_barrier: { level: 'LOW', name: 'Construction barrier', aliases: ['construction_barrier', 'barrier', 'road_cone', 'traffic_cone', 'isolation_pile', 'stopper'] },
  // Everyday obstacles from the general (COCO) model. Only an alert when within arm's reach,
  // otherwise every person across a concourse would trigger one. Spoken with its own name.
  obstacle: {
    level: 'LOW', name: 'Obstacle', useLabelName: true, minProximity: 'IMMEDIATE',
    aliases: ['obstacle', 'person', 'chair', 'bench', 'suitcase', 'potted_plant', 'dining_table', 'couch', 'bicycle', 'motorcycle', 'fire_hydrant', 'dog']
  }
};

const normalizeLabel = (label) => String(label || '').toLowerCase().trim().replace(/[\s-]+/g, '_');

const HAZARD_ALIAS_INDEX = new Map(
  Object.entries(HAZARD_CLASSES).flatMap(([cls, def]) => def.aliases.map(a => [a, cls]))
);

/** Returns { hazardClass, level, name } for a hazard label, or null. */
export function classifyHazard(label) {
  const cls = HAZARD_ALIAS_INDEX.get(normalizeLabel(label));
  if (!cls) return null;
  const def = HAZARD_CLASSES[cls];
  return { hazardClass: cls, level: def.level, name: def.name, useLabelName: Boolean(def.useLabelName), minProximity: def.minProximity || 'FAR' };
}

export const HAZARD_CONFIDENCE_THRESHOLD = 0.70;

// ---------------------------------------------------------------------------------------------
// Signage
// ---------------------------------------------------------------------------------------------

const SIGNAGE_PATTERN = /(_sign$|^sign$|_plate$|^exit_sign$|signage)/;

/** True for detections that carry readable text (and aren't hazards). */
export function isSignageLabel(label) {
  const n = normalizeLabel(label);
  return SIGNAGE_PATTERN.test(n) && !HAZARD_ALIAS_INDEX.has(n);
}

const DISPLAY_NAME_OVERRIDES = {
  bathroom_sign: 'Restroom sign',
  men_bathroom_sign: "Men's restroom sign",
  women_bathroom_sign: "Women's restroom sign",
  tv_monitor: 'TV monitor'
};

export function humanizeLabel(label) {
  const n = normalizeLabel(label);
  if (DISPLAY_NAME_OVERRIDES[n]) return DISPLAY_NAME_OVERRIDES[n];
  const hazard = classifyHazard(n);
  if (hazard && !hazard.useLabelName) return hazard.name;
  const words = n.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Pull a meaningful string out of raw OCR text read from a cropped sign.
 * Falls back to text encoded in the class label (e.g. "room_122b_sign" -> "Room 122B").
 * @returns {{ text: string, source: 'ocr' | 'label' } | null}
 */
export function extractSignText(rawOcrText, label = '') {
  const raw = String(rawOcrText || '').replace(/[|_~`'"]/g, ' ').replace(/\s+/g, ' ').trim();
  const n = normalizeLabel(label);

  const gate = raw.match(/\bGATE\s*[:#-]?\s*([A-Z]?\s?\d{1,3}[A-Z]?)\b/i);
  if (gate) return { text: `Gate ${gate[1].replace(/\s+/g, '').toUpperCase()}`, source: 'ocr' };

  const room = raw.match(/\b(?:ROOM|RM\.?)\s*[:#-]?\s*(\d{1,4}[A-Z]?)\b/i);
  if (room) return { text: `Room ${room[1].toUpperCase()}`, source: 'ocr' };

  const isRoomSign = n === 'room_number_plate' || /^room_\w+_sign$/.test(n);
  if (isRoomSign) {
    const num = raw.match(/\b(\d{2,4}[A-Z]?)\b/i);
    if (num) return { text: `Room ${num[1].toUpperCase()}`, source: 'ocr' };
  }
  if (n === 'boarding_gate_sign') {
    const code = raw.match(/\b([A-Z]\s?\d{1,3})\b/i);
    if (code) return { text: `Gate ${code[1].replace(/\s+/g, '').toUpperCase()}`, source: 'ocr' };
  }

  // Generic readable text: keep short strings that are mostly letters/digits
  const cleaned = raw.replace(/[^A-Za-z0-9 &'-]/g, '').trim();
  const alnum = cleaned.replace(/[^A-Za-z0-9]/g, '').length;
  if (cleaned.length >= 3 && cleaned.length <= 40 && alnum / cleaned.length > 0.7 && /[A-Za-z]{2,}/.test(cleaned)) {
    return { text: cleaned.replace(/\b([a-z])([a-z]*)/gi, (_, a, b) => a.toUpperCase() + b.toLowerCase()), source: 'ocr' };
  }

  const fromLabel = n.match(/^room_(\w+)_sign$/);
  if (fromLabel) return { text: `Room ${fromLabel[1].toUpperCase()}`, source: 'label' };
  return null;
}

/**
 * Strict parser for OCR of a whole overhead-sign band (no YOLO box). Scene OCR is noisy, so only
 * well-known airport sign phrases are accepted.
 * @returns {string[]} e.g. ["Gates B1-B14", "Restrooms"]
 */
export function extractSceneSignTexts(rawOcrText) {
  const raw = String(rawOcrText || '').replace(/[|_~`]/g, ' ').replace(/\s+/g, ' ');
  const found = [];
  const gateRe = /\bGATES?\s*([A-Z])\s?(\d{1,3})(?:\s*(?:-|–|to)\s*([A-Z])\s?(\d{1,3}))?\b/gi;
  let m;
  while ((m = gateRe.exec(raw))) {
    found.push(m[3] ? `Gates ${m[1].toUpperCase()}${m[2]}-${m[3].toUpperCase()}${m[4]}` : `Gate ${m[1].toUpperCase()}${m[2]}`);
  }
  // Letter-only gate lists: "Gates A B C D E F" / OCR-merged "GatesABDE" -> "Gate A", "Gate B", ...
  // ("Gates" in any case; the gate letters themselves must be capitals so "Gates are" isn't read as gates)
  const letterRe = /\b[Gg][Aa][Tt][Ee][Ss]?\s*((?:[A-Z]\s?){1,10})(?![A-Za-z0-9])/g;
  while ((m = letterRe.exec(raw.replace(/[^A-Za-z0-9 -]/g, ' ')))) {
    const letters = [...new Set(m[1].replace(/\s/g, '').toUpperCase().split(''))];
    if (letters.length >= 1 && letters.length <= 10) letters.forEach(l => found.push(`Gate ${l}`));
  }
  const phrases = [
    [/\b(RESTROOMS?|TOILETS?|WASHROOMS?)\b/i, 'Restrooms'],
    [/\bBAGGAGE\s+CLAIM\b/i, 'Baggage Claim'],
    [/\bSECURITY\b/i, 'Security'],
    [/\bINFORMATION\b/i, 'Information'],
    [/\bEXIT\b/i, 'Exit'],
    [/\bELEVATORS?\b/i, 'Elevator'],
    [/\bESCALATORS?\b/i, 'Escalator']
  ];
  for (const [re, text] of phrases) if (re.test(raw)) found.push(text);
  return [...new Set(found)];
}

// ---------------------------------------------------------------------------------------------
// Frame analysis
// ---------------------------------------------------------------------------------------------

/** "Restroom sign 2 meters ahead on your left" */
export function describeSpatially(name, proximity, zone) {
  return `${name} ${proximity.spoken} ${zone.phrase}`;
}

/**
 * Enrich raw detections with zone, proximity, focal-zone and hazard/signage info.
 * @returns {Array} detections with { xCenterNorm, yCenterNorm, zone, proximity, inFocalZone, hazard, isSignage, displayName, spatialDescription }
 */
export function analyzeDetections(detections = [], frameW, frameH) {
  if (!frameW || !frameH) return [];
  return detections.map(d => {
    const xCenterNorm = (d.x + d.w / 2) / frameW;
    const yCenterNorm = (d.y + d.h / 2) / frameH;
    const zone = getHorizontalZone(xCenterNorm);
    const proximity = estimateProximity(d.w, d.h, frameW, frameH);
    const hazard = classifyHazard(d.label);
    const displayName = humanizeLabel(d.label);
    return {
      ...d,
      xCenterNorm: Number(xCenterNorm.toFixed(3)),
      yCenterNorm: Number(yCenterNorm.toFixed(3)),
      zone: zone.key,
      zonePhrase: zone.phrase,
      proximity,
      inFocalZone: isInFocalZone(xCenterNorm, yCenterNorm),
      hazard,
      isSignage: !hazard && isSignageLabel(d.label),
      displayName,
      spatialDescription: describeSpatially(displayName, proximity, zone)
    };
  });
}

const LEVEL_RANK = { HIGH: 2, LOW: 1 };
const PROXIMITY_RANK = { IMMEDIATE: 3, CLOSE: 2, FAR: 1 };

/**
 * Pick the hazard that must interrupt everything: inside the focal zone and above the confidence
 * threshold. Ranked by hazard level, then proximity, then confidence.
 * @returns {{ detection, alert: string } | null}
 */
export function findPriorityHazard(analyzed = [], minConfidence = HAZARD_CONFIDENCE_THRESHOLD) {
  const candidates = analyzed.filter(d => d.hazard && d.inFocalZone && d.score > minConfidence &&
    PROXIMITY_RANK[d.proximity.key] >= PROXIMITY_RANK[d.hazard.minProximity || 'FAR']);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) =>
    (LEVEL_RANK[b.hazard.level] - LEVEL_RANK[a.hazard.level]) ||
    (PROXIMITY_RANK[b.proximity.key] - PROXIMITY_RANK[a.proximity.key]) ||
    (b.score - a.score));
  const top = candidates[0];
  const prefix = top.hazard.level === 'HIGH' ? 'Warning' : 'Caution';
  const name = top.hazard.useLabelName ? top.displayName : top.hazard.name;
  return { detection: top, alert: `${prefix}: ${name} detected directly ahead.` };
}

/** True when a detection is a hazard *right now* (e.g. a person only counts when within reach). */
export function isActiveHazard(d) {
  return Boolean(d && d.hazard && d.proximity &&
    PROXIMITY_RANK[d.proximity.key] >= PROXIMITY_RANK[d.hazard.minProximity || 'FAR']);
}

/** "Approaching Gate B12, 2 meters ahead on your left." */
export function formatSignAnnouncement(signText, analyzedDetection) {
  if (!signText) return null;
  const where = analyzedDetection ? `, ${analyzedDetection.proximity.spoken} ${analyzedDetection.zonePhrase}` : '';
  return `Approaching ${signText}${where}.`;
}
