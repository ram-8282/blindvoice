/**
 * Indoor Navigation Engine (ES Module runtime for BlindVoice)
 * Offline non-GPS dead reckoning navigation with visual landmark anchoring
 * and barometric level transition verification.
 */

export class IndoorNavigationEngine {
  constructor(strideMeters = 0.70) {
    this.activeGraph = null;
    this.currentSegmentIndex = 0;
    this.accumulatedSteps = 0;
    this.isWaitingForElevationChange = false;
    this.strideMeters = strideMeters;
  }

  loadGraph(graph) {
    this.activeGraph = graph;
    this.currentSegmentIndex = 0;
    this.accumulatedSteps = 0;
    this.isWaitingForElevationChange = false;
  }

  getActiveGraph() {
    return this.activeGraph;
  }

  getCurrentSegmentIndex() {
    return this.currentSegmentIndex;
  }

  getCurrentSegment() {
    if (!this.activeGraph || this.currentSegmentIndex >= this.activeGraph.route_path.length) {
      return null;
    }
    return this.activeGraph.route_path[this.currentSegmentIndex];
  }

  isWaitingForElevation() {
    return this.isWaitingForElevationChange;
  }

  isRouteCompleted() {
    if (!this.activeGraph) return false;
    return this.currentSegmentIndex >= this.activeGraph.route_path.length;
  }

  handleElevationComplete() {
    this.isWaitingForElevationChange = false;
    this.currentSegmentIndex++;
    this.accumulatedSteps = 0;
  }

  processStep(deltaSteps = 1) {
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

    // Handle initial inspection query
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

    // Mid-segment countdown every 10 steps
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

  /**
   * Re-anchor the user's position (used when a camera-verified landmark proves the
   * step count has drifted). Clears any pending level-change wait.
   */
  setPosition(segmentIndex, stepsIntoSegment = 0) {
    if (!this.activeGraph) return;
    const last = this.activeGraph.route_path.length - 1;
    this.currentSegmentIndex = Math.max(0, Math.min(segmentIndex, last));
    const seg = this.activeGraph.route_path[this.currentSegmentIndex];
    this.accumulatedSteps = Math.max(0, Math.min(stepsIntoSegment, seg.distance_steps - 1));
    this.isWaitingForElevationChange = false;
  }

  getAccumulatedSteps() {
    return this.accumulatedSteps;
  }

  verifyElevationChange(deltaAltitudeMeters) {
    if (!this.activeGraph || !this.isWaitingForElevationChange) {
      return false;
    }

    const currentSegment = this.activeGraph.route_path[this.currentSegmentIndex];
    if (!currentSegment || !currentSegment.requires_level_change) {
      return false;
    }

    // Check threshold of Δh ≥ 3.8m
    if (Math.abs(deltaAltitudeMeters) >= 3.8) {
      this.handleElevationComplete();
      return true;
    }

    return false;
  }

  verifyVisualLandmark(detectedText) {
    const currentSegment = this.getCurrentSegment();
    if (!currentSegment || !currentSegment.expected_verification_landmarks) {
      return false;
    }

    const normalizedDetected = String(detectedText).toLowerCase().trim();
    return currentSegment.expected_verification_landmarks.some(landmark =>
      normalizedDetected.includes(landmark.toLowerCase().trim()) ||
      landmark.toLowerCase().trim().includes(normalizedDetected)
    );
  }

  getRemainingDistanceMeters() {
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

  buildTurnInstruction(segment) {
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
