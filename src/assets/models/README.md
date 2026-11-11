# Mobile Neural Model Assets Directory

On-device detection model used by `VisionAudioLoop.tsx` (React Native) and by the browser
viewfinder in the Landmark tab (`browserDetector.js`).

## Files (generated — do not edit by hand)

| File | Used by |
|---|---|
| `indoor_yolov8n.tflite` | React Native (`react-native-fast-tflite`) |
| `indoor_yolov8n.onnx` | Browser viewfinder (`onnxruntime-web`) |
| `indoor_yolov8n.labels.ts` | React Native class names + `NUM_CLASSES` |
| `indoor_yolov8n.labels.json` | Browser class names |

## Model Specifications
- **Architecture**: Ultralytics YOLOv8-Nano, fine-tuned on `dataset_merged` (see `indoor_amenities.yaml`)
- **Classes**: **103** (names in `indoor_yolov8n.labels.ts`, in class-id order)
- **TFLite input**: `[1, 640, 640, 3]` NHWC, RGB, float32 in `[0, 1]`
- **ONNX input**: `[1, 3, 640, 640]` NCHW, RGB, float32 in `[0, 1]`
- **Output**: `[1, 107, 8400]` = 4 box values (`cx, cy, w, h`) + 103 class scores, for 8400 anchors.
  Boxes are in 640-px input space for both files (divide by 640 to normalize). No NMS is baked in.
- **Precision**: float32 (no INT8 quantization yet). TFLite and ONNX outputs agree to within 0.01.
- **Accuracy** (train-9, final epoch on 121 val images): precision 0.77, recall 0.50, mAP50 0.51, mAP50-95 0.44.
- **Windows note**: Ultralytics ≥8.4.83 refuses `format='tflite'` on Windows, so the export script
  converts the ONNX with `onnx2tf` directly.

## Generating Weights
Train (fine-tunes from the best previous run automatically):
```bash
.venv\Scripts\python.exe scripts\merge_and_train.py
```
Export the best run and install it here (picks the run with the highest final mAP50-95):
```bash
.venv\Scripts\python.exe scripts\export_windows.py
```
To export a specific run instead: `scripts\export_windows.py C:\Users\kandi\runs\detect\train-9\weights\best.pt`.

If you retrain with a different class list, re-run the export — the labels files and
`NUM_CLASSES` are regenerated, and both decoders read the class count from the output tensor.

## General-purpose model (`coco_yolov8n.onnx`)
Stock Ultralytics YOLOv8n (COCO, 80 classes: person, chair, bench, suitcase, ...), exported from
`yolov8n.pt` at 640 px, opset 12. `browserDetector.js` runs it alongside the indoor model on the
same frame and merges the results (each detection carries `model: 'indoor' | 'general'`).

Why: the indoor model's training set is dominated by hazmat placards and `isolation-pile`
(1,359 instances) with very few real-scene examples (sign 33, person 9, bathroom_sign 8,
wet_floor_sign 6, stairs_sign 2). On real concourse photos it scores < 0.1 for everything, so on
its own the viewfinder shows 0 boxes. Retraining with airport/indoor scene data is the real fix.

## Sign text reader (`ocr_det.onnx`, `ocr_rec.onnx`, `ocr_keys.json`)
PaddleOCR PP-OCRv4 detection + recognition, copied from the `rapidocr_onnxruntime` pip package
(`ch_PP-OCRv4_det_infer.onnx`, `ch_PP-OCRv4_rec_infer.onnx`; the recognizer's character list is
read from its ONNX metadata into `ocr_keys.json`). Used by `ocrEngine.js`:
the detector finds text lines anywhere in the frame (this is what locates real signs - the YOLO
models rarely box them), then only those cropped, straightened lines are recognized.
Pre/post-processing follows RapidOCR's `config.yaml` (BGR, normalize to [-1, 1], det thresh 0.3,
box thresh 0.5, unclip 1.6, rec height 48). ~0.6-3 s per full frame in the browser (wasm, CPU), so
live video re-reads text every 3 s.
