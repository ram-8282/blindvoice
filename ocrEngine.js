// In-browser scene-text reader: PaddleOCR PP-OCRv4 (via RapidOCR's ONNX exports) on onnxruntime-web.
//
//   1. Text DETECTION (DB) finds where text is in the frame -> one box per text line
//   2. Text RECOGNITION (CRNN + CTC) reads only those cropped boxes
//
// Much better than Tesseract on real signage (light-on-dark, angled, cluttered scenes), and it
// doubles as the sign localizer, since none of the YOLO models reliably box real airport signs.
// Pre/post-processing mirrors RapidOCR's defaults (config.yaml) so results match the Python tool.

const DET_URL = './src/assets/models/ocr_det.onnx';
const REC_URL = './src/assets/models/ocr_rec.onnx';
const KEYS_URL = './src/assets/models/ocr_keys.json';

const DET_MIN_SIDE = 736;      // RapidOCR limit_type "min": small text needs the frame upsized
const DET_MAX_SIDE = 1600;     // speed ceiling for the browser
const DET_THRESH = 0.3;        // pixel probability -> text
const BOX_THRESH = 0.5;        // mean probability inside a box to keep it
const UNCLIP_RATIO = 1.6;      // grow the shrunk DB kernel back to the full text line
const MIN_BOX_SIDE = 3;
const REC_HEIGHT = 48;
const REC_MIN_WIDTH = 320;
const REC_MAX_WIDTH = 1280;
const MAX_LINES = 16;          // recognize at most this many text lines per call

let enginePromise = null;

export function loadOcrEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      if (typeof ort === 'undefined') throw new Error('onnxruntime-web failed to load');
      const [detBuf, recBuf, keys] = await Promise.all([
        fetch(DET_URL).then(r => { if (!r.ok) throw new Error('ocr_det.onnx missing'); return r.arrayBuffer(); }),
        fetch(REC_URL).then(r => { if (!r.ok) throw new Error('ocr_rec.onnx missing'); return r.arrayBuffer(); }),
        fetch(KEYS_URL).then(r => { if (!r.ok) throw new Error('ocr_keys.json missing'); return r.json(); })
      ]);
      const opts = { executionProviders: ['wasm'] };
      const [det, rec] = await Promise.all([ort.InferenceSession.create(detBuf, opts), ort.InferenceSession.create(recBuf, opts)]);
      // CTC alphabet: index 0 = blank, then the dictionary, then space (use_space_char)
      return { det, rec, alphabet: ['', ...keys, ' '] };
    })().catch(err => {
      console.warn('OCR engine unavailable:', err);
      enginePromise = null;
      return null;
    });
  }
  return enginePromise;
}

// Draw a source-pixel region into a canvas of the given size and return BGR CHW float32,
// normalized (x/255 - 0.5) / 0.5, matching RapidOCR (OpenCV images are BGR).
function toTensorData(source, sx, sy, sw, sh, tw, th, padToWidth = tw) {
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, tw, th);
  const { data } = ctx.getImageData(0, 0, tw, th);
  const plane = padToWidth * th;
  const out = new Float32Array(3 * plane); // zero padding == mid-gray after normalization
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const p = (y * tw + x) * 4;
      const o = y * padToWidth + x;
      out[o] = data[p + 2] / 127.5 - 1;             // B
      out[o + plane] = data[p + 1] / 127.5 - 1;     // G
      out[o + 2 * plane] = data[p] / 127.5 - 1;     // R
    }
  }
  return out;
}

// ---- detection --------------------------------------------------------------------------------

