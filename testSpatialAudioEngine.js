import { synthesizeSpatialAudio, calculatePanningPosition, calculateDistanceAudioParameters } from './spatialAudioEngine.js';

console.log("=================================================");
console.log("SPATIAL AUDIO SYNTHESIZER - AUTOMATED TEST SUITE");
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

// Test 1: Panning mapping rules (x_center < -0.25, -0.25 to 0.25, > 0.25)
assert(calculatePanningPosition(-0.6) < -0.2, "x_center = -0.6 maps to Panned Left (< -0.2)");
assert(calculatePanningPosition(0.0) === 0.0, "x_center = 0.0 maps to Centered Ahead (0.0)");
assert(calculatePanningPosition(0.6) > 0.2, "x_center = 0.6 maps to Panned Right (> 0.2)");

// Test 2: Distance mapping thresholds (<1.5m, 1.5m-4.0m, >4.0m)
const nearParams = calculateDistanceAudioParameters(1.0);
assert(nearParams.frequency_hz === 880, "Near (<1.5m) maps to 880 Hz pitch");
assert(nearParams.gain === 1.0, "Near (<1.5m) maps to 1.0 gain");
assert(nearParams.pulse_interval_ms === 100, "Near (<1.5m) maps to 100ms fast pulse rate");

const midParams = calculateDistanceAudioParameters(2.5);
assert(midParams.frequency_hz === 440, "Mid (1.5-4.0m) maps to 440 Hz pitch");
assert(midParams.gain === 0.7, "Mid (1.5-4.0m) maps to 0.7 gain");
assert(midParams.pulse_interval_ms === 300, "Mid (1.5-4.0m) maps to 300ms pulse rate");

const farParams = calculateDistanceAudioParameters(5.0);
assert(farParams.frequency_hz === 220, "Far (>4.0m) maps to 220 Hz pitch");
assert(farParams.gain === 0.4, "Far (>4.0m) maps to 0.4 gain");
assert(farParams.pulse_interval_ms === 600, "Far (>4.0m) maps to 600ms slow pulse rate");

// Test 3: Waveform type & critical hazard override
const normalRes = synthesizeSpatialAudio(0.5, 1.0, false);
assert(normalRes.audio_node_config.waveform_type === "sine", "Normal target synthesizes 'sine' waveform");
assert(normalRes.audio_node_config.pan > 0.2, "Panned right for x_center = 0.5");

const hazardRes = synthesizeSpatialAudio(-0.5, 1.0, true);
assert(hazardRes.audio_node_config.waveform_type === "sawtooth", "Critical hazard overrides waveform to 'sawtooth'");
assert(hazardRes.audio_node_config.pan < -0.2, "Panned left for x_center = -0.5");

console.log("\n=================================================");
console.log(`TEST SUMMARY: ${passedCount}/${totalCount} tests passed.`);
console.log("=================================================");

if (passedCount !== totalCount) {
  process.exit(1);
}
