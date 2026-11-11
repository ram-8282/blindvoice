import { IndoorNavigationEngine, VenueGraph, StepProcessResult } from './IndoorNavigationEngine';
import { BarometerSensor } from './BarometerSensor';
import { VisualLandmarkService, YoloDetection, LandmarkVerificationResult } from './VisualLandmarkService';
import { SpatialAudioSynthesizer, SpatialAudioParameters } from './SpatialAudioSynthesizer';

export interface NavigationStateSnapshot {
  venueId: string | null;
  floorLevel: string | null;
  currentSegmentIndex: number;
  totalSegments: number;
  remainingStepsOnSegment: number;
  remainingDistanceMeters: number;
  relativeHeadingDeg: number;
  isWaitingForElevation: boolean;
  isComplete: boolean;
  spatialAudio: SpatialAudioParameters;
  lastVoiceInstruction: string;
}

export class AssistiveNavigationManager {
  private navEngine: IndoorNavigationEngine;
  private barometer: BarometerSensor;
  private visualLandmarkService: VisualLandmarkService;
  private spatialAudioSynth: SpatialAudioSynthesizer;

  private lastVoiceInstruction: string = "";

  constructor(strideMeters: number = 0.70) {
    this.navEngine = new IndoorNavigationEngine(strideMeters);
    this.barometer = new BarometerSensor();
    this.visualLandmarkService = new VisualLandmarkService();
    this.spatialAudioSynth = new SpatialAudioSynthesizer();
  }

  /**
   * Initializes route with a loaded venue graph and baseline atmospheric pressure
   */
  public startNavigation(graph: VenueGraph, initialPressureHPa?: number): NavigationStateSnapshot {
    this.navEngine.loadGraph(graph);
    if (typeof initialPressureHPa === 'number') {
      this.barometer.setBaselinePressure(initialPressureHPa);
    }

    const currentSegment = this.navEngine.getCurrentSegment();
    this.lastVoiceInstruction = currentSegment 
      ? `Starting route. Walk straight toward ${currentSegment.expected_verification_landmarks[0] || 'the first waypoint'} for ${currentSegment.distance_steps} steps.`
      : "Route loaded.";

    return this.getSnapshot();
  }

  /**
   * Pedometer step event processor
   */
  public handleStepEvent(deltaSteps: number = 1): {
    result: StepProcessResult;
    snapshot: NavigationStateSnapshot;
  } {
    const result = this.navEngine.processStep(deltaSteps);
    if (result.voiceInstruction) {
      this.lastVoiceInstruction = result.voiceInstruction;
    }

    return {
      result,
      snapshot: this.getSnapshot()
    };
  }

  /**
   * Barometer sensor update handler (invoked during escalator/stairs/elevator transitions)
   */
  public handlePressureReading(currentPressureHPa: number): {
    levelChangeConfirmed: boolean;
    snapshot: NavigationStateSnapshot;
  } {
    const reading = this.barometer.processPressureReading(currentPressureHPa);
    let levelChangeConfirmed = false;

    if (this.navEngine.isWaitingForElevation() && reading.levelChangeDetected) {
      levelChangeConfirmed = this.navEngine.verifyElevationChange(reading.deltaH);
      if (levelChangeConfirmed) {
        this.barometer.setBaselinePressure(currentPressureHPa); // Re-zero baseline for new floor
        const nextSegment = this.navEngine.getCurrentSegment();
        if (nextSegment) {
          this.lastVoiceInstruction = `Floor transition confirmed. Now turn ${nextSegment.heading_relative_deg === 90 ? 'right' : nextSegment.heading_relative_deg === 270 ? 'left' : 'straight'} for ${nextSegment.distance_steps} steps.`;
        }
      }
    }

    return {
      levelChangeConfirmed,
      snapshot: this.getSnapshot()
    };
  }

  /**
   * Visual verification check from mobile camera OCR and YOLO frames
   */
  public handleCameraVerification(
    detectedOcrStrings: string[],
    yoloDetections: YoloDetection[] = []
  ): LandmarkVerificationResult {
    const currentSegment = this.navEngine.getCurrentSegment();
    if (!currentSegment) {
      return {
        verified: false,
        matchType: 'NONE',
        matchedLandmark: null,
        confidence: 0,
        driftResetRecommended: false
      };
    }

    const result = this.visualLandmarkService.verify(
      currentSegment.expected_verification_landmarks,
      detectedOcrStrings,
      yoloDetections
    );

    if (result.verified && result.matchedLandmark) {
      this.navEngine.verifyVisualLandmark(result.matchedLandmark);
    }

    return result;
  }

  /**
   * Produces a real-time state snapshot for UI, Haptics, and Spatial Audio synthesis
   */
  public getSnapshot(): NavigationStateSnapshot {
    const graph = this.navEngine.getActiveGraph();
    const currentSegment = this.navEngine.getCurrentSegment();
    const isComplete = this.navEngine.isRouteCompleted();

    const relativeHeading = currentSegment ? currentSegment.heading_relative_deg : 0;
    const remainingSteps = currentSegment ? currentSegment.distance_steps : 0;

    const spatialAudio = this.spatialAudioSynth.generateBeaconParameters(
      relativeHeading,
      remainingSteps
    );

    return {
      venueId: graph ? graph.venue_id : null,
      floorLevel: graph ? graph.floor_level : null,
      currentSegmentIndex: this.navEngine.getCurrentSegmentIndex(),
      totalSegments: graph ? graph.route_path.length : 0,
      remainingStepsOnSegment: remainingSteps,
      remainingDistanceMeters: this.navEngine.getRemainingDistanceMeters(),
      relativeHeadingDeg: relativeHeading,
      isWaitingForElevation: this.navEngine.isWaitingForElevation(),
      isComplete,
      spatialAudio,
      lastVoiceInstruction: this.lastVoiceInstruction
    };
  }
}

