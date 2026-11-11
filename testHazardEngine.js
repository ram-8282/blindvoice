import { processSpatialHazards } from './hazardEngine.js';

console.log("=================================================");
console.log("SPATIAL HAZARD & SAFETY ENGINE - AUTOMATED TEST SUITE");
console.log("=================================================\n");

let passedCount = 0;
let totalCount = 0;

function assert(condition, message) {
  totalCount++;
  if (condition) {
    console.log(`[PASS] ${message}`);
    passedCount++;
  } else {
    console.error(`[FAIL] ${message}`);
  }
}

// Test 1: Critical Pothole hazard within 1.0m (left side x_center = -0.5)
const res1 = processSpatialHazards([], {
  pothole_detected: true,
  curb_drop: false,
  hazard_angle: -0.5,
  hazard_distance_m: 1.0
});

assert(res1.hazard_present === true, "Hazard present is true for 1.0m pothole");
assert(res1.severity === "CRITICAL", `Severity is CRITICAL for distance < 1.2m (got: ${res1.severity})`);
assert(res1.spatial_audio.pan === -0.5, `Spatial audio pan is -0.5 (got: ${res1.spatial_audio.pan})`);
assert(res1.spatial_audio.pitch_hz > 600, "Spatial audio pitch is high for close hazard");
assert(res1.spoken_alert !== null, "Spoken alert is generated");

// Word count check (< 5 words rule)
const words1 = res1.spoken_alert.trim().split(/\s+/).length;
assert(words1 <= 5, `Spoken alert is under 5 words (got ${words1} words: "${res1.spoken_alert}")`);

// Test 2: Low branch overhead via YOLO detection (0.8m depth)
const res2 = processSpatialHazards([
  { label: "low_hanging_branch", x_center: 0.1, depth_m: 0.8 }
], {});

assert(res2.hazard_present === true, "Hazard present is true for low branch");
assert(res2.severity === "CRITICAL", "Severity is CRITICAL for 0.8m depth");
assert(res2.spoken_alert.includes("branch") || res2.spoken_alert.includes("duck"), "Alert instructs user about branch/ducking");
const words2 = res2.spoken_alert.trim().split(/\s+/).length;
assert(words2 <= 5, `Spoken alert is under 5 words (got ${words2} words: "${res2.spoken_alert}")`);

// Test 3: Safe scenario (> 2.0m distance)
const res3 = processSpatialHazards([], {
  pothole_detected: true,
  curb_drop: false,
  hazard_angle: 0.0,
  hazard_distance_m: 3.5
});

assert(res3.hazard_present === false, "Hazard present is false for distance > 2.0m");
assert(res3.severity === "NONE", "Severity is NONE when > 2.0m");
assert(res3.spoken_alert === null, "Spoken alert is null for safe distance");

console.log("\n=================================================");
console.log(`TEST SUMMARY: ${passedCount}/${totalCount} tests passed.`);
console.log("=================================================");

if (passedCount !== totalCount) {
  process.exit(1);
}
