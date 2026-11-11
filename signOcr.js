// Sign text reading on top of the PaddleOCR engine (ocrEngine.js).
//
//  - readSignText(source, box): read the text inside one YOLO sign box (cropped, never full frame)
//  - findTextSigns(source): locate and read text lines anywhere in the frame. Used because the
//    YOLO models rarely box real-world signs; the text detector is the sign localizer.

import { readText, loadOcrEngine } from './ocrEngine.js';

const CROP_PADDING = 0.08;   // grow the box a little so edge characters aren't clipped
const CACHE_TTL_MS = 4000;   // re-use text for the same sign region across consecutive frames

const recentReads = []; // { label, cx, cy, text, time }

function cachedRead(box, now) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const tol = Math.max(box.w, box.h) * 0.25;
  for (let i = recentReads.length - 1; i >= 0; i--) {
    const r = recentReads[i];
    if (now - r.time > CACHE_TTL_MS) { recentReads.splice(i, 1); continue; }
    if (r.label === box.label && Math.abs(r.cx - cx) < tol && Math.abs(r.cy - cy) < tol) return r.text;
  }
  return null;
}

/** OCR a single detected sign box. Returns the text read ('' if nothing / OCR unavailable). */
export async function readSignText(source, box) {
  const now = Date.now();
  const cached = cachedRead(box, now);
  if (cached !== null) return cached;
  const padX = box.w * CROP_PADDING, padY = box.h * CROP_PADDING;
  const lines = await readText(source, { x: box.x - padX, y: box.y - padY, w: box.w + 2 * padX, h: box.h + 2 * padY });
  const text = lines.map(l => l.text).join(' ').trim();
  recentReads.push({ label: box.label, cx: box.x + box.w / 2, cy: box.y + box.h / 2, text, time: now });
  if (recentReads.length > 20) recentReads.shift();
  return text;
}

/** Find text lines anywhere in the frame: [{ x, y, w, h, text, score }] in source pixels. */
export function findTextSigns(source, { minScore = 0.75 } = {}) {
  return readText(source, null, { minScore });
}

export function preloadOcr() {
  return loadOcrEngine();
}
