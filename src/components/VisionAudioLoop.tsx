import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, useCameraDevice, useFrameProcessor, runAtTargetFps } from 'react-native-vision-camera';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { Worklets } from 'react-native-worklets-core';
import Sound from 'react-native-sound';
import { MODEL_LABELS, NUM_CLASSES } from '../assets/models/indoor_yolov8n.labels';

// Model I/O (see src/assets/models/README.md):
//   input  [1, 640, 640, 3] float32 RGB in [0,1]
//   output [1, 4 + NUM_CLASSES, 8400]  rows 0-3 = cx, cy, w, h (in 640-px input space), rows 4.. = class scores
const INPUT_SIZE = 640;
const NUM_ANCHORS = 8400;
const CONFIDENCE_THRESHOLD = 0.5;

interface VisionAudioLoopProps {
  targetLandmark: string;
  onLandmarkVerified: (confidence: number) => void;
}

/** Class ids whose label matches the target landmark (case-insensitive, either contains the other). */
function targetClassIds(target: string): number[] {
  const t = target.trim().toLowerCase();
  if (!t) return [];
  return MODEL_LABELS.reduce<number[]>((ids, label, i) => {
    const l = label.toLowerCase().replace(/_/g, ' ');
    if (l.includes(t) || t.includes(l)) ids.push(i);
    return ids;
  }, []);
}

export const VisionAudioLoop: React.FC<VisionAudioLoopProps> = ({ targetLandmark, onLandmarkVerified }) => {
  const device = useCameraDevice('back');
  const tfliteModel = useTensorflowModel(require('../assets/models/indoor_yolov8n.tflite'));
  const model = tfliteModel.state === 'loaded' ? tfliteModel.model : undefined;
  const { resize } = useResizePlugin();
  const pannerSound = useRef<Sound | null>(null);
  const targetIds = useMemo(() => targetClassIds(targetLandmark), [targetLandmark]);

  useEffect(() => {
    pannerSound.current = new Sound('ping.wav', Sound.MAIN_BUNDLE, (error) => {
      if (error) console.log('Audio loading failed:', error);
    });
    return () => pannerSound.current?.release();
  }, []);

  // Sound + callbacks live on the JS thread; the frame processor runs on a worklet thread.
  const onDetectionJS = useMemo(
    () =>
      Worklets.createRunOnJS((confidence: number, pan: number) => {
        onLandmarkVerified(confidence);
        if (pannerSound.current) {
          pannerSound.current.setPan(pan);
          pannerSound.current.play();
        }
      }),
    [onLandmarkVerified]
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      if (model == null || targetIds.length === 0) return;

      runAtTargetFps(10, () => {
        'worklet';
        const input = resize(frame, {
          scale: { width: INPUT_SIZE, height: INPUT_SIZE },
          pixelFormat: 'rgb',
          dataType: 'float32',
        });
        const output = model.runSync([input])[0] as Float32Array;

        // Best-scoring anchor among the target landmark's classes
        let bestScore = 0;
        let bestAnchor = -1;
        for (let a = 0; a < NUM_ANCHORS; a++) {
          for (let k = 0; k < targetIds.length; k++) {
            const score = output[(4 + targetIds[k]) * NUM_ANCHORS + a];
            if (score > bestScore) {
              bestScore = score;
              bestAnchor = a;
            }
          }
        }

        if (bestAnchor >= 0 && bestScore >= CONFIDENCE_THRESHOLD) {
          const cx = output[bestAnchor] / INPUT_SIZE; // pixels -> 0..1
          const pan = Math.max(-1, Math.min(1, cx * 2 - 1)); // -1 left .. +1 right
          onDetectionJS(bestScore, pan);
        }
      });
    },
    [model, targetIds, resize, onDetectionJS]
  );

  if (!device) return <View style={styles.container} />;

  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={true}
      frameProcessor={frameProcessor}
      pixelFormat="yuv"
    />
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' }
});

// Compile-time guard: labels file must match the model's class count
if (MODEL_LABELS.length !== NUM_CLASSES) {
  console.warn(`indoor_yolov8n.labels: expected ${NUM_CLASSES} labels, got ${MODEL_LABELS.length}`);
}
