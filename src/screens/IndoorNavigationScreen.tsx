import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  AccessibilityInfo,
  Platform,
  Vibration
} from 'react-native';
import { VisionAudioLoop } from '../components/VisionAudioLoop';
import { AssistiveNavigationManager, NavigationStateSnapshot } from '../services/AssistiveNavigationManager';
import { VENUE_AIRPORT_SFO_T2 } from '../services/IndoorVenueData';

export const IndoorNavigationScreen: React.FC = () => {
  const navManagerRef = useRef<AssistiveNavigationManager | null>(null);
  const [navState, setNavState] = useState<NavigationStateSnapshot | null>(null);
  const [currentInstruction, setCurrentInstruction] = useState<string>('Initializing indoor navigation...');

  // Initialize navigation manager and load default multi-floor graph
  useEffect(() => {
    const manager = new AssistiveNavigationManager(0.70); // 0.70m standard stride
    navManagerRef.current = manager;

    // Start with SFO Terminal 2 Gate B12 route at baseline 1013.25 hPa
    const initialSnapshot = manager.startNavigation(VENUE_AIRPORT_SFO_T2, 1013.25);
    setNavState(initialSnapshot);
    announceToUser(initialSnapshot.lastVoiceInstruction);
  }, []);

  const announceToUser = useCallback((message: string) => {
    if (!message) return;
    setCurrentInstruction(message);
    AccessibilityInfo.announceForAccessibility(message);
  }, []);

  // Handler for pedometer step events
  const onStepDetected = useCallback(() => {
    if (!navManagerRef.current) return;

    const { result, snapshot } = navManagerRef.current.handleStepEvent(1);
    setNavState(snapshot);

    if (result.voiceInstruction) {
      announceToUser(result.voiceInstruction);
      // Gentle haptic feedback pulse on waypoint or turn instruction
      Vibration.vibrate(Platform.OS === 'android' ? 70 : 0);
    }
  }, [announceToUser]);

  // Handler for real-time barometer readings (e.g., from react-native-sensors)
  const onBarometerUpdate = useCallback((pressureHPa: number) => {
    if (!navManagerRef.current) return;

    const { levelChangeConfirmed, snapshot } = navManagerRef.current.handlePressureReading(pressureHPa);
    if (levelChangeConfirmed) {
      setNavState(snapshot);
      announceToUser(snapshot.lastVoiceInstruction);
      // Double vibration pulse for verified floor change
      Vibration.vibrate([0, 150, 100, 150]);
    }
  }, [announceToUser]);

  // Handler for visual landmark verification from VisionAudioLoop
  const onLandmarkVerified = useCallback((confidence: number) => {
    if (!navManagerRef.current) return;

    const currentSegment = navState ? navState.currentSegmentIndex : 0;
    const result = navManagerRef.current.handleCameraVerification(
      ['Gates B1-B24', 'Starbucks', 'Escalator', 'Restrooms', 'Gate B12'],
      [{ class_name: 'escalator', confidence }]
    );

    if (result.verified) {
      announceToUser(`Visual anchor confirmed: ${result.matchedLandmark}. Step drift corrected.`);
      Vibration.vibrate(80);
    }
  }, [navState, announceToUser]);

  return (
    <View style={styles.container}>
      {/* Background Computer Vision & Spatial Audio Inference Loop */}
      <VisionAudioLoop
        targetLandmark={navState?.lastVoiceInstruction || 'Waypoint'}
        onLandmarkVerified={onLandmarkVerified}
      />

      {/* Accessible High-Contrast HUD Overlay for Blind & Low-Vision Users */}
      <View style={styles.hudOverlay} pointerEvents="box-none">
        <View style={styles.cardHeader}>
          <Text style={styles.venueTitle} accessibilityRole="header">
            {navState?.venueId ? navState.venueId.replace(/_/g, ' ') : 'Indoor Navigation'}
          </Text>
          <Text style={styles.floorBadge}>
            {navState?.floorLevel || 'Departures L2'}
          </Text>
        </View>

        {/* Big Instruction Text */}
        <View
          style={styles.instructionContainer}
          accessible={true}
          accessibilityLabel={`Instruction: ${currentInstruction}`}
          accessibilityLiveRegion="assertive"
        >
          <Text style={styles.instructionText}>{currentInstruction}</Text>
        </View>

        {/* Step Counter & Distance Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>
              {navState?.remainingStepsOnSegment ?? 0}
            </Text>
            <Text style={styles.statLabel}>STEPS REMAINING</Text>
          </View>

          <View style={styles.statBox}>
            <Text style={styles.statNumber}>
              {navState?.remainingDistanceMeters ?? 0}m
            </Text>
            <Text style={styles.statLabel}>TOTAL DISTANCE</Text>
          </View>
        </View>

        {/* Manual Step Simulation Button (for indoor testing) */}
        <TouchableOpacity
          style={styles.stepButton}
          onPress={onStepDetected}
          accessibilityLabel="Simulate one forward step"
          accessibilityHint="Decrements step count and advances indoor dead-reckoning"
          accessibilityRole="button"
        >
          <Text style={styles.stepButtonText}>[+] SIMULATE STEP</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000'
  },
  hudOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    padding: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.45)'
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 36
  },
  venueTitle: {
    color: '#FFD700', // High-contrast amber/yellow
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.5
  },
  floorBadge: {
    backgroundColor: '#FFD700',
    color: '#000',
    fontSize: 14,
    fontWeight: '900',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6
  },
  instructionContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderColor: '#FFD700',
    borderWidth: 2,
    borderRadius: 12,
    padding: 20,
    marginVertical: 16
  },
  instructionText: {
    color: '#FFF',
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 34,
    textAlign: 'center'
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16
  },
  statBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#555'
  },
  statNumber: {
    color: '#00FF66', // Accessible high-contrast neon green
    fontSize: 32,
    fontWeight: '900'
  },
  statLabel: {
    color: '#AAA',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4
  },
  stepButton: {
    backgroundColor: '#FFD700',
    paddingVertical: 18,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 20
  },
  stepButtonText: {
    color: '#000',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1
  }
});