async function detectLines(engine, source, region) {
  const { x: rx, y: ry, w: rw, h: rh } = region;
  let scale = Math.max(1, DET_MIN_SIDE / Math.min(rw, rh));
  scale = Math.min(scale, DET_MAX_SIDE / Math.max(rw, rh));
  const W = Math.max(32, Math.round((rw * scale) / 32) * 32);
  const H = Math.max(32, Math.round((rh * scale) / 32) * 32);

  const input = new ort.Tensor('float32', toTensorData(source, rx, ry, rw, rh, W, H), [1, 3, H, W]);
  const out = (await engine.det.run({ [engine.det.inputNames[0]]: input }))[engine.det.outputNames[0]];
  const prob = out.data; // [1, 1, H, W]

  // Binarize + 2x2 dilation (use_dilation: true)
  const bin = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      bin[i] = prob[i] > DET_THRESH ||
        (x > 0 && prob[i - 1] > DET_THRESH) ||
        (y > 0 && prob[i - W] > DET_THRESH) ||
        (x > 0 && y > 0 && prob[i - W - 1] > DET_THRESH) ? 1 : 0;
    }
  }

  // Connected components (8-neighbour) -> rotated rectangles (text on signs is often tilted)
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const members = new Int32Array(W * H);
  const sx = rw / W, sy = rh / H; // det space -> source pixels
  const boxes = [];
  for (let start = 0; start < W * H; start++) {
    if (!bin[start] || seen[start]) continue;
    let top = 0, count = 0, sumX = 0, sumY = 0, sumP = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const i = stack[--top];
      members[count++] = i;
      const x = i % W, y = (i / W) | 0;
      sumX += x; sumY += y; sumP += prob[i];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (bin[j] && !seen[j]) { seen[j] = 1; stack[top++] = j; }
        }
      }
    }
    if (count < MIN_BOX_SIDE * MIN_BOX_SIDE) continue;
    if (sumP / count < BOX_THRESH) continue; // mean text probability of the region

    // Orientation from second moments (PCA), then extents along / across that axis
    const mx = sumX / count, my = sumY / count;
    let cxx = 0, cyy = 0, cxy = 0;
    for (let k = 0; k < count; k++) {
      const i = members[k], dx = (i % W) - mx, dy = ((i / W) | 0) - my;
      cxx += dx * dx; cyy += dy * dy; cxy += dx * dy;
    }
    const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const ux = Math.cos(angle), uy = Math.sin(angle);
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (let k = 0; k < count; k++) {
      const i = members[k], dx = (i % W) - mx, dy = ((i / W) | 0) - my;
      const u = dx * ux + dy * uy, v = -dx * uy + dy * ux;
      if (u < uMin) uMin = u; if (u > uMax) uMax = u;
      if (v < vMin) vMin = v; if (v > vMax) vMax = v;
    }
    let len = uMax - uMin + 1, thick = vMax - vMin + 1;
    if (Math.min(len, thick) < MIN_BOX_SIDE) continue;

    // Unclip: grow by area * ratio / perimeter on every side
    const d = (len * thick * UNCLIP_RATIO) / (2 * (len + thick));
    len += 2 * d; thick += 2 * d;
    const cu = (uMin + uMax) / 2, cv = (vMin + vMax) / 2;
    const ccx = mx + cu * ux - cv * uy, ccy = my + cu * uy + cv * ux;

    // Corners in det space -> source pixels
    const hl = len / 2, ht = thick / 2;
    const corners = [[-hl, -ht], [hl, -ht], [hl, ht], [-hl, ht]].map(([a, b]) => [
      rx + (ccx + a * ux - b * uy) * sx,
      ry + (ccy + a * uy + b * ux) * sy
    ]);
    const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const x = Math.max(0, Math.min(...xs)), y = Math.max(0, Math.min(...ys));
    boxes.push({
      x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, // axis-aligned bounds (for drawing)
      cx: (xs[0] + xs[2]) / 2, cy: (ys[0] + ys[2]) / 2,      // rotated rect (for reading)
      len: dist(corners[0], corners[1]), thick: dist(corners[1], corners[2]),
      angle: Math.atan2(corners[1][1] - corners[0][1], corners[1][0] - corners[0][0]),
      detScore: sumP / count
    });
  }
  return boxes;
}

