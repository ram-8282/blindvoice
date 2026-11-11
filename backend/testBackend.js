import { processVoiceInput } from './voiceEngine.js';
import { processDirectionsRoute } from './routeEngine.js';
import { verifyVisualLandmark } from './landmarkEngine.js';
import { processSpatialHazards } from './hazardEngine.js';
import { synthesizeSpatialAudio } from './spatialAudioEngine.js';
import { DEFAULT_USER_LOCATION, SAMPLE_PLACES, SAMPLE_DIRECTIONS_PAYLOAD } from './testCases.js';

console.log("=================================================");
console.log("BACKEND MODULE AUTOMATED TEST SUITE");
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

// Test 1: Voice Engine
const voiceResult = processVoiceInput("Take me to Starbucks", DEFAULT_USER_LOCATION, SAMPLE_PLACES);
assert(voiceResult.intent === "CLARIFY", "Voice engine returns CLARIFY for ambiguous Starbucks");

// Test 2: Route Processing Engine
const routeResult = processDirectionsRoute(SAMPLE_DIRECTIONS_PAYLOAD, 0.70, SAMPLE_PLACES);
assert(routeResult.total_steps === 286, `Route total_steps equals 286`);

// Test 3: Visual Landmark Verification Engine
const landmarkResult = verifyVisualLandmark(["Starbks Coffee 555"], [], "Starbucks Coffee", []);
assert(landmarkResult.matched === true, "Landmark verification matched");

// Test 4: Spatial Hazard Engine
const hazardResult = processSpatialHazards([], { pothole_detected: true, hazard_angle: -0.5, hazard_distance_m: 1.0 });
assert(hazardResult.hazard_present === true, "Hazard present is true for 1.0m pothole");

// Test 5: Spatial Audio Synthesizer Engine
const audioResult = synthesizeSpatialAudio(-0.5, 1.2, true);
assert(audioResult.audio_node_config.waveform_type === "sawtooth", "Audio synthesizer outputs 'sawtooth' for critical hazard");
assert(audioResult.audio_node_config.frequency_hz === 880, "Audio synthesizer outputs 880 Hz for near distance (<1.5m)");
assert(audioResult.audio_node_config.pan < -0.2, "Audio synthesizer outputs panned left position");

console.log("\n=================================================");
console.log(`BACKEND TEST SUMMARY: ${passedCount}/${totalCount} tests passed.`);
console.log("=================================================");

if (passedCount !== totalCount) {
  process.exit(1);
}
