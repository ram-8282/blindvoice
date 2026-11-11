export interface StartAnchorNode {
  node_id: string;
  visual_landmark_text: string;
  expected_icon_type: string;
}

export interface RouteSegment {
  segment_index: number;
  from_node: string;
  to_node: string;
  distance_steps: number;
  heading_relative_deg: number;
  expected_verification_landmarks: string[];
  requires_level_change: boolean;
  level_change_type: 'ESCALATOR' | 'STAIRS' | 'ELEVATOR' | 'NONE';
}

export interface VenueGraph {
  venue_id: string;
  floor_level: string;
  start_anchor_node: StartAnchorNode;
  route_path: RouteSegment[];
}

export interface StepProcessResult {
  remainingSteps: number;
  voiceInstruction: string;
  requiresVerification: boolean;
  isComplete: boolean;
}

export class IndoorNavigationEngine {
  private activeGraph: VenueGraph | null = null;
  private currentSegmentIndex: number = 0;
  private accumulatedSteps: number = 0;
  private isWaitingForElevationChange: boolean = false;
  private strideMeters: number = 0.70;

  constructor(strideMeters: number = 0.70) {
    this.strideMeters = strideMeters;
  }

  public loadGraph(graph: VenueGraph): void {
    this.activeGraph = graph;
    this.currentSegmentIndex = 0;
    this.accumulatedSteps = 0;
    this.isWaitingForElevationChange = false;
  }

  public getActiveGraph(): VenueGraph | null {
    return this.activeGraph;
  }

  public getCurrentSegmentIndex(): number {
    return this.currentSegmentIndex;
  }

  public getCurrentSegment(): RouteSegment | null {
    if (!this.activeGraph || this.currentSegmentIndex >= this.activeGraph.route_path.length) {
      return null;
    }
    return this.activeGraph.route_path[this.currentSegmentIndex];
  }

  public isWaitingForElevation(): boolean {
    return this.isWaitingForElevationChange;
  }

  public isRouteCompleted(): boolean {
    if (!this.activeGraph) return false;
    return this.currentSegmentIndex >= this.activeGraph.route_path.length;
  }

  public handleElevationComplete(): void {
    this.isWaitingForElevationChange = false;
    this.currentSegmentIndex++;
    this.accumulatedSteps = 0;
  }

  public processStep(deltaSteps: number = 1): StepProcessResult {
    if (!this.activeGraph) {
      throw new Error("No active venue graph loaded.");
    }

    if (this.isRouteCompleted()) {
      return {
        remainingSteps: 0,
        voiceInstruction: "You have arrived at your destination.",
        requiresVerification: false,
        isComplete: true
      };
    }

    const currentSegment = this.activeGraph.route_path[this.currentSegmentIndex];

    if (this.isWaitingForElevationChange) {
      return {
        remainingSteps: 0,
        voiceInstruction: `Please take the ${currentSegment.level_change_type.toLowerCase()}. Awaiting barometric verification.`,
        requiresVerification: true,
        isComplete: false
      };
    }

    // Handle initialization or initial inspection query
    if (deltaSteps === 0 && this.accumulatedSteps === 0) {
      return {
        remainingSteps: currentSegment.distance_steps,
        voiceInstruction: `Continue straight ahead toward ${currentSegment.expected_verification_landmarks[0] || 'waypoint'} for ${currentSegment.distance_steps} steps.`,
        requiresVerification: false,
        isComplete: false
      };
    }

    this.accumulatedSteps += deltaSteps;
    const remainingSteps = Math.max(0, currentSegment.distance_steps - this.accumulatedSteps);

    if (remainingSteps === 0) {
      if (currentSegment.requires_level_change && currentSegment.level_change_type !== 'NONE') {
        this.isWaitingForElevationChange = true;
        const levelAction = currentSegment.level_change_type === 'ESCALATOR'
          ? 'take the escalator and hold the handrail'
          : `use the ${currentSegment.level_change_type.toLowerCase()}`;
        return {
          remainingSteps: 0,
          voiceInstruction: `Arrived at ${currentSegment.level_change_type.toLowerCase()}. Please ${levelAction}. Awaiting barometric verification.`,
          requiresVerification: true,
          isComplete: false
        };
      }

      // Advance to next segment
      this.currentSegmentIndex++;
      this.accumulatedSteps = 0;

      if (this.currentSegmentIndex >= this.activeGraph.route_path.length) {
        return {
          remainingSteps: 0,
          voiceInstruction: "You have arrived at your destination.",
          requiresVerification: false,
          isComplete: true
        };
      }

      const nextSegment = this.activeGraph.route_path[this.currentSegmentIndex];
      const turnInstruction = this.buildTurnInstruction(nextSegment);

      return {
        remainingSteps: nextSegment.distance_steps,
        voiceInstruction: turnInstruction,
        requiresVerification: nextSegment.expected_verification_landmarks.length > 0,
        isComplete: false
      };
    }

    // Mid-segment reassurance every 10 steps
    if (remainingSteps % 10 === 0) {
      return {
        remainingSteps,
        voiceInstruction: `Continue straight ahead for ${remainingSteps} steps.`,
        requiresVerification: false,
        isComplete: false
      };
    }

    return {
      remainingSteps,
      voiceInstruction: "",
      requiresVerification: false,
      isComplete: false
    };
  }