// Straighten a rotated text line into a tw x th canvas
function rotatedCrop(source, box, tw, th) {
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.translate(tw / 2, th / 2);
  ctx.scale(tw / box.len, th / box.thick);
  ctx.rotate(-box.angle);
  ctx.translate(-box.cx, -box.cy);
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, tw, th).data;
}

// ---- recognition ------------------------------------------------------------------------------

async function recognize(engine, source, box) {
  const ratio = box.len / box.thick;
  const tw = Math.max(8, Math.min(REC_MAX_WIDTH, Math.ceil(REC_HEIGHT * ratio)));
  const padW = Math.max(REC_MIN_WIDTH, tw);
  const px = rotatedCrop(source, box, tw, REC_HEIGHT);
  const plane = padW * REC_HEIGHT;
  const data = new Float32Array(3 * plane); // zero padding == mid-gray after normalization
  for (let y = 0; y < REC_HEIGHT; y++) {
    for (let x = 0; x < tw; x++) {
      const p = (y * tw + x) * 4, o = y * padW + x;
      data[o] = px[p + 2] / 127.5 - 1;           // B
      data[o + plane] = px[p + 1] / 127.5 - 1;   // G
      data[o + 2 * plane] = px[p] / 127.5 - 1;   // R
    }
  }
  const input = new ort.Tensor('float32', data, [1, 3, REC_HEIGHT, padW]);
  const out = (await engine.rec.run({ [engine.rec.inputNames[0]]: input }))[engine.rec.outputNames[0]];
  const [, T, C] = out.dims;
  const p = out.data;

  // Greedy CTC: argmax per step, drop blanks and repeats
  let text = '', confSum = 0, n = 0, prev = -1;
  for (let t = 0; t < T; t++) {
    let best = 0, bestIdx = 0;
    const base = t * C;
    for (let c = 0; c < C; c++) if (p[base + c] > best) { best = p[base + c]; bestIdx = c; }
    if (bestIdx !== 0 && bestIdx !== prev) {
      text += engine.alphabet[bestIdx] || '';
      confSum += best;
      n++;
    }
    prev = bestIdx;
  }
  return { text: text.trim(), score: n ? confSum / n : 0 };
}

// ---- public API -------------------------------------------------------------------------------

/**
 * Find and read text lines in a region of a <video>/<img>.
 * @param {HTMLVideoElement|HTMLImageElement} source
 * @param {{x,y,w,h}} [region] source pixels; default = whole frame
 * @param {{minScore?: number}} [opts]
 * @returns {Promise<Array<{x,y,w,h,text,score}>>} boxes in source pixels, reading order
 */
export async function readText(source, region = null, { minScore = 0.6 } = {}) {
  const engine = await loadOcrEngine();
  const srcW = source.videoWidth || source.naturalWidth;
  const srcH = source.videoHeight || source.naturalHeight;
  if (!engine || !srcW || !srcH) return [];
  const r = region
    ? { x: Math.max(0, region.x), y: Math.max(0, region.y), w: Math.min(srcW - Math.max(0, region.x), region.w), h: Math.min(srcH - Math.max(0, region.y), region.h) }
    : { x: 0, y: 0, w: srcW, h: srcH };
  if (r.w < 8 || r.h < 8) return [];

  const lines = (await detectLines(engine, source, r))
    .filter(b => Math.abs(b.angle) < Math.PI / 4 && b.len / b.thick < 40) // roughly horizontal lines (signs)
    .sort((a, b) => b.len * b.thick - a.len * a.thick)
    .slice(0, MAX_LINES);

  const results = [];
  for (const box of lines) {
    const { text, score } = await recognize(engine, source, box);
    if (text.length >= 2 && score >= minScore) results.push({ ...box, text, score });
  }
  // Reading order: top-to-bottom, then left-to-right
  return results.sort((a, b) => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) / 2 ? a.x - b.x : a.y - b.y));
}
