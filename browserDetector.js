// Real in-browser YOLOv8 inference for the camera viewfinder.
// Runs every available ONNX model (onnxruntime-web, global `ort` from CDN in index.html) on the
// same letterboxed frame and merges their detections in SOURCE-image pixel coordinates.
//
//  - indoor  : the custom fine-tuned model (scripts/export_windows.py) — signs, hazards, amenities
//  - general : stock YOLOv8n (COCO, 80 classes) — people, chairs, suitcases, benches... Needed
//              because the indoor model has very little real-scene training data.

const MODELS = [
  { id: 'indoor', url: './src/assets/models/indoor_yolov8n.onnx', labels: './src/assets/models/indoor_yolov8n.labels.json' },
  { id: 'general', url: './src/assets/models/coco_yolov8n.onnx', labels: './src/assets/models/coco_yolov8n.labels.json' }
];
const INPUT_SIZE = 640;
const SCORE_THRESHOLD = 0.35;
const IOU_THRESHOLD = 0.45;
const MAX_DETECTIONS = 30;

let loadPromise = null; // resolves to [{ id, session, labels }]

async function loadModel(spec) {
  try {
    const [labelsRes, modelRes] = await Promise.all([fetch(spec.labels), fetch(spec.url)]);
    if (!labelsRes.ok || !modelRes.ok) return null; // not exported yet
    const labels = await labelsRes.json();
    const session = await ort.InferenceSession.create(await modelRes.arrayBuffer(), { executionProviders: ['wasm'] });
    return { id: spec.id, session, labels };
  } catch (err) {
    console.warn(`Detector "${spec.id}" unavailable:`, err);
    return null;
  }
}

/** Lazily create all ONNX sessions. Resolves to the list of loaded models (possibly empty). */
export function loadDetector() {
  if (!loadPromise) {
    loadPromise = (async () => {
      if (typeof ort === 'undefined') throw new Error('onnxruntime-web failed to load');
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/';
      const models = (await Promise.all(MODELS.map(loadModel))).filter(Boolean);
      if (models.length === 0) throw new Error('no detection models found');
      return models;
    })().catch((err) => {
      console.warn('Detector unavailable:', err);
      loadPromise = null; // allow retry later
      return [];
    });
  }
  return loadPromise;
}

/** Names of the models currently loaded (for the UI). */
export async function loadedModelIds() {
  return (await loadDetector()).map(m => m.id);
}

/**
 * Run detection on a <video> or <img> element.
 * @returns {Promise<{available: boolean, detections: Array<{label, score, x, y, w, h, model}>, srcWidth, srcHeight}>}
 *          x/y/w/h are in source pixels (videoWidth/naturalWidth space).
 */
export async function detectObjects(source) {
  const models = await loadDetector();
  const srcWidth = source.videoWidth || source.naturalWidth;
  const srcHeight = source.videoHeight || source.naturalHeight;
  if (!models.length || !srcWidth || !srcHeight) {
    return { available: models.length > 0, detections: [], srcWidth, srcHeight };
  }

  // Letterbox into 640x640 (preserve aspect, pad with gray 114 like Ultralytics)
  const scale = Math.min(INPUT_SIZE / srcWidth, INPUT_SIZE / srcHeight);
  const dw = Math.round(srcWidth * scale);
  const dh = Math.round(srcHeight * scale);
  const padX = Math.floor((INPUT_SIZE - dw) / 2);
  const padY = Math.floor((INPUT_SIZE - dh) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(source, padX, padY, dw, dh);
  const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);

  // HWC RGBA uint8 -> CHW RGB float32 [0,1]  (shared by all models)
  const area = INPUT_SIZE * INPUT_SIZE;
  const chw = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    chw[i] = data[i * 4] / 255;
    chw[i + area] = data[i * 4 + 1] / 255;
    chw[i + 2 * area] = data[i * 4 + 2] / 255;
  }
  const input = new ort.Tensor('float32', chw, [1, 3, INPUT_SIZE, INPUT_SIZE]);

  const all = [];
  for (const model of models) { // sequential: the wasm backend runs one session at a time anyway
    const results = await model.session.run({ [model.session.inputNames[0]]: input });
    const out = results[model.session.outputNames[0]];
    all.push(...decode(out, model, { scale, padX, padY, srcWidth, srcHeight }));
  }

  return { available: true, detections: nonMaxSuppression(all), srcWidth, srcHeight };
}

// [1, 4 + numClasses, numAnchors] -> candidate boxes in source pixels
function decode(out, model, { scale, padX, padY, srcWidth, srcHeight }) {
  const [, channels, numAnchors] = out.dims;
  const numClasses = channels - 4;
  const o = out.data;
  const boxes = [];
  for (let a = 0; a < numAnchors; a++) {
    let best = 0, bestCls = -1;
    for (let c = 0; c < numClasses; c++) {
      const s = o[(4 + c) * numAnchors + a];
      if (s > best) { best = s; bestCls = c; }
    }
    if (best < SCORE_THRESHOLD) continue;
    const cx = o[a], cy = o[numAnchors + a], w = o[2 * numAnchors + a], h = o[3 * numAnchors + a];
    const x = (cx - w / 2 - padX) / scale;
    const y = (cy - h / 2 - padY) / scale;
    boxes.push({
      cls: `${model.id}:${bestCls}`,
      label: model.labels[bestCls] || `class_${bestCls}`,
      model: model.id,
      score: best,
      x: Math.max(0, x),
      y: Math.max(0, y),
      w: Math.min(srcWidth - Math.max(0, x), w / scale),
      h: Math.min(srcHeight - Math.max(0, y), h / scale)
    });
  }
  return boxes;
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}

// Class-aware NMS (classes are namespaced per model, so models never suppress each other
// except for the same label name, e.g. both models' "person")
function nonMaxSuppression(boxes) {
  boxes.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const box of boxes) {
    if (kept.every(k => (k.cls !== box.cls && k.label !== box.label) || iou(k, box) < IOU_THRESHOLD)) kept.push(box);
    if (kept.length >= MAX_DETECTIONS) break;
  }
  return kept;
}
