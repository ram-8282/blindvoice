/**
 * Visual Landmark Verification Service for Non-GPS Assistive Navigation
 * Evaluates mobile camera frame OCR text and YOLO ISO 7001 detections
 * to correct accumulated dead-reckoning pedometer drift.
 */

export interface YoloDetection {
  class_name: string;
  confidence: number;
  bbox?: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
}

export interface LandmarkVerificationResult {
  verified: boolean;
  matchType: 'OCR_EXACT' | 'OCR_FUZZY' | 'YOLO_PICTOGRAM' | 'NONE';
  matchedLandmark: string | null;
  confidence: number;
  driftResetRecommended: boolean;
}

export class VisualLandmarkService {
  private readonly similarityThreshold: number = 0.75;
  private readonly yoloConfidenceThreshold: number = 0.80;

  /**
   * Calculates Levenshtein edit distance between two strings
   */
  public levenshteinDistance(a: string, b: string): number {
    if (!a || !b) return (a || b || '').length;
    const s1 = a.toLowerCase().trim();
    const s2 = b.toLowerCase().trim();

    const matrix: number[][] = [];
    for (let i = 0; i <= s1.length; i++) matrix[i] = [i];
    for (let j = 0; j <= s2.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= s1.length; i++) {
      for (let j = 1; j <= s2.length; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j] + 1,     // deletion
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j - 1] + 1  // substitution
          );
        }
      }
    }
    return matrix[s1.length][s2.length];
  }

  /**
   * Normalized string similarity ratio (0.0 to 1.0)
   */
  public calculateStringSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    if (s1 === s2) return 1.0;
    if (s1.includes(s2) || s2.includes(s1)) {
      const minLen = Math.min(s1.length, s2.length);
      const maxLen = Math.max(s1.length, s2.length);
      return Math.min(0.96, 0.75 + (minLen / maxLen) * 0.25);
    }

    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1.0;
    const dist = this.levenshteinDistance(s1, s2);
    return Math.max(0, 1 - dist / maxLen);
  }

  /**
   * Verifies camera OCR strings and YOLO detections against expected landmark targets
   */
  public verify(
    expectedLandmarks: string[],
    detectedOcrStrings: string[],
    yoloDetections: YoloDetection[] = []
  ): LandmarkVerificationResult {
    if (!expectedLandmarks || expectedLandmarks.length === 0) {
      return {
        verified: false,
        matchType: 'NONE',
        matchedLandmark: null,
        confidence: 0,
        driftResetRecommended: false
      };
    }

    // 1. Direct and Fuzzy OCR Match check
    for (const expected of expectedLandmarks) {
      for (const detected of detectedOcrStrings) {
        const score = this.calculateStringSimilarity(expected, detected);
        if (score >= 0.95) {
          return {
            verified: true,
            matchType: 'OCR_EXACT',
            matchedLandmark: expected,
            confidence: Number(score.toFixed(2)),
            driftResetRecommended: true
          };
        } else if (score >= this.similarityThreshold) {
          return {
            verified: true,
            matchType: 'OCR_FUZZY',
            matchedLandmark: expected,
            confidence: Number(score.toFixed(2)),
            driftResetRecommended: true
          };
        }
      }
    }

    // 2. YOLO ISO Pictogram Classification check
    for (const expected of expectedLandmarks) {
      const normalizedExpected = expected.toLowerCase();
      for (const yolo of yoloDetections) {
        if (yolo.confidence >= this.yoloConfidenceThreshold) {
          const detectedClass = yolo.class_name.toLowerCase();
          if (
            normalizedExpected.includes(detectedClass) ||
            detectedClass.includes(normalizedExpected) ||
            (normalizedExpected.includes('restroom') && detectedClass.includes('toilet')) ||
            (normalizedExpected.includes('escalator') && detectedClass.includes('escalator')) ||
            (normalizedExpected.includes('elevator') && detectedClass.includes('elevator'))
          ) {
            return {
              verified: true,
              matchType: 'YOLO_PICTOGRAM',
              matchedLandmark: expected,
              confidence: Number(yolo.confidence.toFixed(2)),
              driftResetRecommended: true
            };
          }
        }
      }
    }

    return {
      verified: false,
      matchType: 'NONE',
      matchedLandmark: null,
      confidence: 0,
      driftResetRecommended: false
    };
  }
}