  public verifyElevationChange(deltaAltitudeMeters: number): boolean {
    if (!this.activeGraph || !this.isWaitingForElevationChange) {
      return false;
    }

    const currentSegment = this.activeGraph.route_path[this.currentSegmentIndex];
    if (!currentSegment || !currentSegment.requires_level_change) {
      return false;
    }

    // Threshold of Δh ≥ 3.8m for vertical floor transition
    if (Math.abs(deltaAltitudeMeters) >= 3.8) {
      this.handleElevationComplete();
      return true;
    }

    return false;
  }

  public verifyVisualLandmark(detectedText: string): boolean {
    const currentSegment = this.getCurrentSegment();
    if (!currentSegment || !currentSegment.expected_verification_landmarks) {
      return false;
    }

    const normalizedDetected = detectedText.toLowerCase().trim();
    return currentSegment.expected_verification_landmarks.some(landmark =>
      normalizedDetected.includes(landmark.toLowerCase().trim()) ||
      landmark.toLowerCase().trim().includes(normalizedDetected)
    );
  }

  public getRemainingDistanceMeters(): number {
    if (!this.activeGraph || this.isRouteCompleted()) {
      return 0;
    }

    let totalRemainingSteps = 0;
    const currentSegment = this.activeGraph.route_path[this.currentSegmentIndex];
    if (currentSegment) {
      totalRemainingSteps += Math.max(0, currentSegment.distance_steps - this.accumulatedSteps);
    }

    for (let i = this.currentSegmentIndex + 1; i < this.activeGraph.route_path.length; i++) {
      totalRemainingSteps += this.activeGraph.route_path[i].distance_steps;
    }

    return Number((totalRemainingSteps * this.strideMeters).toFixed(1));
  }

  private buildTurnInstruction(segment: RouteSegment): string {
    let action = "Continue straight ahead";
    if (segment.heading_relative_deg === 90) action = "Turn 90 degrees right";
    else if (segment.heading_relative_deg === 270) action = "Turn 90 degrees left";
    else if (segment.heading_relative_deg === 180) action = "Turn 180 degrees around";

    const landmarkCue = segment.expected_verification_landmarks && segment.expected_verification_landmarks.length > 0
      ? ` toward ${segment.expected_verification_landmarks[0]}`
      : "";

    if (segment.requires_level_change && segment.level_change_type !== 'NONE') {
      const levelAction = segment.level_change_type === 'ESCALATOR' ? 'take the escalator' : `use the ${segment.level_change_type.toLowerCase()}`;
      return `${action}${landmarkCue} and ${levelAction}.`;
    }

    return `${action}${landmarkCue} for ${segment.distance_steps} steps.`;
  }
}
