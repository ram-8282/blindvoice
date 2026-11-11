/**
 * Visual Landmark Verification Engine for Assistive Navigation
 * Analyzes live mobile camera frame OCR text and YOLO object detections
 * to verify if the visually impaired user is following their planned route.
 */

/**
 * Calculates Levenshtein Distance between two strings
 */
export function levenshteinDistance(a, b) {
  if (!a || !b) return (a || b || '').length;
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();

  const matrix = [];
  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // deletion
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j - 1] + 1  // substitution
        );
      }
    }
  }

  return matrix[s1.length][s2.length];
}

/**
 * Single word string similarity (0.0 to 1.0)
 */
function wordSimilarity(w1, w2) {
  if (!w1 || !w2) return 0;
  if (w1 === w2) return 1.0;
  if (w1.includes(w2) || w2.includes(w1)) return 0.90;
  const dist = levenshteinDistance(w1, w2);
  const maxLen = Math.max(w1.length, w2.length);
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Calculates normalized string similarity ratio between 0.0 and 1.0 with token-based fuzzy matching
 */
export function calculateStringSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1.0;

  // Direct substring match
  if (s1.includes(s2) || s2.includes(s1)) {
    const minLen = Math.min(s1.length, s2.length);
    const maxLen = Math.max(s1.length, s2.length);
    return Math.min(0.96, 0.75 + (minLen / maxLen) * 0.25);
  }

  // Token-based matching for OCR string fragments
  const tokens1 = s1.split(/\s+/).filter(t => t.length > 2);
  const tokens2 = s2.split(/\s+/).filter(t => t.length > 2);

  if (tokens1.length > 0 && tokens2.length > 0) {
    let matchScores = [];
    tokens2.forEach(t2 => {
      let maxWordScore = 0;
      tokens1.forEach(t1 => {
        const score = wordSimilarity(t1, t2);
        if (score > maxWordScore) maxWordScore = score;
      });
      matchScores.push(maxWordScore);
    });

    const avgScore = matchScores.reduce((acc, v) => acc + v, 0) / matchScores.length;
    if (avgScore > 0.7) {
      return Math.min(0.98, Number(avgScore.toFixed(2)));
    }
  }

  const dist = levenshteinDistance(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;

  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Main Visual Landmark Verification Engine
 */
export function verifyVisualLandmark(
  array_of_detected_strings = [],
  array_of_yolo_detections = [],
  expected_landmark_name = '',
  list_of_nearby_place_names = []
) {
  const allDetections = [
    ...(array_of_detected_strings || []),
    ...(array_of_yolo_detections || [])
  ].filter(Boolean);

  if (allDetections.length === 0 || (!expected_landmark_name && list_of_nearby_place_names.length === 0)) {
    return {
      matched: false,
      matched_landmark: null,
      confidence: 0.0,
      location_correction_needed: false,
      spoken_system_update: null
    };
  }

  let bestMatchName = null;
  let highestConfidence = 0.0;
  let isPrimaryTargetMatch = false;

  // 1. Compare detected items against primary expected landmark
  if (expected_landmark_name) {
    for (const detection of allDetections) {
      const similarity = calculateStringSimilarity(detection, expected_landmark_name);
      if (similarity > highestConfidence) {
        highestConfidence = similarity;
        bestMatchName = expected_landmark_name;
        isPrimaryTargetMatch = true;
      }
    }
  }

  // 2. Compare detected items against expected nearby places
  for (const nearbyPlace of (list_of_nearby_place_names || [])) {
    for (const detection of allDetections) {
      const similarity = calculateStringSimilarity(detection, nearbyPlace);
      if (similarity > highestConfidence) {
        highestConfidence = similarity;
        bestMatchName = nearbyPlace;
        isPrimaryTargetMatch = false;
      }
    }
  }

  highestConfidence = Number(highestConfidence.toFixed(2));

  // RULE #2: If match found with confidence > 0.8, re-anchor user position
  if (highestConfidence > 0.80) {
    const isCorrectionNeeded = !isPrimaryTargetMatch;
    const updateText = isPrimaryTargetMatch
      ? `Passing ${bestMatchName} on your right.`
      : `Confirmed nearby landmark: ${bestMatchName}. Re-anchoring route position.`;

    return {
      matched: true,
      matched_landmark: bestMatchName,
      confidence: highestConfidence,
      location_correction_needed: isCorrectionNeeded,
      spoken_system_update: updateText
    };
  }

  return {
    matched: false,
    matched_landmark: null,
    confidence: highestConfidence,
    location_correction_needed: false,
    spoken_system_update: null
  };
}
